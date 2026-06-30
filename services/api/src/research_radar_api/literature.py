from __future__ import annotations

import asyncio
import hashlib
import html
import json
import mimetypes
import os
import re
import shutil
import subprocess
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

import httpx
from fastapi import APIRouter, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, field_validator

from .db import EntityPersistence
from .settings import get_settings


router = APIRouter(prefix="/api/v1/literature", tags=["literature"])

ROOT_DIR = Path(__file__).resolve().parents[4]
IMPORTED_DATA_DIR = ROOT_DIR / "storage" / "literature" / "imported-local-data"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_doi(value: Any) -> str | None:
    doi = (
        str(value or "")
        .strip()
        .removeprefix("doi:")
        .replace("https://doi.org/", "")
        .replace("http://doi.org/", "")
        .replace("https://dx.doi.org/", "")
        .replace("http://dx.doi.org/", "")
        .strip()
    )
    return doi.lower() or None


def doi_url(value: Any) -> str:
    doi = normalize_doi(value)
    return f"https://doi.org/{doi}" if doi else ""


def slug(value: Any, limit: int = 90) -> str:
    text = re.sub(r"<[^>]*>", " ", str(value or "").lower())
    text = re.sub(r"[^\w\u4e00-\u9fff]+", "-", text, flags=re.UNICODE)
    return text.strip("-")[:limit] or f"item-{uuid4().hex[:8]}"


def compact_title(value: Any) -> str:
    text = re.sub(r"<[^>]*>", " ", str(value or "").lower())
    return re.sub(r"[^\w\u4e00-\u9fff]+", " ", text, flags=re.UNICODE).strip()


def stable_paper_id(paper: dict[str, Any]) -> str:
    key = normalize_doi(paper.get("doi")) or compact_title(paper.get("title"))
    digest = hashlib.sha1(key.encode("utf-8")).hexdigest()[:14]
    return f"paper_{digest}"


def unique_strings(values: list[Any]) -> list[str]:
    seen: set[str] = set()
    output: list[str] = []
    for value in values:
        item = re.sub(r"\s+", " ", str(value or "")).strip()
        key = item.lower()
        if item and key not in seen:
            seen.add(key)
            output.append(item)
    return output


def is_likely_pdf_url(value: Any) -> bool:
    url = str(value or "").lower()
    return bool(url) and "doi.org/" not in url and (
        ".pdf" in url or "/pdf" in url or "pdfdownload" in url or "pdfft" in url
    )


def abstract_from_openalex(index: dict[str, list[int]] | None) -> str:
    if not index:
        return ""
    words: list[tuple[int, str]] = []
    for word, positions in index.items():
        words.extend((position, word) for position in positions)
    return " ".join(word for _, word in sorted(words))


def strip_html(value: Any) -> str:
    text = re.sub(r"<[^>]+>", " ", str(value or ""))
    return html.unescape(re.sub(r"\s+", " ", text).strip())


def query_terms(query: str) -> list[str]:
    stopwords = {
        "and",
        "or",
        "not",
        "the",
        "with",
        "for",
        "from",
        "into",
        "under",
        "using",
        "use",
        "study",
        "studies",
        "research",
    }
    return [
        term
        for term in re.split(r"[,\s，、;；()\"'`]+", query.lower())
        if len(term) >= 2 and term not in stopwords
    ]


def score_paper(paper: dict[str, Any], query: str, year_from: int | None) -> float:
    terms = query_terms(query)
    text = " ".join(
        [
            str(paper.get("title") or ""),
            str(paper.get("abstract") or ""),
            " ".join(paper.get("keywords") or []),
        ]
    ).lower()
    hits = len([term for term in terms if term in text])
    coverage = hits / len(terms) if terms else 0
    year = int(paper.get("year") or 0)
    recency = max(0, min(20, year - year_from + 1)) if year and year_from else 0
    citations = min(30, (paper.get("citedByCount") or 0) ** 0.35)
    access = 12 if paper.get("openAccess") else 0
    abstract = 10 if paper.get("abstract") else 0
    doi = 5 if paper.get("doi") else 0
    phrase = 12 if query and query.lower() in text else 0
    return round((hits * 14 + coverage * 20 + phrase + recency + citations + access + abstract + doi) * 10) / 10


