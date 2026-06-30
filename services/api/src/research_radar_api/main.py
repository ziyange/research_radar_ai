from collections.abc import Callable
from dataclasses import asdict
from datetime import datetime, timezone
from time import monotonic
from typing import Any
from uuid import uuid4

import httpx
from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from .ai import (
    AiOutputValidationError,
    AiProvider,
    AiProviderConfigError,
    validate_analysis_safety,
)
from .agent_scan import AgentScanRequest, StandaloneResearchScanAgent
from .db import database_health
from .literature import router as literature_router
from .notifications import publish_report_notifications
from .retrieval import (
    CrossrefAdapter,
    NormalizedRecord,
    OpenAlexAdapter,
    RetrievalAdapter,
    RetrievalRunResult,
)
from .schemas import (
    AnalysisClaim,
    AnalysisRequest,
    AuthResponse,
    FeedbackRequest,
    KnowledgeCreate,
    KnowledgeItem,
    KnowledgePatch,
    LoginRequest,
    PaperAnalysis,
    ProfileGenerateRequest,
    ProjectCreate,
    ProjectUpdate,
    RecommendationList,
    RegisterRequest,
    ResearchProfile,
    ResearchProfilePatch,
    ResearchProject,
    SearchTask,
    TaskStatus,
    UploadRecord,
    User,
    UserFeedback,
    make_id,
    now_utc,
)
from .settings import Settings, get_settings
from .store import store


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="Research Radar AI API",
        version="0.1.0",
        description="Document-first MVP API for RR-MVP requirements.",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def request_id_middleware(request: Request, call_next: Callable[..., Any]):
        request_id = request.headers.get("x-request-id", f"req_{uuid4().hex[:12]}")
        request.state.request_id = request_id
        response = await call_next(request)
        response.headers["x-request-id"] = request_id
        return response

    @app.exception_handler(HTTPException)
    async def http_exception_handler(request: Request, exc: HTTPException):
        if isinstance(exc.detail, dict):
            code = exc.detail.get("code", "REQUEST_FAILED")
            message = exc.detail.get("message", code)
            details = exc.detail.get("details", {})
        else:
            code = "VALIDATION_ERROR" if exc.status_code == 422 else "REQUEST_FAILED"
            message = str(exc.detail)
            details = {}
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "request_id": getattr(request.state, "request_id", f"req_{uuid4().hex[:12]}"),
                "error": {
                    "code": code,
                    "message": message,
                    "details": details,
                },
            },
        )

    return app


app = create_app()
app.include_router(literature_router)


def envelope(request: Request, data: Any) -> dict[str, Any]:
    return {"request_id": request.state.request_id, "data": data}


def current_user(request: Request) -> User:
    settings = get_settings()
    user_id = request.headers.get("x-user-id")
    if not user_id and settings.app_env == "development":
        user_id = settings.dev_user_id
    if not user_id:
        raise HTTPException(status_code=401, detail="AUTH_REQUIRED")
    user = store.users.get(user_id)
    if not user:
        raise HTTPException(status_code=401, detail="UNAUTHORIZED")
    return user


