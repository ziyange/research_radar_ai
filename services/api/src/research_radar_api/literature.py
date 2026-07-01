from __future__ import annotations

import asyncio
import json
import mimetypes
import os
import re
import shutil
import smtplib
import subprocess
import time
from datetime import datetime, timezone
from email.message import EmailMessage
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse

from .literature_runtime.analysis import create_report
from .literature_runtime.models import AnalyzePayload, CliResult, MailTestPayload, TaskPayload
from .literature_runtime.fulltext import fetch_fulltext_for_paper, save_paper_asset
from .literature_runtime.repository import (
    ROOT_DIR,
)
from .literature_runtime.retrieval import (
    dedupe,
    doi_url,
    expand_queries,
    fetch_crossref,
    fetch_openalex,
    relevant_enough,
    score_paper,
    slug,
    unique_strings,
)
from .literature_runtime.state import repository, resolve_reader_file
from .settings import get_settings


router = APIRouter(prefix="/api/v1/literature", tags=["literature"])

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def perform_scan(payload: dict[str, Any], task_id: str | None = None, trigger: str = "manual") -> dict[str, Any]:
    query = str(payload.get("query") or "").strip()
    if not query:
        raise HTTPException(status_code=400, detail={"code": "QUERY_REQUIRED", "message": "请输入研究方向"})
    count = max(1, min(20, int(payload.get("count") or 5)))
    year_from = int(payload["yearFrom"]) if payload.get("yearFrom") else None
    min_score = float(payload.get("minScore") or 0)
    sources = payload.get("sources") or ["openalex", "crossref"]
    query_plan = await expand_queries(query)
    fetch_limit = max(120, count * 30)
    source_statuses: list[dict[str, Any]] = []

    async def fetch_job(source: str, planned: dict[str, str]) -> list[dict[str, Any]]:
        try:
            items = (
                await fetch_crossref(planned["query"], year_from, fetch_limit)
                if source == "crossref"
                else await fetch_openalex(planned["query"], year_from, fetch_limit)
            )
            source_statuses.append(
                {
                    "source": source,
                    "query": planned["query"],
                    "querySource": planned["source"],
                    "status": "succeeded",
                    "count": len(items),
                }
            )
            for paper in items:
                paper["matchedQuery"] = planned["query"]
                paper["querySource"] = planned["source"]
                paper["rawScore"] = max(
                    score_paper(paper, query, year_from),
                    score_paper(paper, planned["query"], year_from),
                )
            return items
        except Exception as exc:
            source_statuses.append(
                {
                    "source": source,
                    "query": planned["query"],
                    "querySource": planned["source"],
                    "status": "failed",
                    "error": str(exc),
                }
            )
            return []

    batches = await asyncio.gather(
        *[
            fetch_job(source, planned)
            for planned in query_plan
            for source in sources
            if source in {"openalex", "crossref"}
        ]
    )
    candidates = [
        paper
        for paper in sorted([paper for batch in batches for paper in batch], key=lambda item: item.get("rawScore") or 0, reverse=True)
        if paper.get("title")
        and (paper.get("rawScore") or 0) >= min_score
        and any(relevant_enough(paper, planned["query"]) for planned in query_plan)
    ]
    unique, duplicates = dedupe(repository.library["papers"], candidates)
    selected = sorted(unique, key=lambda item: item.get("rawScore") or 0, reverse=True)[:count]
    saved = [await save_paper_asset(paper, payload.get("downloadOpenPdf") is not False) for paper in selected]
    run = {
        "id": f"scan_{uuid4()}",
        "taskId": task_id,
        "query": query,
        "trigger": trigger,
        "count": count,
        "yearFrom": year_from,
        "minScore": min_score,
        "sources": sources,
        "queryPlan": query_plan,
        "fetchLimitPerQuery": fetch_limit,
        "sourceStatuses": source_statuses,
        "candidateCount": len(candidates),
        "uniqueCount": len(unique),
        "duplicateCount": len(duplicates),
        "duplicateTitles": [item.get("title") for item in duplicates[:12]],
        "savedPaperIds": [paper["id"] for paper in saved],
        "savedCount": len(saved),
        "targetMet": len(saved) >= count,
        "exhaustedReason": ""
        if len(saved) >= count
        else ("没有找到满足评分、时间和去重条件的新文献" if not unique else "满足条件的新文献少于目标篇数"),
        "createdAt": now_iso(),
    }
    repository.library["papers"] = [*saved, *repository.library["papers"]]
    repository.library["scanRuns"] = [run, *repository.library["scanRuns"]][:100]
    repository.save_library()
    return {
        "run": run,
        "papers": [repository.serialize_paper(paper) for paper in saved],
        "duplicates": duplicates,
        "library": repository.serialize_library(),
    }