def relevant_enough(paper: dict[str, Any], query: str) -> bool:
    terms = query_terms(query)
    if not terms:
        return True
    text = " ".join(
        [
            str(paper.get("title") or ""),
            str(paper.get("abstract") or ""),
            " ".join(paper.get("keywords") or []),
        ]
    ).lower()
    hits = len([term for term in terms if term in text])
    return hits >= (1 if len(terms) == 1 else min(2, len(terms)))


def fallback_queries(query: str) -> list[dict[str, str]]:
    translated = query
    glossary = [
        (r"纳米材料|纳米颗粒|纳米粒子", "nanomaterials nanoparticles"),
        (r"植物|植株|作物", "plants crops"),
        (r"食品安全|食品污染", "food safety food contaminants"),
        (r"传感器|检测", "sensor detection"),
        (r"重金属", "heavy metals"),
        (r"土壤", "soil"),
        (r"抗旱|干旱", "drought stress"),
        (r"吸收|转运", "uptake translocation"),
        (r"毒性|生态毒性", "toxicity ecotoxicity"),
        (r"微生物|根系微生物", "rhizosphere microbiome"),
    ]
    for pattern, replacement in glossary:
        translated = re.sub(pattern, f" {replacement} ", translated)
    translated = re.sub(r"[，、；;]+", " ", translated)
    translated = re.sub(r"\s+", " ", translated).strip()
    queries = unique_strings(
        [
            query,
            translated,
            f"{translated} review",
            f"{translated} open access",
        ]
    )
    return [{"query": item, "source": "rules" if index else "user"} for index, item in enumerate(queries[:4])]


async def expand_queries(query: str) -> list[dict[str, str]]:
    settings = get_settings()
    if settings.ai_provider == "openai" and settings.ai_configured:
        prompt = (
            "请把用户的中文或混合语言科研方向转换成 OpenAlex/Crossref 可用英文检索式。"
            "只输出 JSON object，字段 queries 为 2-6 个英文检索式字符串数组。"
            "不要输出论文、DOI、作者或来源。"
            f"\n用户方向: {query}"
        )
        try:
            async with httpx.AsyncClient(timeout=settings.ai_request_timeout_seconds) as client:
                response = await client.post(
                    f"{settings.openai_base_url.rstrip('/')}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {settings.openai_api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": settings.openai_model,
                        "temperature": 0.1,
                        "messages": [
                            {"role": "system", "content": "你只输出可解析 JSON。"},
                            {"role": "user", "content": prompt},
                        ],
                    },
                )
                response.raise_for_status()
            content = response.json()["choices"][0]["message"]["content"]
            match = re.search(r"\{[\s\S]*\}", content)
            payload = json.loads(match.group(0) if match else content)
            queries = [str(item).strip() for item in payload.get("queries", []) if str(item).strip()]
            if queries:
                return [{"query": item, "source": "ai-expansion"} for item in unique_strings([query, *queries])[:6]]
        except Exception:
            return fallback_queries(query)
    return fallback_queries(query)


class TaskPayload(BaseModel):
    query: str
    count: int = Field(default=5, ge=1, le=20)
    yearFrom: int | None = None
    minScore: float = 0
    sources: list[str] = Field(default_factory=lambda: ["openalex", "crossref"])
    downloadOpenPdf: bool = True
    autoAnalyze: bool = False
    dailyEnabled: bool = False
    dailyTime: str = "09:00"
    dailyTimezone: str = "Asia/Shanghai"
    notifyAfterRun: bool = False
    recipientEmails: list[str] = Field(default_factory=list)
    ccEmails: list[str] = Field(default_factory=list)
    bccEmails: list[str] = Field(default_factory=list)

    @field_validator("recipientEmails", "ccEmails", "bccEmails")
    @classmethod
    def validate_email_list(cls, values: list[str]) -> list[str]:
        cleaned = unique_strings([str(item).strip() for item in values if str(item).strip()])
        invalid = [item for item in cleaned if not re.match(r"^[^\s@]+@[^\s@]+\.[^\s@]+$", item)]
        if invalid:
            raise ValueError(f"Invalid email address: {', '.join(invalid)}")
        return cleaned