def get_project_for_user(project_id: str, user: User) -> ResearchProject:
    project = store.projects.get(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if project.owner_id != user.id and user.role != "admin":
        raise HTTPException(status_code=403, detail="FORBIDDEN")
    return project


@app.get("/api/v1/health")
def health(request: Request, settings: Settings = Depends(get_settings)):
    return envelope(
        request,
        {
            "status": "ok",
            "app_env": settings.app_env,
            "ai_provider": settings.ai_provider,
            "ai": {
                "provider": settings.ai_provider,
                "model": settings.openai_model if settings.ai_provider == "openai" else "mock-research-radar",
                "configured": settings.ai_configured,
                "base_url_host": settings.openai_base_url_host
                if settings.ai_provider == "openai"
                else None,
            },
            "retrieval_provider": settings.retrieval_provider,
            "demo_seed_enabled": settings.demo_seed_enabled,
            "database": asdict(database_health(settings.database_url)),
            "requirements": ["RR-MVP-001", "RR-MVP-034"],
            "time": datetime.now(timezone.utc).isoformat(),
        },
    )


@app.post("/api/v1/agent/research-scan:run")
async def run_agent_research_scan(
    payload: AgentScanRequest,
    request: Request,
    settings: Settings = Depends(get_settings),
    user: User = Depends(current_user),
):
    if payload.project_id:
        get_project_for_user(payload.project_id, user)
    if (
        (
            payload.query_expansion == "ai"
            or (payload.hitl_mode == "auto_analyze" and payload.analyze_top_n > 0)
        )
        and settings.ai_provider == "openai"
        and not settings.ai_configured
    ):
        raise HTTPException(
            status_code=400,
            detail={
                "code": "AI_PROVIDER_CONFIG_MISSING",
                "message": "AI_PROVIDER=openai 时必须配置 OPENAI_API_KEY、OPENAI_BASE_URL 和 OPENAI_MODEL。",
            },
        )
    try:
        result = await StandaloneResearchScanAgent(store, settings).run(payload, user)
    except AiOutputValidationError as exc:
        raise HTTPException(
            status_code=502,
            detail={
                "code": "AI_RETRIEVAL_PLAN_INVALID",
                "message": f"AI 检索规划输出无效：{exc}",
            },
        ) from exc
    store.audit(
        "agent.research_scan",
        "RR-FUTURE-010",
        user_id=user.id,
        project_id=payload.project_id,
    )
    return envelope(request, result)


@app.post("/api/v1/auth/register")
def register(payload: RegisterRequest, request: Request):
    user = User(
        id=make_id("usr"),
        email=payload.email,
        display_name=payload.display_name,
        quota_balance=100,
    )
    store.users[user.id] = user
    store.audit("auth.register", "RR-MVP-001", user_id=user.id)
    return envelope(request, AuthResponse(user=user, session_token=f"dev_{user.id}"))


@app.post("/api/v1/auth/login")
def login(payload: LoginRequest, request: Request):
    user = next((item for item in store.users.values() if item.email == payload.email), None)
    if not user:
        raise HTTPException(status_code=401, detail="UNAUTHORIZED")
    store.audit("auth.login", "RR-MVP-001", user_id=user.id)
    return envelope(request, AuthResponse(user=user, session_token=f"dev_{user.id}"))


@app.post("/api/v1/auth/logout")
def logout(request: Request, user: User = Depends(current_user)):
    store.audit("auth.logout", "RR-MVP-001", user_id=user.id)
    return envelope(request, {"ok": True})


@app.get("/api/v1/me")
def me(request: Request, user: User = Depends(current_user)):
    return envelope(request, user)


@app.get("/api/v1/projects")
def list_projects(request: Request, user: User = Depends(current_user)):
    projects = [item for item in store.projects.values() if item.owner_id == user.id]
    return envelope(request, projects)


@app.post("/api/v1/projects")
def create_project(payload: ProjectCreate, request: Request, user: User = Depends(current_user)):
    project = ResearchProject(
        id=make_id("proj"),
        owner_id=user.id,
        name=payload.name,
        discipline=payload.discipline,
        description=payload.description,
    )
    store.projects[project.id] = project
    store.audit("project.create", "RR-MVP-002", user_id=user.id, project_id=project.id)
    return envelope(request, project)


@app.get("/api/v1/projects/{project_id}")
def get_project(project_id: str, request: Request, user: User = Depends(current_user)):
    return envelope(request, get_project_for_user(project_id, user))


@app.patch("/api/v1/projects/{project_id}")
def update_project(
    project_id: str,
    payload: ProjectUpdate,
    request: Request,
    user: User = Depends(current_user),
):
    project = get_project_for_user(project_id, user)
    update = payload.model_dump(exclude_unset=True)
    for key, value in update.items():
        setattr(project, key, value)
    project.updated_at = now_utc()
    store.audit("project.update", "RR-MVP-002", user_id=user.id, project_id=project.id)
    return envelope(request, project)


@app.post("/api/v1/projects/{project_id}:archive")
def archive_project(project_id: str, request: Request, user: User = Depends(current_user)):
    project = get_project_for_user(project_id, user)
    project.status = "archived"
    project.updated_at = now_utc()
    store.audit("project.archive", "RR-MVP-002", user_id=user.id, project_id=project.id)
    return envelope(request, project)


def profile_from_payload(
    project: ResearchProject,
    source_payload: dict[str, Any],
    source_type: str,
) -> ResearchProfile:
    existing_versions = [item.version for item in store.profiles.values() if item.project_id == project.id]
    return ResearchProfile(
        id=make_id("profile"),
        project_id=project.id,
        version=(max(existing_versions) + 1) if existing_versions else 1,
        source_type=source_type,  # type: ignore[arg-type]
        discipline=source_payload.get("discipline") or project.discipline,
        subfield=source_payload.get("subfield"),
        research_object=source_payload.get("research_object") or [],
        research_questions=source_payload.get("research_questions") or [],
        goals=source_payload.get("goals") or [],
        methods=source_payload.get("methods") or [],
        materials=source_payload.get("materials") or [],
        reagents=source_payload.get("reagents") or [],
        metrics=source_payload.get("metrics") or [],
        mechanisms=source_payload.get("mechanisms") or [],
        applications=source_payload.get("applications") or [],
        keywords_zh=source_payload.get("keywords_zh") or [],
        keywords_en=source_payload.get("keywords_en") or [],
        synonyms=source_payload.get("synonyms") or [],
        exclusions=source_payload.get("exclusions") or [],
        confidence=float(source_payload.get("confidence") or 0.72),
    )


def rough_token_count(text: str) -> int:
    return max(1, len(text) // 2)


@app.post("/api/v1/projects/{project_id}/profile:generate")
async def generate_profile(
    project_id: str,
    payload: ProfileGenerateRequest,
    request: Request,
    settings: Settings = Depends(get_settings),
    user: User = Depends(current_user),
):
    project = get_project_for_user(project_id, user)
    try:
        source_payload = await AiProvider(settings).generate_profile_payload(
            project=project,
            one_sentence=payload.one_sentence,
        )
        profile = profile_from_payload(project, source_payload, "one_sentence")
    except AiProviderConfigError as exc:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "AI_PROVIDER_CONFIG_MISSING",
                "message": "AI provider is not configured.",
                "details": {"reason": str(exc)},
            },
        ) from exc
    except (AiOutputValidationError, ValueError, ValidationError) as exc:
        raise HTTPException(
            status_code=502,
            detail={
                "code": "AI_OUTPUT_SCHEMA_INVALID",
                "message": "AI profile output did not match the required schema.",
                "details": {},
            },
        ) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502,
            detail={
                "code": "AI_PROVIDER_REQUEST_FAILED",
                "message": "AI provider request failed.",
                "details": {},
            },
        ) from exc
    store.profiles[profile.id] = profile
    store.add_cost(
        user_id=user.id,
        project_id=project.id,
        feature="profile.generate",
        requirement_id="RR-MVP-003",
        provider=settings.ai_provider,
        model=settings.openai_model if settings.ai_provider == "openai" else "mock-research-radar",
        quota_delta=0,
        estimated_cost=0.0 if settings.ai_provider == "mock" else 0.01,
        input_tokens=rough_token_count(f"{project.name} {project.description or ''} {payload.one_sentence}"),
        output_tokens=rough_token_count(str(source_payload)),
    )
    return envelope(request, profile)


