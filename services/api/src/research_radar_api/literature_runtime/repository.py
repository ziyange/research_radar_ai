from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from uuid import uuid4

from research_radar_api.db import EntityPersistence
from research_radar_api.settings import get_settings


ROOT_DIR = Path(__file__).resolve().parents[5]
IMPORTED_DATA_DIR = ROOT_DIR / "storage" / "literature" / "imported-local-data"


def resolve_reader_file(relative: str, storage_root: Path | None = None) -> Path | None:
    normalized = relative.replace("\\", "/").lstrip("/")
    candidates: list[Path] = []
    if normalized.startswith("local-data/"):
        candidates.append((IMPORTED_DATA_DIR / normalized.removeprefix("local-data/")).resolve())
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
        return {
            "papers": [self.serialize_paper(item) for item in self.library["papers"]],
            "scanRuns": self.library["scanRuns"],
            "reports": [self.serialize_report(item) for item in self.library["reports"]],
            "mailDeliveries": [
                self.serialize_delivery(item) for item in self.library["mailDeliveries"]
            ],
        }