class AnalyzePayload(BaseModel):
    paperIds: list[str] | None = None
    query: str | None = None
    title: str | None = None
    limit: int = 5


class MailTestPayload(BaseModel):
    to: list[str] = Field(default_factory=list)


@dataclass
class CliResult:
    code: int
    stdout: str
    stderr: str


class LiteratureRepository:
    entity_types = {
        "papers": "literature_papers",
        "scanRuns": "literature_scan_runs",
        "reports": "literature_reports",
        "mailDeliveries": "literature_mail_deliveries",
        "tasks": "literature_tasks",
    }

    def __init__(self) -> None:
        settings = get_settings()
        self.persistence = EntityPersistence(settings.database_url)
        self.storage_root = (ROOT_DIR / settings.literature_storage_root).resolve()
        self.papers_dir = self.storage_root / "papers"
        self.downloads_dir = self.storage_root / "downloads"
        self.reports_dir = self.storage_root / "reports"
        self.mail_dir = self.storage_root / "mail-outbox"
        for path in [self.papers_dir, self.downloads_dir, self.reports_dir, self.mail_dir]:
            path.mkdir(parents=True, exist_ok=True)
        self.library: dict[str, list[dict[str, Any]]] = {
            "papers": [],
            "scanRuns": [],
            "reports": [],
            "mailDeliveries": [],
        }
        self.tasks: list[dict[str, Any]] = []
        self._load()

    def _load(self) -> None:
        rows = self.persistence.load_all()
        loaded = False
        for key, entity_type in self.entity_types.items():
            payloads = rows.get(entity_type) or []
            if key == "tasks":
                self.tasks = payloads
            else:
                self.library[key] = payloads
            loaded = loaded or bool(payloads)
        if not loaded:
            self._import_demo_data()

    def _import_demo_data(self) -> None:
        library_path = IMPORTED_DATA_DIR / "library.json"
        task_path = IMPORTED_DATA_DIR / "tasks.json"
        if library_path.exists():
            payload = json.loads(library_path.read_text(encoding="utf-8"))
            for key in ["papers", "scanRuns", "reports", "mailDeliveries"]:
                self.library[key] = payload.get(key) or []
                for item in self.library[key]:
                    self._persist_item(key, item)
        if task_path.exists():
            payload = json.loads(task_path.read_text(encoding="utf-8"))
            self.tasks = payload.get("tasks") if isinstance(payload, dict) else payload
            for task in self.tasks:
                self._persist_item("tasks", task)

    def _persist_item(self, key: str, item: dict[str, Any]) -> None:
        entity_type = self.entity_types[key]
        item_id = str(item.get("id") or item.get("taskId") or uuid4())
        item["id"] = item_id
        self.persistence.save(entity_type, item_id, item)

    def _delete_item(self, key: str, item_id: str) -> None:
        self.persistence.delete(self.entity_types[key], item_id)

    def save_library(self) -> None:
        for key in ["papers", "scanRuns", "reports", "mailDeliveries"]:
            for item in self.library[key]:
                self._persist_item(key, item)

    def save_tasks(self) -> None:
        for task in self.tasks:
            self._persist_item("tasks", task)

    def file_url(self, relative: str | None) -> str:
        if not relative:
            return ""
        return f"/api/v1/literature/files/{relative.replace('\\', '/')}"

    def serialize_paper(self, paper: dict[str, Any]) -> dict[str, Any]:
        item = dict(paper)
        if item.get("localMarkdownPath"):
            item["localMarkdownUrl"] = self.file_url(item["localMarkdownPath"])
        if item.get("localFullTextPath"):
            item["localFullTextUrl"] = self.file_url(item["localFullTextPath"])
        if item.get("localPdfPath"):
            item["localPdfUrl"] = self.file_url(item["localPdfPath"])
        return item

    def serialize_report(self, report: dict[str, Any]) -> dict[str, Any]:
        item = dict(report)
        path = item.get("markdownPath")
        if path:
            item["markdownUrl"] = self.file_url(path)
            file_path = resolve_reader_file(path)
            if file_path and file_path.exists() and not item.get("markdown"):
                item["markdown"] = file_path.read_text(encoding="utf-8", errors="ignore")
        return item

    def serialize_delivery(self, delivery: dict[str, Any]) -> dict[str, Any]:
        item = dict(delivery)
        if item.get("markdownPath"):
            item["markdownUrl"] = self.file_url(item["markdownPath"])
        return item

    def serialize_library(self) -> dict[str, Any]:
        return {
            "papers": [self.serialize_paper(item) for item in self.library["papers"]],
            "scanRuns": self.library["scanRuns"],
            "reports": [self.serialize_report(item) for item in self.library["reports"]],
            "mailDeliveries": [
                self.serialize_delivery(item) for item in self.library["mailDeliveries"]
            ],
        }