@app.get("/api/v1/projects/{project_id}/profile")
def get_profile(project_id: str, request: Request, user: User = Depends(current_user)):
    project = get_project_for_user(project_id, user)
    if not project.current_profile_id:
        profiles = [item for item in store.profiles.values() if item.project_id == project.id]
        if not profiles:
            raise HTTPException(status_code=404, detail="Profile not found")
        profile = sorted(profiles, key=lambda item: item.version)[-1]
    else:
        profile = store.profiles[project.current_profile_id]
    return envelope(request, profile)


@app.patch("/api/v1/projects/{project_id}/profile")
def patch_profile(
    project_id: str,
    payload: ResearchProfilePatch,
    request: Request,
    user: User = Depends(current_user),
):
    project = get_project_for_user(project_id, user)
    profiles = sorted(
        [item for item in store.profiles.values() if item.project_id == project.id],
        key=lambda item: item.version,
    )
    if not profiles:
        raise HTTPException(status_code=404, detail="Profile not found")
    profile = profiles[-1].model_copy(deep=True)
    profile.id = make_id("profile")
    profile.version += 1
    profile.source_type = "manual"
    profile.status = "draft"
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(profile, key, value)
    store.profiles[profile.id] = profile
    store.audit("profile.patch", "RR-MVP-007", user_id=user.id, project_id=project.id)
    return envelope(request, profile)


@app.post("/api/v1/projects/{project_id}/profile:confirm")
def confirm_profile(project_id: str, request: Request, user: User = Depends(current_user)):
    project = get_project_for_user(project_id, user)
    profiles = sorted(
        [item for item in store.profiles.values() if item.project_id == project.id],
        key=lambda item: item.version,
    )
    if not profiles:
        raise HTTPException(status_code=404, detail="Profile not found")
    for profile in profiles:
        if profile.status == "confirmed":
            profile.status = "superseded"
    profile = profiles[-1]
    profile.status = "confirmed"
    project.current_profile_id = profile.id
    project.updated_at = now_utc()
    store.audit("profile.confirm", "RR-MVP-007", user_id=user.id, project_id=project.id)
    return envelope(request, profile)


@app.get("/api/v1/projects/{project_id}/profile/versions")
def profile_versions(project_id: str, request: Request, user: User = Depends(current_user)):
    project = get_project_for_user(project_id, user)
    profiles = sorted(
        [item for item in store.profiles.values() if item.project_id == project.id],
        key=lambda item: item.version,
    )
    return envelope(request, profiles)


@app.get("/api/v1/projects/{project_id}/diagnosis")
def first_day_diagnosis(project_id: str, request: Request, user: User = Depends(current_user)):
    project = get_project_for_user(project_id, user)
    profile = store.profiles.get(project.current_profile_id or "")
    if not profile:
        profiles = [item for item in store.profiles.values() if item.project_id == project.id]
        if not profiles:
            raise HTTPException(status_code=404, detail="Profile not found")
        profile = sorted(profiles, key=lambda item: item.version)[-1]
    recs = store.create_recommendations(project.id, profile.id)
    return envelope(
        request,
        {
            "requirement_id": "RR-MVP-008",
            "understanding": {
                "research_object": profile.research_object,
                "methods": profile.methods,
                "materials": profile.materials,
            },
            "keywords_zh": profile.keywords_zh,
            "keywords_en": profile.keywords_en,
            "highly_related_papers": recs[:3],
            "method_transfer_papers": [item for item in recs if item.channel == "method_transfer"][:2],
            "research_gap_candidate": "二胺改性后界面键合强度与热压窗口的系统比较仍不足。",
            "technical_route": "脱木质素 -> 高碘酸钠氧化 -> 二胺改性 -> 热压成型 -> 性能评价",
            "knowledge_gap": "缺少不同氧化程度、二胺种类和热压参数之间的可比证据。",
        },
    )


@app.post("/api/v1/projects/{project_id}/uploads")
async def upload_file(
    project_id: str,
    request: Request,
    upload_type: str = "research_material",
    file: UploadFile = File(...),
    user: User = Depends(current_user),
):
    project = get_project_for_user(project_id, user)
    content = await file.read()
    record = UploadRecord(
        id=make_id("upload"),
        project_id=project.id,
        upload_type=upload_type,  # type: ignore[arg-type]
        filename=file.filename or "upload.bin",
        content_type=file.content_type or "application/octet-stream",
        size=len(content),
    )
    store.uploads[record.id] = record
    task = TaskStatus(
        task_id=make_id("task"),
        type="file_parse",
        status="pending",
        retryable=True,
        message="文件已进入解析队列。",
    )
    store.tasks[task.task_id] = task
    store.audit("upload.create", "RR-MVP-004", user_id=user.id, project_id=project.id)
    return envelope(request, {"upload": record, "task": task})


