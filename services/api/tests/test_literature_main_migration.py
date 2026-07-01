from fastapi.testclient import TestClient
from types import SimpleNamespace

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


def test_literature_confirmation_summary_object_is_formatted() -> None:
    output = (
        '{"confirmation_token":"ctk_object_summary",'
        '"summary":{"action":"send","attachment_count":2,'
        '"from":"sender@example.com","subject":"文献推送",'
        '"to":["recipient@example.com"]}}'
    )

    token, summary = literature.extract_confirmation(output)

    assert token == "ctk_object_summary"
    assert "动作：send" in summary
    assert "To：recipient@example.com" in summary
    assert "主题：文献推送" in summary
    assert "附件：2 个" in summary


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


def test_literature_task_rejects_push_without_recipient() -> None:
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
        "recipientEmails": [],
    }

    response = client.post("/api/v1/literature/tasks", json=payload)

    assert response.status_code == 422


def test_literature_run_disables_legacy_push_task_without_recipient(monkeypatch) -> None:
    task = {
        "id": "task_legacy_missing_recipient",
        "query": "mail missing recipient",
        "count": 1,
        "yearFrom": 2021,
        "minScore": 0,
        "sources": ["openalex"],
        "downloadOpenPdf": False,
        "autoAnalyze": False,
        "dailyEnabled": False,
        "dailyTime": "09:00",
        "dailyTimezone": "Asia/Shanghai",
        "notifyAfterRun": True,
        "recipientEmails": [],
    }
    literature.repository.tasks = [task, *[item for item in literature.repository.tasks if item["id"] != task["id"]]]
    literature.repository._persist_item("tasks", task)

    async def fake_perform_scan(payload, task_id=None, trigger="manual"):  # noqa: ANN001, ARG001
        assert payload["notifyAfterRun"] is False
        return {
            "run": {
                "id": "scan_legacy_missing_recipient",
                "savedCount": 0,
                "createdAt": "2026-01-01T00:00:00+00:00",
            },
            "papers": [],
            "duplicates": [],
            "library": literature.repository.serialize_library(),
        }

    monkeypatch.setattr(literature, "perform_scan", fake_perform_scan)

    response = client.post(f"/api/v1/literature/tasks/{task['id']}:run", json={})

    assert response.status_code == 200
    assert response.json()["tasks"][0]["notifyAfterRun"] is False
    assert response.json()["mailDeliveries"] == literature.repository.serialize_library()["mailDeliveries"]


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


def test_literature_confirms_all_pending_deliveries(monkeypatch) -> None:
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
        return literature.CliResult(0, '{"data": {"message_id": "msg_sent"}}', "")

    monkeypatch.setattr(literature, "run_agent_mail", fake_run_agent_mail)
    deliveries = []
    for index in range(2):
        delivery = literature.add_mail_delivery(
            "mail_test",
            {"id": f"mail_test_batch_{index}", "title": f"批量确认测试 {index}", "abstract": "test"},
            task={"query": "mail batch"},
            recipients=["recipient@example.com"],
        )
        delivery.update(status="pending_confirmation", confirmationToken=f"ctk_batch_{index}", error="")
        literature.repository._persist_item("mailDeliveries", delivery)
        deliveries.append(delivery)

    response = client.post("/api/v1/literature/mail/deliveries:confirm-pending")

    assert response.status_code == 200
    assert len(response.json()["confirmed"]) >= 2
    assert all("--confirmation-token" in call for call in calls[-2:])


def test_literature_agent_mail_auto_confirms_token(monkeypatch) -> None:
    monkeypatch.setattr(
        literature,
        "mail_status",
        lambda: {
            "enabled": True,
            "installed": True,
            "authorized": True,
            "email": "sender@example.com",
            "sendCapable": True,
            "provider": "agent_mail",
            "cli": "agently-cli",
            "message": "ok",
        },
    )
    monkeypatch.setattr(
        literature,
        "get_settings",
        lambda: SimpleNamespace(
            agent_mail_auto_confirm=True,
            agent_mail_default_recipients=[],
        ),
    )
    calls: list[list[str]] = []

    def fake_run_agent_mail(args, cwd=None, timeout=45):  # noqa: ANN001, ARG001
        calls.append(args)
        if "--confirmation-token" in args:
            return literature.CliResult(0, '{"data": {"message_id": "msg_auto_sent"}}', "")
        return literature.CliResult(8, "summary: 请确认发送\nctk_auto_confirm", "")

    monkeypatch.setattr(literature, "run_agent_mail", fake_run_agent_mail)

    delivery = literature.add_mail_delivery(
        "mail_test",
        {"id": "mail_test_auto_confirm", "title": "Agent Mail 自动确认测试", "abstract": "test"},
        task={"query": "agent mail auto"},
        recipients=["recipient@example.com"],
    )

    assert delivery["status"] == "sent"
    assert delivery["providerMessageId"] == "msg_auto_sent"
    assert len(calls) == 2
    assert "--confirmation-token" not in calls[0]
    assert "--confirmation-token" in calls[1]


def test_literature_smtp_delivery_sends_without_confirmation(monkeypatch) -> None:
    sent: list[object] = []

    class FakeSmtp:
        def __init__(self, host: str, port: int, timeout: int) -> None:
            self.host = host
            self.port = port
            self.timeout = timeout

        def __enter__(self) -> "FakeSmtp":
            return self

        def __exit__(self, *args: object) -> None:
            return None

        def starttls(self) -> None:
            return None

        def login(self, username: str, password: str) -> None:
            assert username == "sender@example.com"
            assert password == "secret"

        def send_message(self, message: object, to_addrs: list[str]) -> None:
            sent.append((message, to_addrs))

    monkeypatch.setattr(literature.smtplib, "SMTP", FakeSmtp)
    monkeypatch.setattr(
        literature,
        "get_settings",
        lambda: SimpleNamespace(
            email_provider="smtp",
            email_from="Research Radar AI <sender@example.com>",
            smtp_host="smtp.example.com",
            smtp_port=587,
            smtp_username="sender@example.com",
            smtp_password="secret",
            smtp_use_tls=True,
            agent_mail_default_recipients=[],
        ),
    )

    delivery = literature.add_mail_delivery(
        "mail_test",
        {"id": "mail_test_smtp", "title": "SMTP 自动发送测试", "abstract": "test"},
        task={"query": "smtp"},
        recipients=["recipient@example.com"],
    )

    assert delivery["status"] == "sent"
    assert delivery["confirmationToken"] == ""
    assert sent
    assert sent[0][1] == ["recipient@example.com"]


def test_literature_file_route_serves_markdown() -> None:
    library = client.get("/api/v1/literature/library").json()
    paper = next(item for item in library["papers"] if item.get("localMarkdownUrl"))

    response = client.get(paper["localMarkdownUrl"])

    assert response.status_code == 200
    assert response.text.startswith("# ")