repository = LiteratureRepository()


def resolve_reader_file(relative: str) -> Path | None:
    normalized = relative.replace("\\", "/").lstrip("/")
    candidates: list[Path] = []
    if normalized.startswith("local-data/"):
        candidates.append((IMPORTED_DATA_DIR / normalized.removeprefix("local-data/")).resolve())
    candidates.append((ROOT_DIR / normalized).resolve())
    candidates.append((repository.storage_root / normalized).resolve())
    for candidate in candidates:
        try:
            candidate.relative_to(ROOT_DIR)
        except ValueError:
            continue
        if candidate.exists() and candidate.is_file():
            return candidate
    return None


def normalize_openalex(work: dict[str, Any]) -> dict[str, Any]:
    primary = work.get("primary_location") or {}
    best = work.get("best_oa_location") or {}
    source = primary.get("source") or {}
    open_access = work.get("open_access") or {}
    locations = (work.get("locations") or [])[:10]
    doi = normalize_doi(work.get("doi"))
    pdf_candidates = unique_strings(
        [
            primary.get("pdf_url"),
            best.get("pdf_url"),
            *[item.get("pdf_url") for item in locations if isinstance(item, dict)],
        ]
    )
    pdf_candidates = [item for item in pdf_candidates if is_likely_pdf_url(item)]
    landing_candidates = unique_strings(
        [
            primary.get("landing_page_url"),
            best.get("landing_page_url"),
            open_access.get("oa_url"),
            doi_url(doi),
            work.get("id"),
            *[item.get("landing_page_url") for item in locations if isinstance(item, dict)],
        ]
    )
    paper = {
        "id": "",
        "title": work.get("display_name") or work.get("title") or "",
        "doi": doi,
        "year": work.get("publication_year"),
        "journal": source.get("display_name") or "OpenAlex",
        "authors": [
            item.get("author", {}).get("display_name")
            for item in work.get("authorships") or []
            if item.get("author", {}).get("display_name")
        ][:10],
        "abstract": abstract_from_openalex(work.get("abstract_inverted_index")),
        "keywords": [
            item.get("display_name")
            for item in (work.get("concepts") or [])[:10]
            if item.get("display_name")
        ],
        "source": "OpenAlex",
        "sourceUrl": work.get("id"),
        "landingPageUrl": landing_candidates[0] if landing_candidates else doi_url(doi),
        "pdfUrl": pdf_candidates[0] if pdf_candidates else None,
        "pdfCandidates": pdf_candidates,
        "landingCandidates": landing_candidates,
        "openAccess": bool(open_access.get("is_oa") or pdf_candidates),
        "citedByCount": int(work.get("cited_by_count") or 0),
        "rawScore": 0,
    }
    paper["id"] = stable_paper_id(paper)
    return paper