@app.get("/api/v1/projects/{project_id}/uploads")
def list_uploads(project_id: str, request: Request, user: User = Depends(current_user)):
    project = get_project_for_user(project_id, user)
    return envelope(
        request,
        [item for item in store.uploads.values() if item.project_id == project.id],
    )


@app.get("/api/v1/uploads/{upload_id}")
def get_upload(upload_id: str, request: Request, user: User = Depends(current_user)):
    upload = store.uploads.get(upload_id)
    if not upload:
        raise HTTPException(status_code=404, detail="Upload not found")
    get_project_for_user(upload.project_id, user)
    return envelope(request, upload)


def unique_terms(*groups: list[str]) -> list[str]:
    terms: list[str] = []
    seen: set[str] = set()
    for group in groups:
        for value in group:
            term = value.strip()
            marker = term.lower()
            if not term or marker in seen:
                continue
            seen.add(marker)
            terms.append(term)
    return terms


def query_from_terms(terms: list[str], fallback: str) -> str:
    selected = terms[:4]
    if not selected:
        selected = [fallback]
    return " AND ".join(f"({term})" for term in selected)


def build_search_task_specs(profile: ResearchProfile) -> list[tuple[str, str]]:
    exact_terms = unique_terms(
        profile.keywords_en,
        profile.research_object,
        profile.methods,
        profile.materials,
    )
    expanded_terms = unique_terms(
        profile.synonyms,
        profile.materials,
        profile.metrics,
        profile.applications,
        profile.keywords_en,
    )
    method_terms = unique_terms(
        profile.methods,
        profile.mechanisms,
        profile.metrics,
        profile.materials,
    )
    return [
        ("exact", query_from_terms(exact_terms, "research topic")),
        ("expanded", query_from_terms(expanded_terms, "related research")),
        ("method_transfer", query_from_terms(method_terms, "research method")),
    ]


@app.post("/api/v1/projects/{project_id}/search-tasks:generate")
def generate_search_tasks(project_id: str, request: Request, user: User = Depends(current_user)):
    project = get_project_for_user(project_id, user)
    if not project.current_profile_id:
        raise HTTPException(status_code=422, detail="Confirm profile before search planning")
    profile = store.profiles[project.current_profile_id]
    if [item for item in store.search_tasks.values() if item.project_id == project.id]:
        tasks = [item for item in store.search_tasks.values() if item.project_id == project.id]
        return envelope(request, tasks)
    tasks: list[SearchTask] = []
    for task_type, query in build_search_task_specs(profile):
        task = SearchTask(
            id=make_id("search"),
            project_id=project.id,
            profile_id=profile.id,
            task_type=task_type,  # type: ignore[arg-type]
            query_text=query,
            filters={"year_from": 2021, "open_access_only": False},
        )
        store.search_tasks[task.id] = task
        tasks.append(task)
    store.audit("search_tasks.generate", "RR-MVP-009", user_id=user.id, project_id=project.id)
    return envelope(request, tasks)


@app.get("/api/v1/projects/{project_id}/search-tasks")
def list_search_tasks(project_id: str, request: Request, user: User = Depends(current_user)):
    project = get_project_for_user(project_id, user)
    return envelope(
        request,
        [item for item in store.search_tasks.values() if item.project_id == project.id],
    )


def retrieval_adapters(settings: Settings) -> list[RetrievalAdapter]:
    return [
        OpenAlexAdapter(
            timeout=settings.retrieval_timeout_seconds,
            email=settings.openalex_email,
        ),
        CrossrefAdapter(timeout=settings.retrieval_timeout_seconds),
    ]


def fallback_open_records(task: SearchTask, source: str | None = None) -> list[NormalizedRecord]:
    query_hint = task.query_text.replace("(", " ").replace(")", " ")
    records = [
        NormalizedRecord(
            source="openalex",
            source_identifier=f"fallback-openalex-{task.id}-1",
            title="Periodate oxidation of cellulose-rich biomass for aldehyde mediated crosslinking",
            authors=["Fallback OpenAlex"],
            year=2024,
            journal="Open Metadata Fallback",
            doi=f"10.5555/{task.id}.openalex",
            abstract=f"OpenAlex-shaped fallback record for {query_hint} with periodate oxidation and biomass crosslinking.",
            keywords=["periodate oxidation", "biomass", "crosslinking"],
            url="https://api.openalex.org/works",
            open_access=True,
            raw_payload={"fallback": True, "source": "openalex", "query": task.query_text},
            quality_score=0.62,
        ),
        NormalizedRecord(
            source="crossref",
            source_identifier=f"fallback-crossref-{task.id}-1",
            title="Diamine crosslinking strategies in hot pressed lignocellulosic composites",
            authors=["Fallback Crossref"],
            year=2023,
            journal="Open Metadata Fallback",
            doi=f"10.5555/{task.id}.crossref",
            abstract=f"Crossref-shaped fallback record for {query_hint} covering diamine and hot pressing methods.",
            keywords=["diamine", "hot pressing", "lignocellulosic composite"],
            url="https://api.crossref.org/works",
            open_access=False,
            raw_payload={"fallback": True, "source": "crossref", "query": task.query_text},
            quality_score=0.6,
        ),
    ]
    return [record for record in records if source is None or record.source == source]


def retrieval_error_code(exc: Exception) -> str:
    if isinstance(exc, httpx.TimeoutException):
        return "timeout"
    if isinstance(exc, httpx.HTTPStatusError):
        if exc.response.status_code == 429:
            return "rate_limited"
        return f"http_{exc.response.status_code}"
    if isinstance(exc, httpx.RequestError):
        return "request_error"
    return exc.__class__.__name__


