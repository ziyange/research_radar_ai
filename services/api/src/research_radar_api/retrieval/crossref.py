from __future__ import annotations

import asyncio
from time import monotonic
from typing import Any

import httpx

from .base import NormalizedRecord


def _first(value: Any) -> Any:
    return value[0] if isinstance(value, list) and value else value


def _year(item: dict[str, Any]) -> int | None:
    parts = (item.get("published-print") or item.get("published-online") or item.get("created") or {}).get(
        "date-parts"
    )
    if parts and parts[0]:
        return parts[0][0]
    return None


class CrossrefAdapter:
    source = "crossref"

    def __init__(self, timeout: float = 12.0, min_interval_seconds: float = 0.2) -> None:
        self.timeout = timeout
        self.min_interval_seconds = min_interval_seconds
        self._last_request_at = 0.0

    async def search(self, query: str, filters: dict[str, Any], limit: int) -> list[NormalizedRecord]:
        await self._respect_rate_limit()
        params: dict[str, Any] = {
            "query.bibliographic": query,
            "rows": limit,
            "sort": "score",
            "order": "desc",
        }
        year_from = filters.get("year_from")
        if year_from:
            params["filter"] = f"from-pub-date:{year_from}-01-01"
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await self._request_with_retry(
                client,
                "https://api.crossref.org/works",
                params,
            )
            response.raise_for_status()
            payload = response.json()
        items = payload.get("message", {}).get("items", [])
        return [self._normalize(item) for item in items if _first(item.get("title"))]

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
        authors = []
        for author in item.get("author") or []:
            name = " ".join(
                part for part in [author.get("given"), author.get("family")] if part
            ).strip()
            if name:
                authors.append(name)
        doi = item.get("DOI")
        return NormalizedRecord(
            source=self.source,
            source_identifier=str(doi or item.get("URL")),
            title=str(_first(item.get("title"))),
            authors=authors,
            year=_year(item),
            journal=str(_first(item.get("container-title")) or ""),
            doi=doi.lower() if isinstance(doi, str) else None,
            abstract=item.get("abstract"),
            keywords=item.get("subject") or [],
            url=item.get("URL"),
            license=_first(item.get("license") or [{}]).get("URL")
            if item.get("license")
            else None,
            open_access=bool(item.get("license")),
            citation_count=int(item.get("is-referenced-by-count") or 0),
            raw_payload=item,
            quality_score=0.86 if doi else 0.7,
        )