def normalize_crossref(item: dict[str, Any]) -> dict[str, Any]:
    links = item.get("link") if isinstance(item.get("link"), list) else []
    pdf_candidates = unique_strings(
        [
            link.get("URL")
            for link in links
            if "pdf" in str(link.get("content-type") or "").lower()
            or is_likely_pdf_url(link.get("URL"))
        ]
    )
    doi = normalize_doi(item.get("DOI"))
    parts = (
        item.get("issued")
        or item.get("published-print")
        or item.get("published-online")
        or {}
    ).get("date-parts")
    title = (item.get("title") or [""])[0] if isinstance(item.get("title"), list) else item.get("title")
    journal = (
        (item.get("container-title") or [""])[0]
        if isinstance(item.get("container-title"), list)
        else item.get("container-title")
    )
    paper = {
        "id": "",
        "title": title or "",
        "doi": doi,
        "year": parts[0][0] if parts and parts[0] else None,
        "journal": journal or "Crossref",
        "authors": [
            " ".join(part for part in [author.get("given"), author.get("family")] if part)
            for author in item.get("author") or []
        ][:10],
        "abstract": strip_html(item.get("abstract") or ""),
        "keywords": item.get("subject") or [],
        "source": "Crossref",
        "sourceUrl": item.get("URL") or doi_url(doi),
        "landingPageUrl": item.get("URL") or doi_url(doi),
        "pdfUrl": pdf_candidates[0] if pdf_candidates else None,
        "pdfCandidates": pdf_candidates,
        "landingCandidates": unique_strings([item.get("URL"), doi_url(doi)]),
        "openAccess": bool(pdf_candidates or item.get("license")),
        "citedByCount": int(item.get("is-referenced-by-count") or 0),
        "rawScore": 0,
    }
    paper["id"] = stable_paper_id(paper)
    return paper


async def fetch_openalex(query: str, year_from: int | None, limit: int) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    cursor = "*"
    per_page = min(200, max(50, limit))
    async with httpx.AsyncClient(timeout=get_settings().agent_source_timeout_seconds) as client:
        for _ in range(4):
            if len(items) >= limit or not cursor:
                break
            params: dict[str, Any] = {
                "search": query,
                "per-page": per_page,
                "cursor": cursor,
                "sort": "relevance_score:desc",
            }
            if year_from:
                params["filter"] = f"from_publication_date:{year_from}-01-01"
            if get_settings().openalex_email:
                params["mailto"] = get_settings().openalex_email
            response = await client.get(
                "https://api.openalex.org/works",
                params=params,
                headers={"User-Agent": "ResearchRadarAI-LiteratureReader/0.1"},
            )
            response.raise_for_status()
            payload = response.json()
            items.extend(normalize_openalex(item) for item in payload.get("results", []) if item.get("display_name"))
            cursor = payload.get("meta", {}).get("next_cursor") or ""
    return items[:limit]


async def fetch_crossref(query: str, year_from: int | None, limit: int) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    rows = min(100, max(50, limit))
    async with httpx.AsyncClient(timeout=get_settings().agent_source_timeout_seconds) as client:
        for offset in range(0, 400, rows):
            if len(items) >= limit:
                break
            params: dict[str, Any] = {
                "query": query,
                "rows": rows,
                "offset": offset,
                "sort": "relevance",
                "order": "desc",
            }
            if year_from:
                params["filter"] = f"from-pub-date:{year_from}-01-01"
            response = await client.get(
                "https://api.crossref.org/works",
                params=params,
                headers={"User-Agent": "ResearchRadarAI-LiteratureReader/0.1 (mailto:dev@example.com)"},
            )
            response.raise_for_status()
            page_items = response.json().get("message", {}).get("items", [])
            items.extend(normalize_crossref(item) for item in page_items if item.get("title"))
            if len(page_items) < rows:
                break
    return items[:limit]