async def run_retrieval_adapter(
    adapter: RetrievalAdapter,
    task: SearchTask,
    settings: Settings,
) -> RetrievalRunResult:
    started = monotonic()
    try:
        records = await adapter.search(
            query=task.query_text,
            filters=task.filters,
            limit=settings.retrieval_max_results_per_source,
        )
        return RetrievalRunResult(
            source=adapter.source,
            status="succeeded",
            records=records,
            elapsed_ms=int((monotonic() - started) * 1000),
        )
    except Exception as exc:
        return RetrievalRunResult(
            source=adapter.source,
            status="failed",
            records=[],
            elapsed_ms=int((monotonic() - started) * 1000),
            error_code=retrieval_error_code(exc),
            error_message=str(exc)[:300],
            fallback_reason=None,
        )


@app.post("/api/v1/search-tasks/{task_id}:run")
async def run_search_task(
    task_id: str,
    request: Request,
    user: User = Depends(current_user),
    settings: Settings = Depends(get_settings),
):
    task = store.search_tasks.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Search task not found")
    get_project_for_user(task.project_id, user)
    task.status = "running"
    store.search_tasks[task.id] = task
    fetched = 0
    records: list[NormalizedRecord] = []
    run_results: list[RetrievalRunResult] = []
    if settings.retrieval_provider == "mock":
        records = fallback_open_records(task)
        run_results = [
            RetrievalRunResult(
                source=source,
                status="succeeded",
                records=[record for record in records if record.source == source],
                fallback_reason="mock retrieval provider uses deterministic open metadata records.",
            )
            for source in {"openalex", "crossref"}
        ]
    else:
        for adapter in retrieval_adapters(settings):
            result = await run_retrieval_adapter(adapter, task, settings)
            run_results.append(result)
            records.extend(result.records)

    for record in records:
        store.ingest_source_record(task.id, record)
        fetched += 1
    task.status = "succeeded" if fetched else "failed"
    task.last_run_at = now_utc()
    store.search_tasks[task.id] = task
    recommendations = store.create_recommendations(
        task.project_id,
        task.profile_id,
        force_refresh=True,
    )
    degraded = any(result.status == "degraded" for result in run_results)
    failed_sources = [result.source for result in run_results if result.status == "failed"]
    status = TaskStatus(
        task_id=task.id,
        type="search_task",
        status="succeeded" if fetched else "failed",
        retryable=bool(degraded or failed_sources),
        error_code="source_degraded" if degraded else ("all_sources_failed" if failed_sources else None),
        message=(
            f"检索任务已完成，保存 {fetched} 条来源记录，生成 {len(recommendations)} 条推荐。"
            + (" 部分来源已降级，详见 source_statuses。" if degraded else "")
        ),
        degraded=degraded,
        source_statuses=[result.status_payload() for result in run_results],
    )
    store.tasks[status.task_id] = status
    store.audit("search_task.run", "RR-MVP-011", user_id=user.id, project_id=task.project_id)
    return envelope(request, status)


@app.get("/api/v1/search-tasks/{task_id}")
def get_search_task(task_id: str, request: Request, user: User = Depends(current_user)):
    task = store.search_tasks.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Search task not found")
    get_project_for_user(task.project_id, user)
    return envelope(request, task)


@app.get("/api/v1/tasks/{task_id}")
def get_task_status(task_id: str, request: Request, user: User = Depends(current_user)):
    search_task = store.search_tasks.get(task_id)
    if search_task:
        get_project_for_user(search_task.project_id, user)
    status = store.tasks.get(task_id)
    if status:
        return envelope(request, status)
    if search_task:
        bridged_status = "waiting" if search_task.status == "paused" else search_task.status
        return envelope(
            request,
            TaskStatus(
                task_id=search_task.id,
                type="search_task",
                status=bridged_status,  # type: ignore[arg-type]
                message="检索任务尚未运行。" if search_task.status == "pending" else None,
            ),
        )
    raise HTTPException(status_code=404, detail="Task not found")


@app.get("/api/v1/search-tasks/{task_id}/source-records")
def get_search_task_source_records(
    task_id: str,
    request: Request,
    user: User = Depends(current_user),
):
    task = store.search_tasks.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Search task not found")
    get_project_for_user(task.project_id, user)
    records = [
        item for item in store.source_records.values() if item.search_task_id == task.id
    ]
    return envelope(request, records)


@app.get("/api/v1/papers/{paper_id}")
def get_paper(paper_id: str, request: Request):
    paper = store.papers.get(paper_id)
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")
    return envelope(request, paper)


@app.get("/api/v1/papers/{paper_id}/versions")
def get_paper_versions(paper_id: str, request: Request):
    if paper_id not in store.papers:
        raise HTTPException(status_code=404, detail="Paper not found")
    return envelope(
        request,
        [item for item in store.paper_versions.values() if item.paper_id == paper_id],
    )


@app.get("/api/v1/projects/{project_id}/recommendations")
def recommendations(project_id: str, request: Request, user: User = Depends(current_user)):
    project = get_project_for_user(project_id, user)
    if not project.current_profile_id:
        raise HTTPException(status_code=422, detail="Confirm profile before recommendations")
    items = store.create_recommendations(project.id, project.current_profile_id)
    return envelope(request, RecommendationList(items=items))


