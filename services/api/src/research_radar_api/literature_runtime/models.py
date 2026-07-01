from __future__ import annotations

import re
from dataclasses import dataclass

from pydantic import BaseModel, Field, field_validator


def unique_strings(values: list[object]) -> list[str]:
    seen: set[str] = set()
    output: list[str] = []
    for value in values:
        item = re.sub(r"\s+", " ", str(value or "")).strip()
        key = item.lower()
        if item and key not in seen:
            seen.add(key)
            output.append(item)
    return output


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