def agent_mail_cli_path() -> str:
    configured = get_settings().agent_mail_cli
    found = shutil.which(configured)
    if found:
        return found
    appdata = os.environ.get("APPDATA")
    if appdata:
        bundled = Path(appdata) / "npm" / "node_modules" / "@tencent-qqmail" / "agently-cli-win32-x64" / "bin" / "agently-cli.exe"
        if bundled.exists():
            return str(bundled)
    return configured


def run_agent_mail(args: list[str], cwd: Path | None = None, timeout: int = 45) -> CliResult:
    try:
        result = subprocess.run(
            [agent_mail_cli_path(), *args],
            cwd=str(cwd or ROOT_DIR),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
            check=False,
        )
        return CliResult(result.returncode, result.stdout, result.stderr)
    except FileNotFoundError:
        return CliResult(127, "", "Agent Mail CLI 未安装")
    except subprocess.TimeoutExpired as exc:
        return CliResult(124, exc.stdout or "", exc.stderr or "AGENT_MAIL_TIMEOUT")


def parse_cli_json(output: str) -> dict[str, Any] | None:
    match = re.search(r"\{[\s\S]*\}", output or "")
    if not match:
        return None
    try:
        return json.loads(match.group(0))
    except json.JSONDecodeError:
        return None


def extract_confirmation(output: str) -> tuple[str, str]:
    token = re.search(r"ctk_[A-Za-z0-9_\-]+", output or "")
    summary_match = re.search(r"summary[\"']?\s*[:：]\s*[\"']?([^\"'\n]+)", output or "")
    return (token.group(0) if token else "", summary_match.group(1) if summary_match else output[:1200])


def confirmation_token_invalid(output: str) -> bool:
    payload = parse_cli_json(output) or {}
    error = payload.get("error") or payload.get("data", {}).get("error") or {}
    message = str(error.get("message") or output or "").lower()
    return "confirmation token" in message and ("expired" in message or "invalid" in message)


def mail_status() -> dict[str, Any]:
    settings = get_settings()
    if settings.email_provider == "smtp":
        configured = bool(
            settings.smtp_host
            and settings.email_from
            and (not settings.smtp_username or settings.smtp_password)
        )
        return {
            "enabled": configured,
            "installed": True,
            "authorized": configured,
            "email": settings.email_from,
            "sendCapable": configured,
            "provider": "smtp",
            "message": "ok" if configured else "SMTP_CONFIG_MISSING",
        }
    enabled = settings.agent_mail_enabled or settings.email_provider == "agent_mail"
    cli = agent_mail_cli_path()
    if not shutil.which(cli) and not Path(cli).exists():
        return {"enabled": enabled, "installed": False, "authorized": False, "email": "", "sendCapable": False, "cli": cli, "message": "Agent Mail CLI 未安装"}
    result = run_agent_mail(["+me"], timeout=12)
    payload = parse_cli_json(f"{result.stdout}\n{result.stderr}") or {}
    aliases = payload.get("data", {}).get("aliases") or []
    primary = next((item for item in aliases if item.get("is_primary")), aliases[0] if aliases else {})
    email = primary.get("email") or ""
    return {
        "enabled": enabled,
        "installed": True,
        "authorized": bool(result.code == 0 and email),
        "email": email,
        "sendCapable": bool(result.code == 0 and email),
        "provider": "agent_mail",
        "cli": cli,
        "message": "ok" if result.code == 0 else (result.stderr or result.stdout or "Agent Mail 未授权"),
    }


