from __future__ import annotations

import asyncio
import hashlib
import html
import json
import re
from typing import Any
from uuid import uuid4

import httpx

from research_radar_api.settings import get_settings

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
    # Open metadata providers may return English records for Chinese queries.
    # When no English expansion is available, keep provider-ranked records and
    # let score/year/dedupe filters decide instead of requiring impossible CJK
    # term matches inside English titles or abstracts.
    has_cjk_query = bool(re.search(r"[\u4e00-\u9fff]", query))
    has_latin_term = any(re.search(r"[a-zA-Z]", term) for term in terms)
    if has_cjk_query and not has_latin_term:
        return bool(paper.get("title") and (paper.get("abstract") or paper.get("doi")))
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
    translated = re.sub(r"[，、；;]+", " ", query)
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
            response = await get_with_retry(
                client,
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
            response = await get_with_retry(
                client,
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


async def get_with_retry(
    client: httpx.AsyncClient,
    url: str,
    params: dict[str, Any],
    headers: dict[str, str],
) -> httpx.Response:
    last_response: httpx.Response | None = None
    for attempt in range(3):
        response = await client.get(url, params=params, headers=headers)
        last_response = response
        if response.status_code not in {429, 500, 502, 503, 504}:
            response.raise_for_status()
            return response
        if attempt < 2:
            retry_after = response.headers.get("retry-after")
            try:
                delay = min(8.0, float(retry_after or 0))
            except ValueError:
                delay = 0
            if not delay:
                delay = 0.8 * (attempt + 1)
            await asyncio.sleep(delay)
    assert last_response is not None
    last_response.raise_for_status()
    return last_response


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