@app.post("/api/v1/projects/{project_id}/recommendations:refresh")
def refresh_recommendations(project_id: str, request: Request, user: User = Depends(current_user)):
    project = get_project_for_user(project_id, user)
    if not project.current_profile_id:
        raise HTTPException(status_code=422, detail="Confirm profile before recommendations")
    items = store.create_recommendations(project.id, project.current_profile_id, force_refresh=True)
    store.audit("recommendations.refresh", "RR-MVP-016", user_id=user.id, project_id=project.id)
    return envelope(request, RecommendationList(items=items))


@app.get("/api/v1/recommendations/{recommendation_id}")
def recommendation_detail(recommendation_id: str, request: Request, user: User = Depends(current_user)):
    rec = store.recommendations.get(recommendation_id)
    if not rec:
        raise HTTPException(status_code=404, detail="Recommendation not found")
    get_project_for_user(rec.project_id, user)
    return envelope(request, rec)


@app.post("/api/v1/recommendations/{recommendation_id}/feedback")
def submit_feedback(
    recommendation_id: str,
    payload: FeedbackRequest,
    request: Request,
    user: User = Depends(current_user),
):
    rec = store.recommendations.get(recommendation_id)
    if not rec:
        raise HTTPException(status_code=404, detail="Recommendation not found")
    project = get_project_for_user(rec.project_id, user)
    feedback = UserFeedback(
        id=make_id("fb"),
        user_id=user.id,
        project_id=project.id,
        paper_id=rec.paper.id,
        recommendation_id=rec.id,
        feedback_type=payload.feedback_type,
        note=payload.note,
    )
    store.feedback[feedback.id] = feedback
    if payload.feedback_type in {"irrelevant", "exclude_material", "exclude_application"}:
        rec.score_total = max(0.1, round(rec.score_total - 0.2, 2))
    elif payload.feedback_type in {"very_relevant", "method_useful", "want_more"}:
        rec.score_total = min(0.99, round(rec.score_total + 0.05, 2))
    store.audit("feedback.create", "RR-MVP-018", user_id=user.id, project_id=project.id)
    return envelope(request, feedback)


@app.get("/api/v1/projects/{project_id}/feedback")
def list_feedback(project_id: str, request: Request, user: User = Depends(current_user)):
    project = get_project_for_user(project_id, user)
    return envelope(request, [item for item in store.feedback.values() if item.project_id == project.id])


@app.get("/api/v1/projects/{project_id}/radar-settings")
def radar_settings(project_id: str, request: Request, user: User = Depends(current_user)):
    project = get_project_for_user(project_id, user)
    profile = store.profiles.get(project.current_profile_id or "")
    return envelope(
        request,
        {
            "current_focus": profile.model_dump() if profile else None,
            "quick_controls": [
                "增加方法论文",
                "增加综述",
                "只看近三年",
                "只看可获取全文",
                "扩大材料范围",
            ],
        },
    )


@app.patch("/api/v1/projects/{project_id}/radar-settings")
def update_radar_settings(
    project_id: str,
    payload: dict[str, Any],
    request: Request,
    user: User = Depends(current_user),
):
    project = get_project_for_user(project_id, user)
    profile = store.profiles.get(project.current_profile_id or "")
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")
    profile.preferences.update(payload)
    store.audit("radar_settings.update", "RR-MVP-019", user_id=user.id, project_id=project.id)
    return envelope(request, {"preferences": profile.preferences})


