import os

from fastapi.testclient import TestClient


from research_radar_api.main import app


client = TestClient(app)


def unwrap(response):
    assert response.status_code < 400, response.text
    payload = response.json()
    assert "request_id" in payload
    return payload["data"]


def auth_headers(user_id: str = "usr_demo") -> dict[str, str]:
    return {"x-user-id": user_id}


def create_ready_project(user_id: str = "usr_demo") -> dict:
    project = unwrap(
        client.post(
            "/api/v1/projects",
            headers=auth_headers(user_id),
            json={"name": f"RR-DEV-005 {user_id}", "discipline": "材料科学"},
        )
    )
    unwrap(
        client.post(
            f"/api/v1/projects/{project['id']}/profile:generate",
            headers=auth_headers(user_id),
            json={"one_sentence": "我研究脱木质素竹材高碘酸钠氧化和二胺热压。"},
        )
    )
    unwrap(
        client.post(
            f"/api/v1/projects/{project['id']}/profile:confirm",
            headers=auth_headers(user_id),
        )
    )
    recs = unwrap(
        client.get(
            f"/api/v1/projects/{project['id']}/recommendations",
            headers=auth_headers(user_id),
        )
    )["items"]
    unwrap(
        client.post(
            f"/api/v1/recommendations/{recs[0]['id']}/feedback",
            headers=auth_headers(user_id),
            json={"feedback_type": "method_useful", "note": "方法有启发"},
        )
    )
    unwrap(
        client.post(
            f"/api/v1/projects/{project['id']}/knowledge",
            headers=auth_headers(user_id),
            json={
                "paper_id": recs[0]["paper"]["id"],
                "status": "read_later",
                "tags": ["周报增长"],
                "note": "纳入周报验收。",
            },
        )
    )
    return project


def test_daily_report_creates_message_and_email_outbox():
    project = create_ready_project()

    report = unwrap(
        client.post(f"/api/v1/projects/{project['id']}/reports:generate?report_type=daily")
    )
    assert report["report_type"] == "daily"
    assert report["message_status"] == "emailed"
    assert report["content"]["new_papers"] >= 1
    assert report["content"]["deduped_papers"] >= 1
    assert report["content"]["high_relevance"]
    assert report["content"]["suggested_deep_reads"]
    assert "method_inspirations" in report["content"]

    messages = unwrap(client.get("/api/v1/messages"))
    message = next(item for item in messages if item["report_id"] == report["id"])
    assert message["read"] is False

    read = unwrap(client.post(f"/api/v1/messages/{message['id']}:read"))
    assert read["read"] is True

    outbox = unwrap(client.get("/api/v1/me/email-outbox"))
    record = next(item for item in outbox if item["report_id"] == report["id"])
    assert record["recipient_email"] == "researcher@example.com"
    assert record["status"] == "sent"
    assert record["failure_reason"] is None
    assert record["unsubscribed"] is False


def test_weekly_report_contains_growth_trends_and_suggestions():
    project = create_ready_project()

    report = unwrap(
        client.post(f"/api/v1/projects/{project['id']}/reports:generate?report_type=weekly")
    )

    assert report["report_type"] == "weekly"
    assert report["content"]["high_value_papers"]
    assert report["content"]["trends"]
    assert report["content"]["knowledge_growth"] >= 1
    assert report["content"]["feedback_changes"]["positive"] >= 1
    assert report["content"]["next_week_suggestions"]

    messages = unwrap(client.get("/api/v1/messages"))
    assert any(message["report_id"] == report["id"] for message in messages)


def test_mock_email_failure_is_recorded_in_outbox():
    user = unwrap(
        client.post(
            "/api/v1/auth/register",
            json={
                "email": "fail-recipient@example.com",
                "password": "password",
                "display_name": "失败邮箱用户",
            },
        )
    )["user"]
    project = create_ready_project(user["id"])

    report = unwrap(
        client.post(
            f"/api/v1/projects/{project['id']}/reports:generate?report_type=daily",
            headers=auth_headers(user["id"]),
        )
    )
    assert report["message_status"] == "failed"

    outbox = unwrap(client.get("/api/v1/me/email-outbox", headers=auth_headers(user["id"])))
    record = next(item for item in outbox if item["report_id"] == report["id"])
    assert record["status"] == "failed"
    assert record["failure_reason"]
    assert record["unsubscribed"] is False


def test_unsubscribe_skips_email_task_but_keeps_message():
    user = unwrap(
        client.post(
            "/api/v1/auth/register",
            json={
                "email": "unsubscribed@example.com",
                "password": "password",
                "display_name": "退订用户",
            },
        )
    )["user"]
    project = create_ready_project(user["id"])

    before = unwrap(client.get("/api/v1/me/email-outbox", headers=auth_headers(user["id"])))
    preference = unwrap(
        client.post("/api/v1/me/email:unsubscribe", headers=auth_headers(user["id"]))
    )
    assert preference["reports_unsubscribed"] is True

    report = unwrap(
        client.post(
            f"/api/v1/projects/{project['id']}/reports:generate?report_type=weekly",
            headers=auth_headers(user["id"]),
        )
    )

    after = unwrap(client.get("/api/v1/me/email-outbox", headers=auth_headers(user["id"])))
    assert len(after) == len(before)
    assert report["message_status"] == "published"

    messages = unwrap(client.get("/api/v1/messages", headers=auth_headers(user["id"])))
    assert any(message["report_id"] == report["id"] for message in messages)
