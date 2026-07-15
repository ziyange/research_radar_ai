import asyncio
import time
import zipfile
from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

from fastapi.testclient import TestClient

from research_radar_api import literature
from research_radar_api.literature_runtime import repository as repository_module
from research_radar_api.literature_runtime.markdown_pdf import markdown_to_pdf
from research_radar_api.literature_runtime.repository import LiteratureRepository
from research_radar_api.main import app


client = TestClient(app)


def add_fulltext_test_paper(paper_id: str = "paper_test_fulltext") -> dict:
    full_path = literature.repository.papers_dir / f"{paper_id}-fulltext.md"
    full_path.write_text(
        "# Test Full Text\n\n"
        + ("This full text describes methods, results, evidence and conclusions. " * 80),
        encoding="utf-8",
    )
    paper = {
        "id": paper_id,
        "title": "Full text acceptance paper",
        "doi": f"10.0000/{paper_id}",
        "year": 2026,
        "journal": "Local Test Journal",
        "source": "Local",
        "authors": ["Test Author"],
        "abstract": "This is an abstract.",
        "localFullTextPath": str(full_path.relative_to(literature.ROOT_DIR)).replace("\\", "/"),
        "fullTextStatus": "ready",
        "fullTextSource": "html",
    }
    literature.repository.library["papers"] = [
        paper,
        *[item for item in literature.repository.library["papers"] if item["id"] != paper_id],
    ]
    literature.repository._persist_item("papers", paper)
    return paper


def test_literature_library_starts_without_demo_assets() -> None:
    literature.repository.library = {"papers": [], "scanRuns": [], "reports": [], "mailDeliveries": []}
    literature.repository.tasks = []
    response = client.get("/api/v1/literature/library")

    assert response.status_code == 200
    payload = response.json()
    assert payload["papers"] == []
    assert payload["scanRuns"] == []
    assert payload["reports"] == []


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


def test_literature_tasks_persist_to_local_storage_when_database_is_memory(monkeypatch) -> None:
    storage_root = literature.ROOT_DIR / "tmp" / f"literature-repo-test-{uuid4().hex}"
    monkeypatch.setattr(
        repository_module,
        "get_settings",
        lambda: SimpleNamespace(database_url="sqlite+memory://dev", literature_storage_root=str(storage_root)),
    )
    repo = LiteratureRepository()
    task = {
        "id": "task_local_persist",
        "query": "persistent task",
        "count": 5,
        "createdAt": "2026-01-01T00:00:00+00:00",
    }

    repo.tasks = [task]
    repo._persist_item("tasks", task)
    reloaded = LiteratureRepository()

    assert any(item["id"] == task["id"] and item["query"] == task["query"] for item in reloaded.tasks)


def test_literature_scheduler_runs_due_daily_task(monkeypatch) -> None:
    monkeypatch.setattr(
        literature,
        "get_settings",
        lambda: SimpleNamespace(literature_scheduler_enabled=True),
    )
    seen: dict[str, object] = {}
    task = {
        "id": f"task_scheduler_{uuid4().hex}",
        "query": "scheduled nanomaterials plant",
        "count": 1,
        "yearFrom": 2021,
        "minScore": 0,
        "sources": ["crossref"],
        "downloadOpenPdf": False,
        "autoAnalyze": False,
        "dailyEnabled": True,
        "dailyTime": "09:00",
        "dailyTimezone": "Asia/Shanghai",
        "notifyAfterRun": False,
        "lastScheduledRunDate": "",
    }
    literature.repository.tasks = [task, *[item for item in literature.repository.tasks if item["id"] != task["id"]]]

    async def fake_perform_scan(payload, task_id=None, trigger="manual"):  # noqa: ANN001
        seen["trigger"] = trigger
        seen["task_id"] = task_id
        run = {
            "id": f"scan_scheduler_{uuid4().hex}",
            "taskId": task_id,
            "query": payload["query"],
            "trigger": trigger,
            "savedCount": 0,
            "candidateCount": 0,
            "duplicateCount": 0,
            "savedPaperIds": [],
            "sourceStatuses": [],
            "queryPlan": [],
            "executionEvents": [],
            "targetMet": False,
            "createdAt": literature.now_iso(),
        }
        return {"run": run, "papers": [], "duplicates": [], "library": literature.repository.serialize_library()}

    monkeypatch.setattr(literature, "perform_scan", fake_perform_scan)

    results = asyncio.run(
        literature.run_due_scheduled_tasks_once(datetime(2026, 7, 3, 1, 5, tzinfo=timezone.utc))
    )

    assert results[0]["status"] == "succeeded"
    assert seen["trigger"] == "scheduled"
    assert task["lastScheduledRunDate"] == "2026-07-03"
    assert task["lastRunStatus"] == "succeeded"
    assert task["nextScheduledRunAt"]


