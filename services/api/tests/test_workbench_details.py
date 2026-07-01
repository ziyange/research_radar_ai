import os

from fastapi.testclient import TestClient


from research_radar_api.main import app


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
            json={"name": "RR-DEV-009 详情接口验收", "discipline": "材料科学"},
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
    status = unwrap(client.post(f"/api/v1/search-tasks/{tasks[0]['id']}:run"))
    recommendations = unwrap(client.get(f"/api/v1/projects/{project['id']}/recommendations"))
    return project, tasks, status, recommendations["items"][0]


def test_workbench_detail_endpoints_and_task_retry():
    project, tasks, task_status, recommendation = prepare_project()

    recommendation_detail = unwrap(client.get(f"/api/v1/recommendations/{recommendation['id']}"))
    assert recommendation_detail["paper"]["id"] == recommendation["paper"]["id"]

    paper = unwrap(client.get(f"/api/v1/papers/{recommendation['paper']['id']}"))
    assert paper["id"] == recommendation["paper"]["id"]
    versions = unwrap(client.get(f"/api/v1/papers/{paper['id']}/versions"))
    assert versions

    analysis = unwrap(
        client.post(
            f"/api/v1/papers/{paper['id']}/analysis",
            json={"project_id": project["id"], "analysis_type": "quick", "input_scope": "abstract"},
        )
    )
    analyses = unwrap(client.get(f"/api/v1/papers/{paper['id']}/analysis"))
    assert any(item["id"] == analysis["id"] for item in analyses)

    knowledge = unwrap(
        client.post(
            f"/api/v1/projects/{project['id']}/knowledge",
            json={
                "paper_id": paper["id"],
                "status": "read_later",
                "tags": ["RR-DEV-009"],
                "note": "用于详情抽屉验收。",
            },
        )
    )
    knowledge_detail = unwrap(client.get(f"/api/v1/knowledge/{knowledge['id']}"))
    assert knowledge_detail["paper_id"] == paper["id"]
    updated_knowledge = unwrap(
        client.patch(
            f"/api/v1/knowledge/{knowledge['id']}",
            json={"status": "read", "tags": ["RR-DEV-009", "已研读"], "note": "详情可编辑。"},
        )
    )
    assert updated_knowledge["status"] == "read"
    assert "已研读" in updated_knowledge["tags"]

    report = unwrap(client.post(f"/api/v1/projects/{project['id']}/reports:generate?report_type=daily"))
    report_detail = unwrap(client.get(f"/api/v1/reports/{report['id']}"))
    assert report_detail["id"] == report["id"]

    messages = unwrap(client.get("/api/v1/messages"))
    message = next(item for item in messages if item["report_id"] == report["id"])
    message_detail = unwrap(client.get(f"/api/v1/messages/{message['id']}"))
    assert message_detail["title"] == message["title"]
    read_message = unwrap(client.post(f"/api/v1/messages/{message['id']}:read"))
    assert read_message["read"] is True

    bridged_task = unwrap(client.get(f"/api/v1/tasks/{tasks[0]['id']}"))
    assert bridged_task["task_id"] == task_status["task_id"]
    retried = unwrap(client.post(f"/api/v1/tasks/{tasks[0]['id']}:retry"))
    assert retried["status"] == "retrying"
    assert retried["retry_count"] >= 1
