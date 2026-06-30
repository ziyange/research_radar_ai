from fastapi.testclient import TestClient

from research_radar_api import literature
from research_radar_api.main import app


client = TestClient(app)


def test_literature_library_imports_demo_assets() -> None:
    response = client.get("/api/v1/literature/library")

    assert response.status_code == 200
    payload = response.json()
    assert len(payload["papers"]) >= 1
    assert len(payload["scanRuns"]) >= 1
    assert len(payload["reports"]) >= 1
    assert payload["papers"][0].get("localMarkdownUrl") or payload["papers"][0].get(
        "localFullTextUrl"
    )


def test_literature_task_crud_roundtrip() -> None:
    payload = {
        "query": "nanomaterials plant",
        "count": 2,
        "yearFrom": 2021,
        "minScore": 50,
        "sources": ["openalex", "crossref"],
        "downloadOpenPdf": False,
        "autoAnalyze": False,
        "dailyEnabled": False,
        "dailyTime": "09:00",
        "dailyTimezone": "Asia/Shanghai",
        "notifyAfterRun": False,
        "recipientEmails": ["recipient@example.com"],
        "ccEmails": ["cc@example.com"],
        "bccEmails": ["bcc@example.com"],
    }

    created = client.post("/api/v1/literature/tasks", json=payload)
    assert created.status_code == 200
    task = created.json()["task"]
    assert task["query"] == payload["query"]
    assert task["recipientEmails"] == ["recipient@example.com"]
    assert task["ccEmails"] == ["cc@example.com"]
    assert task["bccEmails"] == ["bcc@example.com"]

    updated = client.put(
        f"/api/v1/literature/tasks/{task['id']}",
        json={**payload, "count": 3, "notifyAfterRun": True},
    )
    assert updated.status_code == 200
    assert updated.json()["task"]["count"] == 3
    assert updated.json()["task"]["notifyAfterRun"] is True

    deleted = client.delete(f"/api/v1/literature/tasks/{task['id']}")
    assert deleted.status_code == 200
    assert all(item["id"] != task["id"] for item in deleted.json()["tasks"])


def test_literature_mock_analysis_generates_markdown_report() -> None:
    library = client.get("/api/v1/literature/library").json()
    paper_id = library["papers"][0]["id"]

    response = client.post(
        "/api/v1/literature/analyze",
        json={"paperIds": [paper_id], "query": "acceptance", "limit": 1},
    )

    assert response.status_code == 200
    report = response.json()["report"]
    assert paper_id in report["paperIds"]
    assert "AI 阅读报告" in report["markdown"]
    assert "```mermaid" in report["markdown"]


def test_literature_mail_test_requires_recipient_when_no_default() -> None:
    response = client.post("/api/v1/literature/mail/test", json={"to": []})

    assert response.status_code == 200
    delivery = response.json()["delivery"]
    assert delivery["status"] in {"queued", "failed", "pending_confirmation", "sent"}
    if delivery["status"] == "queued":
        assert delivery["error"] == "MAIL_RECIPIENT_REQUIRED"


def test_literature_mail_delivery_records_send_parameters() -> None:
    response = client.post(
        "/api/v1/literature/mail/test",
        json={"to": ["recipient@example.com"]},
    )

    assert response.status_code == 200
    delivery = response.json()["delivery"]
    assert delivery["recipients"] == ["recipient@example.com"]
    assert delivery["subject"].startswith("[研知雷达]")
    assert delivery["bodyFile"].endswith(".md")
    assert delivery["markdownPath"] == delivery["bodyFile"]
    assert isinstance(delivery.get("attachments"), list)


def test_literature_task_rejects_invalid_recipient_email() -> None:
    payload = {
        "query": "nanomaterials plant",
        "count": 2,
        "yearFrom": 2021,
        "minScore": 50,
        "sources": ["openalex", "crossref"],
        "downloadOpenPdf": False,
        "autoAnalyze": False,
        "dailyEnabled": False,
        "dailyTime": "09:00",
        "dailyTimezone": "Asia/Shanghai",
        "notifyAfterRun": True,
        "recipientEmails": ["not-an-email"],
    }

    response = client.post("/api/v1/literature/tasks", json=payload)

    assert response.status_code == 422


def test_literature_expired_confirmation_regenerates_pending_token(monkeypatch) -> None:
    monkeypatch.setattr(
        literature,
        "mail_status",
        lambda: {
            "enabled": True,
            "installed": True,
            "authorized": True,
            "email": "sender@example.com",
            "sendCapable": True,
            "cli": "agently-cli",
            "message": "ok",
        },
    )
    calls: list[list[str]] = []

    def fake_run_agent_mail(args, cwd=None, timeout=45):  # noqa: ANN001, ARG001
        calls.append(args)
        if "--confirmation-token" in args:
            return literature.CliResult(
                1,
                '{"ok": false, "error": {"type": "api_error", "code": 400, "message": "Confirmation token expired or invalid"}}',
                "",
            )
        return literature.CliResult(8, "summary: 请确认发送\nctk_new_confirmation", "")

    monkeypatch.setattr(literature, "run_agent_mail", fake_run_agent_mail)
    delivery = literature.add_mail_delivery(
        "mail_test",
        {"id": "mail_test_expired", "title": "确认令牌刷新测试", "abstract": "test"},
        task={"query": "mail retry"},
        recipients=["recipient@example.com"],
    )

    response = client.post(f"/api/v1/literature/mail/deliveries/{delivery['id']}:confirm")

    assert response.status_code == 200
    refreshed = response.json()["delivery"]
    assert refreshed["status"] == "pending_confirmation"
    assert refreshed["confirmationToken"] == "ctk_new_confirmation"
    assert any("--confirmation-token" in call for call in calls)
    assert calls[-1].count("--confirmation-token") == 0


def test_literature_file_route_serves_markdown() -> None:
    library = client.get("/api/v1/literature/library").json()
    paper = next(item for item in library["papers"] if item.get("localMarkdownUrl"))

    response = client.get(paper["localMarkdownUrl"])

    assert response.status_code == 200
    assert response.text.startswith("# ")