def send_smtp_delivery(delivery: dict[str, Any], body_path: Path) -> str:
    settings = get_settings()
    if not settings.smtp_host:
        raise RuntimeError("SMTP_CONFIG_MISSING")
    recipients = delivery.get("recipients") or []
    cc = delivery.get("cc") or []
    bcc = delivery.get("bcc") or []
    message = EmailMessage()
    message["From"] = settings.email_from
    message["To"] = ", ".join(recipients)
    if cc:
        message["Cc"] = ", ".join(cc)
    message["Subject"] = delivery["subject"]
    message.set_content(body_path.read_text(encoding="utf-8", errors="ignore"))
    for attachment in (delivery.get("attachments") or [])[:3]:
        attachment_path = resolve_reader_file(str(attachment or ""))
        if not attachment_path:
            continue
        content_type, _ = mimetypes.guess_type(attachment_path.name)
        maintype, subtype = (content_type or "application/octet-stream").split("/", 1)
        message.add_attachment(
            attachment_path.read_bytes(),
            maintype=maintype,
            subtype=subtype,
            filename=attachment_path.name,
        )
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=30) as smtp:
        if settings.smtp_use_tls:
            smtp.starttls()
        if settings.smtp_username:
            smtp.login(settings.smtp_username, settings.smtp_password or "")
        smtp.send_message(message, to_addrs=[*recipients, *cc, *bcc])
    return f"smtp:{int(time.time())}"


def delivery_subject(kind: str, paper: dict[str, Any], task: dict[str, Any] | None = None) -> str:
    prefix = "AI分析" if kind == "analysis_report" else "完整文献" if kind == "paper_fulltext" else "测试邮件"
    title = (
        paper.get("titleZh")
        or paper.get("title_zh")
        or paper.get("translatedTitle")
        or paper.get("title")
        or (task or {}).get("query")
        or "Agent Mail"
    )
    return f"[研知雷达] {prefix} · {title[:58]}"


def recipients_for_task(task: dict[str, Any] | None, explicit: list[str] | None = None) -> list[str]:
    return unique_strings(
        [
            *(explicit or []),
            *((task or {}).get("recipientEmails") or []),
            *get_settings().agent_mail_default_recipients,
        ]
    )


def mail_copy_for_task(task: dict[str, Any] | None, key: str) -> list[str]:
    return unique_strings((task or {}).get(key) or [])


def delivery_body_markdown(kind: str, paper: dict[str, Any], task: dict[str, Any] | None, report: dict[str, Any] | None) -> str:
    if report:
        return str(report.get("markdown") or "")
    if kind == "mail_test":
        return paper_delivery_markdown(paper, task, include_fulltext=False)
    return paper_delivery_markdown(paper, task, include_fulltext=True)


def delivery_attachments(delivery_id: str, paper: dict[str, Any], report: dict[str, Any] | None) -> list[str]:
    attachments: list[str] = []
    candidates = [paper.get("localPdfPath")]
    for source in candidates:
        path = resolve_reader_file(str(source or ""))
        if not path:
            continue
        suffix = path.suffix or ".bin"
        target = repository.mail_dir / f"{delivery_id}-{slug(path.stem, 42)}{suffix}"
        try:
            if path.resolve() != target.resolve():
                shutil.copyfile(path, target)
            attachments.append(str(target.relative_to(ROOT_DIR)).replace("\\", "/"))
        except OSError:
            continue
        if len(attachments) >= 3:
            break
    return attachments


