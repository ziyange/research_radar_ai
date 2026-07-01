from __future__ import annotations

from pathlib import Path

from .repository import LiteratureRepository
from .repository import resolve_reader_file as resolve_reader_file_with_storage


repository = LiteratureRepository()


def resolve_reader_file(relative: str) -> Path | None:
    return resolve_reader_file_with_storage(relative, repository.storage_root)