def test_literature_async_run_job_exposes_real_events(monkeypatch) -> None:
    task = {
        "id": f"task_async_{uuid4().hex}",
        "query": "async nanomaterials plant",
        "count": 1,
        "yearFrom": 2021,
        "minScore": 0,
        "sources": ["crossref"],
        "downloadOpenPdf": False,
        "autoAnalyze": False,
        "dailyEnabled": False,
        "dailyTime": "09:00",
        "dailyTimezone": "Asia/Shanghai",
        "notifyAfterRun": False,
    }
    literature.repository.tasks = [task, *[item for item in literature.repository.tasks if item["id"] != task["id"]]]

    async def fake_perform_scan(payload, task_id=None, trigger="manual", event_sink=None):  # noqa: ANN001
        if event_sink:
            event_sink(literature.execution_event("source", "running", "连接 crossref，查询 async。"))
            event_sink(literature.execution_event("source", "done", "crossref 返回 1 条开放元数据。"))
        run = {
            "id": f"scan_async_{uuid4().hex}",
            "taskId": task_id,
            "query": payload["query"],
            "trigger": trigger,
            "savedCount": 0,
            "candidateCount": 1,
            "duplicateCount": 0,
            "savedPaperIds": [],
            "sourceStatuses": [{"source": "crossref", "query": payload["query"], "status": "succeeded", "count": 1}],
            "queryPlan": [{"query": payload["query"], "source": "user"}],
            "executionEvents": [],
            "targetMet": False,
            "createdAt": literature.now_iso(),
        }
        return {"run": run, "papers": [], "duplicates": [], "library": literature.repository.serialize_library()}

    monkeypatch.setattr(literature, "perform_scan", fake_perform_scan)

    started = client.post(f"/api/v1/literature/tasks/{task['id']}:run-async", json={})
    assert started.status_code == 200
    job_id = started.json()["job"]["id"]

    job = {}
    for _ in range(20):
        response = client.get(f"/api/v1/literature/runs/{job_id}")
        assert response.status_code == 200
        job = response.json()["job"]
        if job["status"] != "running":
            break
        time.sleep(0.05)

    assert job["status"] == "done"
    assert any("crossref" in event["message"] for event in job["events"])
    assert job["result"]["run"]["query"] == task["query"]