def add_mail_delivery(kind: str, paper: dict[str, Any], task: dict[str, Any] | None = None, report: dict[str, Any] | None = None, recipients: list[str] | None = None) -> dict[str, Any]:
    id_ = f"mail_{uuid4()}"
    subject = delivery_subject(kind, paper, task)
    body = delivery_body_markdown(kind, paper, task, report)
    body_path = repository.mail_dir / f"{slug(subject)}-{id_}.md"
    body_path.write_text(body, encoding="utf-8")
    delivery = {
        "id": id_,
        "kind": kind,
        "taskId": (task or {}).get("id"),
        "runId": None,
        "paperId": paper.get("id"),
        "reportId": (report or {}).get("id"),
        "recipient": "",
        "recipients": recipients_for_task(task, recipients),
        "cc": mail_copy_for_task(task, "ccEmails"),
        "bcc": mail_copy_for_task(task, "bccEmails"),
        "subject": subject,
        "markdownPath": str(body_path.relative_to(ROOT_DIR)).replace("\\", "/"),
        "bodyFile": str(body_path.relative_to(ROOT_DIR)).replace("\\", "/"),
        "attachments": delivery_attachments(id_, paper, report),
        "status": "queued",
        "confirmationToken": "",
        "confirmationSummary": "",
        "error": "",
        "createdAt": now_iso(),
        "sentAt": "",
    }
    repository.library["mailDeliveries"] = [delivery, *repository.library["mailDeliveries"]][:500]
    repository._persist_item("mailDeliveries", delivery)
    return attempt_mail_delivery(id_)


def paper_delivery_markdown(paper: dict[str, Any], task: dict[str, Any] | None, include_fulltext: bool = True) -> str:
    lines = [
        f"# {paper.get('title')}",
        "",
        "| 字段 | 内容 |",
        "| --- | --- |",
        f"| 研究方向 | {(task or {}).get('query') or paper.get('matchedQuery') or ''} |",
        f"| DOI | {paper.get('doi') or '未提供'} |",
        f"| 年份 | {paper.get('year') or '未知'} |",
        f"| 期刊 | {paper.get('journal') or paper.get('source') or '未知'} |",
        f"| 来源 | {paper.get('source') or '未知'} |",
        f"| 匹配评分 | {round(paper.get('rawScore') or 0)} |",
        f"| 开放获取 | {'是' if paper.get('openAccess') else '未知或受限'} |",
        f"| 本地 PDF | {paper.get('localPdfPath') or '未下载'} |",
        f"| 本地 Markdown | {paper.get('localFullTextPath') or paper.get('localMarkdownPath') or '未保存'} |",
        "",
        "## 摘要",
        "",
        paper.get("abstract") or "未提供摘要。",
        "",
        "## 文件与链接",
        "",
        f"- DOI/来源链接: {doi_url(paper.get('doi')) or paper.get('landingPageUrl') or paper.get('sourceUrl') or '未提供'}",
        f"- 在线 PDF: {paper.get('pdfUrl') or '未提供'}",
    ]
    if include_fulltext:
        fulltext_path = paper.get("localFullTextPath") or paper.get("localMarkdownPath")
        file_path = resolve_reader_file(str(fulltext_path or ""))
        if file_path:
            content = file_path.read_text(encoding="utf-8", errors="ignore").strip()
            if content:
                lines.extend(["", "## 本地原文 / 解析", "", content])
        else:
            lines.extend(["", "## 本地原文 / 解析", "", "尚未获取到可合法保存的完整原文；请打开 DOI 页面下载 PDF 后上传。"])
    return "\n".join(lines)


