import os
from time import monotonic

import pytest
from fastapi.testclient import TestClient

os.environ["AI_PROVIDER"] = "mock"
os.environ["RETRIEVAL_PROVIDER"] = "mock"
os.environ["DEMO_SEED_ENABLED"] = "true"
os.environ["DEV_USER_ID"] = "usr_demo"

from research_radar_api.main import app
from research_radar_api.retrieval.base import NormalizedRecord
from research_radar_api.settings import get_settings


client = TestClient(app)


def unwrap(response):
    assert response.status_code < 400, response.text
    payload = response.json()
    assert "request_id" in payload
    return payload["data"]


def prepare_project():
    project = unwrap(
        client.post(
            "/api/v1/projects",
            json={"name": "RR-DEV-011 Agent Scan 验收", "discipline": "材料科学"},
        )
    )
    unwrap(
        client.post(
            f"/api/v1/projects/{project['id']}/profile:generate",
            json={
                "one_sentence": "我研究脱木质素竹材高碘酸钠氧化和二胺改性后的热压性能。"
            },
        )
    )
    unwrap(client.post(f"/api/v1/projects/{project['id']}/profile:confirm"))
    return project


def authorized_cnki_record():
    return {
        "source": "cnki",
        "source_identifier": "cnki-export-001",
        "title": "高碘酸钠氧化竹材二胺改性热压性能研究",
        "title_zh": "高碘酸钠氧化竹材二胺改性热压性能研究",
        "authors": ["张三"],
        "published_at": "2025-01-10",
        "year": 2025,
        "venue": "材料导报",
        "doi": "10.0000/rr.cnki.2025.001",
        "abstract": "研究脱木质素竹材、高碘酸钠氧化、二胺改性和热压性能。",
        "keywords": ["脱木质素竹材", "高碘酸钠氧化", "二胺改性", "热压"],
        "content_type": "paper",
        "license_note": "user_authorized_export",
    }


def duplicate_cnki_record():
    record = authorized_cnki_record()
    record["source_identifier"] = "cnki-export-duplicate-001"
    record["title"] = "Periodate oxidation and diamine crosslinking of delignified bamboo materials"
    record["title_zh"] = "脱木质素竹材的高碘酸盐氧化与二胺交联研究"
    record["doi"] = "10.0000/rr.bamboo.2024.001"
    return record


def open_metadata_records(source: str):
    return [
        NormalizedRecord(
            source=source,
            source_identifier=f"{source}-nano-plant-{index}",
            title=f"Nanomaterials regulate plant stress response study {index}",
            authors=["Open Metadata Author"],
            year=2020 + index,
            journal="Open Metadata Journal",
            doi=f"10.1234/nano.plant.202{index}.00{index}",
            abstract="Nanomaterials and plant systems are studied for stress response and growth.",
            keywords=["nanomaterials", "plant", "stress response"],
            url=f"https://open.example/{source}/papers/{index}",
            fulltext_url=f"https://open.example/{source}/papers/{index}.pdf",
            open_access=True,
            citation_count=20 * index,
            quality_score=0.9,
        )
        for index in range(2, 7)
    ]


def test_agent_scan_openalex_crossref_analyzes_five_records_and_builds_system_report(
    monkeypatch,
):
    project = prepare_project()
    seen_queries: list[tuple[str, str, dict, int]] = []

    async def fake_openalex_search(self, query, filters, limit):
        seen_queries.append(("openalex", query, filters, limit))
        return open_metadata_records("openalex")

    async def fake_crossref_search(self, query, filters, limit):
        seen_queries.append(("crossref", query, filters, limit))
        return open_metadata_records("crossref")

    monkeypatch.setattr(
        "research_radar_api.agent_scan.OpenAlexAdapter.search",
        fake_openalex_search,
    )
    monkeypatch.setattr(
        "research_radar_api.agent_scan.CrossrefAdapter.search",
        fake_crossref_search,
    )

    result = unwrap(
        client.post(
            "/api/v1/agent/research-scan:run",
            json={
                "research_direction": "nanomaterials plant stress response",
                "project_id": project["id"],
                "sources": ["openalex", "crossref"],
                "source_modes": {"openalex": "live_api", "crossref": "live_api"},
                "published_after": "2021-06-23",
                "min_score": 8,
                "limit": 5,
                "analyze_top_n": 5,
                "analysis_type": "quick",
                "input_scope": "abstract",
            },
        )
    )

    assert result["status"] == "completed"
    assert {item["source"] for item in result["source_statuses"]} == {"openalex", "crossref"}
    assert {item["code"] for item in result["source_statuses"]} == {"OPEN_METADATA_API_LOADED"}
    assert result["query_plan"]["queries"]
    assert result["query_plan"]["translated_direction_en"] == "nanomaterials plant stress response"
    assert result["source_count"] == 20
    assert result["filtered_count"] == 5
    assert len(result["candidates"]) == 5
    assert {item["doi"] for item in result["candidates"]} == {
        f"10.1234/nano.plant.202{index}.00{index}" for index in range(2, 7)
    }
    assert len(result["analyses"]) == 5
    assert all(item["claims"] for item in result["analyses"])
    assert all(item["evidence_labels_valid"] for item in result["analyses"])
    first_analysis = result["analyses"][0]
    assert first_analysis["paper"]["doi"]
    assert first_analysis["paper"]["url"]
    assert "legal_access_note" in first_analysis["paper"]
    assert first_analysis["result"]["paper_metadata"]["paper_id"] == first_analysis["paper_id"]
    assert first_analysis["result"]["fulltext_availability"]["legal_access_note"]
    assert first_analysis["result"]["abstract_translation_zh"]
    assert first_analysis["result"]["paper_deep_analysis"]
    assert first_analysis["result"]["researcher_interest_points"]
    assert first_analysis["result"]["literature_matching_directions"]
    assert first_analysis["result"]["methodology"]
    assert first_analysis["result"]["deep_reading_checklist"]
    assert result["report"]["model"] == "deterministic-agent-scan-report"
    assert len(result["report"]["recommended_reading_order"]) == 5
    assert any(step["step"] == "query_expansion" for step in result["trace"])
    assert any(step["step"] == "dedupe_within_scan" for step in result["trace"])
    assert any(step["step"] == "report_index" for step in result["trace"])
    assert ("openalex", "nanomaterials plant stress response", {"year_from": 2021}, 10) in seen_queries
    assert ("crossref", "nanomaterials plant stress response", {"year_from": 2021}, 10) in seen_queries

    costs = unwrap(client.get("/api/v1/me/costs"))
    assert any(item["feature"] == "agent.research_scan.quick" for item in costs)
    assert any(item["feature"] == "agent.research_scan.report_index" for item in costs)