def test_literature_runtime_config_updates_env_without_echoing_secret(monkeypatch) -> None:
    config_dir = literature.ROOT_DIR / "tmp" / f"config-test-{uuid4().hex}"
    config_dir.mkdir(parents=True, exist_ok=True)
    env_file = config_dir / ".env"
    example_file = config_dir / ".env.example"
    example_file.write_text(
        "AI_PROVIDER=mock\nOPENAI_API_KEY=old-secret\nOPENAI_MODEL=qwen-old\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(literature, "env_path", lambda: env_file)
    monkeypatch.setattr(literature, "env_example_path", lambda: example_file)

    payload = literature.public_config_payload()
    secret_field = next(item for item in payload["fields"] if item["key"] == "OPENAI_API_KEY")
    assert secret_field["value"] == ""
    assert secret_field["hasValue"] is True

    literature.update_env_values({"OPENAI_MODEL": "qwen3.6-plus", "OPENAI_API_KEY": ""})
    values = literature.read_env_values()

    assert values["OPENAI_MODEL"] == "qwen3.6-plus"
    assert values["OPENAI_API_KEY"] == "old-secret"


def test_literature_filters_known_test_artifacts_outside_pytest(monkeypatch) -> None:
    monkeypatch.delenv("PYTEST_CURRENT_TEST", raising=False)

    assert repository_module.is_test_artifact(
        "literature_tasks",
        {
            "id": "task_digest_push",
            "query": "nanomaterials plant",
            "count": 3,
            "minScore": 50,
            "recipientEmails": ["recipient@example.com"],
        },
    )
    assert repository_module.is_test_artifact(
        "literature_tasks",
        {
            "id": f"task_{uuid4()}",
            "query": "nanomaterials plant",
            "count": 3,
            "minScore": 50,
            "recipientEmails": ["recipient@example.com"],
        },
    )
    assert not repository_module.is_test_artifact(
        "literature_tasks",
        {
            "id": f"task_{uuid4()}",
            "query": "nanomaterials plant",
            "count": 3,
            "minScore": 50,
            "recipientEmails": ["real-user@example.com"],
        },
    )


def test_literature_pytest_does_not_write_global_entity_files() -> None:
    task_id = f"task_pytest_no_real_{uuid4().hex}"
    target = literature.repository.entities_dir / "literature_tasks" / f"{task_id}.json"
    target.unlink(missing_ok=True)

    literature.repository._persist_item(
        "tasks",
        {
            "id": task_id,
            "query": "pytest should not write real storage",
            "count": 1,
            "createdAt": "2026-01-01T00:00:00+00:00",
        },
    )

    assert not target.exists()


def test_literature_scan_degrades_when_openalex_fails(monkeypatch) -> None:
    async def fake_openalex(query, year_from, limit):  # noqa: ANN001, ARG001
        raise RuntimeError("Server error '503 Service Unavailable'")

    async def fake_crossref(query, year_from, limit):  # noqa: ANN001, ARG001
        return [
            {
                "id": "paper_test_crossref_degraded",
                "title": "Crossref fallback food safety paper",
                "doi": "10.0000/crossref-degraded",
                "year": 2026,
                "journal": "Crossref Test",
                "authors": ["Fallback Author"],
                "abstract": "Food safety contaminants review evidence.",
                "keywords": ["food safety"],
                "source": "Crossref",
                "sourceUrl": "https://doi.org/10.0000/crossref-degraded",
                "landingPageUrl": "https://doi.org/10.0000/crossref-degraded",
                "openAccess": False,
                "citedByCount": 0,
                "rawScore": 95,
            }
        ]

    monkeypatch.setattr(literature, "fetch_openalex", fake_openalex)
    monkeypatch.setattr(literature, "fetch_crossref", fake_crossref)
    async def fake_expand_queries(query):  # noqa: ANN001, ARG001
        return [{"query": "food safety", "source": "test"}]

    monkeypatch.setattr(literature, "expand_queries", fake_expand_queries)

    response = client.post(
        "/api/v1/literature/scan",
        json={
            "query": "food safety",
            "count": 1,
            "yearFrom": 2021,
            "minScore": 1,
            "sources": ["openalex", "crossref"],
            "downloadOpenPdf": False,
        },
    )

    assert response.status_code == 200
    run = response.json()["run"]
    assert run["savedCount"] == 1
    assert run["degraded"] is True
    assert run["sourceSummary"]["failed_count"] == 1
    assert any(item.get("errorType") == "service_unavailable" for item in run["sourceStatuses"])


def test_literature_cjk_query_keeps_provider_ranked_english_records() -> None:
    paper = {
        "title": "Nanomaterials improve plant stress tolerance",
        "doi": "10.0000/nano-plant",
        "abstract": "Nanoparticles and nanomaterials regulate plant growth under abiotic stress.",
        "keywords": ["nanomaterials", "plants"],
        "providerRank": 1,
        "providerScore": 75,
        "year": 2026,
        "openAccess": True,
    }

    assert literature.relevant_enough(paper, "纳米材料 植物") is True
    assert literature.score_paper(paper, "纳米材料 植物", 2021) >= 70


def test_literature_cjk_query_can_save_crossref_provider_ranked_results(monkeypatch) -> None:
    async def fake_openalex(query, year_from, limit):  # noqa: ANN001, ARG001
        raise RuntimeError("Server error '503 Service Unavailable'")

    async def fake_crossref(query, year_from, limit):  # noqa: ANN001, ARG001
        return [
            {
                "id": "paper_test_cjk_crossref_ranked",
                "title": "Nanomaterials regulate plant stress tolerance",
                "doi": "10.0000/cjk-crossref-ranked",
                "year": 2026,
                "journal": "Crossref Test",
                "authors": ["Ranked Author"],
                "abstract": "Nanoparticles and nanomaterials improve plant growth and stress tolerance.",
                "keywords": ["nanomaterials", "plants"],
                "source": "Crossref",
                "sourceUrl": "https://doi.org/10.0000/cjk-crossref-ranked",
                "landingPageUrl": "https://doi.org/10.0000/cjk-crossref-ranked",
                "openAccess": True,
                "citedByCount": 4,
                "providerScore": 75,
                "rawScore": 0,
            }
        ]

    async def fake_expand_queries(query):  # noqa: ANN001
        return [{"query": query, "source": "user"}]

    monkeypatch.setattr(literature, "fetch_openalex", fake_openalex)
    monkeypatch.setattr(literature, "fetch_crossref", fake_crossref)
    monkeypatch.setattr(literature, "expand_queries", fake_expand_queries)

    response = client.post(
        "/api/v1/literature/scan",
        json={
            "query": "纳米材料 植物",
            "count": 1,
            "yearFrom": 2021,
            "minScore": 70,
            "sources": ["openalex", "crossref"],
            "downloadOpenPdf": False,
        },
    )

    assert response.status_code == 200
    run = response.json()["run"]
    assert run["savedCount"] == 1
    assert run["candidateCount"] == 1
    assert run["degraded"] is True
    messages = [item["message"] for item in run["executionEvents"]]
    assert any("连接 crossref" in message for message in messages)
    assert any("评分筛选" in message for message in messages)
    assert any("已入库" in message for message in messages)


def test_literature_mock_analysis_generates_markdown_report() -> None:
    paper = add_fulltext_test_paper()
    paper_id = paper["id"]

    response = client.post(
        "/api/v1/literature/analyze",
        json={"paperIds": [paper_id], "query": "acceptance", "limit": 1},
    )

    assert response.status_code == 200
    report = response.json()["report"]
    assert paper_id in report["paperIds"]
    assert "AI 阅读报告" in report["markdown"]
    assert "```mermaid" in report["markdown"]


def test_literature_analysis_requires_fulltext() -> None:
    paper = {
        "id": "paper_test_metadata_only",
        "title": "Metadata only paper",
        "doi": "10.0000/metadata-only",
        "year": 2026,
        "journal": "Local Test Journal",
        "source": "Local",
        "abstract": "Only an abstract exists.",
        "fullTextStatus": "metadata_only",
    }
    literature.repository.library["papers"] = [
        paper,
        *[item for item in literature.repository.library["papers"] if item["id"] != paper["id"]],
    ]
    literature.repository._persist_item("papers", paper)

    response = client.post(
        "/api/v1/literature/analyze",
        json={"paperIds": [paper["id"]], "query": "acceptance", "limit": 1},
    )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "FULLTEXT_REQUIRED"


def test_literature_upload_pdf_extracts_fulltext() -> None:
    paper = {
        "id": "paper_test_pdf_upload",
        "title": "PDF upload extraction paper",
        "doi": "10.0000/pdf-upload",
        "year": 2026,
        "journal": "Local Test Journal",
        "source": "Local",
        "abstract": "PDF upload abstract.",
        "fullTextStatus": "metadata_only",
    }
    literature.repository.library["papers"] = [
        paper,
        *[item for item in literature.repository.library["papers"] if item["id"] != paper["id"]],
    ]
    literature.repository._persist_item("papers", paper)
    content = b"%PDF-1.4\n" + (b"Extractable PDF text for research evidence. " * 80)

    response = client.post(
        f"/api/v1/literature/papers/{paper['id']}/upload-pdf",
        files={"file": ("paper.pdf", content, "application/pdf")},
    )

    assert response.status_code == 200
    updated = response.json()["paper"]
    assert updated["localPdfUrl"]
    assert updated["localFullTextUrl"]
    assert updated["fullTextStatus"] == "ready"
    assert updated["fullTextExtraction"]["charCount"] >= 800
    assert updated["fullTextExtraction"]["pdfPath"].endswith(".pdf")


def test_literature_upload_scanned_pdf_blocks_analysis() -> None:
    paper = {
        "id": "paper_test_scanned_pdf",
        "title": "Scanned PDF paper",
        "doi": "10.0000/scanned-pdf",
        "year": 2026,
        "journal": "Local Test Journal",
        "source": "Local",
        "abstract": "Scanned PDF abstract.",
        "fullTextStatus": "metadata_only",
    }
    literature.repository.library["papers"] = [
        paper,
        *[item for item in literature.repository.library["papers"] if item["id"] != paper["id"]],
    ]
    literature.repository._persist_item("papers", paper)

    upload = client.post(
        f"/api/v1/literature/papers/{paper['id']}/upload-pdf",
        files={"file": ("scan.pdf", b"%PDF-1.4\n%%EOF", "application/pdf")},
    )

    assert upload.status_code == 200
    updated = upload.json()["paper"]
    assert updated["fullTextStatus"] == "extract_failed"
    assert updated["fullTextError"]

    response = client.post(
        "/api/v1/literature/analyze",
        json={"paperIds": [paper["id"]], "query": "acceptance", "limit": 1},
    )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "FULLTEXT_REQUIRED"


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
    assert delivery["markdownPath"].endswith(".md")
    assert delivery["bodyFile"].endswith(".txt")
    assert delivery["bodyTextPath"] == delivery["bodyFile"]
    assert delivery["bodyPdfPath"].endswith(".pdf")
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


def test_literature_task_push_skips_digest_when_no_new_papers(monkeypatch) -> None:
    task = {
        "id": "task_digest_empty_result",
        "query": "纳米材料 植物",
        "count": 5,
        "yearFrom": 2021,
        "minScore": 70,
        "sources": ["openalex", "crossref"],
        "downloadOpenPdf": False,
        "autoAnalyze": True,
        "dailyEnabled": False,
        "dailyTime": "09:00",
        "dailyTimezone": "Asia/Shanghai",
        "notifyAfterRun": True,
        "recipientEmails": ["recipient@example.com"],
        "ccEmails": [],
        "bccEmails": [],
    }
    literature.repository.tasks = [task, *[item for item in literature.repository.tasks if item["id"] != task["id"]]]
    literature.repository._persist_item("tasks", task)
    before = [
        item["id"]
        for item in literature.repository.serialize_library()["mailDeliveries"]
        if item.get("taskId") == task["id"]
    ]

    async def fake_perform_scan(payload, task_id=None, trigger="manual"):  # noqa: ANN001, ARG001
        return {
            "run": {
                "id": "scan_empty_digest",
                "taskId": task_id,
                "query": payload["query"],
                "count": payload["count"],
                "yearFrom": payload["yearFrom"],
                "minScore": payload["minScore"],
                "sources": payload["sources"],
                "queryPlan": [{"query": payload["query"], "source": "user"}],
                "sourceStatuses": [
                    {"source": "crossref", "query": payload["query"], "status": "succeeded", "count": 295}
                ],
                "sourceSummary": {"succeeded_count": 1, "failed_count": 0, "degraded": False},
                "candidateCount": 0,
                "uniqueCount": 0,
                "duplicateCount": 0,
                "savedPaperIds": [],
                "savedCount": 0,
                "targetMet": False,
                "exhaustedReason": "没有找到满足评分、时间和去重条件的新文献",
                "createdAt": "2026-01-01T00:00:00+00:00",
            },
            "papers": [],
            "duplicates": [],
            "library": literature.repository.serialize_library(),
        }

    monkeypatch.setattr(literature, "perform_scan", fake_perform_scan)

    response = client.post(f"/api/v1/literature/tasks/{task['id']}:run", json={})

    assert response.status_code == 200
    payload = response.json()
    assert payload["run"]["savedCount"] == 0
    assert payload["taskDigestDelivery"] is None
    assert any(
        item["stage"] == "mail" and item["status"] == "skipped"
        for item in payload["run"]["executionEvents"]
    )
    after = [
        item["id"]
        for item in payload["mailDeliveries"]
        if item.get("taskId") == task["id"]
    ]
    assert after == before


def test_literature_task_push_creates_single_digest_with_zip_attachments(monkeypatch) -> None:
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
    monkeypatch.setattr(
        literature,
        "run_agent_mail",
        lambda args, cwd=None, timeout=45: literature.CliResult(0, '{"data": {"message_id": "msg_digest"}}', ""),
    )
    paper = add_fulltext_test_paper("paper_test_task_digest")
    task = {
        "id": "task_digest_push",
        "query": "task digest research",
        "count": 1,
        "yearFrom": 2021,
        "minScore": 0,
        "sources": ["openalex"],
        "downloadOpenPdf": False,
        "autoAnalyze": True,
        "dailyEnabled": False,
        "dailyTime": "09:00",
        "dailyTimezone": "Asia/Shanghai",
        "notifyAfterRun": True,
        "recipientEmails": ["recipient@example.com"],
        "ccEmails": [],
        "bccEmails": [],
    }
    literature.repository.tasks = [task, *[item for item in literature.repository.tasks if item["id"] != task["id"]]]
    literature.repository._persist_item("tasks", task)

    async def fake_perform_scan(payload, task_id=None, trigger="manual"):  # noqa: ANN001, ARG001
        return {
            "run": {
                "id": "scan_task_digest",
                "taskId": task_id,
                "query": payload["query"],
                "count": 1,
                "yearFrom": 2021,
                "minScore": 0,
                "sources": ["openalex"],
                "sourceStatuses": [{"source": "openalex", "query": payload["query"], "status": "succeeded", "count": 1}],
                "candidateCount": 1,
                "uniqueCount": 1,
                "duplicateCount": 0,
                "savedPaperIds": [paper["id"]],
                "savedCount": 1,
                "targetMet": True,
                "createdAt": "2026-01-01T00:00:00+00:00",
            },
            "papers": [paper],
            "duplicates": [],
            "library": literature.repository.serialize_library(),
        }

    monkeypatch.setattr(literature, "perform_scan", fake_perform_scan)

    response = client.post(f"/api/v1/literature/tasks/{task['id']}:run", json={})

    assert response.status_code == 200
    deliveries = [
        item for item in response.json()["mailDeliveries"] if item.get("taskId") == task["id"]
    ]
    assert deliveries
    latest = deliveries[0]
    assert latest["kind"] == "task_digest"
    assert latest["recipients"] == ["recipient@example.com"]
    assert latest["paperIds"] == [paper["id"]]
    assert latest["reportIds"]
    assert latest["status"] == "sent"
    assert latest["bodyFile"].endswith(".txt")
    assert latest["bodyTextPath"].endswith(".txt")
    assert latest["bodyPdfPath"].endswith(".pdf")
    body_text_path = literature.resolve_reader_file(latest["bodyTextPath"])
    assert body_text_path and body_text_path.exists()
    assert "| --- |" not in body_text_path.read_text(encoding="utf-8")
    assert len(latest["attachments"]) <= 3
    assert any(item.endswith(".zip") for item in latest["attachments"])
    assert any(item.endswith(".pdf") for item in latest["attachments"])
    assert all(item["kind"] != "paper_fulltext" for item in deliveries)
    assert all(item["kind"] != "analysis_report" for item in deliveries)
    zip_paths = [
        literature.resolve_reader_file(path)
        for path in latest["attachments"]
        if path.endswith(".zip")
    ]
    assert zip_paths and all(path and path.exists() for path in zip_paths)
    for zip_path in zip_paths:
        with zipfile.ZipFile(zip_path) as archive:
            names = archive.namelist()
            assert names
            assert all(not name.endswith(".md") for name in names)
            assert any(name.endswith(".pdf") for name in names)


def test_literature_task_mail_disconnect_does_not_fail_saved_run(monkeypatch) -> None:
    paper = add_fulltext_test_paper("paper_test_mail_disconnect")
    task = {
        "id": f"task_mail_disconnect_{uuid4().hex}",
        "query": "mail disconnect research",
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
        "recipientEmails": ["recipient@example.com"],
        "ccEmails": [],
        "bccEmails": [],
    }
    literature.repository.tasks = [task, *[item for item in literature.repository.tasks if item["id"] != task["id"]]]

    async def fake_perform_scan(payload, task_id=None, trigger="manual"):  # noqa: ANN001, ARG001
        return {
            "run": {
                "id": f"scan_mail_disconnect_{uuid4().hex}",
                "taskId": task_id,
                "query": payload["query"],
                "sourceStatuses": [{"source": "openalex", "query": payload["query"], "status": "succeeded", "count": 1}],
                "candidateCount": 1,
                "uniqueCount": 1,
                "duplicateCount": 0,
                "savedPaperIds": [paper["id"]],
                "savedCount": 1,
                "targetMet": True,
                "createdAt": "2026-01-01T00:00:00+00:00",
            },
            "papers": [paper],
            "duplicates": [],
            "library": literature.repository.serialize_library(),
        }

    monkeypatch.setattr(literature, "perform_scan", fake_perform_scan)

    def fail_task_digest(*args, **kwargs):  # noqa: ANN002, ANN003, ARG001
        raise RuntimeError("Server disconnected without sending a response.")

    monkeypatch.setattr(literature, "add_task_digest_delivery", fail_task_digest)

    response = client.post(f"/api/v1/literature/tasks/{task['id']}:run", json={})

    assert response.status_code == 200
    payload = response.json()
    assert payload["run"]["savedCount"] == 1
    assert payload["taskDigestDelivery"]["status"] == "failed"
    assert "邮件服务连接中断" in payload["taskDigestDelivery"]["error"]
    assert task["lastRunStatus"] == "succeeded"
    assert any(
        item["stage"] == "mail" and item["status"] == "warning"
        for item in payload["run"]["executionEvents"]
    )


def test_literature_async_task_mail_disconnect_finishes_job(monkeypatch) -> None:
    paper = add_fulltext_test_paper("paper_test_async_mail_disconnect")
    task = {
        "id": f"task_async_mail_disconnect_{uuid4().hex}",
        "query": "async mail disconnect research",
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
        "recipientEmails": ["recipient@example.com"],
        "ccEmails": [],
        "bccEmails": [],
    }
    literature.repository.tasks = [task, *[item for item in literature.repository.tasks if item["id"] != task["id"]]]

    async def fake_perform_scan(payload, task_id=None, trigger="manual", event_sink=None):  # noqa: ANN001, ARG001
        if event_sink:
            event_sink(literature.execution_event("save", "done", "保存 1 篇文献。"))
        return {
            "run": {
                "id": f"scan_async_mail_disconnect_{uuid4().hex}",
                "taskId": task_id,
                "query": payload["query"],
                "sourceStatuses": [{"source": "openalex", "query": payload["query"], "status": "succeeded", "count": 1}],
                "candidateCount": 1,
                "uniqueCount": 1,
                "duplicateCount": 0,
                "savedPaperIds": [paper["id"]],
                "savedCount": 1,
                "targetMet": True,
                "createdAt": "2026-01-01T00:00:00+00:00",
            },
            "papers": [paper],
            "duplicates": [],
            "library": literature.repository.serialize_library(),
        }

    monkeypatch.setattr(literature, "perform_scan", fake_perform_scan)

    def fail_task_digest(*args, **kwargs):  # noqa: ANN002, ANN003, ARG001
        raise RuntimeError("Server disconnected without sending a response.")

    monkeypatch.setattr(literature, "add_task_digest_delivery", fail_task_digest)

    started = client.post(f"/api/v1/literature/tasks/{task['id']}:run-async", json={})
    assert started.status_code == 200
    job_id = started.json()["job"]["id"]

    job = None
    for _ in range(40):
        time.sleep(0.05)
        response = client.get(f"/api/v1/literature/runs/{job_id}")
        assert response.status_code == 200
        job = response.json()["job"]
        if job["status"] != "running":
            break

    assert job
    assert job["status"] == "done"
    assert job["result"]["taskDigestDelivery"]["status"] == "failed"
    assert "邮件服务连接中断" in job["result"]["taskDigestDelivery"]["error"]


def test_markdown_to_pdf_generates_mobile_readable_attachment() -> None:
    pdf_path = literature.repository.mail_dir / f"markdown-pdf-test-{uuid4().hex}.pdf"
    markdown_to_pdf(
        "# 标题\n\n这是 **加粗** 内容。\n\n| 字段 | 内容 |\n| --- | --- |\n| DOI | 10.0000/test |\n",
        pdf_path,
        title="Markdown PDF 验收",
    )

    assert pdf_path.exists()
    assert pdf_path.read_bytes().startswith(b"%PDF")
    assert pdf_path.stat().st_size > 1000


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


def test_literature_agent_mail_auto_confirm_timeout_is_visible(monkeypatch) -> None:
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
            agent_mail_send_timeout_seconds=180,
        ),
    )

    def fake_run_agent_mail(args, cwd=None, timeout=45):  # noqa: ANN001, ARG001
        if "--confirmation-token" in args:
            assert timeout == 180
            return literature.CliResult(124, "", "AGENT_MAIL_TIMEOUT")
        return literature.CliResult(8, "summary: 请确认发送\nctk_timeout_confirm", "")

    monkeypatch.setattr(literature, "run_agent_mail", fake_run_agent_mail)

    delivery = literature.add_mail_delivery(
        "mail_test",
        {"id": "mail_test_auto_timeout", "title": "Agent Mail 超时测试", "abstract": "test"},
        task={"query": "agent mail timeout"},
        recipients=["recipient@example.com"],
    )

    assert delivery["status"] == "failed"
    assert delivery["error"] == "AGENT_MAIL_TIMEOUT"
    assert delivery["confirmationToken"] == "ctk_timeout_confirm"


