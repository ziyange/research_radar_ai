from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any
from uuid import uuid4

from research_radar_api.db import EntityPersistence
from research_radar_api.settings import get_settings


ROOT_DIR = Path(__file__).resolve().parents[5]


def running_under_pytest() -> bool:
    return bool(os.environ.get("PYTEST_CURRENT_TEST"))


def is_test_artifact(entity_type: str, payload: dict[str, Any]) -> bool:
    if running_under_pytest():
        return False
    item_id = str(payload.get("id") or payload.get("taskId") or "")
    query = str(payload.get("query") or "").strip().lower()
    title = str(payload.get("title") or "").strip().lower()
    if item_id.startswith(("paper_test_", "report_test_", "mail_test_")):
        return True
    if item_id in {
        "task_digest_push",
        "task_digest_empty_result",
        "task_legacy_missing_recipient",
        "scan_task_digest",
        "scan_empty_digest",
        "scan_legacy_missing_recipient",
    }:
        return True
    if entity_type == "literature_tasks":
        recipients = [str(item).lower() for item in payload.get("recipientEmails") or []]
        return (
            query == "nanomaterials plant"
            and "recipient@example.com" in recipients
            and int(payload.get("count") or 0) == 3
            and float(payload.get("minScore") or 0) == 50
        )
    if entity_type == "literature_papers" and (
        item_id.startswith("paper_test_")
        or title.startswith(("full text acceptance paper", "crossref fallback"))
    ):
        return True
    if entity_type == "literature_scan_runs":
        task_id = str(payload.get("taskId") or "")
        return task_id.startswith("task_digest_") or task_id == "task_legacy_missing_recipient"
    if entity_type == "literature_mail_deliveries":
        kind = payload.get("kind")
        task_id = str(payload.get("taskId") or "")
        return kind == "mail_test" or task_id.startswith("task_digest_") or task_id == "task_legacy_missing_recipient"
    return False


def resolve_reader_file(relative: str, storage_root: Path | None = None) -> Path | None:
    normalized = relative.replace("\\", "/").lstrip("/")
    candidates: list[Path] = []
    candidates.append((ROOT_DIR / normalized).resolve())
    if storage_root is not None:
        candidates.append((storage_root / normalized).resolve())
    for candidate in candidates:
        try:
            candidate.relative_to(ROOT_DIR)
        except ValueError:
            continue
        if candidate.exists() and candidate.is_file():
            return candidate
    return None


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
        self.entities_dir = self.storage_root / "entities"
        for path in [self.papers_dir, self.downloads_dir, self.reports_dir, self.mail_dir, self.entities_dir]:
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
        if not rows and not self.persistence.enabled:
            rows = self._load_file_entities()
        loaded = False
        for key, entity_type in self.entity_types.items():
            payloads = rows.get(entity_type) or []
            payloads = [item for item in payloads if not is_test_artifact(entity_type, item)]
            payloads = sorted(
                payloads,
                key=lambda item: str(item.get("updatedAt") or item.get("createdAt") or ""),
                reverse=True,
            )
            if key == "tasks":
                self.tasks = payloads
            else:
                self.library[key] = payloads
            loaded = loaded or bool(payloads)
        if not loaded:
            self.library = {"papers": [], "scanRuns": [], "reports": [], "mailDeliveries": []}
            self.tasks = []

    def _persist_item(self, key: str, item: dict[str, Any]) -> None:
        entity_type = self.entity_types[key]
        item_id = str(item.get("id") or item.get("taskId") or uuid4())
        item["id"] = item_id
        self.persistence.save(entity_type, item_id, item)
        if self._should_persist_file_entities():
            self._persist_file_entity(entity_type, item_id, item)

    def _delete_item(self, key: str, item_id: str) -> None:
        self.persistence.delete(self.entity_types[key], item_id)
        if self._should_persist_file_entities():
            path = self.entities_dir / self.entity_types[key] / f"{item_id}.json"
            try:
                path.unlink(missing_ok=True)
            except OSError:
                # Windows may keep a recently written JSON file locked briefly.
                # The in-memory list has already been updated; a stale file is
                # harmless and can be overwritten or ignored by later updates.
                return

    def _load_file_entities(self) -> dict[str, list[dict[str, Any]]]:
        rows: dict[str, list[dict[str, Any]]] = {}
        for entity_type in self.entity_types.values():
            directory = self.entities_dir / entity_type
            if not directory.exists():
                continue
            for path in directory.glob("*.json"):
                try:
                    payload = json.loads(path.read_text(encoding="utf-8"))
                except (OSError, json.JSONDecodeError):
                    continue
                if isinstance(payload, dict):
                    rows.setdefault(entity_type, []).append(payload)
        return rows

    def _should_persist_file_entities(self) -> bool:
        if self.persistence.enabled:
            return False
        if not running_under_pytest():
            return True
        try:
            self.storage_root.relative_to(ROOT_DIR / "tmp")
            return True
        except ValueError:
            return False

    def _persist_file_entity(self, entity_type: str, item_id: str, item: dict[str, Any]) -> None:
        directory = self.entities_dir / entity_type
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / f"{item_id}.json"
        path.write_text(json.dumps(item, ensure_ascii=False, indent=2), encoding="utf-8")

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
        if not item.get("fullTextStatus"):
            item["fullTextStatus"] = "ready" if item.get("localFullTextPath") else "metadata_only"
        if not item.get("fullTextSource"):
            item["fullTextSource"] = "html" if item.get("localFullTextPath") else "none"
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
            file_path = resolve_reader_file(path, self.storage_root)
            if file_path and file_path.exists() and not item.get("markdown"):
                item["markdown"] = file_path.read_text(encoding="utf-8", errors="ignore")
        return item

    def serialize_delivery(self, delivery: dict[str, Any]) -> dict[str, Any]:
        item = dict(delivery)
        if item.get("markdownPath"):
            item["markdownUrl"] = self.file_url(item["markdownPath"])
        return item

    def serialize_library(self) -> dict[str, Any]:
        papers = [
            item
            for item in self.library["papers"]
            if not is_test_artifact("literature_papers", item)
        ]
        scan_runs = [
            item
            for item in self.library["scanRuns"]
            if not is_test_artifact("literature_scan_runs", item)
        ]
        reports = [
            item
            for item in self.library["reports"]
            if not is_test_artifact("literature_reports", item)
        ]
        mail_deliveries = [
            item
            for item in self.library["mailDeliveries"]
            if not is_test_artifact("literature_mail_deliveries", item)
        ]
        return {
            "papers": [self.serialize_paper(item) for item in papers],
            "scanRuns": scan_runs,
            "reports": [self.serialize_report(item) for item in reports],
            "mailDeliveries": [
                self.serialize_delivery(item) for item in mail_deliveries
            ],
        }
