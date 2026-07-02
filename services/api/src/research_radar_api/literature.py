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
import zipfile
from datetime import datetime, timezone
from email.message import EmailMessage
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse

from .literature_runtime.analysis import create_report
from .literature_runtime.models import AnalyzePayload, CliResult, MailTestPayload, TaskPayload
from .literature_runtime.fulltext import fetch_fulltext_for_paper, save_paper_asset, save_pdf_text_asset
from .literature_runtime.markdown_pdf import markdown_file_to_pdf, markdown_to_pdf, markdown_to_plain_text
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


def execution_event(stage: str, status: str, message: str, **fields: Any) -> dict[str, Any]:
    return {
        "id": f"evt_{uuid4().hex[:10]}",
        "at": now_iso(),
        "stage": stage,
        "status": status,
        "message": message,
        **{key: value for key, value in fields.items() if value not in (None, "", [])},
    }


EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def normalize_task_mail_push(task: dict[str, Any]) -> bool:
    changed = False
    recipients = unique_strings(task.get("recipientEmails") or [])
    cc = unique_strings(task.get("ccEmails") or [])
    bcc = unique_strings(task.get("bccEmails") or [])
    invalid = [
        item
        for item in [*recipients, *cc, *bcc]
        if not EMAIL_PATTERN.match(str(item))
    ]
    if task.get("recipientEmails") != recipients:
        task["recipientEmails"] = recipients
        changed = True
    if task.get("ccEmails") != cc:
        task["ccEmails"] = cc
        changed = True
    if task.get("bccEmails") != bcc:
        task["bccEmails"] = bcc
        changed = True
    if task.get("notifyAfterRun") and (not recipients or invalid):
        task["notifyAfterRun"] = False
        if invalid:
            task["recipientEmails"] = []
            task["ccEmails"] = []
            task["bccEmails"] = []
        changed = True
    return changed


def normalize_all_tasks_mail_push() -> None:
    changed = False
    for task in repository.tasks:
        changed = normalize_task_mail_push(task) or changed
    if changed:
        repository.save_tasks()


def classify_source_error(error: str) -> str:
    text = (error or "").lower()
    if "429" in text or "too many requests" in text:
        return "rate_limited"
    if "503" in text or "service unavailable" in text:
        return "service_unavailable"
    if "500" in text or "server error" in text or "502" in text or "504" in text:
        return "server_error"
    if "timeout" in text or "timed out" in text:
        return "timeout"
    return "unknown"


