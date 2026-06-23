from __future__ import annotations

import asyncio
import re
from datetime import date
from typing import Any, Literal, cast
from urllib.parse import urlparse

import httpx
from pydantic import BaseModel, Field, field_validator

from .ai import (
    AiOutputValidationError,
    AiProvider,
    AiProviderConfigError,
    validate_analysis_safety,
)
from .dedup import normalize_doi
from .retrieval import CrossrefAdapter, OpenAlexAdapter
from .retrieval.base import NormalizedRecord, RetrievalAdapter
from .schemas import AnalysisClaim, Paper, ResearchProfile, User, make_id
from .settings import Settings
from .store import InMemoryStore


AgentSource = Literal["openalex", "crossref", "x_mol", "cnki"]
AgentSourceMode = Literal[
    "live_api",
    "public_metadata",
    "authorized_export",
    "official_api",
    "disabled",
]
AgentContentType = Literal["news", "paper", "report"]
AgentHitlMode = Literal["auto_analyze", "review_before_analysis"]
DuplicateStatus = Literal["new", "duplicate_knowledge", "duplicate_paper"]
SourceFetchStatus = Literal["succeeded", "skipped", "failed"]
QueryExpansionMode = Literal["ai", "rules"]


class AgentExternalRecord(BaseModel):
    source: AgentSource
    source_identifier: str
    title: str
    title_zh: str | None = None
    authors: list[str] = Field(default_factory=list)
    published_at: date | None = None
    year: int | None = None
    venue: str | None = None
    doi: str | None = None
    abstract: str | None = None
    keywords: list[str] = Field(default_factory=list)
    url: str | None = None
    content_type: AgentContentType = "paper"
    license_note: str = "user_authorized_export"

    @field_validator("doi")
    @classmethod
    def normalize_record_doi(cls, value: str | None) -> str | None:
        return normalize_doi(value)


class AgentScanRequest(BaseModel):
    research_direction: str = Field(min_length=6)
    project_id: str | None = None
    sources: list[AgentSource] = Field(default_factory=lambda: ["openalex", "crossref"])
    source_modes: dict[AgentSource, AgentSourceMode] = Field(
        default_factory=lambda: {
            "openalex": "live_api",
            "crossref": "live_api",
            "x_mol": "disabled",
            "cnki": "disabled",
        }
    )
    query_expansion: QueryExpansionMode = "ai"
    published_after: date | None = None
    published_before: date | None = None
    min_score: float = Field(default=2.0, ge=0, le=10)
    limit: int = Field(default=10, ge=1, le=50)
    analyze_top_n: int = Field(default=3, ge=0, le=20)
    analysis_type: Literal["quick", "standard"] = "quick"
    input_scope: Literal["metadata", "abstract"] = "abstract"
    hitl_mode: AgentHitlMode = "auto_analyze"
    external_records: list[AgentExternalRecord] = Field(default_factory=list)

    @field_validator("sources")
    @classmethod
    def require_source(cls, value: list[AgentSource]) -> list[AgentSource]:
        if not value:
            raise ValueError("At least one source is required.")
        return value


class AgentTraceStep(BaseModel):
    step: str
    status: Literal["succeeded", "skipped", "requires_review", "failed"]
    summary: str
    input_count: int = 0
    output_count: int = 0
    evidence_refs: list[str] = Field(default_factory=list)


class AgentQueryPlan(BaseModel):
    mode: QueryExpansionMode
    original_direction: str
    translated_direction_en: str
    queries: list[str] = Field(default_factory=list)
    keywords_zh: list[str] = Field(default_factory=list)
    keywords_en: list[str] = Field(default_factory=list)
    synonyms_en: list[str] = Field(default_factory=list)
    exclusions: list[str] = Field(default_factory=list)
    confidence: float = Field(default=0.6, ge=0, le=1)
    generated_by: str

    @field_validator("queries")
    @classmethod
    def require_queries(cls, value: list[str]) -> list[str]:
        queries = [item.strip() for item in value if item.strip()]
        if not queries:
            raise ValueError("At least one query is required.")
        return queries[:6]


class AgentCandidate(BaseModel):
    id: str
    source: AgentSource
    source_mode: AgentSourceMode
    source_identifier: str
    title: str
    title_zh: str
    authors: list[str] = Field(default_factory=list)
    published_at: date | None = None
    year: int | None = None
    venue: str | None = None
    doi: str | None = None
    abstract: str | None = None
    keywords: list[str] = Field(default_factory=list)
    url: str | None = None
    fulltext_url: str | None = None
    open_access: bool = False
    citation_count: int = 0
    matched_query: str | None = None
    content_type: AgentContentType = "paper"
    score: float = 0
    score_basis: list[str] = Field(default_factory=list)
    duplicate_status: DuplicateStatus = "new"
    duplicate_of: str | None = None
    duplicate_reason: str | None = None
    compliance_note: str


class AgentSourceStatus(BaseModel):
    source: AgentSource
    mode: AgentSourceMode
    status: SourceFetchStatus
    code: str
    message: str
    record_count: int = 0
    endpoint_host: str | None = None
    query_count: int = 0
    queries: list[str] = Field(default_factory=list)


