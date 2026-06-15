from __future__ import annotations

import asyncio
from time import monotonic
from typing import Any

import httpx

from .base import NormalizedRecord


def _inverted_index_to_text(index: dict[str, list[int]] | None) -> str | None:
    if not index:
        return None
    words: list[tuple[int, str]] = []
    for word, positions in index.items():
        words.extend((position, word) for position in positions)
    return " ".join(word for _, word in sorted(words)) or None


class OpenAlexAdapter:
    source = "openalex"

    def __init__(
        self,
        timeout: float = 12.0,
        email: str | None = None,
        min_interval_seconds: float = 0.2,
    ) -> None:
        self.timeout = timeout
        self.email = email
        self.min_interval_seconds = min_interval_seconds
        self._last_request_at = 0.0

    async def search(self, query: str, filters: dict[str, Any], limit: int) -> list[NormalizedRecord]:
        await self._respect_rate_limit()
        params: dict[str, Any] = {
            "search": query,
            "per-page": limit,
            "sort": "relevance_score:desc",
        }
        year_from = filters.get("year_from")
        if year_from:
            params["filter"] = f"from_publication_date:{year_from}-01-01"
        if self.email:
            params["mailto"] = self.email
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await self._request_with_retry(
                client,
                "https://api.openalex.org/works",
                params,
            )
            response.raise_for_status()
            payload = response.json()
        return [self._normalize(item) for item in payload.get("results", []) if item.get("title")]

    async def _respect_rate_limit(self) -> None:
        wait_for = self.min_interval_seconds - (monotonic() - self._last_request_at)
        if wait_for > 0:
            await asyncio.sleep(wait_for)
        self._last_request_at = monotonic()

    async def _request_with_retry(
        self,
        client: httpx.AsyncClient,
        url: str,
        params: dict[str, Any],
    ) -> httpx.Response:
        response = await client.get(url, params=params)
        if response.status_code == 429 or response.status_code >= 500:
            await asyncio.sleep(self.min_interval_seconds)
            response = await client.get(url, params=params)
        return response

    def _normalize(self, item: dict[str, Any]) -> NormalizedRecord:
        authorships = item.get("authorships") or []
        authors = [
            author.get("author", {}).get("display_name")
            for author in authorships
            if author.get("author", {}).get("display_name")
        ]
        best_oa = item.get("best_oa_location") or {}
        primary = item.get("primary_location") or {}
        source = primary.get("source") or {}
        doi = item.get("doi")
        if isinstance(doi, str):
            doi = doi.removeprefix("https://doi.org/").lower()
        return NormalizedRecord(
            source=self.source,
            source_identifier=str(item.get("id") or item.get("doi")),
            title=item["title"],
            authors=authors,
            year=item.get("publication_year"),
            journal=source.get("display_name"),
            doi=doi,
            abstract=_inverted_index_to_text(item.get("abstract_inverted_index")),
            keywords=[
                concept.get("display_name")
                for concept in item.get("concepts", [])[:8]
                if concept.get("display_name")
            ],
            url=item.get("id"),
            fulltext_url=best_oa.get("pdf_url") or best_oa.get("landing_page_url"),
            license=best_oa.get("license"),
            open_access=bool(item.get("open_access", {}).get("is_oa")),
            citation_count=int(item.get("cited_by_count") or 0),
            raw_payload=item,
            quality_score=0.9 if doi else 0.78,
        )