def dedupe(existing: list[dict[str, Any]], candidates: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    seen: set[str] = set()
    for paper in existing:
        if paper.get("doi"):
            seen.add(f"doi:{normalize_doi(paper.get('doi'))}")
        if paper.get("title"):
            seen.add(f"title:{compact_title(paper.get('title'))}")
    unique: list[dict[str, Any]] = []
    duplicates: list[dict[str, Any]] = []
    for paper in candidates:
        keys = [
            f"doi:{normalize_doi(paper.get('doi'))}" if paper.get("doi") else "",
            f"title:{compact_title(paper.get('title'))}",
        ]
        if any(key and key in seen for key in keys):
            duplicates.append({"title": paper.get("title"), "doi": paper.get("doi"), "source": paper.get("source")})
            continue
        for key in keys:
            if key:
                seen.add(key)
        unique.append(paper)
    return unique, duplicates


def paper_markdown(paper: dict[str, Any]) -> str:
    link = paper.get("landingPageUrl") or paper.get("sourceUrl") or doi_url(paper.get("doi"))
    authors = "\n".join(f"- {author}" for author in paper.get("authors") or []) or "- 未提供"
    keywords = "\n".join(f"- {keyword}" for keyword in paper.get("keywords") or []) or "- 未提供"
    return "\n".join(
        [
            f"# {paper.get('title') or 'Untitled'}",
            "",
            f"- DOI: {paper.get('doi') or '未提供'}",
            f"- 年份: {paper.get('year') or '未知'}",
            f"- 期刊: {paper.get('journal') or '未知'}",
            f"- 来源: {paper.get('source') or '未知'}",
            f"- 开放获取: {'是' if paper.get('openAccess') else '否'}",
            f"- DOI/来源链接: {link or '无'}",
            f"- 本地 PDF: {paper.get('localPdfPath') or '未下载'}",
            "",
            "## Authors",
            "",
            authors,
            "",
            "## Keywords",
            "",
            keywords,
            "",
            "## Abstract",
            "",
            paper.get("abstract") or "未获取到摘要。",
            "",
            "## Local Notes",
            "",
            "该 Markdown 由本地采集器生成，供 AI 从本地文献资产进行分析。",
            "",
        ]
    )


async def save_paper_asset(paper: dict[str, Any], download_open_pdf: bool) -> dict[str, Any]:
    enriched = dict(paper)
    if download_open_pdf and enriched.get("openAccess"):
        enriched = (await fetch_fulltext_for_paper(enriched, update_repository=False))["paper"]
    markdown_path = repository.papers_dir / f"{slug(enriched.get('title'))}-{enriched['id']}.md"
    markdown_path.write_text(paper_markdown(enriched), encoding="utf-8")
    enriched["localMarkdownPath"] = str(markdown_path.relative_to(ROOT_DIR)).replace("\\", "/")
    enriched["savedAt"] = now_iso()
    return enriched


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


async def call_ai_markdown(papers: list[dict[str, Any]], query: str) -> str:
    settings = get_settings()
    if settings.ai_provider == "openai" and settings.ai_configured:
        sections = []
        for index, paper in enumerate(papers, 1):
            prompt = "\n\n".join(
                [
                    "你是严谨的科研文献分析助手。请输出 Markdown，不要输出 JSON。",
                    "必须只包含这些二级标题且不要重复：中文标题翻译、摘要完整翻译、文献信息总表、研究主题、核心逻辑流程图、方法与实验设计、关键结果与证据、局限与不可追溯点、可借鉴的点、与当前研究方向的关系、精读问题、后续检索建议。",
                    "文献信息总表必须用 Markdown 表格。核心逻辑流程图必须用 fenced mermaid flowchart。",
                    "如果只有摘要/元数据，所有结论必须标注：摘要可追溯、元数据可追溯、需回到原文核验、AI 推测。",
                    f"检索上下文: {query}",
                    f"论文序号: {index}",
                    f"本地论文 JSON: {json.dumps(paper, ensure_ascii=False)}",
                ]
            )
            async with httpx.AsyncClient(timeout=settings.ai_request_timeout_seconds) as client:
                response = await client.post(
                    f"{settings.openai_base_url.rstrip('/')}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {settings.openai_api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": settings.openai_model,
                        "temperature": 0.2,
                        "max_tokens": 5200,
                        "enable_thinking": False,
                        "messages": [
                            {"role": "system", "content": "你只输出 Markdown 小节正文，不输出解释。"},
                            {"role": "user", "content": prompt},
                        ],
                    },
                )
                response.raise_for_status()
            sections.append(response.json()["choices"][0]["message"]["content"])
        model = settings.openai_model
    else:
        model = "mock-literature-analysis"
        sections = [mock_markdown_section(paper, query, index) for index, paper in enumerate(papers, 1)]
    if len(papers) == 1:
        title = f"# {papers[0].get('title')} AI 阅读报告"
    else:
        title = f"# {query or '本地文献'} AI 阅读报告"
    return "\n".join(
        [
            title,
            "",
            f"- 生成时间: {now_iso()}",
            f"- 模型: {model}",
            "- 数据来源: 本地已保存论文资产",
            "",
            *sections,
        ]
    )