def attempt_mail_delivery(delivery_id: str, confirmation_token: str = "") -> dict[str, Any]:
    index = next((idx for idx, item in enumerate(repository.library["mailDeliveries"]) if item["id"] == delivery_id), -1)
    if index < 0:
        raise HTTPException(status_code=404, detail={"code": "MAIL_DELIVERY_NOT_FOUND"})
    delivery = repository.library["mailDeliveries"][index]
    status = mail_status()
    recipients = delivery.get("recipients") or []
    if not recipients:
        delivery.update(status="queued", error="MAIL_RECIPIENT_REQUIRED")
        repository._persist_item("mailDeliveries", delivery)
        return delivery
    if not status["enabled"] or not status["installed"] or not status["authorized"]:
        delivery.update(status="failed", error=status.get("message") or "AGENT_MAIL_NOT_READY")
        repository._persist_item("mailDeliveries", delivery)
        return delivery
    body_path = resolve_reader_file(delivery["markdownPath"])
    if not body_path:
        delivery.update(status="failed", error="MAIL_BODY_FILE_MISSING")
        repository._persist_item("mailDeliveries", delivery)
        return delivery
    if status.get("provider") == "smtp":
        delivery.update(status="sending", recipient=",".join(recipients), error="")
        repository._persist_item("mailDeliveries", delivery)
        try:
            provider_message_id = send_smtp_delivery(delivery, body_path)
            delivery.update(
                status="sent",
                sentAt=now_iso(),
                error="",
                providerMessageId=provider_message_id,
                confirmationToken="",
                confirmationSummary="",
            )
        except Exception as exc:
            delivery.update(status="failed", error=str(exc) or "SMTP_SEND_FAILED")
        repository.library["mailDeliveries"][index] = delivery
        repository._persist_item("mailDeliveries", delivery)
        return delivery
    args = ["message", "+send"]
    for recipient in recipients:
        args.extend(["--to", recipient])
    for cc in delivery.get("cc") or []:
        args.extend(["--cc", cc])
    for bcc in delivery.get("bcc") or []:
        args.extend(["--bcc", bcc])
    args.extend(["--subject", delivery["subject"], "--body-file", body_path.name])
    attachment_names: list[str] = []
    for attachment in (delivery.get("attachments") or [])[:3]:
        attachment_path = resolve_reader_file(str(attachment or ""))
        if not attachment_path:
            continue
        if attachment_path.parent != body_path.parent:
            target = body_path.parent / f"{delivery['id']}-{slug(attachment_path.stem, 42)}{attachment_path.suffix or '.bin'}"
            try:
                shutil.copyfile(attachment_path, target)
                attachment_path = target
            except OSError:
                continue
        attachment_names.append(attachment_path.name)
    for attachment_name in attachment_names:
        args.extend(["--attachment", attachment_name])
    if confirmation_token:
        args.extend(["--confirmation-token", confirmation_token])
    delivery.update(status="sending", recipient=",".join(recipients), error="")
    repository._persist_item("mailDeliveries", delivery)
    result = run_agent_mail(args, cwd=body_path.parent, timeout=45)
    output = f"{result.stdout}\n{result.stderr}".strip()
    token, summary = extract_confirmation(output)
    payload = parse_cli_json(output) or {}
    if result.code == 0 and not token:
        delivery.update(
            status="sent",
            sentAt=now_iso(),
            error="",
            providerMessageId=payload.get("data", {}).get("message_id") or payload.get("message_id") or "",
        )
    elif token:
        delivery.update(
            status="pending_confirmation",
            confirmationToken=token,
            confirmationSummary=summary,
            error="",
        )
    else:
        if confirmation_token and confirmation_token_invalid(output):
            delivery.update(
                status="queued",
                confirmationToken="",
                confirmationSummary="",
                error="MAIL_CONFIRMATION_EXPIRED_REGENERATING",
            )
            repository.library["mailDeliveries"][index] = delivery
            repository._persist_item("mailDeliveries", delivery)
            return attempt_mail_delivery(delivery_id)
        delivery.update(status="failed", error=output or f"AGENT_MAIL_EXIT_{result.code}")
    repository.library["mailDeliveries"][index] = delivery
    repository._persist_item("mailDeliveries", delivery)
    return delivery


@router.get("/health")
def literature_health() -> dict[str, Any]:
    settings = get_settings()
    return {
        "status": "ok",
        "storage": settings.literature_storage_provider,
        "ai": {
            "provider": settings.ai_provider,
            "model": settings.openai_model if settings.ai_provider == "openai" else "mock-literature-analysis",
            "configured": settings.ai_configured,
            "baseUrlHost": settings.openai_base_url_host,
        },
        "mail": mail_status(),
        "counts": {
            "papers": len(repository.library["papers"]),
            "reports": len(repository.library["reports"]),
            "scanRuns": len(repository.library["scanRuns"]),
            "mailDeliveries": len(repository.library["mailDeliveries"]),
            "tasks": len(repository.tasks),
        },
    }


