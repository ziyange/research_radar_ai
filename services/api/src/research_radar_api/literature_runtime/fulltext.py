from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

import httpx

from .repository import ROOT_DIR
from .retrieval import doi_url, slug, strip_html, unique_strings
from .state import repository


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


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