def mock_markdown_section(paper: dict[str, Any], query: str, index: int) -> str:
    title = paper.get("title") or "Untitled"
    abstract = paper.get("abstract") or "摘要缺失，需回到来源页面核验。"
    authors = ", ".join(paper.get("authors") or []) or "未提供"
    return f"""## 中文标题翻译
{title}

## 摘要完整翻译
{abstract}

## 文献信息总表
| 字段 | 内容 |
| --- | --- |
| 标题 | {title} |
| 作者 | {authors} |
| 年份 | {paper.get("year") or "未知"} |
| 期刊 | {paper.get("journal") or paper.get("source") or "未知"} |
| 研究背景 | 基于元数据和摘要识别，需回到原文核验。 |
| 研究目的 | 与“{query}”相关性筛选。 |
| 研究方法 | 摘要级输入不足以完整恢复实验方法。 |
| 研究结论 | {abstract[:120]} |
| 证据范围 | 摘要可追溯 / 元数据可追溯。 |

## 研究主题
第 {index} 篇文献围绕 {title} 展开，适合做候选精读。

## 核心逻辑流程图
```mermaid
flowchart TD
  A[背景/问题: 元数据与摘要提示研究问题] --> B[目的: 判断与当前方向的关系]
  B --> C[方法: 回到原文核验实验设计]
  C --> D[结果: 摘要级结果需核验]
  D --> E[结论: 可作为候选阅读]
  E --> F[可借鉴点: 提炼变量、指标和方法迁移]
```

## 方法与实验设计
- 摘要可追溯：{abstract[:180]}
- 需回到原文核验：样本、参数、图表、统计显著性。

## 关键结果与证据
- 摘要可追溯：{abstract[:180]}

## 局限与不可追溯点
- 当前没有完整正文时，不能声称已经阅读图表或补充材料。

## 可借鉴的点
- 研究问题拆解
- 关键词与检索式扩展
- 方法路线或评价指标参考

## 与当前研究方向的关系
- 当前方向：{query}
- 关系判断：需要结合全文进一步确认。

## 精读问题
- 是否有可下载 PDF？
- 方法、对照组和关键变量是否完整？
- 是否有可迁移到当前课题的指标？

## 后续检索建议
- 以 DOI 和关键词进行二次检索。
"""


async def create_report(papers: list[dict[str, Any]], query: str, title: str | None = None) -> dict[str, Any]:
    markdown = await call_ai_markdown(papers, query)
    report = {
        "id": f"report_{uuid4()}",
        "title": title or f"{query or '本地文献'} AI 阅读报告",
        "paperIds": [paper["id"] for paper in papers],
        "model": get_settings().openai_model if get_settings().ai_provider == "openai" else "mock-literature-analysis",
        "createdAt": now_iso(),
        "markdownPath": "",
        "markdown": markdown,
    }
    report_path = repository.reports_dir / f"{slug(report['title'])}-{report['id']}.md"
    report_path.write_text(markdown, encoding="utf-8")
    report["markdownPath"] = str(report_path.relative_to(ROOT_DIR)).replace("\\", "/")
    repository.library["reports"] = [report, *repository.library["reports"]][:300]
    repository.save_library()
    return repository.serialize_report(report)


