from __future__ import annotations

import re
import unicodedata
from difflib import SequenceMatcher

from .retrieval import NormalizedRecord
from .schemas import Paper


def normalize_doi(doi: str | None) -> str | None:
    if not doi:
        return None
    return doi.strip().lower().removeprefix("https://doi.org/").removeprefix("doi:")


def normalize_title(title: str) -> str:
    text = unicodedata.normalize("NFKD", title).lower()
    text = re.sub(r"[^a-z0-9\u4e00-\u9fff]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def author_year_key(authors: list[str], year: int | None) -> tuple[str, int | None]:
    first = normalize_title(authors[0]) if authors else ""
    return first, year


def match_existing(record: NormalizedRecord, papers: list[Paper]) -> Paper | None:
    doi = normalize_doi(record.doi)
    if doi:
        for paper in papers:
            if normalize_doi(paper.doi) == doi:
                return paper

    title = normalize_title(record.title)
    for paper in papers:
        if normalize_title(paper.title) == title:
            return paper

    record_author, record_year = author_year_key(record.authors, record.year)
    for paper in papers:
        paper_author, paper_year = author_year_key(paper.authors, paper.year)
        title_similarity = SequenceMatcher(
            None, title, normalize_title(paper.title)
        ).ratio()
        if record_year == paper_year and record_author == paper_author and title_similarity >= 0.88:
            return paper
    return None
