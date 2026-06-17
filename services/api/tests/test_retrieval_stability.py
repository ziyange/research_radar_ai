import asyncio

from research_radar_api.main import run_retrieval_adapter
from research_radar_api.retrieval import NormalizedRecord
from research_radar_api.schemas import ResearchProfile, ResearchProject, SearchTask
from research_radar_api.settings import Settings
from research_radar_api.store import InMemoryStore
from research_radar_api import store as store_module


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


def test_live_adapter_failure_records_source_without_fallback_data():
    task = SearchTask(
        id="search_test_degrade",
        project_id="proj_test",
        profile_id="profile_test",
        task_type="exact",
        query_text="delignified bamboo periodate oxidation diamine",
    )
    result = asyncio.run(run_retrieval_adapter(FailingAdapter(), task, Settings()))

    assert result.source == "openalex"
    assert result.status == "failed"
    assert result.error_code == "TimeoutError"
    assert result.fallback_reason is None
    assert result.records == []
    payload = result.status_payload()
    assert payload["source"] == "openalex"
    assert payload["record_count"] == 0


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


def test_live_recommendations_do_not_use_seed_fallback(monkeypatch):
    monkeypatch.setattr(
        store_module,
        "get_settings",
        lambda: Settings(
            database_url="sqlite+memory://unit",
            retrieval_provider="live",
            demo_seed_enabled=True,
        ),
    )
    local_store = InMemoryStore(database_url="sqlite+memory://unit", seed_on_empty=True)
    project = ResearchProject(
        id="proj_live_no_records",
        owner_id="usr_demo",
        name="真实检索无结果项目",
    )
    profile = ResearchProfile(
        id="profile_live_no_records",
        project_id=project.id,
        version=1,
        status="confirmed",
        source_type="manual",
        research_object=["target material"],
        methods=["target method"],
        materials=["target material"],
        metrics=["target metric"],
        keywords_en=["target material target method"],
    )
    project.current_profile_id = profile.id
    local_store.projects[project.id] = project
    local_store.profiles[profile.id] = profile

    assert local_store.project_papers(project.id) == []
    assert local_store.create_recommendations(project.id, profile.id, force_refresh=True) == []