def test_agent_scan_ai_analysis_runs_with_bounded_concurrency(monkeypatch):
    project = prepare_project()

    async def fake_openalex_search(self, query, filters, limit):
        return open_metadata_records("openalex")

    async def slow_analysis(self, paper, profile, analysis_type, input_scope):
        import asyncio

        await asyncio.sleep(0.05)
        return self._mock_analysis(paper, profile, analysis_type, input_scope)

    monkeypatch.setattr(
        "research_radar_api.agent_scan.OpenAlexAdapter.search",
        fake_openalex_search,
    )
    monkeypatch.setattr(
        "research_radar_api.agent_scan.AiProvider.analyze_paper",
        slow_analysis,
    )
    monkeypatch.setenv("AGENT_AI_ANALYSIS_CONCURRENCY", "3")
    get_settings.cache_clear()

    started = monotonic()
    result = unwrap(
        client.post(
            "/api/v1/agent/research-scan:run",
            json={
                "research_direction": "nanomaterials plant stress response",
                "project_id": project["id"],
                "sources": ["openalex"],
                "source_modes": {"openalex": "live_api"},
                "min_score": 0,
                "limit": 5,
                "analyze_top_n": 5,
                "analysis_type": "quick",
                "input_scope": "abstract",
            },
        )
    )
    elapsed = monotonic() - started

    assert len(result["analyses"]) == 5
    assert elapsed < 0.22
    assert any("最大并发 3" in step["summary"] for step in result["trace"])
    get_settings.cache_clear()


def test_agent_scan_authorized_export_dedupes_against_knowledge():
    project = prepare_project()
    unwrap(
        client.post(
            f"/api/v1/projects/{project['id']}/knowledge",
            json={
                "paper_id": "paper_bamboo_oxidation",
                "status": "read_later",
                "tags": ["去重基准"],
                "note": "用于验证 Agent Scan 不重复推荐知识库已有论文。",
            },
        )
    )

    result = unwrap(
        client.post(
            "/api/v1/agent/research-scan:run",
            json={
                "research_direction": "脱木质素竹材 高碘酸钠氧化 二胺改性 热压性能",
                "project_id": project["id"],
                "sources": ["cnki"],
                "source_modes": {"cnki": "authorized_export"},
                "published_after": "2023-01-01",
                "min_score": 2,
                "limit": 5,
                "analyze_top_n": 3,
                "analysis_type": "quick",
                "input_scope": "abstract",
                "external_records": [authorized_cnki_record(), duplicate_cnki_record()],
            },
        )
    )

    assert result["status"] == "completed"
    assert result["source_count"] == 2
    assert result["duplicate_count"] >= 1
    assert any(item["duplicate_status"] == "duplicate_knowledge" for item in result["candidates"])
    assert result["analyses"]
    assert any(step["step"] == "dedupe_against_knowledge" for step in result["trace"])
    assert any("不暴露模型隐藏思维链" in note for note in result["compliance_notes"])