class AgentCandidateAnalysis(BaseModel):
    candidate_id: str
    paper_id: str
    paper: dict[str, Any]
    analysis_type: Literal["quick", "standard"]
    input_scope: Literal["metadata", "abstract"]
    result: dict[str, Any]
    claims: list[AnalysisClaim]
    evidence_labels_valid: bool
    traceability_score: float
    model: str
    cost_record_id: str | None = None


class AgentScanReport(BaseModel):
    title: str
    executive_summary: str
    key_findings: list[str] = Field(default_factory=list)
    recommended_reading_order: list[str] = Field(default_factory=list)
    research_gaps: list[str] = Field(default_factory=list)
    next_actions: list[str] = Field(default_factory=list)
    evidence_refs: list[str] = Field(default_factory=list)
    model: str
    cost_record_id: str | None = None


class AgentHitlState(BaseModel):
    required: bool
    mode: AgentHitlMode
    reason: str
    review_fields: list[str] = Field(default_factory=list)


class AgentScanResponse(BaseModel):
    status: Literal["completed", "requires_review"]
    request_id: str
    candidates: list[AgentCandidate]
    analyses: list[AgentCandidateAnalysis]
    duplicate_count: int
    filtered_count: int
    source_count: int
    source_statuses: list[AgentSourceStatus]
    query_plan: AgentQueryPlan
    trace: list[AgentTraceStep]
    hitl: AgentHitlState
    compliance_notes: list[str]
    report: AgentScanReport | None = None


def _tokens(text: str) -> set[str]:
    normalized = {
        item.lower()
        for item in re.split(r"[\s,，。；;:：、/|()（）\[\]\-]+", text)
        if len(item.strip()) >= 2
    }
    cjk = re.sub(r"[^\u4e00-\u9fff]+", "", text)
    grams = {
        cjk[index : index + size]
        for size in (2, 3, 4)
        for index in range(max(0, len(cjk) - size + 1))
    }
    return normalized.union(grams)


def _compact_text(*values: str | None) -> str:
    return " ".join(value for value in values if value)


def _title_key(value: str) -> str:
    return re.sub(r"[\W_]+", "", value.lower())


def _endpoint_host(value: str | None) -> str | None:
    if not value:
        return None
    return urlparse(value).netloc or None


def _list_from_value(value: object) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item) for item in value if str(item).strip()]
    if isinstance(value, str):
        return [item.strip() for item in re.split(r"[,，;；、]", value) if item.strip()]
    return [str(value)]


def _query_terms(text: str) -> list[str]:
    terms = [
        item.strip().lower()
        for item in re.split(r"[\s,，。；;:：、/|()（）\[\]\-]+", text)
        if len(item.strip()) >= 2
    ]
    return sorted(set(terms))