def html_to_markdown_document(source: str, title: str) -> str:
    text = source
    text = re.sub(r"<script[\s\S]*?</script>", "", text, flags=re.I)
    text = re.sub(r"<style[\s\S]*?</style>", "", text, flags=re.I)
    text = re.sub(r"<(h1|h2|h3|h4)[^>]*>([\s\S]*?)</\1>", lambda m: f"\n\n{'#' * int(m.group(1)[1])} {strip_html(m.group(2))}\n\n", text, flags=re.I)
    text = re.sub(r"<p[^>]*>([\s\S]*?)</p>", lambda m: f"\n\n{strip_html(m.group(1))}\n\n", text, flags=re.I)
    text = re.sub(r"<li[^>]*>([\s\S]*?)</li>", lambda m: f"\n- {strip_html(m.group(1))}", text, flags=re.I)
    cleaned = strip_html(text)
    lines = [line.strip() for line in cleaned.splitlines() if line.strip()]
    body = "\n\n".join(lines)
    return f"# {title}\n\n{body[:50000]}\n"


async def fetch_fulltext_for_paper(paper: dict[str, Any], update_repository: bool = True) -> dict[str, Any]:
    attempts: list[dict[str, Any]] = []
    candidates = unique_strings(
        [
            paper.get("pdfUrl"),
            *(paper.get("pdfCandidates") or []),
            doi_url(paper.get("doi")),
            paper.get("landingPageUrl"),
            paper.get("sourceUrl"),
            *(paper.get("landingCandidates") or []),
        ]
    )
    async with httpx.AsyncClient(timeout=24.0, follow_redirects=True) as client:
        for url in candidates:
            if not url:
                continue
            try:
                response = await client.get(
                    url,
                    headers={
                        "User-Agent": "ResearchRadarAI-LiteratureReader/0.1",
                        "Accept": "application/pdf,text/html,application/xhtml+xml",
                    },
                )
                content_type = response.headers.get("content-type", "").lower()
                attempts.append({"url": url, "status": response.status_code, "contentType": content_type})
                if response.status_code >= 400:
                    continue
                if "pdf" in content_type or response.content[:4] == b"%PDF":
                    pdf_path = repository.downloads_dir / f"{paper['id']}.pdf"
                    pdf_path.write_bytes(response.content)
                    paper["localPdfPath"] = str(pdf_path.relative_to(ROOT_DIR)).replace("\\", "/")
                    paper["pdfUrl"] = url
                    break
                html_text = response.text
                pdf_match = re.search(r'href=["\']([^"\']+\.pdf[^"\']*)["\']', html_text, re.I)
                if pdf_match:
                    pdf_url = httpx.URL(url).join(pdf_match.group(1)).human_repr()
                    if pdf_url not in candidates:
                        candidates.append(pdf_url)
                article_text = strip_html(html_text)
                if len(article_text) > 5000:
                    md = html_to_markdown_document(html_text, paper.get("title") or "Full text")
                    full_path = repository.papers_dir / f"{slug(paper.get('title'))}-{paper['id']}-fulltext.md"
                    full_path.write_text(md, encoding="utf-8")
                    paper["localFullTextPath"] = str(full_path.relative_to(ROOT_DIR)).replace("\\", "/")
                    break
            except Exception as exc:
                attempts.append({"url": url, "status": "failed", "error": str(exc)})
    if update_repository:
        for index, item in enumerate(repository.library["papers"]):
            if item["id"] == paper["id"]:
                repository.library["papers"][index] = paper
                repository._persist_item("papers", paper)
                break
    return {
        "paper": repository.serialize_paper(paper),
        "method": "pdf" if paper.get("localPdfPath") else "html-fulltext" if paper.get("localFullTextPath") else "",
        "retrieval": {"attempts": attempts},
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
    enabled = get_settings().agent_mail_enabled or get_settings().email_provider == "agent_mail"
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
        "cli": cli,
        "message": "ok" if result.code == 0 else (result.stderr or result.stdout or "Agent Mail 未授权"),
    }


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
            error="AGENT_MAIL_CONFIRMATION_REQUIRED",
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
