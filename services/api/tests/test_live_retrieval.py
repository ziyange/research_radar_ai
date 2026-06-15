import asyncio
import os

import pytest

from research_radar_api.retrieval import CrossrefAdapter, OpenAlexAdapter


def test_live_openalex_crossref_smoke_when_enabled():
    if os.environ.get("RUN_LIVE_RETRIEVAL_TESTS") != "1":
        pytest.skip("Set RUN_LIVE_RETRIEVAL_TESTS=1 to exercise live OpenAlex/Crossref APIs.")

    async def run_live():
        adapters = [
            OpenAlexAdapter(timeout=5.0, min_interval_seconds=0),
            CrossrefAdapter(timeout=5.0, min_interval_seconds=0),
        ]
        results = {}
        for adapter in adapters:
            try:
                records = await adapter.search(
                    "delignified bamboo sodium periodate oxidation diamine",
                    {"year_from": 2020},
                    2,
                )
            except Exception as exc:  # pragma: no cover - intentionally environment dependent
                pytest.skip(f"{adapter.source} live API unavailable: {exc}")
            results[adapter.source] = records
        return results

    results = asyncio.run(run_live())
    assert set(results) == {"openalex", "crossref"}
    assert all(isinstance(records, list) for records in results.values())