@router.get("/library")
def get_library() -> dict[str, Any]:
    return repository.serialize_library()


@router.post("/scan")
async def scan(payload: TaskPayload) -> dict[str, Any]:
    return await perform_scan(payload.model_dump())


@router.get("/tasks")
def list_tasks() -> dict[str, Any]:
    return {"tasks": repository.tasks}


@router.post("/tasks")
def create_task(payload: TaskPayload) -> dict[str, Any]:
    task = {
        **payload.model_dump(),
        "id": f"task_{uuid4()}",
        "createdAt": now_iso(),
        "updatedAt": now_iso(),
        "nextScheduledRunAt": "",
    }
    repository.tasks = [task, *repository.tasks]
    repository._persist_item("tasks", task)
    return {"task": task, "tasks": repository.tasks}


@router.put("/tasks/{task_id}")
def update_task(task_id: str, payload: TaskPayload) -> dict[str, Any]:
    for index, task in enumerate(repository.tasks):
        if task["id"] == task_id:
            updated = {**task, **payload.model_dump(), "updatedAt": now_iso()}
            repository.tasks[index] = updated
            repository._persist_item("tasks", updated)
            return {"task": updated, "tasks": repository.tasks}
    raise HTTPException(status_code=404, detail={"code": "TASK_NOT_FOUND"})


@router.delete("/tasks/{task_id}")
def delete_task(task_id: str) -> dict[str, Any]:
    repository.tasks = [task for task in repository.tasks if task["id"] != task_id]
    repository._delete_item("tasks", task_id)
    return {"tasks": repository.tasks}