def test_literature_agent_mail_alias_eof_retries_and_stays_retryable(monkeypatch) -> None:
    monkeypatch.setattr(literature.time, "sleep", lambda seconds: None)
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
            agent_mail_send_timeout_seconds=180,
        ),
    )
    calls: list[list[str]] = []
    output = (
        '{"ok": false, "error": {"type": "api_error", "message": '
        '"resolve alias: failed to resolve alias from /v1/me: Get \\"https://api.agent.qq.com/v1/me\\": EOF"}}'
    )

    def fake_run_agent_mail(args, cwd=None, timeout=45):  # noqa: ANN001, ARG001
        calls.append(args)
        return literature.CliResult(1, output, "")

    monkeypatch.setattr(literature, "run_agent_mail", fake_run_agent_mail)

    delivery = literature.add_mail_delivery(
        "mail_test",
        {"id": "mail_test_alias_eof", "title": "Agent Mail alias EOF", "abstract": "test"},
        task={"query": "agent mail alias eof"},
        recipients=["recipient@example.com"],
    )

    assert len(calls) == 3
    assert delivery["status"] == "failed"
    assert "暂时无法解析" in delivery["error"]
    assert "/v1/me" in delivery["rawError"]


def test_literature_agent_mail_authorized_is_send_enabled(monkeypatch) -> None:
    monkeypatch.setattr(literature.shutil, "which", lambda cli: cli)
    monkeypatch.setattr(
        literature,
        "get_settings",
        lambda: SimpleNamespace(
            email_provider="mock",
            agent_mail_enabled=False,
            agent_mail_cli="agently-cli",
            agent_mail_auto_confirm=True,
        ),
    )
    monkeypatch.setattr(
        literature,
        "run_agent_mail",
        lambda args, cwd=None, timeout=45: literature.CliResult(
            0,
            '{"data": {"aliases": [{"email": "sender@example.com", "is_primary": true}]}}',
            "",
        ),
    )

    status = literature.mail_status()

    assert status["enabled"] is True
    assert status["authorized"] is True
    assert status["sendCapable"] is True
    assert status["autoConfirm"] is True