@app.post("/api/v1/papers/{paper_id}/analysis")
async def create_analysis(
    paper_id: str,
    payload: AnalysisRequest,
    request: Request,
    settings: Settings = Depends(get_settings),
    user: User = Depends(current_user),
):
    paper = store.papers.get(paper_id)
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")
    profile = None
    if payload.project_id:
        project = get_project_for_user(payload.project_id, user)
        profile = store.profiles.get(project.current_profile_id or "")
    quota_cost = 10 if payload.analysis_type == "standard" else 1
    task = TaskStatus(
        task_id=make_id("task"),
        type=f"paper_analysis.{payload.analysis_type}",
        status="running",
        retryable=True,
        message="AI 研读任务已开始。",
    )
    if user.quota_balance < quota_cost:
        task.status = "waiting"
        task.error_code = "QUOTA_EXHAUSTED"
        task.message = "额度不足，标准研读等高成本任务未执行。"
        task.degraded = True
        store.tasks[task.task_id] = task
        raise HTTPException(
            status_code=402,
            detail={
                "code": "QUOTA_EXHAUSTED",
                "message": task.message,
                "details": {
                    "task_id": task.task_id,
                    "retryable": True,
                    "required_quota": quota_cost,
                    "quota_balance": user.quota_balance,
                },
            },
        )
    store.tasks[task.task_id] = task
    try:
        ai_result = await AiProvider(settings).analyze_paper(
            paper=paper,
            profile=profile,
            analysis_type=payload.analysis_type,
            input_scope=payload.input_scope,
        )
        claims = [AnalysisClaim.model_validate(item) for item in ai_result["claims"]]
    except AiProviderConfigError as exc:
        task.status = "failed"
        task.error_code = "AI_PROVIDER_CONFIG_MISSING"
        task.message = "AI provider is not configured."
        store.tasks[task.task_id] = task
        raise HTTPException(
            status_code=503,
            detail={
                "code": "AI_PROVIDER_CONFIG_MISSING",
                "message": task.message,
                "details": {"task_id": task.task_id, "reason": str(exc)},
            },
        ) from exc
    except (AiOutputValidationError, KeyError, ValidationError) as exc:
        task.status = "failed"
        task.error_code = "AI_OUTPUT_SCHEMA_INVALID"
        task.message = "AI 输出结构无效，未写入正式分析结果。"
        store.tasks[task.task_id] = task
        raise HTTPException(
            status_code=502,
            detail={
                "code": "AI_OUTPUT_SCHEMA_INVALID",
                "message": task.message,
                "details": {"task_id": task.task_id},
            },
        ) from exc
    except httpx.HTTPError as exc:
        task.status = "failed"
        task.error_code = "AI_PROVIDER_REQUEST_FAILED"
        task.message = "AI provider request failed."
        store.tasks[task.task_id] = task
        raise HTTPException(
            status_code=502,
            detail={
                "code": "AI_PROVIDER_REQUEST_FAILED",
                "message": task.message,
                "details": {"task_id": task.task_id},
            },
        ) from exc
    safety = validate_analysis_safety(ai_result["result"], claims, paper)
    if safety["hallucinated_doi_count"] or safety["fact_inference_confusion_count"]:
        task.status = "failed"
        task.error_code = "AI_SAFETY_VALIDATION_FAILED"
        task.message = "AI 输出未通过安全校验，未写入正式分析结果。"
        store.tasks[task.task_id] = task
        raise HTTPException(
            status_code=500,
            detail={
                "code": "AI_SAFETY_VALIDATION_FAILED",
                "message": task.message,
                "details": {"task_id": task.task_id, **safety},
            },
        )
    input_tokens = max(1, len((paper.title or "") + (paper.abstract or "")) // 4)
    output_tokens = max(1, sum(len(claim.claim) for claim in claims) // 2)
    cost = store.add_cost(
        user_id=user.id,
        project_id=payload.project_id,
        paper_id=paper.id,
        feature=f"paper.analysis.{payload.analysis_type}",
        requirement_id="RR-MVP-021" if payload.analysis_type == "standard" else "RR-MVP-020",
        provider=settings.ai_provider,
        model=ai_result["model"],
        quota_delta=-quota_cost,
        estimated_cost=0.0 if settings.ai_provider == "mock" else 0.01,
        task_id=task.task_id,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
    )
    analysis = PaperAnalysis(
        id=make_id("analysis"),
        paper_id=paper.id,
        project_id=payload.project_id,
        analysis_type=payload.analysis_type,
        input_scope=payload.input_scope,
        result=ai_result["result"],
        claims=claims,
        evidence_labels_valid=not safety["missing_fact_levels"],
        model=ai_result["model"],
        cost_record_id=cost.id,
    )
    store.analyses[analysis.id] = analysis
    task.status = "succeeded"
    task.message = "AI 研读任务已完成，成本和额度已记录。"
    store.tasks[task.task_id] = task
    return envelope(request, analysis)


@app.get("/api/v1/analysis/{analysis_id}")
def get_analysis(analysis_id: str, request: Request, user: User = Depends(current_user)):
    analysis = store.analyses.get(analysis_id)
    if not analysis:
        raise HTTPException(status_code=404, detail="Analysis not found")
    return envelope(request, analysis)


@app.get("/api/v1/papers/{paper_id}/analysis")
def list_analysis(paper_id: str, request: Request, user: User = Depends(current_user)):
    return envelope(
        request,
        [item for item in store.analyses.values() if item.paper_id == paper_id],
    )


@app.get("/api/v1/projects/{project_id}/knowledge")
def list_knowledge(project_id: str, request: Request, user: User = Depends(current_user)):
    project = get_project_for_user(project_id, user)
    return envelope(
        request,
        [item for item in store.knowledge.values() if item.project_id == project.id],
    )


@app.post("/api/v1/projects/{project_id}/knowledge")
def add_knowledge(
    project_id: str,
    payload: KnowledgeCreate,
    request: Request,
    user: User = Depends(current_user),
):
    project = get_project_for_user(project_id, user)
    if payload.paper_id not in store.papers:
        raise HTTPException(status_code=404, detail="Paper not found")
    item = KnowledgeItem(
        id=make_id("know"),
        user_id=user.id,
        project_id=project.id,
        paper_id=payload.paper_id,
        status=payload.status,
        tags=payload.tags,
        note=payload.note,
    )
    store.knowledge[item.id] = item
    store.audit("knowledge.create", "RR-MVP-023", user_id=user.id, project_id=project.id)
    return envelope(request, item)


@app.patch("/api/v1/knowledge/{item_id}")
def patch_knowledge(
    item_id: str,
    payload: KnowledgePatch,
    request: Request,
    user: User = Depends(current_user),
):
    item = store.knowledge.get(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Knowledge item not found")
    get_project_for_user(item.project_id, user)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(item, key, value)
    item.updated_at = now_utc()
    store.audit("knowledge.update", "RR-MVP-024", user_id=user.id, project_id=item.project_id)
    return envelope(request, item)


@app.get("/api/v1/knowledge/{item_id}")
def get_knowledge_item(item_id: str, request: Request, user: User = Depends(current_user)):
    item = store.knowledge.get(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Knowledge item not found")
    get_project_for_user(item.project_id, user)
    return envelope(request, item)


@app.get("/api/v1/projects/{project_id}/knowledge:search")
def search_knowledge(
    project_id: str,
    q: str = "",
    request: Request = None,  # type: ignore[assignment]
    user: User = Depends(current_user),
):
    project = get_project_for_user(project_id, user)
    query = q.lower()
    items = [item for item in store.knowledge.values() if item.project_id == project.id]
    if query:
        items = [
            item
            for item in items
            if query in " ".join(item.tags).lower()
            or query in (item.note or "").lower()
            or query in store.papers[item.paper_id].title.lower()
            or query in store.papers[item.paper_id].title_zh.lower()
        ]
    return envelope(request, items)


@app.get("/api/v1/projects/{project_id}/reports")
def list_reports(project_id: str, request: Request, user: User = Depends(current_user)):
    project = get_project_for_user(project_id, user)
    reports = sorted(
        [item for item in store.reports.values() if item.project_id == project.id],
        key=lambda item: item.created_at,
        reverse=True,
    )
    return envelope(request, reports)


@app.get("/api/v1/reports/{report_id}")
def get_report(report_id: str, request: Request, user: User = Depends(current_user)):
    report = store.reports.get(report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    get_project_for_user(report.project_id, user)
    return envelope(request, report)


@app.post("/api/v1/projects/{project_id}/reports:generate")
def generate_report(
    project_id: str,
    report_type: str = "daily",
    request: Request = None,  # type: ignore[assignment]
    user: User = Depends(current_user),
    settings: Settings = Depends(get_settings),
):
    project = get_project_for_user(project_id, user)
    if report_type not in {"daily", "weekly"}:
        raise HTTPException(status_code=422, detail="report_type must be daily or weekly")
    report = store.create_report(user.id, project.id, report_type)
    publish_report_notifications(store, user, report, settings)
    requirement_id = "RR-MVP-026" if report_type == "daily" else "RR-MVP-027"
    store.audit("report.generate", requirement_id, user_id=user.id, project_id=project.id)
    return envelope(request, report)


@app.get("/api/v1/messages")
def list_messages(request: Request, user: User = Depends(current_user)):
    return envelope(request, [item for item in store.messages.values() if item.user_id == user.id])


@app.get("/api/v1/messages/{message_id}")
def get_message(message_id: str, request: Request, user: User = Depends(current_user)):
    message = store.messages.get(message_id)
    if not message or message.user_id != user.id:
        raise HTTPException(status_code=404, detail="Message not found")
    return envelope(request, message)


@app.post("/api/v1/messages/{message_id}:read")
def mark_message_read(message_id: str, request: Request, user: User = Depends(current_user)):
    message = store.messages.get(message_id)
    if not message or message.user_id != user.id:
        raise HTTPException(status_code=404, detail="Message not found")
    message.read = True
    store.messages[message.id] = message
    return envelope(request, message)


@app.get("/api/v1/me/email-preference")
def email_preference(request: Request, user: User = Depends(current_user)):
    return envelope(request, store.email_preference_for_user(user.id))


@app.post("/api/v1/me/email:unsubscribe")
def unsubscribe_email_reports(request: Request, user: User = Depends(current_user)):
    preference = store.email_preference_for_user(user.id)
    preference.reports_unsubscribed = True
    preference.unsubscribed_at = now_utc()
    preference.updated_at = now_utc()
    store.email_preferences[preference.id] = preference
    store.audit("email.unsubscribe", "RR-MVP-028", user_id=user.id)
    return envelope(request, preference)


@app.post("/api/v1/me/email:subscribe")
def subscribe_email_reports(request: Request, user: User = Depends(current_user)):
    preference = store.email_preference_for_user(user.id)
    preference.reports_unsubscribed = False
    preference.unsubscribed_at = None
    preference.updated_at = now_utc()
    store.email_preferences[preference.id] = preference
    store.audit("email.subscribe", "RR-MVP-028", user_id=user.id)
    return envelope(request, preference)


@app.get("/api/v1/me/email-outbox")
def email_outbox(request: Request, user: User = Depends(current_user)):
    records = sorted(
        [item for item in store.email_outbox.values() if item.user_id == user.id],
        key=lambda item: item.created_at,
        reverse=True,
    )
    return envelope(request, records)


@app.get("/api/v1/me/quota")
def quota(request: Request, user: User = Depends(current_user)):
    return envelope(request, {"quota_balance": user.quota_balance, "plan": user.plan})


@app.get("/api/v1/me/costs")
def my_costs(request: Request, user: User = Depends(current_user)):
    return envelope(request, [item for item in store.costs.values() if item.user_id == user.id])


@app.get("/api/v1/admin/costs")
def admin_costs(request: Request, user: User = Depends(current_user)):
    if user.role != "admin" and user.id != "usr_demo":
        raise HTTPException(status_code=403, detail="FORBIDDEN")
    return envelope(request, list(store.costs.values()))


@app.get("/api/v1/admin/audit-logs")
def admin_audit_logs(request: Request, user: User = Depends(current_user)):
    if user.role != "admin" and user.id != "usr_demo":
        raise HTTPException(status_code=403, detail="FORBIDDEN")
    return envelope(request, list(store.audit_logs.values()))


@app.post("/api/v1/tasks/{task_id}:retry")
def retry_task(task_id: str, request: Request, user: User = Depends(current_user)):
    search_task = store.search_tasks.get(task_id)
    if search_task:
        get_project_for_user(search_task.project_id, user)
    task = store.tasks.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    task.status = "retrying"
    task.retry_count += 1
    task.retryable = True
    task.message = "任务已进入人工重试队列。"
    store.audit("task.retry", "RR-MVP-034", user_id=user.id)
    return envelope(request, task)