@router.post("/tasks/{task_id}:run")
async def run_task(task_id: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    task = next((item for item in repository.tasks if item["id"] == task_id), None)
    if not task:
        raise HTTPException(status_code=404, detail={"code": "TASK_NOT_FOUND"})
    if task.get("notifyAfterRun") and not task.get("recipientEmails"):
        task["lastRunStatus"] = "failed"
        task["lastRunError"] = "MAIL_RECIPIENT_REQUIRED"
        task["lastRunFinishedAt"] = now_iso()
        repository._persist_item("tasks", task)
        raise HTTPException(
            status_code=400,
            detail={
                "code": "MAIL_RECIPIENT_REQUIRED",
                "message": "开启推送邮箱时必须在任务中填写收件人 To。",
            },
        )
    task["lastRunStatus"] = "running"
    task["lastRunStartedAt"] = now_iso()
    repository._persist_item("tasks", task)
    try:
        result = await perform_scan({**task, **(payload or {})}, task_id=task_id)
        task["lastRunStatus"] = "succeeded"
        task["lastRunFinishedAt"] = now_iso()
        task["lastRunSavedCount"] = result["run"]["savedCount"]
        task["lastRunId"] = result["run"]["id"]
        if task.get("notifyAfterRun"):
            if task.get("autoAnalyze"):
                for paper in result["papers"]:
                    report = await create_report([paper], task.get("query") or "")
                    add_mail_delivery("analysis_report", paper, task=task, report=report)
            else:
                for paper in result["papers"]:
                    add_mail_delivery("paper_fulltext", paper, task=task)
        repository._persist_item("tasks", task)
        result["tasks"] = repository.tasks
        result["mailDeliveries"] = repository.serialize_library()["mailDeliveries"]
        return result
    except Exception as exc:
        task["lastRunStatus"] = "failed"
        task["lastRunError"] = str(exc)
        task["lastRunFinishedAt"] = now_iso()
        repository._persist_item("tasks", task)
        raise


@router.post("/analyze")
async def analyze(payload: AnalyzePayload) -> dict[str, Any]:
    selected = set(payload.paperIds or [])
    papers = [
        paper
        for paper in repository.library["papers"]
        if not selected or paper["id"] in selected
    ][: max(1, payload.limit)]
    if not papers:
        raise HTTPException(status_code=400, detail={"code": "NO_LOCAL_PAPERS"})
    fallback_query = repository.library["scanRuns"][0].get("query", "") if repository.library["scanRuns"] else ""
    report = await create_report(papers, payload.query or fallback_query, payload.title)
    return {"report": report, "library": repository.serialize_library()}


@router.delete("/papers/{paper_id}")
def delete_paper(paper_id: str) -> dict[str, Any]:
    repository.library["papers"] = [paper for paper in repository.library["papers"] if paper["id"] != paper_id]
    for run in repository.library["scanRuns"]:
        run["savedPaperIds"] = [item for item in run.get("savedPaperIds", []) if item != paper_id]
        repository._persist_item("scanRuns", run)
    repository.library["reports"] = [
        report for report in repository.library["reports"] if paper_id not in report.get("paperIds", [])
    ]
    repository._delete_item("papers", paper_id)
    repository.save_library()
    return {"library": repository.serialize_library()}


@router.post("/papers/{paper_id}:fetch-fulltext")
async def fetch_paper_fulltext(paper_id: str) -> dict[str, Any]:
    paper = next((item for item in repository.library["papers"] if item["id"] == paper_id), None)
    if not paper:
        raise HTTPException(status_code=404, detail={"code": "PAPER_NOT_FOUND"})
    result = await fetch_fulltext_for_paper(dict(paper))
    return {"paper": result["paper"], "retrieval": result["retrieval"], "library": repository.serialize_library()}


@router.post("/papers/{paper_id}:upload-pdf")
async def upload_pdf(paper_id: str, request: Request) -> dict[str, Any]:
    content_type = request.headers.get("content-type", "")
    if "application/pdf" not in content_type:
        raise HTTPException(status_code=415, detail={"code": "PDF_REQUIRED", "message": "请上传 PDF 文件"})
    body = await request.body()
    paper = next((item for item in repository.library["papers"] if item["id"] == paper_id), None)
    if not paper:
        raise HTTPException(status_code=404, detail={"code": "PAPER_NOT_FOUND"})
    pdf_path = repository.downloads_dir / f"{paper_id}.pdf"
    pdf_path.write_bytes(body)
    paper["localPdfPath"] = str(pdf_path.relative_to(ROOT_DIR)).replace("\\", "/")
    repository._persist_item("papers", paper)
    return {"paper": repository.serialize_paper(paper), "library": repository.serialize_library()}


@router.post("/papers/{paper_id}/upload-pdf")
async def upload_pdf_file(paper_id: str, file: UploadFile) -> dict[str, Any]:
    if file.content_type and "pdf" not in file.content_type:
        raise HTTPException(status_code=415, detail={"code": "PDF_REQUIRED", "message": "请上传 PDF 文件"})
    paper = next((item for item in repository.library["papers"] if item["id"] == paper_id), None)
    if not paper:
        raise HTTPException(status_code=404, detail={"code": "PAPER_NOT_FOUND"})
    pdf_path = repository.downloads_dir / f"{paper_id}.pdf"
    pdf_path.write_bytes(await file.read())
    paper["localPdfPath"] = str(pdf_path.relative_to(ROOT_DIR)).replace("\\", "/")
    repository._persist_item("papers", paper)
    return {"paper": repository.serialize_paper(paper), "library": repository.serialize_library()}


@router.get("/mail/status")
def get_mail_status() -> dict[str, Any]:
    return {**mail_status(), "authSession": None}


@router.post("/mail/auth:start")
def start_mail_auth() -> dict[str, Any]:
    process = subprocess.Popen(
        [agent_mail_cli_path(), "auth", "login"],
        cwd=str(ROOT_DIR),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
    )
    output = ""
    auth_url = ""
    started = time.monotonic()
    while time.monotonic() - started < 15:
        if process.stdout is None:
            break
        chunk = process.stdout.readline()
        if chunk:
            output += chunk
            match = re.search(r"https?://\S+", output)
            if match:
                auth_url = match.group(0)
                break
        if process.poll() is not None:
            break
    if not auth_url:
        raise HTTPException(
            status_code=503,
            detail={"code": "AGENT_MAIL_AUTH_URL_MISSING", "message": output or "未获取到授权链接"},
        )
    return {
        "authUrl": auth_url,
        "session": {
            "status": "running",
            "url": auth_url,
            "output": output,
            "startedAt": now_iso(),
        },
    }


@router.post("/mail/auth:logout")
def logout_mail_auth() -> dict[str, Any]:
    result = run_agent_mail(["auth", "logout"], timeout=20)
    if result.code not in {0, 3}:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "AGENT_MAIL_LOGOUT_FAILED",
                "message": result.stderr or result.stdout or f"Agent Mail logout failed: {result.code}",
            },
        )
    return {"status": "logged_out", "mail": mail_status()}