def test_literature_agent_mail_expired_status_requires_login(monkeypatch) -> None:
    monkeypatch.setattr(literature.shutil, "which", lambda cli: cli)
    monkeypatch.setattr(
        literature,
        "get_settings",
        lambda: SimpleNamespace(
            email_provider="mock",
            agent_mail_enabled=False,
            agent_mail_cli="agently-cli",
            agent_mail_auto_confirm=True,
            agent_mail_status_timeout_seconds=30,
        ),
    )
    monkeypatch.setattr(
        literature,
        "run_agent_mail",
        lambda args, cwd=None, timeout=30: literature.CliResult(
            1,
            "",
            "refresh token request: context deadline exceeded\n"
            "warning: failed to acquire refresh lock: Access is denied.\n"
            "tip: Authorization required; follow the agently mail skill OAuth login flow.",
        ),
    )

    status = literature.mail_status()

    assert status["authorized"] is False
    assert status["sendCapable"] is False
    assert status["requiresLogin"] is True
    assert status["authState"] == "refresh_failed"
    assert "重新登录" in status["authIssue"]


def test_literature_mail_auth_session_poll_authorized(monkeypatch) -> None:
    class FakeProcess:
        stdout = None

        def poll(self) -> int:
            return 0

        def terminate(self) -> None:
            return None

    session_id = f"mail_auth_test_{uuid4().hex}"
    literature.MAIL_AUTH_SESSIONS.clear()
    with literature.MAIL_AUTH_LOCK:
        literature.MAIL_AUTH_SESSIONS[session_id] = {
            "id": session_id,
            "status": "running",
            "authUrl": "https://agent.qq.com/oauth/test",
            "output": "",
            "error": "",
            "email": "",
            "startedAt": literature.now_iso(),
            "startedMono": literature.time.monotonic(),
            "process": FakeProcess(),
        }

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
            "authState": "authorized",
            "authIssue": "",
            "requiresLogin": False,
            "message": "ok",
        },
    )

    response = client.get(f"/api/v1/literature/mail/auth:sessions/{session_id}")

    assert response.status_code == 200
    payload = response.json()
    assert payload["session"]["status"] == "authorized"
    assert payload["session"]["email"] == "sender@example.com"
    assert payload["mail"]["authorized"] is True
    literature.MAIL_AUTH_SESSIONS.clear()