def summarize_source_statuses(statuses: list[dict[str, Any]]) -> dict[str, Any]:
    summary: dict[str, dict[str, Any]] = {}
    for item in statuses:
        source = str(item.get("source") or "unknown")
        bucket = summary.setdefault(
            source,
            {"source": source, "succeeded_count": 0, "failed_count": 0, "record_count": 0, "errors": []},
        )
        if item.get("status") == "succeeded":
            bucket["succeeded_count"] += 1
            bucket["record_count"] += int(item.get("count") or 0)
        else:
            bucket["failed_count"] += 1
            if item.get("errorType") and item.get("errorType") not in bucket["errors"]:
                bucket["errors"].append(item.get("errorType"))
    values = list(summary.values())
    return {
        "sources": values,
        "succeeded_count": sum(item["succeeded_count"] for item in values),
        "failed_count": sum(item["failed_count"] for item in values),
        "degraded": any(item["failed_count"] for item in values)
        and any(item["succeeded_count"] for item in values),
        "failure_reason": "部分数据源临时不可用，已使用可用来源继续完成任务"
        if any(item["failed_count"] for item in values)
        else "",
    }


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
    execution_events: list[dict[str, Any]] = [
        execution_event(
            "prepare",
            "done",
            f"读取任务参数：方向「{query}」，目标 {count} 篇，年份 {year_from or '不限'}，评分≥{min_score:g}。",
        ),
        execution_event(
            "plan",
            "done",
            f"生成 {len(query_plan)} 个检索式：{', '.join(item['query'] for item in query_plan[:4])}。",
        ),
    ]
    semaphores = {"openalex": asyncio.Semaphore(2), "crossref": asyncio.Semaphore(1)}

    async def fetch_job(source: str, planned: dict[str, str]) -> list[dict[str, Any]]:
        execution_events.append(
            execution_event(
                "source",
                "running",
                f"连接 {source}，查询关键词「{planned['query']}」。",
                source=source,
                query=planned["query"],
            )
        )
        try:
            async with semaphores[source]:
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
            execution_events.append(
                execution_event(
                    "source",
                    "done",
                    f"{source} / 「{planned['query']}」返回 {len(items)} 条开放元数据。",
                    source=source,
                    query=planned["query"],
                    count=len(items),
                )
            )
            for index, paper in enumerate(items, start=1):
                paper["matchedQuery"] = planned["query"]
                paper["querySource"] = planned["source"]
                paper["providerRank"] = index
                paper["providerSource"] = source
                paper["rawScore"] = max(
                    score_paper(paper, query, year_from),
                    score_paper(paper, planned["query"], year_from),
                )
            return items
        except Exception as exc:
            error_text = str(exc)
            error_type = classify_source_error(error_text)
            source_statuses.append(
                {
                    "source": source,
                    "query": planned["query"],
                    "querySource": planned["source"],
                    "status": "failed",
                    "error": error_text,
                    "errorType": error_type,
                }
            )
            execution_events.append(
                execution_event(
                    "source",
                    "failed",
                    f"{source} / 「{planned['query']}」检索失败：{error_type}。",
                    source=source,
                    query=planned["query"],
                    error=error_text,
                    errorType=error_type,
                )
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
    execution_events.append(
        execution_event(
            "filter",
            "done",
            f"完成评分筛选：满足年份、评分和相关性条件的候选 {len(candidates)} 篇。",
            count=len(candidates),
        )
    )
    unique, duplicates = dedupe(repository.library["papers"], candidates)
    execution_events.append(
        execution_event(
            "dedupe",
            "done",
            f"完成跨源/本地去重：新文献 {len(unique)} 篇，重复 {len(duplicates)} 篇。",
            uniqueCount=len(unique),
            duplicateCount=len(duplicates),
        )
    )
    selected = sorted(unique, key=lambda item: item.get("rawScore") or 0, reverse=True)[:count]
    saved = []
    for paper in selected:
        execution_events.append(
            execution_event(
                "save",
                "running",
                f"保存文献：{paper.get('title') or paper.get('doi') or paper.get('id')}。",
                paperId=paper.get("id"),
                title=paper.get("title"),
            )
        )
        enriched = await save_paper_asset(paper, payload.get("downloadOpenPdf") is not False)
        saved.append(enriched)
        fulltext_status = enriched.get("fullTextStatus") or ("ready" if enriched.get("localFullTextPath") else "metadata_only")
        execution_events.append(
            execution_event(
                "save",
                "done",
                f"已入库：{enriched.get('title') or enriched.get('doi')}；全文状态：{fulltext_status}。",
                paperId=enriched.get("id"),
                title=enriched.get("title"),
                fullTextStatus=fulltext_status,
            )
        )
    if not saved:
        execution_events.append(
            execution_event("save", "skipped", "没有新的可入库文献，跳过保存、全文获取、AI 分析和任务邮件。")
        )
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
        "sourceSummary": summarize_source_statuses(source_statuses),
        "degraded": any(item.get("status") == "failed" for item in source_statuses)
        and any(item.get("status") == "succeeded" for item in source_statuses),
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
        "executionEvents": execution_events,
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


def format_confirmation_summary(summary: Any) -> str:
    if not summary:
        return ""
    if isinstance(summary, str):
        return summary
    if isinstance(summary, list):
        return "；".join(
            item for item in (format_confirmation_summary(part) for part in summary) if item
        )
    if isinstance(summary, dict):
        to_value = summary.get("to")
        to_text = ", ".join(str(item) for item in to_value) if isinstance(to_value, list) else str(to_value or "")
        parts = [
            f"动作：{summary['action']}" if summary.get("action") else "",
            f"From：{summary['from']}" if summary.get("from") else "",
            f"To：{to_text}" if to_text else "",
            f"主题：{summary['subject']}" if summary.get("subject") else "",
            f"附件：{summary['attachment_count']} 个"
            if summary.get("attachment_count") is not None
            else "",
        ]
        text = " · ".join(part for part in parts if part)
        return text or json.dumps(summary, ensure_ascii=False)
    return str(summary)


def extract_confirmation(output: str) -> tuple[str, str]:
    token = re.search(r"ctk_[A-Za-z0-9_\-]+", output or "")
    payload = parse_cli_json(output) or {}
    summary = (
        payload.get("summary")
        or payload.get("data", {}).get("summary")
        or payload.get("confirmation", {}).get("summary")
        or payload.get("data", {}).get("confirmation", {}).get("summary")
    )
    summary_text = format_confirmation_summary(summary)
    if summary_text:
        return (token.group(0) if token else "", summary_text)
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
    authorized = bool(result.code == 0 and email)
    effective_enabled = bool(enabled or authorized)
    return {
        "enabled": effective_enabled,
        "installed": True,
        "authorized": authorized,
        "email": email,
        "sendCapable": authorized,
        "provider": "agent_mail",
        "autoConfirm": bool(getattr(settings, "agent_mail_auto_confirm", False)),
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
    if kind == "task_digest":
        title = (task or {}).get("name") or (task or {}).get("query") or "采集任务"
        return f"[研知雷达] {str(title)[:58]} · {datetime.now().strftime('%Y-%m-%d %H:%M')}"
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
    candidates = [
        paper.get("localPdfPath"),
        paper.get("localFullTextPath"),
        paper.get("localMarkdownPath"),
        (report or {}).get("markdownPath"),
    ]
    for source in candidates:
        path = resolve_reader_file(str(source or ""))
        if not path:
            continue
        suffix = ".pdf" if path.suffix.lower() == ".md" else path.suffix or ".bin"
        target = repository.mail_dir / f"{delivery_id}-{slug(path.stem, 42)}{suffix}"
        try:
            if path.suffix.lower() == ".md":
                markdown_file_to_pdf(path, target, title=path.stem)
            elif path.resolve() != target.resolve():
                shutil.copyfile(path, target)
            attachments.append(str(target.relative_to(ROOT_DIR)).replace("\\", "/"))
        except OSError:
            continue
        if len(attachments) >= 3:
            break
    return attachments


def write_mail_body_files(delivery_id: str, subject: str, markdown: str) -> dict[str, str]:
    base = repository.mail_dir / f"{slug(subject)}-{delivery_id}"
    markdown_path = base.with_suffix(".md")
    text_path = base.with_suffix(".txt")
    pdf_path = base.with_suffix(".pdf")
    markdown_path.write_text(markdown, encoding="utf-8")
    text_path.write_text(markdown_to_plain_text(markdown), encoding="utf-8")
    markdown_to_pdf(markdown, pdf_path, title=subject)
    return {
        "markdownPath": str(markdown_path.relative_to(ROOT_DIR)).replace("\\", "/"),
        "bodyTextPath": str(text_path.relative_to(ROOT_DIR)).replace("\\", "/"),
        "bodyPdfPath": str(pdf_path.relative_to(ROOT_DIR)).replace("\\", "/"),
    }


def readable_datetime(value: str | None) -> str:
    if not value:
        return now_iso()
    return value.replace("T", " ").replace("+00:00", " UTC")


def source_summary_lines(run: dict[str, Any]) -> list[str]:
    statuses = run.get("sourceStatuses") or []
    if not statuses:
        return ["- 来源状态: 未记录"]
    lines = []
    for item in statuses:
        if item.get("status") == "succeeded":
            lines.append(f"- {item.get('source')} / {item.get('query')}: 成功，返回 {item.get('count') or 0} 条")
        else:
            lines.append(
                f"- {item.get('source')} / {item.get('query')}: 失败，{item.get('errorType') or 'unknown'}"
            )
    return lines


def task_digest_markdown(
    task: dict[str, Any],
    run: dict[str, Any],
    papers: list[dict[str, Any]],
    reports: list[dict[str, Any]],
) -> str:
    report_by_paper: dict[str, dict[str, Any]] = {}
    for report in reports:
        for paper_id in report.get("paperIds") or []:
            report_by_paper[str(paper_id)] = report
    lines = [
        f"# {(task or {}).get('name') or (task or {}).get('query') or '采集任务'}",
        "",
        "## 任务信息",
        "",
        "| 字段 | 内容 |",
        "| --- | --- |",
        f"| 任务名称 | {(task or {}).get('name') or '未命名任务'} |",
        f"| 执行时间 | {readable_datetime(run.get('createdAt'))} |",
        f"| 研究方向 | {(task or {}).get('query') or run.get('query') or ''} |",
        f"| 目标篇数 | {run.get('count') or (task or {}).get('count') or ''} |",
        f"| 起始年份 | {run.get('yearFrom') or (task or {}).get('yearFrom') or '不限'} |",
        f"| 最低评分 | {run.get('minScore') if run.get('minScore') is not None else (task or {}).get('minScore', '')} |",
        f"| 数据源 | {', '.join(run.get('sources') or (task or {}).get('sources') or [])} |",
        f"| 是否 AI 分析 | {'是' if (task or {}).get('autoAnalyze') else '否'} |",
        "",
        "## 执行结果",
        "",
        f"- 保存文献: {run.get('savedCount') or 0} 篇",
        f"- 候选文献: {run.get('candidateCount') or 0} 篇",
        f"- 去重后新文献: {run.get('uniqueCount') or 0} 篇",
        f"- 重复文献: {run.get('duplicateCount') or 0} 篇",
        f"- 是否降级: {'是' if run.get('degraded') else '否'}",
        f"- 是否达到目标: {'是' if run.get('targetMet') else '否'}",
        "",
        "## 来源状态",
        "",
        *source_summary_lines(run),
        "",
        "## 文献列表",
        "",
    ]
    for index, paper in enumerate(papers, 1):
        report = report_by_paper.get(str(paper.get("id")))
        lines.extend(
            [
                f"### {index}. {paper.get('title') or 'Untitled'}",
                "",
                f"- DOI: {paper.get('doi') or '未提供'}",
                f"- 年份: {paper.get('year') or '未知'}",
                f"- 期刊: {paper.get('journal') or paper.get('source') or '未知'}",
                f"- 评分: {round(paper.get('rawScore') or 0)}",
                f"- 全文: {paper.get('localPdfPath') or paper.get('localFullTextPath') or paper.get('localMarkdownPath') or '未获取'}",
                f"- AI 分析: {report.get('markdownPath') if report else ('未开启或全文不足，未生成' if (task or {}).get('autoAnalyze') else '未开启')}",
                "",
            ]
        )
    lines.extend(
        [
            "## 任务 AI 分析总结",
            "",
            "本轮先按任务汇总执行结果和附件。后续可在此处接入跨文献任务级总结：研究趋势、共同方法、差异点、研究空白和下一步建议。",
            "",
            "## 附件说明",
            "",
            "- `fulltexts-*.zip`: 文献 PDF；若没有 PDF，则把系统保存的全文 Markdown 转为 PDF 后放入。",
            "- `analysis-reports-*.zip`: 开启 AI 分析且成功生成报告时，包含单篇 AI 报告 PDF。",
            "- `task-summary-*.pdf`: 任务摘要、执行结果、附件清单和文献对应关系。",
            "",
        ]
    )
    return "\n".join(lines)


def zip_files(zip_path: Path, files: list[tuple[str, Path]]) -> str | None:
    existing = [(name, path) for name, path in files if path.exists() and path.is_file()]
    if not existing:
        return None
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        used: set[str] = set()
        for index, (name, path) in enumerate(existing, 1):
            arcname = name
            if arcname in used:
                arcname = f"{index}-{arcname}"
            used.add(arcname)
            archive.write(path, arcname=arcname)
    return str(zip_path.relative_to(ROOT_DIR)).replace("\\", "/")


def pdf_asset_for_markdown(source: Path, target_name: str, title: str = "") -> Path | None:
    target = repository.mail_dir / f"{slug(target_name, 72)}.pdf"
    try:
        markdown_file_to_pdf(source, target, title=title or source.stem)
        return target
    except Exception:
        return None


def build_task_digest_attachments(
    delivery_id: str,
    run: dict[str, Any],
    papers: list[dict[str, Any]],
    reports: list[dict[str, Any]],
    summary_pdf_path: Path | None = None,
) -> list[str]:
    attachments: list[str] = []
    fulltext_files: list[tuple[str, Path]] = []
    for index, paper in enumerate(papers, 1):
        relative = paper.get("localPdfPath") or paper.get("localFullTextPath") or paper.get("localMarkdownPath")
        path = resolve_reader_file(str(relative or ""))
        if path:
            title_slug = slug(paper.get("title"), 48)
            if path.suffix.lower() == ".md":
                pdf_path = pdf_asset_for_markdown(path, f"{index:02d}-{title_slug}-fulltext", title=paper.get("title") or "")
                if pdf_path:
                    fulltext_files.append((f"{index:02d}-{title_slug}.pdf", pdf_path))
            else:
                suffix = path.suffix or ".bin"
                fulltext_files.append((f"{index:02d}-{title_slug}{suffix}", path))
    fulltexts_zip = zip_files(repository.mail_dir / f"fulltexts-{run.get('id') or delivery_id}.zip", fulltext_files)
    if fulltexts_zip:
        attachments.append(fulltexts_zip)
    report_files: list[tuple[str, Path]] = []
    for index, report in enumerate(reports, 1):
        path = resolve_reader_file(str(report.get("markdownPath") or ""))
        if path:
            pdf_path = pdf_asset_for_markdown(path, f"{index:02d}-{slug(report.get('title'), 48)}-analysis", title=report.get("title") or "")
            if pdf_path:
                report_files.append((f"{index:02d}-{slug(report.get('title'), 48)}.pdf", pdf_path))
    reports_zip = zip_files(repository.mail_dir / f"analysis-reports-{run.get('id') or delivery_id}.zip", report_files)
    if reports_zip:
        attachments.append(reports_zip)
    manifest_path = repository.mail_dir / f"manifest-{run.get('id') or delivery_id}.md"
    manifest_lines = [
        f"# 任务附件清单 {run.get('id') or delivery_id}",
        "",
        "## 文献",
        "",
    ]
    for index, paper in enumerate(papers, 1):
        manifest_lines.append(
            f"{index}. {paper.get('title') or 'Untitled'} | DOI: {paper.get('doi') or '未提供'} | 文件: {paper.get('localPdfPath') or paper.get('localFullTextPath') or paper.get('localMarkdownPath') or '无'}"
        )
    manifest_lines.extend(["", "## AI 报告", ""])
    for index, report in enumerate(reports, 1):
        manifest_lines.append(f"{index}. {report.get('title') or report.get('id')} | {report.get('markdownPath') or '无'}")
    manifest_path.write_text("\n".join(manifest_lines), encoding="utf-8")
    summary_or_manifest_pdf = summary_pdf_path
    if not summary_or_manifest_pdf:
        summary_or_manifest_pdf = pdf_asset_for_markdown(
            manifest_path,
            f"manifest-{run.get('id') or delivery_id}",
            title=f"任务附件清单 {run.get('id') or delivery_id}",
        )
    if summary_or_manifest_pdf:
        attachments.append(str(summary_or_manifest_pdf.relative_to(ROOT_DIR)).replace("\\", "/"))
    return attachments[:3]


def task_digest_plain_text(
    task: dict[str, Any],
    run: dict[str, Any],
    papers: list[dict[str, Any]],
    reports: list[dict[str, Any]],
    attachments: list[str],
) -> str:
    source_statuses = run.get("sourceStatuses") or []
    source_summaries = []
    for item in source_statuses[:8]:
        if item.get("status") == "succeeded":
            source_summaries.append(f"{item.get('source')} / {item.get('query')}：成功，返回 {item.get('count') or 0} 条")
        else:
            source_summaries.append(f"{item.get('source')} / {item.get('query')}：失败，{item.get('errorType') or 'unknown'}")
    paper_lines = []
    for index, paper in enumerate(papers[:20], 1):
        paper_lines.append(
            f"{index}. {paper.get('title') or 'Untitled'} | {paper.get('year') or '未知'} | "
            f"{paper.get('journal') or paper.get('source') or '未知'} | DOI: {paper.get('doi') or '未提供'}"
        )
    return "\n".join(
        [
            "研知雷达任务执行完成",
            "",
            f"任务名称：{task.get('name') or task.get('query') or '采集任务'}",
            f"执行时间：{readable_datetime(run.get('createdAt'))}",
            f"研究方向：{task.get('query') or run.get('query') or ''}",
            f"执行参数：目标 {run.get('count') or task.get('count') or ''} 篇；"
            f"起始年份 {run.get('yearFrom') or task.get('yearFrom') or '不限'}；"
            f"最低评分 {run.get('minScore') if run.get('minScore') is not None else task.get('minScore', '')}",
            "",
            "执行结果：",
            f"保存 {run.get('savedCount') or 0} 篇；候选 {run.get('candidateCount') or 0} 篇；"
            f"重复 {run.get('duplicateCount') or 0} 篇；"
            f"AI 报告 {len(reports)} 份；{'存在来源降级' if run.get('degraded') else '数据源正常'}。",
            "",
            "来源状态：",
            *(source_summaries or ["未记录来源状态"]),
            "",
            "文献列表：",
            *(paper_lines or ["本次没有新入库文献。"]),
            "",
            "附件：",
            *(attachments or ["本次没有可发送附件。"]),
            "",
            "说明：邮件正文使用纯文本以保证移动端可读；完整任务摘要、表格、全文与 AI 报告请查看 PDF/ZIP 附件。",
        ]
    )


def add_mail_delivery(kind: str, paper: dict[str, Any], task: dict[str, Any] | None = None, report: dict[str, Any] | None = None, recipients: list[str] | None = None) -> dict[str, Any]:
    id_ = f"mail_{uuid4()}"
    subject = delivery_subject(kind, paper, task)
    body = delivery_body_markdown(kind, paper, task, report)
    body_files = write_mail_body_files(id_, subject, body)
    attachments = unique_strings([*delivery_attachments(id_, paper, report), body_files["bodyPdfPath"]])[:3]
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
        "markdownPath": body_files["markdownPath"],
        "bodyTextPath": body_files["bodyTextPath"],
        "bodyPdfPath": body_files["bodyPdfPath"],
        "bodyFile": body_files["bodyTextPath"],
        "attachments": attachments,
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


def add_task_digest_delivery(
    task: dict[str, Any],
    run: dict[str, Any],
    papers: list[dict[str, Any]],
    reports: list[dict[str, Any]],
) -> dict[str, Any]:
    id_ = f"mail_{uuid4()}"
    task_title = task.get("name") or task.get("query") or "采集任务"
    run_time = readable_datetime(run.get("createdAt"))[:16]
    subject = f"[研知雷达] {str(task_title)[:58]} · {run_time}"
    body = task_digest_markdown(task, run, papers, reports)
    body_files = write_mail_body_files(id_, subject, body)
    summary_pdf = resolve_reader_file(body_files["bodyPdfPath"])
    attachments = build_task_digest_attachments(id_, run, papers, reports, summary_pdf)
    body_text_path = resolve_reader_file(body_files["bodyTextPath"])
    if body_text_path:
        body_text_path.write_text(
            task_digest_plain_text(task, run, papers, reports, attachments),
            encoding="utf-8",
        )
    delivery = {
        "id": id_,
        "kind": "task_digest",
        "taskId": task.get("id"),
        "runId": run.get("id"),
        "paperId": None,
        "paperIds": [paper.get("id") for paper in papers],
        "reportId": None,
        "reportIds": [report.get("id") for report in reports],
        "recipient": "",
        "recipients": recipients_for_task(task),
        "cc": mail_copy_for_task(task, "ccEmails"),
        "bcc": mail_copy_for_task(task, "bccEmails"),
        "subject": subject,
        "markdownPath": body_files["markdownPath"],
        "summaryMarkdownPath": body_files["markdownPath"],
        "bodyTextPath": body_files["bodyTextPath"],
        "bodyPdfPath": body_files["bodyPdfPath"],
        "bodyFile": body_files["bodyTextPath"],
        "attachments": attachments,
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


def attempt_mail_delivery(
    delivery_id: str,
    confirmation_token: str = "",
    auto_confirm_attempted: bool = False,
    regenerate_attempted: bool = False,
) -> dict[str, Any]:
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
    body_path = resolve_reader_file(
        str(delivery.get("bodyTextPath") or delivery.get("bodyFile") or delivery.get("markdownPath") or "")
    )
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
        if (
            getattr(get_settings(), "agent_mail_auto_confirm", False)
            and not confirmation_token
            and not auto_confirm_attempted
        ):
            repository.library["mailDeliveries"][index] = delivery
            repository._persist_item("mailDeliveries", delivery)
            return attempt_mail_delivery(delivery_id, token, auto_confirm_attempted=True)
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
            if not regenerate_attempted:
                return attempt_mail_delivery(
                    delivery_id,
                    auto_confirm_attempted=True,
                    regenerate_attempted=True,
                )
            delivery.update(status="failed", error="MAIL_CONFIRMATION_TOKEN_INVALID")
            repository.library["mailDeliveries"][index] = delivery
            repository._persist_item("mailDeliveries", delivery)
            return delivery
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
    normalize_all_tasks_mail_push()
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
    normalize_task_mail_push(task)
    repository.tasks = [task, *repository.tasks]
    repository._persist_item("tasks", task)
    return {"task": task, "tasks": repository.tasks}


@router.put("/tasks/{task_id}")
def update_task(task_id: str, payload: TaskPayload) -> dict[str, Any]:
    for index, task in enumerate(repository.tasks):
        if task["id"] == task_id:
            updated = {**task, **payload.model_dump(), "updatedAt": now_iso()}
            normalize_task_mail_push(updated)
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
    normalize_task_mail_push(task)
    task["lastRunStatus"] = "running"
    task["lastRunStartedAt"] = now_iso()
    repository._persist_item("tasks", task)
    try:
        result = await perform_scan({**task, **(payload or {})}, task_id=task_id)
        task["lastRunStatus"] = "succeeded"
        task["lastRunFinishedAt"] = now_iso()
        task["lastRunSavedCount"] = result["run"]["savedCount"]
        task["lastRunId"] = result["run"]["id"]
        if task.get("notifyAfterRun") and (result["run"].get("savedCount") or 0) > 0:
            digest_papers: list[dict[str, Any]] = []
            digest_reports: list[dict[str, Any]] = []
            if task.get("autoAnalyze"):
                for paper in result["papers"]:
                    paper_with_fulltext = paper
                    if not paper_with_fulltext.get("localFullTextPath"):
                        result["run"].setdefault("executionEvents", []).append(
                            execution_event(
                                "fulltext",
                                "running",
                                f"尝试获取 DOI/来源全文：{paper.get('title') or paper.get('doi')}。",
                                paperId=paper.get("id"),
                                title=paper.get("title"),
                            )
                        )
                        paper_with_fulltext = (await fetch_fulltext_for_paper(dict(paper)))["paper"]
                        fulltext_status = paper_with_fulltext.get("fullTextStatus") or (
                            "ready" if paper_with_fulltext.get("localFullTextPath") else "unavailable"
                        )
                        result["run"].setdefault("executionEvents", []).append(
                            execution_event(
                                "fulltext",
                                "done" if paper_with_fulltext.get("localFullTextPath") else "failed",
                                f"{'获取全文成功' if paper_with_fulltext.get('localFullTextPath') else '未获取到可分析全文'}：{paper_with_fulltext.get('title') or paper_with_fulltext.get('doi')}。",
                                paperId=paper_with_fulltext.get("id"),
                                title=paper_with_fulltext.get("title"),
                                fullTextStatus=fulltext_status,
                            )
                        )
                    digest_papers.append(paper_with_fulltext)
                    if paper_with_fulltext.get("localFullTextPath"):
                        result["run"].setdefault("executionEvents", []).append(
                            execution_event(
                                "analysis",
                                "running",
                                f"开始 AI 分析：{paper_with_fulltext.get('title') or paper_with_fulltext.get('doi')}。",
                                paperId=paper_with_fulltext.get("id"),
                                title=paper_with_fulltext.get("title"),
                            )
                        )
                        report = await create_report([paper_with_fulltext], task.get("query") or "")
                        digest_reports.append(report)
                        result["run"].setdefault("executionEvents", []).append(
                            execution_event(
                                "analysis",
                                "done",
                                f"AI 分析已完成：{paper_with_fulltext.get('title') or paper_with_fulltext.get('doi')}。",
                                paperId=paper_with_fulltext.get("id"),
                                title=paper_with_fulltext.get("title"),
                                reportId=report.get("id"),
                            )
                        )
                    else:
                        result["run"].setdefault("executionEvents", []).append(
                            execution_event(
                                "analysis",
                                "skipped",
                                f"缺少可读全文，跳过 AI 分析：{paper_with_fulltext.get('title') or paper_with_fulltext.get('doi')}。",
                                paperId=paper_with_fulltext.get("id"),
                                title=paper_with_fulltext.get("title"),
                            )
                        )
            else:
                digest_papers = list(result["papers"])
            if digest_papers:
                result["run"].setdefault("executionEvents", []).append(
                    execution_event(
                        "mail",
                        "running",
                        f"生成任务汇总邮件：To {', '.join(task.get('recipientEmails') or [])}。",
                    )
                )
                delivery = add_task_digest_delivery(task, result["run"], digest_papers, digest_reports)
                result["taskDigestDelivery"] = delivery
                result["run"].setdefault("executionEvents", []).append(
                    execution_event(
                        "mail",
                        "done" if delivery.get("status") == "sent" else "warning",
                        f"任务汇总邮件已生成：{delivery.get('status')}。",
                        deliveryId=delivery.get("id"),
                        deliveryStatus=delivery.get("status"),
                    )
                )
            else:
                result["taskDigestDelivery"] = None
        elif task.get("notifyAfterRun"):
            result["taskDigestDelivery"] = None
            result["run"].setdefault("executionEvents", []).append(
                execution_event("mail", "skipped", "本次没有新入库文献，未生成任务汇总邮件。")
            )
        repository._persist_item("tasks", task)
        repository._persist_item("scanRuns", result["run"])
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
    missing = [paper for paper in papers if not paper.get("localFullTextPath")]
    if missing:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "FULLTEXT_REQUIRED",
                "message": "请先获取或上传完整论文原文，再生成 AI 分析报告。",
                "paperIds": [paper.get("id") for paper in missing],
            },
        )
    fallback_query = repository.library["scanRuns"][0].get("query", "") if repository.library["scanRuns"] else ""
    report = await create_report(papers, payload.query or fallback_query, payload.title)
    return {"report": report, "library": repository.serialize_library()}


@router.post("/papers/{paper_id}:analyze")
async def analyze_paper(paper_id: str, payload: AnalyzePayload | None = None) -> dict[str, Any]:
    body = payload or AnalyzePayload(paperIds=[paper_id], limit=1)
    return await analyze(
        AnalyzePayload(
            paperIds=[paper_id],
            query=body.query,
            title=body.title,
            limit=1,
        )
    )


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
    paper = save_pdf_text_asset(paper, pdf_path, "upload")
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
    paper = save_pdf_text_asset(paper, pdf_path, "upload")
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