def test_agent_scan_hitl_stops_before_analysis():
    project = prepare_project()
    result = unwrap(
        client.post(
            "/api/v1/agent/research-scan:run",
            json={
                "research_direction": "我研究脱木质素竹材高碘酸钠氧化和二胺改性后的热压性能。",
                "project_id": project["id"],
                "sources": ["cnki"],
                "source_modes": {"cnki": "authorized_export"},
                "hitl_mode": "review_before_analysis",
                "analyze_top_n": 3,
                "external_records": [authorized_cnki_record()],
            },
        )
    )

    assert result["status"] == "requires_review"
    assert result["hitl"]["required"] is True
    assert result["analyses"] == []
    assert any(step["step"] == "hitl_gate" for step in result["trace"])


def test_agent_scan_blocks_cnki_without_authorized_records():
    project = prepare_project()
    result = unwrap(
        client.post(
            "/api/v1/agent/research-scan:run",
            json={
                "research_direction": "我研究脱木质素竹材高碘酸钠氧化和二胺改性后的热压性能。",
                "project_id": project["id"],
                "sources": ["cnki"],
                "source_modes": {"cnki": "public_metadata"},
                "analyze_top_n": 0,
            },
        )
    )

    assert result["status"] == "completed"
    assert result["candidates"] == []
    assert result["analyses"] == []
    assert any("CNKI 不支持未授权 public_metadata 抓取" in note for note in result["compliance_notes"])


def test_agent_scan_openai_query_expansion_drives_open_metadata_search(monkeypatch):
    project = prepare_project()
    seen_queries: list[str] = []

    async def fake_chat_completion(self, messages, temperature):
        return """
        {
          "translated_direction_en": "nanomaterials in plant growth",
          "queries": [
            "nanomaterials plant growth",
            "nanoparticles plant stress response"
          ],
          "keywords_zh": ["纳米材料", "植物"],
          "keywords_en": ["nanomaterials", "plant"],
          "synonyms_en": ["nanoparticles"],
          "exclusions": ["animal study"],
          "confidence": 0.86
        }
        """

    async def fake_openalex_search(self, query, filters, limit):
        seen_queries.append(query)
        return open_metadata_records("openalex")[:1]

    monkeypatch.setenv("AI_PROVIDER", "openai")
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setenv("OPENAI_BASE_URL", "https://example.test/v1")
    monkeypatch.setenv("OPENAI_MODEL", "qwen3.6-plus")
    get_settings.cache_clear()
    monkeypatch.setattr(
        "research_radar_api.ai.AiProvider._chat_completion",
        fake_chat_completion,
    )
    monkeypatch.setattr(
        "research_radar_api.agent_scan.OpenAlexAdapter.search",
        fake_openalex_search,
    )

    result = unwrap(
        client.post(
            "/api/v1/agent/research-scan:run",
            json={
                "research_direction": "纳米材料 植物 生长",
                "project_id": project["id"],
                "sources": ["openalex"],
                "source_modes": {"openalex": "live_api"},
                "min_score": 0,
                "limit": 5,
                "analyze_top_n": 0,
            },
        )
    )

    assert result["query_plan"]["mode"] == "ai"
    assert result["query_plan"]["generated_by"] == "qwen3.6-plus"
    assert seen_queries == ["nanomaterials plant growth", "nanoparticles plant stress response"]
    monkeypatch.setenv("AI_PROVIDER", "mock")
    get_settings.cache_clear()


def test_agent_scan_openai_missing_config_returns_stable_error(monkeypatch):
    project = prepare_project()
    monkeypatch.setenv("AI_PROVIDER", "openai")
    monkeypatch.setenv("OPENAI_API_KEY", "")
    get_settings.cache_clear()

    response = client.post(
        "/api/v1/agent/research-scan:run",
        json={
            "research_direction": "我研究脱木质素竹材高碘酸钠氧化和二胺改性后的热压性能。",
            "project_id": project["id"],
            "sources": ["openalex"],
            "source_modes": {"openalex": "live_api"},
            "analyze_top_n": 0,
        },
    )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "AI_PROVIDER_CONFIG_MISSING"
    monkeypatch.setenv("AI_PROVIDER", "mock")
    get_settings.cache_clear()


def test_live_agent_scan_open_metadata_when_enabled():
    if os.getenv("RUN_LIVE_AGENT_SCAN_TESTS") != "1":
        pytest.skip("Set RUN_LIVE_AGENT_SCAN_TESTS=1 to exercise live Agent OpenAlex/Crossref scan.")
    project = prepare_project()

    result = unwrap(
        client.post(
            "/api/v1/agent/research-scan:run",
            json={
                "research_direction": "nanomaterials plant growth stress response",
                "project_id": project["id"],
                "sources": ["openalex", "crossref"],
                "source_modes": {"openalex": "live_api", "crossref": "live_api"},
                "query_expansion": "rules",
                "published_after": "2020-01-01",
                "min_score": 0,
                "limit": 3,
                "analyze_top_n": 0,
            },
        )
    )

    assert result["status"] == "completed"
    assert result["query_plan"]["queries"]
    assert {item["source"] for item in result["source_statuses"]} == {"openalex", "crossref"}
    assert result["source_count"] >= len(result["candidates"]) >= 1