@router.get("/mail/outbox")
def get_mail_outbox() -> dict[str, Any]:
    return {"deliveries": repository.serialize_library()["mailDeliveries"]}


@router.post("/mail/test")
def send_test_mail(payload: MailTestPayload) -> dict[str, Any]:
    paper = {"id": "mail_test", "title": "Agent Mail 测试邮件", "abstract": "这是一封由研知雷达正式 FastAPI 服务生成的测试邮件。", "source": "local"}
    delivery = add_mail_delivery("mail_test", paper, task={"query": "Agent Mail 测试"}, recipients=payload.to)
    return {"delivery": repository.serialize_delivery(delivery), "library": repository.serialize_library()}


@router.post("/mail/deliveries/{delivery_id}:confirm")
def confirm_mail_delivery(delivery_id: str) -> dict[str, Any]:
    delivery = next((item for item in repository.library["mailDeliveries"] if item["id"] == delivery_id), None)
    if not delivery:
        raise HTTPException(status_code=404, detail={"code": "MAIL_DELIVERY_NOT_FOUND"})
    token = delivery.get("confirmationToken")
    if not token:
        raise HTTPException(status_code=400, detail={"code": "MAIL_CONFIRMATION_TOKEN_MISSING"})
    updated = attempt_mail_delivery(delivery_id, token)
    return {"delivery": repository.serialize_delivery(updated), "library": repository.serialize_library()}


@router.post("/mail/deliveries:confirm-pending")
def confirm_pending_mail_deliveries() -> dict[str, Any]:
    pending = [
        item
        for item in repository.library["mailDeliveries"]
        if item.get("status") == "pending_confirmation" and item.get("confirmationToken")
    ]
    confirmed: list[dict[str, Any]] = []
    for delivery in pending:
        updated = attempt_mail_delivery(delivery["id"], delivery["confirmationToken"])
        confirmed.append(repository.serialize_delivery(updated))
    return {
        "confirmed": confirmed,
        "library": repository.serialize_library(),
    }


@router.post("/mail/deliveries/{delivery_id}:retry")
def retry_mail_delivery(delivery_id: str) -> dict[str, Any]:
    delivery = next((item for item in repository.library["mailDeliveries"] if item["id"] == delivery_id), None)
    if not delivery:
        raise HTTPException(status_code=404, detail={"code": "MAIL_DELIVERY_NOT_FOUND"})
    delivery.update(confirmationToken="", confirmationSummary="", error="")
    repository._persist_item("mailDeliveries", delivery)
    updated = attempt_mail_delivery(delivery_id)
    return {"delivery": repository.serialize_delivery(updated), "library": repository.serialize_library()}


@router.get("/files/{relative_path:path}")
def get_literature_file(relative_path: str) -> FileResponse:
    path = resolve_reader_file(relative_path)
    if not path:
        raise HTTPException(status_code=404, detail={"code": "FILE_NOT_FOUND"})
    return FileResponse(path, media_type=mimetypes.guess_type(path.name)[0])
