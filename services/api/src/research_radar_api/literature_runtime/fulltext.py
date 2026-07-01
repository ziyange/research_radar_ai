from __future__ import annotations

import re
from datetime import datetime, timezone
from pathlib import Path
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
            f"- 正文状态: {paper.get('fullTextStatus') or 'metadata_only'}",
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
    enriched.setdefault("fullTextStatus", "metadata_only")
    enriched.setdefault("fullTextSource", "none")
    if download_open_pdf and enriched.get("openAccess"):
        enriched = (await fetch_fulltext_for_paper(enriched, update_repository=False))["paper"]
    markdown_path = repository.papers_dir / f"{slug(enriched.get('title'))}-{enriched['id']}.md"
    markdown_path.write_text(paper_markdown(enriched), encoding="utf-8")
    enriched["localMarkdownPath"] = str(markdown_path.relative_to(ROOT_DIR)).replace("\\", "/")
    enriched["savedAt"] = now_iso()
    return enriched


def extract_pdf_text(pdf_path: Path) -> str:
    try:
        from pypdf import PdfReader  # type: ignore[import-not-found]

        reader = PdfReader(str(pdf_path))
        pages = []
        for page in reader.pages[:80]:
            pages.append(page.extract_text() or "")
        text = "\n\n".join(page.strip() for page in pages if page.strip())
        if len(text.strip()) >= 800:
            return text
    except Exception:
        pass
    try:
        raw = pdf_path.read_bytes()
        decoded = raw.decode("utf-8", errors="ignore")
        decoded = re.sub(r"[^\S\r\n]+", " ", decoded)
        decoded = re.sub(r"\n{3,}", "\n\n", decoded)
        if len(decoded.strip()) >= 800:
            return decoded.strip()
    except Exception:
        return ""
    return ""


def save_pdf_text_asset(paper: dict[str, Any], pdf_path: Path, source: str = "pdf") -> dict[str, Any]:
    text = extract_pdf_text(pdf_path)
    if not text:
        paper["fullTextStatus"] = "extract_failed"
        paper["fullTextSource"] = source
        return paper
    title = paper.get("title") or "Full text"
    md = f"# {title}\n\n{text[:80000]}\n"
    full_path = repository.papers_dir / f"{slug(title)}-{paper['id']}-fulltext.md"
    full_path.write_text(md, encoding="utf-8")
    paper["localFullTextPath"] = str(full_path.relative_to(ROOT_DIR)).replace("\\", "/")
    paper["fullTextStatus"] = "ready"
    paper["fullTextSource"] = source
    return paper



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
                    paper = save_pdf_text_asset(paper, pdf_path, "pdf")
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
                    paper["fullTextStatus"] = "ready"
                    paper["fullTextSource"] = "html"
                    break
            except Exception as exc:
                attempts.append({"url": url, "status": "failed", "error": str(exc)})
    if not paper.get("localFullTextPath") and not paper.get("fullTextStatus"):
        paper["fullTextStatus"] = "metadata_only"
        paper["fullTextSource"] = "none"
    if not paper.get("localFullTextPath") and paper.get("fullTextStatus") not in {"extract_failed"}:
        paper["fullTextStatus"] = "unavailable" if attempts else "metadata_only"
        paper["fullTextSource"] = paper.get("fullTextSource") or "none"
    if update_repository:
        for index, item in enumerate(repository.library["papers"]):
            if item["id"] == paper["id"]:
                repository.library["papers"][index] = paper
                repository._persist_item("papers", paper)
                break
    return {
        "paper": repository.serialize_paper(paper),
        "method": "pdf"
        if paper.get("localPdfPath") and paper.get("localFullTextPath")
        else "pdf-extract-failed"
        if paper.get("localPdfPath")
        else "html-fulltext"
        if paper.get("localFullTextPath")
        else "",
        "retrieval": {
            "attempts": attempts,
            "fullTextStatus": paper.get("fullTextStatus") or "metadata_only",
            "nextAction": ""
            if paper.get("localFullTextPath")
            else "请打开 DOI/来源页面下载 PDF 后上传，或稍后重试自动获取。",
        },
    }



