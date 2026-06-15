from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol


@dataclass(slots=True)
class NormalizedRecord:
    source: str
    source_identifier: str
    title: str
    authors: list[str] = field(default_factory=list)
    year: int | None = None
    journal: str | None = None
    doi: str | None = None
    abstract: str | None = None
    keywords: list[str] = field(default_factory=list)
    url: str | None = None
    fulltext_url: str | None = None
    license: str | None = None
    open_access: bool = False
    citation_count: int = 0
    raw_payload: dict[str, Any] = field(default_factory=dict)
    quality_score: float = 0.75

    def payload(self) -> dict[str, Any]:
        return {
            "source": self.source,
            "source_identifier": self.source_identifier,
            "title": self.title,
            "authors": self.authors,
            "year": self.year,
            "journal": self.journal,
            "doi": self.doi,
            "abstract": self.abstract,
            "keywords": self.keywords,
            "url": self.url,
            "fulltext_url": self.fulltext_url,
            "license": self.license,
            "open_access": self.open_access,
            "citation_count": self.citation_count,
        }


@dataclass(slots=True)
class RetrievalRunResult:
    source: str
    status: str
    records: list[NormalizedRecord] = field(default_factory=list)
    elapsed_ms: int = 0
    error_code: str | None = None
    error_message: str | None = None
    fallback_reason: str | None = None

    def status_payload(self) -> dict[str, Any]:
        return {
            "source": self.source,
            "status": self.status,
            "record_count": len(self.records),
            "elapsed_ms": self.elapsed_ms,
            "error_code": self.error_code,
            "error_message": self.error_message,
            "fallback_reason": self.fallback_reason,
        }


class RetrievalAdapter(Protocol):
    source: str

    async def search(self, query: str, filters: dict[str, Any], limit: int) -> list[NormalizedRecord]:
        ...
