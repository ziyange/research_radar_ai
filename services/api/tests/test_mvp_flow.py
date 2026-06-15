import os

from fastapi.testclient import TestClient

os.environ["RETRIEVAL_PROVIDER"] = "mock"

from research_radar_api.main import app


client = TestClient(app)


def unwrap(response):
    assert response.status_code < 400, response.text
    payload = response.json()
    assert "request_id" in payload
    return payload["data"]


def test_health_reports_documented_runtime():
    data = unwrap(client.get("/api/v1/health"))
    assert data["status"] == "ok"
    assert "RR-MVP-001" in data["requirements"]


def test_cold_start_to_diagnosis_flow():
    project = unwrap(
        client.post(
            "/api/v1/projects",
            json={
                "name": "脱木质素竹材热压材料研究",
                "discipline": "材料科学",
                "description": "验证 RR-MVP 冷启动。",
            },
        )
    )
    profile = unwrap(
        client.post(
            f"/api/v1/projects/{project['id']}/profile:generate",
            json={
                "one_sentence": "我研究脱木质素竹片经过高碘酸钠氧化和二胺改性后的热压材料性能。",
                "foundation_paper_ids": [],
                "material_ids": [],
            },
        )
    )
    assert "高碘酸钠氧化" in profile["methods"]

    confirmed = unwrap(client.post(f"/api/v1/projects/{project['id']}/profile:confirm"))
    assert confirmed["status"] == "confirmed"

    diagnosis = unwrap(client.get(f"/api/v1/projects/{project['id']}/diagnosis"))
    assert len(diagnosis["highly_related_papers"]) == 3
    assert len(diagnosis["method_transfer_papers"]) == 2
    assert diagnosis["research_gap_candidate"]


def test_search_recommend_feedback_analysis_knowledge_report_flow():
    project = unwrap(
        client.post(
            "/api/v1/projects",
            json={"name": "推荐闭环测试", "discipline": "材料科学"},
        )
    )
    unwrap(
        client.post(
            f"/api/v1/projects/{project['id']}/profile:generate",
            json={"one_sentence": "我研究脱木质素竹材高碘酸钠氧化和二胺热压。"},
        )
    )
    unwrap(client.post(f"/api/v1/projects/{project['id']}/profile:confirm"))

    tasks = unwrap(client.post(f"/api/v1/projects/{project['id']}/search-tasks:generate"))
    assert {task["task_type"] for task in tasks} >= {"exact", "expanded", "method_transfer"}

    task_status = unwrap(client.post(f"/api/v1/search-tasks/{tasks[0]['id']}:run"))
    assert task_status["status"] == "succeeded"
    assert {item["source"] for item in task_status["source_statuses"]} >= {"openalex", "crossref"}
    source_records = unwrap(client.get(f"/api/v1/search-tasks/{tasks[0]['id']}/source-records"))
    assert {record["source"] for record in source_records} >= {"openalex", "crossref"}
    assert all(record["paper_id"] for record in source_records)

    recommendations = unwrap(client.get(f"/api/v1/projects/{project['id']}/recommendations"))
    assert recommendations["items"][0]["score_total"] > recommendations["items"][-1]["score_total"]
    assert "score_basis" in recommendations["items"][0]["explanation"]
    assert (
        recommendations["items"][0]["score_topic"]
        + recommendations["items"][0]["score_method"]
        + recommendations["items"][0]["score_material"]
        > recommendations["items"][0]["score_heat"]
    )
    rec = recommendations["items"][0]

    feedback = unwrap(
        client.post(
            f"/api/v1/recommendations/{rec['id']}/feedback",
            json={"feedback_type": "method_useful", "note": "方法可借鉴"},
        )
    )
    assert feedback["feedback_type"] == "method_useful"

    analysis = unwrap(
        client.post(
            f"/api/v1/papers/{rec['paper']['id']}/analysis",
            json={"project_id": project["id"], "analysis_type": "quick", "input_scope": "abstract"},
        )
    )
    assert analysis["evidence_labels_valid"] is True
    assert analysis["claims"][0]["fact_level"] in {
        "source_explicit",
        "ai_summary",
        "cross_paper_comparison",
        "ai_inference",
        "research_inspiration",
    }

    item = unwrap(
        client.post(
            f"/api/v1/projects/{project['id']}/knowledge",
            json={
                "paper_id": rec["paper"]["id"],
                "status": "read_later",
                "tags": ["方法参考"],
                "note": "后续比较热压参数。",
            },
        )
    )
    assert item["status"] == "read_later"

    search = unwrap(client.get(f"/api/v1/projects/{project['id']}/knowledge:search?q=热压"))
    assert len(search) == 1

    report = unwrap(client.post(f"/api/v1/projects/{project['id']}/reports:generate?report_type=daily"))
    assert report["content"]["new_papers"] >= 1

    messages = unwrap(client.get("/api/v1/messages"))
    assert any(message["report_id"] == report["id"] for message in messages)


def test_e2e_002_daily_recommendation_feedback_changes_next_ranking():
    project = unwrap(
        client.post(
            "/api/v1/projects",
            json={"name": "E2E-002 反馈纠偏", "discipline": "材料科学"},
        )
    )
    unwrap(
        client.post(
            f"/api/v1/projects/{project['id']}/profile:generate",
            json={"one_sentence": "我研究脱木质素竹材高碘酸钠氧化和二胺热压。"},
        )
    )
    unwrap(client.post(f"/api/v1/projects/{project['id']}/profile:confirm"))
    tasks = unwrap(client.post(f"/api/v1/projects/{project['id']}/search-tasks:generate"))
    for task in tasks[:2]:
        status = unwrap(client.post(f"/api/v1/search-tasks/{task['id']}:run"))
        assert "来源记录" in status["message"]

    before = unwrap(client.get(f"/api/v1/projects/{project['id']}/recommendations"))["items"]
    assert before
    first = before[0]
    unwrap(
        client.post(
            f"/api/v1/recommendations/{first['id']}/feedback",
            json={"feedback_type": "irrelevant", "note": "不是这个材料体系"},
        )
    )
    after = unwrap(client.post(f"/api/v1/projects/{project['id']}/recommendations:refresh"))[
        "items"
    ]
    assert after
    assert after[0]["paper"]["id"] != first["paper"]["id"]
    moved = next(item for item in after if item["paper"]["id"] == first["paper"]["id"])
    assert moved["rank"] > first["rank"]
    assert "排序下调" in moved["explanation"]["usefulness"]