def test_literature_mail_auth_session_poll_failed(monkeypatch) -> None:
    class FakeProcess:
        stdout = None

        def poll(self) -> int:
            return 1

        def terminate(self) -> None:
            return None

    session_id = f"mail_auth_test_{uuid4().hex}"
    literature.MAIL_AUTH_SESSIONS.clear()
    with literature.MAIL_AUTH_LOCK:
        literature.MAIL_AUTH_SESSIONS[session_id] = {
            "id": session_id,
            "status": "running",
            "authUrl": "https://agent.qq.com/oauth/test",
            "output": "",
            "error": "",
            "email": "",
            "startedAt": literature.now_iso(),
            "startedMono": literature.time.monotonic(),
            "process": FakeProcess(),
        }

    monkeypatch.setattr(
        literature,
        "mail_status",
        lambda: {
            "enabled": True,
            "installed": True,
            "authorized": False,
            "email": "",
            "sendCapable": False,
            "provider": "agent_mail",
            "authState": "expired",
            "authIssue": "邮箱授权已失效，请重新登录。",
            "requiresLogin": True,
            "message": "Authorization required",
        },
    )

    response = client.get(f"/api/v1/literature/mail/auth:sessions/{session_id}")

    assert response.status_code == 200
    payload = response.json()
    assert payload["session"]["status"] == "failed"
    assert "重新登录" in payload["session"]["error"]
    assert payload["mail"]["requiresLogin"] is True
    literature.MAIL_AUTH_SESSIONS.clear()


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