class StandaloneResearchScanAgent:
    """A controlled research-scan loop for future source adapters.

    The public response exposes a decision trace and evidence references, not hidden model
    chain-of-thought. CNKI is intentionally limited to official API or user-authorized exports.
    """

    def __init__(self, store: InMemoryStore, settings: Settings) -> None:
        self.store = store
        self.settings = settings

    async def run(self, payload: AgentScanRequest, user: User) -> AgentScanResponse:
        trace: list[AgentTraceStep] = []
        compliance_notes = [
            "Agent Scan 暴露的是可审计决策轨迹，不暴露模型隐藏思维链。",
            "默认自动检索来源为 OpenAlex 和 Crossref 官方开放元数据 API。",
            "X-MOL 自动检索仅允许官方 API 或用户授权导出；不抓取 robots.txt 禁止的搜索路径。",
            "CNKI 不允许自动登录、保存学校账号、长期 Cookie 或绕过机构权限。",
        ]
        profile = self._project_profile(payload.project_id)
        query_plan = await self._build_query_plan(payload, profile, trace)

        raw_candidates, source_statuses = await self._fetch_candidates(
            payload, query_plan, trace, compliance_notes
        )
        scored_candidates = self._score_candidates(query_plan, raw_candidates)
        unique_candidates = self._dedupe_same_scan(scored_candidates)
        trace.append(
            AgentTraceStep(
                step="dedupe_within_scan",
                status="succeeded",
                summary="用 DOI 和标准化标题合并本轮 OpenAlex/Crossref 返回的重复候选。",
                input_count=len(scored_candidates),
                output_count=len(unique_candidates),
            )
        )
        filtered_candidates = self._filter_candidates(payload, unique_candidates)
        trace.append(
            AgentTraceStep(
                step="filter",
                status="succeeded",
                summary=(
                    "按发布时间、最低分和数量筛选候选；排序优先使用与研究方向的相关分。"
                ),
                input_count=len(scored_candidates),
                output_count=len(filtered_candidates),
            )
        )

        deduped_candidates = self._mark_duplicates(payload.project_id, user, filtered_candidates)
        duplicate_count = sum(
            1 for candidate in deduped_candidates if candidate.duplicate_status != "new"
        )
        trace.append(
            AgentTraceStep(
                step="dedupe_against_knowledge",
                status="succeeded",
                summary="用 DOI 和标准化标题与当前知识库及 Paper 库去重。",
                input_count=len(filtered_candidates),
                output_count=len(deduped_candidates) - duplicate_count,
            )
        )

        if payload.hitl_mode == "review_before_analysis":
            trace.append(
                AgentTraceStep(
                    step="hitl_gate",
                    status="requires_review",
                    summary="已暂停在 AI 分析前，等待人工确认候选来源、去重和筛选结果。",
                    input_count=len(deduped_candidates),
                    output_count=0,
                )
            )
            return AgentScanResponse(
                status="requires_review",
                request_id=make_id("agentscan"),
                candidates=deduped_candidates,
                analyses=[],
                duplicate_count=duplicate_count,
                filtered_count=len(filtered_candidates),
                source_count=len(raw_candidates),
                source_statuses=source_statuses,
                query_plan=query_plan,
                trace=trace,
                hitl=AgentHitlState(
                    required=True,
                    mode=payload.hitl_mode,
                    reason="用户要求 AI 分析前人工审核。",
                    review_fields=[
                        "source",
                        "title",
                        "published_at",
                        "score",
                        "duplicate_status",
                        "compliance_note",
                    ],
                ),
                compliance_notes=compliance_notes,
            )

        analyses = await self._analyze_candidates(payload, user, profile, deduped_candidates, trace)
        report = await self._build_report(payload, user, analyses, trace)
        return AgentScanResponse(
            status="completed",
            request_id=make_id("agentscan"),
            candidates=deduped_candidates,
            analyses=analyses,
            duplicate_count=duplicate_count,
            filtered_count=len(filtered_candidates),
            source_count=len(raw_candidates),
            source_statuses=source_statuses,
            query_plan=query_plan,
            trace=trace,
            hitl=AgentHitlState(
                required=False,
                mode=payload.hitl_mode,
                reason="当前为自动分析模式；重复候选不会进入 AI 分析。",
            ),
            compliance_notes=compliance_notes,
            report=report,
        )

    def _project_profile(self, project_id: str | None) -> ResearchProfile | None:
        if not project_id:
            return None
        project = self.store.projects.get(project_id)
        if not project or not project.current_profile_id:
            return None
        return self.store.profiles.get(project.current_profile_id)

    async def _build_query_plan(
        self,
        payload: AgentScanRequest,
        profile: ResearchProfile | None,
        trace: list[AgentTraceStep],
    ) -> AgentQueryPlan:
        if payload.query_expansion == "rules":
            plan = self._rules_query_plan(payload.research_direction)
        else:
            try:
                raw_plan = await AiProvider(self.settings).generate_retrieval_plan(
                    research_direction=payload.research_direction,
                    profile=profile,
                )
                plan = AgentQueryPlan.model_validate(raw_plan)
            except AiProviderConfigError:
                raise
            except (AiOutputValidationError, ValueError, KeyError) as exc:
                trace.append(
                    AgentTraceStep(
                        step="query_expansion",
                        status="failed",
                        summary=f"AI 检索规划输出无效：{exc}",
                        input_count=1,
                        output_count=0,
                    )
                )
                raise AiOutputValidationError("AI retrieval plan is invalid.") from exc
        trace.append(
            AgentTraceStep(
                step="query_expansion",
                status="succeeded",
                summary=(
                    "已把用户研究方向转换为可用于 OpenAlex/Crossref 的英文检索计划；"
                    "篇数、筛选和去重仍由后端程序控制。"
                ),
                input_count=1,
                output_count=len(plan.queries),
                evidence_refs=plan.queries,
            )
        )
        return plan

    def _rules_query_plan(self, research_direction: str) -> AgentQueryPlan:
        terms = _query_terms(research_direction)
        latin_terms = [term for term in terms if re.search(r"[a-zA-Z]", term)]
        cjk_terms = [term for term in terms if re.search(r"[\u4e00-\u9fff]", term)]
        base_query = " ".join(latin_terms or terms)
        if not base_query:
            base_query = research_direction
        queries = [base_query]
        if latin_terms and len(latin_terms) > 2:
            queries.append(" ".join(latin_terms[: min(6, len(latin_terms))]))
        if cjk_terms and latin_terms:
            queries.append(" ".join([*latin_terms[:4], *cjk_terms[:2]]))
        return AgentQueryPlan(
            mode="rules",
            original_direction=research_direction,
            translated_direction_en=base_query,
            queries=queries,
            keywords_zh=cjk_terms,
            keywords_en=latin_terms,
            synonyms_en=[],
            exclusions=[],
            confidence=0.45,
            generated_by="deterministic-rule-query-plan",
        )

    async def _fetch_candidates(
        self,
        payload: AgentScanRequest,
        query_plan: AgentQueryPlan,
        trace: list[AgentTraceStep],
        compliance_notes: list[str],
    ) -> tuple[list[AgentCandidate], list[AgentSourceStatus]]:
        candidates: list[AgentCandidate] = []
        source_statuses: list[AgentSourceStatus] = []
        for source in payload.sources:
            mode = payload.source_modes.get(source, "disabled")
            if source == "openalex":
                fetched, status = await self._fetch_open_source(
                    source=source,
                    adapter=OpenAlexAdapter(
                        timeout=self.settings.agent_source_timeout_seconds,
                        email=self.settings.openalex_email,
                    ),
                    mode=mode,
                    payload=payload,
                    query_plan=query_plan,
                    compliance_notes=compliance_notes,
                )
            elif source == "crossref":
                fetched, status = await self._fetch_open_source(
                    source=source,
                    adapter=CrossrefAdapter(timeout=self.settings.agent_source_timeout_seconds),
                    mode=mode,
                    payload=payload,
                    query_plan=query_plan,
                    compliance_notes=compliance_notes,
                )
            elif source == "x_mol":
                fetched, status = await self._fetch_x_mol(payload, mode, compliance_notes)
            else:
                fetched, status = await self._fetch_cnki(payload, mode, compliance_notes)
            candidates.extend(fetched)
            source_statuses.append(status)
            trace.append(
                AgentTraceStep(
                    step=f"source_fetch.{source}",
                    status="failed"
                    if status.status == "failed"
                    else "succeeded"
                    if status.status == "succeeded"
                    else "skipped",
                    summary=status.message,
                    input_count=1,
                    output_count=len(fetched),
                    evidence_refs=[candidate.source_identifier for candidate in fetched],
                )
            )
        return candidates, source_statuses

    async def _fetch_open_source(
        self,
        source: Literal["openalex", "crossref"],
        adapter: RetrievalAdapter,
        mode: AgentSourceMode,
        payload: AgentScanRequest,
        query_plan: AgentQueryPlan,
        compliance_notes: list[str],
    ) -> tuple[list[AgentCandidate], AgentSourceStatus]:
        if mode == "disabled":
            return [], AgentSourceStatus(
                source=source,
                mode=mode,
                status="skipped",
                code="SOURCE_DISABLED",
                message=f"{source} 来源已禁用。",
                queries=query_plan.queries,
                query_count=len(query_plan.queries),
            )
        if mode == "authorized_export":
            records = [
                record
                for record in payload.external_records
                if record.source == source
                and record.license_note in {"user_authorized_export", "official_api", "open_metadata_api"}
            ]
            candidates = [self._candidate_from_record(record, mode) for record in records]
            return candidates, AgentSourceStatus(
                source=source,
                mode=mode,
                status="succeeded" if candidates else "skipped",
                code="AUTHORIZED_EXPORT_LOADED" if candidates else "AUTHORIZED_EXPORT_EMPTY",
                message=f"{source} 用户授权导入返回 {len(candidates)} 条候选。",
                record_count=len(candidates),
                queries=query_plan.queries,
                query_count=len(query_plan.queries),
            )
        if mode != "live_api":
            compliance_notes.append(f"{source} 只支持 live_api 或 authorized_export，本次跳过 {mode}。")
            return [], AgentSourceStatus(
                source=source,
                mode=mode,
                status="skipped",
                code="SOURCE_MODE_UNSUPPORTED",
                message=f"{source} 不支持 {mode} 模式；请使用 live_api。",
                endpoint_host=self._source_endpoint_host(source),
                queries=query_plan.queries,
                query_count=len(query_plan.queries),
            )

        records: list[tuple[NormalizedRecord, str]] = []
        errors: list[str] = []
        filters: dict[str, Any] = {}
        if payload.published_after:
            filters["year_from"] = payload.published_after.year
        per_query_limit = min(max(payload.limit * 2, 5), 25)
        for query in query_plan.queries:
            try:
                fetched = await adapter.search(query=query, filters=filters, limit=per_query_limit)
            except Exception as exc:
                errors.append(f"{query}: {exc.__class__.__name__}")
                continue
            records.extend((record, query) for record in fetched)

        candidates = [
            self._candidate_from_normalized_record(record, mode, matched_query=query)
            for record, query in records
            if record.title
        ]
        if candidates:
            return candidates, AgentSourceStatus(
                source=source,
                mode=mode,
                status="succeeded",
                code="OPEN_METADATA_API_LOADED",
                message=(
                    f"{source} 官方开放元数据 API 返回 {len(candidates)} 条候选；"
                    f"执行 {len(query_plan.queries)} 条查询。"
                ),
                record_count=len(candidates),
                endpoint_host=self._source_endpoint_host(source),
                queries=query_plan.queries,
                query_count=len(query_plan.queries),
            )
        return [], AgentSourceStatus(
            source=source,
            mode=mode,
            status="failed" if errors else "skipped",
            code="OPEN_METADATA_API_FAILED" if errors else "OPEN_METADATA_API_EMPTY",
            message=(
                f"{source} 官方开放元数据 API 未返回候选。"
                + (f" 错误：{'; '.join(errors[:3])}" if errors else "")
            ),
            endpoint_host=self._source_endpoint_host(source),
            queries=query_plan.queries,
            query_count=len(query_plan.queries),
        )

    def _source_endpoint_host(self, source: AgentSource) -> str | None:
        hosts = {
            "openalex": "api.openalex.org",
            "crossref": "api.crossref.org",
            "x_mol": "www.x-mol.com",
            "cnki": None,
        }
        return hosts[source]

    async def _fetch_x_mol(
        self,
        payload: AgentScanRequest,
        mode: AgentSourceMode,
        compliance_notes: list[str],
    ) -> tuple[list[AgentCandidate], AgentSourceStatus]:
        if mode == "disabled":
            return [], AgentSourceStatus(
                source="x_mol",
                mode=mode,
                status="skipped",
                code="SOURCE_DISABLED",
                message="X-MOL 来源已禁用。",
            )
        if mode == "authorized_export":
            records = [
                record
                for record in payload.external_records
                if record.source == "x_mol"
                and record.license_note in {"user_authorized_export", "official_api"}
            ]
            if not records:
                compliance_notes.append("X-MOL authorized_export 模式未收到用户授权导出记录。")
            candidates = [self._candidate_from_record(record, mode) for record in records]
            return candidates, AgentSourceStatus(
                source="x_mol",
                mode=mode,
                status="succeeded" if candidates else "skipped",
                code="AUTHORIZED_EXPORT_LOADED" if candidates else "AUTHORIZED_EXPORT_EMPTY",
                message=f"X-MOL 用户授权导入返回 {len(candidates)} 条候选。",
                record_count=len(candidates),
            )
        if mode == "public_metadata":
            compliance_notes.append(
                "X-MOL robots.txt 禁止 /paper/search 与 /news/search；未配置官方 API 时不执行自动搜索。"
            )
            return [], AgentSourceStatus(
                source="x_mol",
                mode=mode,
                status="skipped",
                code="PUBLIC_SEARCH_DISALLOWED",
                message="X-MOL public_metadata 自动搜索已跳过：站点搜索路径禁止抓取。",
                endpoint_host="www.x-mol.com",
            )
        return await self._fetch_official_api_source(
            source="x_mol",
            payload=payload,
            base_url=self.settings.x_mol_api_base_url,
            api_key=self.settings.x_mol_api_key,
            compliance_notes=compliance_notes,
        )

    async def _fetch_cnki(
        self,
        payload: AgentScanRequest,
        mode: AgentSourceMode,
        compliance_notes: list[str],
    ) -> tuple[list[AgentCandidate], AgentSourceStatus]:
        if mode == "disabled":
            compliance_notes.append("CNKI 当前已禁用：未提供官方 API 或用户授权导出记录。")
            return [], AgentSourceStatus(
                source="cnki",
                mode=mode,
                status="skipped",
                code="SOURCE_DISABLED",
                message="CNKI 来源已禁用。",
            )
        if mode == "public_metadata":
            compliance_notes.append("CNKI 不支持未授权 public_metadata 抓取，本次已跳过。")
            return [], AgentSourceStatus(
                source="cnki",
                mode=mode,
                status="skipped",
                code="PUBLIC_SEARCH_DISALLOWED",
                message="CNKI public_metadata 自动搜索已跳过：需要官方 API、机构合作或用户授权导出。",
            )
        if mode == "official_api":
            return await self._fetch_official_api_source(
                source="cnki",
                payload=payload,
                base_url=self.settings.cnki_api_base_url,
                api_key=self.settings.cnki_api_key,
                compliance_notes=compliance_notes,
            )
        records = [
            record
            for record in payload.external_records
            if record.source == "cnki" and record.license_note in {"user_authorized_export", "official_api"}
        ]
        if not records:
            compliance_notes.append("CNKI authorized_export 模式未收到用户导出记录。")
        candidates = [self._candidate_from_record(record, mode) for record in records]
        return candidates, AgentSourceStatus(
            source="cnki",
            mode=mode,
            status="succeeded" if candidates else "skipped",
            code="AUTHORIZED_EXPORT_LOADED" if candidates else "AUTHORIZED_EXPORT_EMPTY",
            message=f"CNKI 用户授权导入返回 {len(candidates)} 条候选。",
            record_count=len(candidates),
        )

    async def _fetch_official_api_source(
        self,
        source: AgentSource,
        payload: AgentScanRequest,
        base_url: str | None,
        api_key: str | None,
        compliance_notes: list[str],
    ) -> tuple[list[AgentCandidate], AgentSourceStatus]:
        if not base_url:
            compliance_notes.append(f"{source} official_api 未配置 API 地址，未执行自动检索。")
            return [], AgentSourceStatus(
                source=source,
                mode="official_api",
                status="skipped",
                code="OFFICIAL_API_CONFIG_MISSING",
                message=f"{source} official_api 缺少 API 地址配置。",
            )
        try:
            payload_json = await self._request_official_api(
                source=source,
                base_url=base_url,
                api_key=api_key,
                payload=payload,
            )
        except httpx.HTTPError as exc:
            return [], AgentSourceStatus(
                source=source,
                mode="official_api",
                status="failed",
                code="OFFICIAL_API_REQUEST_FAILED",
                message=f"{source} official_api 请求失败：{exc}",
                endpoint_host=_endpoint_host(base_url),
            )
        records = self._records_from_official_payload(source, payload_json)
        candidates = [self._candidate_from_record(record, "official_api") for record in records]
        return candidates, AgentSourceStatus(
            source=source,
            mode="official_api",
            status="succeeded",
            code="OFFICIAL_API_LOADED",
            message=f"{source} official_api 返回 {len(candidates)} 条候选。",
            record_count=len(candidates),
            endpoint_host=_endpoint_host(base_url),
        )

    async def _request_official_api(
        self,
        source: AgentSource,
        base_url: str,
        api_key: str | None,
        payload: AgentScanRequest,
    ) -> dict[str, Any] | list[Any]:
        headers = {"Accept": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        params: dict[str, Any] = {
            "q": payload.research_direction,
            "limit": payload.limit,
            "source": source,
        }
        if payload.published_after:
            params["published_after"] = payload.published_after.isoformat()
        if payload.published_before:
            params["published_before"] = payload.published_before.isoformat()
        async with httpx.AsyncClient(timeout=self.settings.agent_source_timeout_seconds) as client:
            response = await client.get(
                f"{base_url.rstrip('/')}/search",
                params=params,
                headers=headers,
            )
            response.raise_for_status()
            payload_json = response.json()
        if not isinstance(payload_json, (dict, list)):
            raise httpx.HTTPError(f"{source} official_api response must be JSON object or array.")
        return payload_json

    def _records_from_official_payload(
        self,
        source: AgentSource,
        payload_json: dict[str, Any] | list[Any],
    ) -> list[AgentExternalRecord]:
        if isinstance(payload_json, list):
            items = payload_json
        else:
            raw_items = (
                payload_json.get("items")
                or payload_json.get("results")
                or payload_json.get("data")
                or []
            )
            items = raw_items if isinstance(raw_items, list) else []
        records: list[AgentExternalRecord] = []
        for index, item in enumerate(items):
            if not isinstance(item, dict):
                continue
            title = item.get("title") or item.get("name")
            if not title:
                continue
            published_at = item.get("published_at") or item.get("published_date") or item.get("date")
            record = AgentExternalRecord(
                source=source,
                source_identifier=str(
                    item.get("source_identifier")
                    or item.get("id")
                    or item.get("url")
                    or f"{source}_official_{index}"
                ),
                title=str(title),
                title_zh=str(item.get("title_zh") or item.get("chinese_title") or title),
                authors=_list_from_value(item.get("authors") or item.get("author")),
                published_at=date.fromisoformat(str(published_at)[:10]) if published_at else None,
                year=int(item["year"]) if item.get("year") else None,
                venue=item.get("venue") or item.get("journal") or item.get("source_name"),
                doi=item.get("doi"),
                abstract=item.get("abstract") or item.get("summary"),
                keywords=_list_from_value(item.get("keywords")),
                url=item.get("url") or item.get("link"),
                content_type=item.get("content_type") or "paper",
                license_note="official_api",
            )
            records.append(record)
        return records

    def _candidate_from_record(
        self,
        record: AgentExternalRecord,
        mode: AgentSourceMode,
    ) -> AgentCandidate:
        return AgentCandidate(
            id=make_id("cand"),
            source=record.source,
            source_mode=mode,
            source_identifier=record.source_identifier,
            title=record.title,
            title_zh=record.title_zh or record.title,
            authors=record.authors,
            published_at=record.published_at,
            year=record.year or (record.published_at.year if record.published_at else None),
            venue=record.venue,
            doi=record.doi,
            abstract=record.abstract,
            keywords=record.keywords,
            url=record.url,
            content_type=record.content_type,
            compliance_note=record.license_note,
        )

    def _candidate_from_normalized_record(
        self,
        record: NormalizedRecord,
        mode: AgentSourceMode,
        matched_query: str,
    ) -> AgentCandidate:
        source = cast(AgentSource, record.source if record.source in {"openalex", "crossref"} else "openalex")
        return AgentCandidate(
            id=make_id("cand"),
            source=source,
            source_mode=mode,
            source_identifier=record.source_identifier,
            title=record.title,
            title_zh=record.title,
            authors=record.authors,
            year=record.year,
            venue=record.journal,
            doi=record.doi,
            abstract=record.abstract,
            keywords=record.keywords,
            url=record.url,
            fulltext_url=record.fulltext_url,
            open_access=record.open_access,
            citation_count=record.citation_count,
            matched_query=matched_query,
            content_type="paper",
            compliance_note="open_metadata_api",
        )

    def _score_candidates(
        self,
        query_plan: AgentQueryPlan,
        candidates: list[AgentCandidate],
    ) -> list[AgentCandidate]:
        query_text = _compact_text(
            query_plan.original_direction,
            query_plan.translated_direction_en,
            " ".join(query_plan.keywords_zh),
            " ".join(query_plan.keywords_en),
            " ".join(query_plan.synonyms_en),
        )
        direction_tokens = _tokens(query_text)
        for candidate in candidates:
            text = _compact_text(
                candidate.title,
                candidate.title_zh,
                candidate.abstract,
                " ".join(candidate.keywords),
            )
            candidate_tokens = _tokens(text)
            overlap = sorted(direction_tokens.intersection(candidate_tokens))
            direction_terms = _query_terms(query_text) or sorted(direction_tokens)
            exact_hits = [
                term
                for term in direction_terms
                if term.lower() in text.lower() or term in candidate_tokens
            ]
            denominator = max(1, len(direction_terms))
            score = 1.0 + 7.5 * min(1.0, len(exact_hits) / denominator)
            if candidate.abstract:
                score += 0.7
            if normalize_doi(candidate.doi):
                score += 0.5
            if candidate.url:
                score += 0.3
            if candidate.open_access or candidate.fulltext_url:
                score += 0.3
            if candidate.citation_count:
                score += min(0.7, candidate.citation_count / 200)
            candidate.score = round(min(score, 10), 2)
            candidate.score_basis = [
                f"检索式: {candidate.matched_query or '-'}",
                f"关键词交集: {', '.join(overlap[:8]) or '无'}",
                f"方向命中: {', '.join(exact_hits[:8]) or '无'}",
                "有摘要加权" if candidate.abstract else "无摘要，不加摘要权重",
                "有 DOI 加权" if candidate.doi else "无 DOI，不加 DOI 权重",
                "有来源链接加权" if candidate.url else "无来源链接，不加链接权重",
                "开放全文/开放获取加权" if candidate.open_access or candidate.fulltext_url else "未发现开放全文，不加开放权重",
            ]
        return sorted(candidates, key=lambda item: item.score, reverse=True)

    def _dedupe_same_scan(self, candidates: list[AgentCandidate]) -> list[AgentCandidate]:
        seen: set[str] = set()
        unique: list[AgentCandidate] = []
        for candidate in candidates:
            doi = normalize_doi(candidate.doi)
            key = f"doi:{doi}" if doi else f"title:{_title_key(candidate.title)}"
            if key in seen:
                continue
            seen.add(key)
            unique.append(candidate)
        return unique

    def _filter_candidates(
        self,
        payload: AgentScanRequest,
        candidates: list[AgentCandidate],
    ) -> list[AgentCandidate]:
        filtered = []
        min_score = payload.min_score * 10 if 0 < payload.min_score <= 1 else payload.min_score
        for candidate in candidates:
            if payload.published_after and candidate.published_at:
                if candidate.published_at < payload.published_after:
                    continue
            if payload.published_before and candidate.published_at:
                if candidate.published_at > payload.published_before:
                    continue
            if candidate.score < min_score:
                continue
            filtered.append(candidate)
        return filtered[: payload.limit]

    def _mark_duplicates(
        self,
        project_id: str | None,
        user: User,
        candidates: list[AgentCandidate],
    ) -> list[AgentCandidate]:
        knowledge_items = [
            item
            for item in self.store.knowledge.values()
            if item.user_id == user.id and (not project_id or item.project_id == project_id)
        ]
        knowledge_papers = [
            self.store.papers[item.paper_id]
            for item in knowledge_items
            if item.paper_id in self.store.papers
        ]
        for candidate in candidates:
            candidate_doi = normalize_doi(candidate.doi)
            candidate_title_key = _title_key(candidate.title)
            for paper in knowledge_papers:
                paper_doi = normalize_doi(paper.doi)
                if candidate_doi and paper_doi and candidate_doi == paper_doi:
                    candidate.duplicate_status = "duplicate_knowledge"
                    candidate.duplicate_of = paper.id
                    candidate.duplicate_reason = "DOI 与当前知识库论文一致。"
                    break
                if candidate_title_key and candidate_title_key == _title_key(paper.title):
                    candidate.duplicate_status = "duplicate_knowledge"
                    candidate.duplicate_of = paper.id
                    candidate.duplicate_reason = "标题与当前知识库论文一致。"
                    break
            if candidate.duplicate_status != "new":
                continue
            for paper in self.store.papers.values():
                paper_doi = normalize_doi(paper.doi)
                if candidate_doi and paper_doi and candidate_doi == paper_doi:
                    candidate.duplicate_status = "duplicate_paper"
                    candidate.duplicate_of = paper.id
                    candidate.duplicate_reason = "DOI 与 Paper 库已有论文一致，但尚未在知识库中。"
                    break
        return candidates

    def _paper_snapshot_from_candidate(self, candidate: AgentCandidate, paper: Paper) -> dict[str, Any]:
        return {
            "paper_id": paper.id,
            "candidate_id": candidate.id,
            "source": candidate.source,
            "source_mode": candidate.source_mode,
            "source_identifier": candidate.source_identifier,
            "matched_query": candidate.matched_query,
            "title": candidate.title,
            "title_zh": candidate.title_zh,
            "authors": candidate.authors,
            "year": candidate.year,
            "venue": candidate.venue,
            "journal": paper.journal,
            "doi": candidate.doi,
            "abstract": candidate.abstract,
            "keywords": candidate.keywords,
            "url": candidate.url,
            "fulltext_url": candidate.fulltext_url,
            "open_access": candidate.open_access,
            "fulltext_status": paper.fulltext_status,
            "citation_count": candidate.citation_count,
            "content_type": candidate.content_type,
            "compliance_note": candidate.compliance_note,
            "legal_access_note": (
                "返回完整论文元数据、DOI、来源链接和开放全文入口；不自动下载或分发受版权保护全文。"
            ),
        }

    async def _analyze_candidates(
        self,
        payload: AgentScanRequest,
        user: User,
        profile: ResearchProfile | None,
        candidates: list[AgentCandidate],
        trace: list[AgentTraceStep],
    ) -> list[AgentCandidateAnalysis]:
        new_candidates = [candidate for candidate in candidates if candidate.duplicate_status == "new"]
        targets = new_candidates[: payload.analyze_top_n]
        if not targets:
            trace.append(
                AgentTraceStep(
                    step="ai_analysis",
                    status="succeeded",
                    summary="没有非重复候选需要执行 AI 分析。",
                    input_count=0,
                    output_count=0,
                )
            )
            return []

        concurrency = max(1, min(self.settings.agent_ai_analysis_concurrency, len(targets)))
        semaphore = asyncio.Semaphore(concurrency)

        async def run_one(candidate: AgentCandidate) -> tuple[AgentCandidateAnalysis | None, AgentTraceStep | None]:
            async with semaphore:
                return await self._analyze_one_candidate(payload, user, profile, candidate)

        results = await asyncio.gather(*(run_one(candidate) for candidate in targets))
        analyses = [analysis for analysis, _ in results if analysis is not None]
        trace.extend(step for _, step in results if step is not None)
        trace.append(
            AgentTraceStep(
                step="ai_analysis",
                status="succeeded",
                summary=(
                    f"并发执行非重复候选 AI 分析，最大并发 {concurrency}；"
                    "单篇失败不阻断其他候选。"
                ),
                input_count=len(targets),
                output_count=len(analyses),
                evidence_refs=[analysis.candidate_id for analysis in analyses],
            )
        )
        return analyses

    async def _analyze_one_candidate(
        self,
        payload: AgentScanRequest,
        user: User,
        profile: ResearchProfile | None,
        candidate: AgentCandidate,
    ) -> tuple[AgentCandidateAnalysis | None, AgentTraceStep | None]:
        paper = Paper(
            id=f"agent_{candidate.id}",
            title=candidate.title,
            title_zh=candidate.title_zh,
            year=candidate.year or date.today().year,
            journal=candidate.venue or candidate.source,
            doi=candidate.doi,
            authors=candidate.authors,
            abstract=candidate.abstract,
            keywords=candidate.keywords,
            fulltext_status="open_access"
            if candidate.open_access or candidate.fulltext_url
            else "unknown",
            source_count=1,
        )
        try:
            ai_result = await AiProvider(self.settings).analyze_paper(
                paper=paper,
                profile=profile,
                analysis_type=payload.analysis_type,
                input_scope=payload.input_scope,
            )
            claims = [AnalysisClaim.model_validate(item) for item in ai_result["claims"]]
        except AiProviderConfigError as exc:
            return None, AgentTraceStep(
                step="ai_analysis",
                status="failed",
                summary=f"AI provider 配置缺失：{exc}",
                input_count=1,
            )
        except (AiOutputValidationError, KeyError, ValueError, httpx.HTTPError) as exc:
            return None, AgentTraceStep(
                step="ai_analysis",
                status="failed",
                summary=f"候选 {candidate.id} 的 AI 输出无效或请求失败：{exc}",
                input_count=1,
            )

        safety = validate_analysis_safety(ai_result["result"], claims, paper)
        if safety["hallucinated_doi_count"] or safety["fact_inference_confusion_count"]:
            return None, AgentTraceStep(
                step="ai_safety",
                status="failed",
                summary=f"候选 {candidate.id} 未通过 AI 安全校验。",
                input_count=1,
                output_count=0,
            )
        cost = self.store.add_cost(
            user_id=user.id,
            project_id=payload.project_id,
            paper_id=paper.id,
            feature=f"agent.research_scan.{payload.analysis_type}",
            requirement_id="RR-FUTURE-010",
            provider=self.settings.ai_provider,
            model=ai_result["model"],
            quota_delta=0,
            estimated_cost=0.0 if self.settings.ai_provider == "mock" else 0.01,
            task_id=None,
            input_tokens=max(1, len(_compact_text(paper.title, paper.abstract)) // 4),
            output_tokens=max(1, sum(len(claim.claim) for claim in claims) // 2),
        )
        return AgentCandidateAnalysis(
            candidate_id=candidate.id,
            paper_id=paper.id,
            paper=self._paper_snapshot_from_candidate(candidate, paper),
            analysis_type=payload.analysis_type,
            input_scope=payload.input_scope,
            result=ai_result["result"],
            claims=claims,
            evidence_labels_valid=not safety["missing_fact_levels"],
            traceability_score=0.86,
            model=ai_result["model"],
            cost_record_id=cost.id,
        ), None

    async def _build_report(
        self,
        payload: AgentScanRequest,
        user: User,
        analyses: list[AgentCandidateAnalysis],
        trace: list[AgentTraceStep],
    ) -> AgentScanReport | None:
        if not analyses:
            return None
        reading_order = [
            str(analysis.result.get("title_zh") or analysis.paper_id)
            for analysis in analyses
        ]
        deep_read_titles = [
            str(analysis.result.get("title_zh") or analysis.paper_id)
            for analysis in analyses
            if analysis.result.get("worth_deep_reading") is True
        ]
        report = AgentScanReport(
            title="Agent Research Scan 逐篇分析索引",
            executive_summary=(
                f"已按程序对 {len(analyses)} 篇非重复候选完成逐篇 AI 分析；"
                "篇数由 limit/analyze_top_n 和去重结果控制，未由 AI 决定。"
            ),
            key_findings=[
                "每篇候选均独立调用 AI 分析，并通过事实分级与 DOI 安全校验。",
                "重复知识库或 Paper 库的候选不会进入 AI 分析。",
            ],
            recommended_reading_order=reading_order,
            research_gaps=[
                "当前结果基于元数据/摘要；实验参数、样本量和关键结论仍需回到原文核验。"
            ],
            next_actions=[
                "优先深读 worth_deep_reading=true 的论文。",
                "确认有价值后再加入知识库或项目推荐列表。",
            ],
            evidence_refs=[analysis.candidate_id for analysis in analyses],
            model="deterministic-agent-scan-report",
        )
        cost = self.store.add_cost(
            user_id=user.id,
            project_id=payload.project_id,
            feature="agent.research_scan.report_index",
            requirement_id="RR-FUTURE-010",
            provider="system",
            model=report.model,
            quota_delta=0,
            estimated_cost=0.0,
            input_tokens=0,
            output_tokens=0,
        )
        report.cost_record_id = cost.id
        if deep_read_titles:
            report.next_actions.insert(0, f"建议优先核验：{deep_read_titles[0]}")
        trace.append(
            AgentTraceStep(
                step="report_index",
                status="succeeded",
                summary="由后端确定性生成逐篇分析索引，不触发额外 AI 调用。",
                input_count=len(analyses),
                output_count=1,
                evidence_refs=report.evidence_refs,
            )
        )
        return report
