import importlib.util
import os
from pathlib import Path

from fastapi.testclient import TestClient


from research_radar_api.main import app  # noqa: E402
from research_radar_api.store import store  # noqa: E402


client = TestClient(app)


def unwrap(response):
    assert response.status_code < 400, response.text
    payload = response.json()
    assert "request_id" in payload
    return payload["data"]


def create_confirmed_project():
    project = unwrap(client.post("/api/v1/projects", json={"name": "AI 安全成本验收"}))
    unwrap(
        client.post(
            f"/api/v1/projects/{project['id']}/profile:generate",
            json={"one_sentence": "我研究脱木质素竹材高碘酸钠氧化和二胺热压。"},
        )
    )
    unwrap(client.post(f"/api/v1/projects/{project['id']}/profile:confirm"))
    return project


def test_quick_and_standard_analysis_record_costs_and_fact_levels():
    project = create_confirmed_project()
    before_quota = unwrap(client.get("/api/v1/me/quota"))["quota_balance"]

    quick = unwrap(
        client.post(
            "/api/v1/papers/paper_bamboo_oxidation/analysis",
            json={"project_id": project["id"], "analysis_type": "quick", "input_scope": "abstract"},
        )
    )
    standard = unwrap(
        client.post(
            "/api/v1/papers/paper_bamboo_oxidation/analysis",
            json={
                "project_id": project["id"],
                "analysis_type": "standard",
                "input_scope": "abstract",
            },
        )
    )

    fact_levels = {claim["fact_level"] for claim in standard["claims"]}
    assert fact_levels == {
        "source_explicit",
        "ai_summary",
        "cross_paper_comparison",
        "ai_inference",
        "research_inspiration",
    }
    assert quick["evidence_labels_valid"] is True
    assert standard["evidence_labels_valid"] is True
    result = standard["result"]
    for field in [
        "paper_metadata",
        "fulltext_availability",
        "title_translation_notes",
        "abstract_translation_zh",
        "paper_core_contribution",
        "paper_deep_analysis",
        "researcher_interest_points",
        "literature_matching_directions",
        "research_background",
        "research_problem",
        "research_object",
        "methodology",
        "materials_or_dataset",
        "experimental_design",
        "key_results",
        "innovation_points",
        "limitations",
        "applicability_to_project",
        "reproducibility_notes",
        "risk_and_uncertainty",
        "follow_up_questions",
        "deep_reading_checklist",
    ]:
        assert field in result
    assert result["paper_metadata"]["paper_id"] == "paper_bamboo_oxidation"
    assert result["fulltext_availability"]["legal_access_note"]
    assert isinstance(result["methodology"], list)

    costs = unwrap(client.get("/api/v1/me/costs"))
    quick_cost = next(item for item in costs if item["id"] == quick["cost_record_id"])
    standard_cost = next(item for item in costs if item["id"] == standard["cost_record_id"])
    assert quick_cost["project_id"] == project["id"]
    assert quick_cost["paper_id"] == "paper_bamboo_oxidation"
    assert quick_cost["task_id"]
    assert quick_cost["feature"] == "paper.analysis.quick"
    assert standard_cost["feature"] == "paper.analysis.standard"
    assert standard_cost["quota_delta"] == -10
    assert standard_cost["input_tokens"] > 0
    assert unwrap(client.get("/api/v1/me/quota"))["quota_balance"] == before_quota - 11

    task = unwrap(client.get(f"/api/v1/tasks/{standard_cost['task_id']}"))
    assert task["status"] == "succeeded"
    assert task["retryable"] is True


def test_standard_analysis_quota_exhaustion_returns_stable_error_and_waiting_task():
    user = store.users["usr_demo"]
    original_quota = user.quota_balance
    user.quota_balance = 0
    store.users[user.id] = user
    try:
        project = create_confirmed_project()
        response = client.post(
            "/api/v1/papers/paper_bamboo_oxidation/analysis",
            json={
                "project_id": project["id"],
                "analysis_type": "standard",
                "input_scope": "abstract",
            },
        )
        assert response.status_code == 402
        payload = response.json()
        assert payload["error"]["code"] == "QUOTA_EXHAUSTED"
        task_id = payload["error"]["details"]["task_id"]
        task = unwrap(client.get(f"/api/v1/tasks/{task_id}"))
        assert task["status"] == "waiting"
        assert task["error_code"] == "QUOTA_EXHAUSTED"
        assert task["retryable"] is True
    finally:
        user.quota_balance = original_quota
        store.users[user.id] = user


def test_ai_safety_eval_reports_zero_high_risk_failures():
    script = Path("services/api/evals/ai_safety_eval.py").resolve()
    spec = importlib.util.spec_from_file_location("ai_safety_eval", script)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    dataset = module.load_dataset(Path("services/api/evals/ai_safety_cases.json").resolve())
    metrics = module.asyncio.run(module.evaluate(dataset))
    assert metrics["hallucinated_doi_count"] == 0
    assert metrics["fact_inference_confusion_count"] == 0
    assert metrics["missing_fact_level_count"] == 0
