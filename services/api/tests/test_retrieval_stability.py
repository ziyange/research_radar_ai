import asyncio

from research_radar_api.main import run_retrieval_adapter
from research_radar_api.retrieval import NormalizedRecord
from research_radar_api.schemas import SearchTask
from research_radar_api.settings import Settings


class FailingAdapter:
    source = "openalex"

    async def search(self, query, filters, limit):  # noqa: ANN001
        raise TimeoutError("simulated timeout")


class SuccessfulAdapter:
    source = "crossref"

    async def search(self, query, filters, limit):  # noqa: ANN001
        return [
            NormalizedRecord(
                source=self.source,
                source_identifier="crossref-ok",
                title="Diamine crosslinking in hot pressed lignocellulosic panels",
                year=2024,
                raw_payload={"ok": True},
            )
        ]


def test_adapter_failure_records_source_and_uses_source_fallback():
    task = SearchTask(
        id="search_test_degrade",
        project_id="proj_test",
        profile_id="profile_test",
        task_type="exact",
        query_text="delignified bamboo periodate oxidation diamine",
    )
    result = asyncio.run(run_retrieval_adapter(FailingAdapter(), task, Settings()))

    assert result.source == "openalex"
    assert result.status == "degraded"
    assert result.error_code == "TimeoutError"
    assert result.fallback_reason
    assert {record.source for record in result.records} == {"openalex"}
    payload = result.status_payload()
    assert payload["source"] == "openalex"
    assert payload["record_count"] == 1


def test_adapter_success_is_not_affected_by_other_source_contract():
    task = SearchTask(
        id="search_test_success",
        project_id="proj_test",
        profile_id="profile_test",
        task_type="method_transfer",
        query_text="periodate oxidation hot pressing",
    )
    result = asyncio.run(run_retrieval_adapter(SuccessfulAdapter(), task, Settings()))

    assert result.source == "crossref"
    assert result.status == "succeeded"
    assert result.error_code is None
    assert len(result.records) == 1
