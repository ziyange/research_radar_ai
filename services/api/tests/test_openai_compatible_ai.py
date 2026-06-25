import json
import os
import asyncio
from collections.abc import Iterator

from fastapi.testclient import TestClient

os.environ["AI_PROVIDER"] = "mock"
os.environ["RETRIEVAL_PROVIDER"] = "mock"
os.environ["DEMO_SEED_ENABLED"] = "true"
os.environ["DEV_USER_ID"] = "usr_demo"

from research_radar_api import ai as ai_module  # noqa: E402
from research_radar_api.main import app  # noqa: E402
from research_radar_api.settings import Settings, get_settings  # noqa: E402


client = TestClient(app)


class FakeResponse:
    def __init__(self, content: str, status_code: int = 200) -> None:
        self.content = content
        self.status_code = status_code

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict:
        return {"choices": [{"message": {"content": self.content}}]}


class FakeAsyncClient:
    responses: list[str] = []

    def __init__(self, *args, **kwargs) -> None:  # noqa: ANN002, ANN003
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args) -> None:  # noqa: ANN002
        return None

    async def post(self, *args, **kwargs) -> FakeResponse:  # noqa: ANN002, ANN003
        return FakeResponse(self.responses.pop(0))


class FlakyAsyncClient:
    attempts = 0

    def __init__(self, *args, **kwargs) -> None:  # noqa: ANN002, ANN003
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args) -> None:  # noqa: ANN002
        return None

    async def post(self, *args, **kwargs) -> FakeResponse:  # noqa: ANN002, ANN003
        FlakyAsyncClient.attempts += 1
        if FlakyAsyncClient.attempts == 1:
            raise ai_module.httpx.RemoteProtocolError(
                "Server disconnected without sending a response."
            )
        return FakeResponse('{"ok": true}')


def unwrap(response):
    assert response.status_code < 400, response.text
    return response.json()["data"]


def openai_settings(api_key: str | None = "test-key") -> Settings:
    return Settings(
        ai_provider="openai",
        openai_api_key=api_key,
        openai_base_url="https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
        openai_model="qwen3.6-plus",
        retrieval_provider="mock",
        demo_seed_enabled=True,
        dev_user_id="usr_demo",
    )


def override_settings(settings: Settings) -> Iterator[None]:
    app.dependency_overrides[get_settings] = lambda: settings
    try:
        yield
    finally:
        app.dependency_overrides.pop(get_settings, None)


def test_openai_provider_missing_key_returns_stable_error():
    project = unwrap(client.post("/api/v1/projects", json={"name": "缺配置 AI"}))
    for _ in override_settings(openai_settings(api_key=None)):
        response = client.post(
            f"/api/v1/projects/{project['id']}/profile:generate",
            json={"one_sentence": "我研究可持续生物质材料。"},
        )

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "AI_PROVIDER_CONFIG_MISSING"


def test_openai_compatible_profile_generation_writes_structured_profile(monkeypatch):
    monkeypatch.setattr(ai_module.httpx, "AsyncClient", FakeAsyncClient)
    FakeAsyncClient.responses = [
        json.dumps(
            {
                "discipline": "材料科学",
                "subfield": "生物质材料",
                "research_object": ["脱木质素竹片"],
                "research_questions": ["二胺改性如何影响热压性能"],
                "goals": ["筛选高相关论文"],
                "methods": ["高碘酸钠氧化", "二胺改性", "热压"],
                "materials": ["脱木质素竹片"],
                "reagents": ["高碘酸钠", "二胺"],
                "metrics": ["力学性能"],
                "mechanisms": ["醛基-胺基反应"],
                "applications": ["热压材料"],
                "keywords_zh": ["脱木质素竹材"],
                "keywords_en": ["delignified bamboo"],
                "synonyms": ["periodate oxidation"],
                "exclusions": ["无化学改性竹材"],
                "confidence": 0.88,
            }
        )
    ]
    project = unwrap(client.post("/api/v1/projects", json={"name": "真实 AI 画像"}))

    for _ in override_settings(openai_settings()):
        profile = unwrap(
            client.post(
                f"/api/v1/projects/{project['id']}/profile:generate",
                json={"one_sentence": "我研究脱木质素竹片经过氧化和二胺改性后的热压材料。"},
            )
        )

    assert profile["methods"] == ["高碘酸钠氧化", "二胺改性", "热压"]
    assert profile["confidence"] == 0.88
    costs = unwrap(client.get("/api/v1/me/costs"))
    assert any(item["feature"] == "profile.generate" and item["model"] == "qwen3.6-plus" for item in costs)


def test_openai_compatible_analysis_writes_claims_and_cost(monkeypatch):
    monkeypatch.setattr(ai_module.httpx, "AsyncClient", FakeAsyncClient)
    FakeAsyncClient.responses = [
        json.dumps(
            {
                "result": {
                    "title_zh": "脱木质素竹材分析",
                    "one_sentence_conclusion": "建议深读。",
                    "summary_zh": "摘要支持该方向判断。",
                    "relation_to_project": "高度相关",
                    "recommendation_level": "deep_read",
                    "worth_deep_reading": True,
                    "title_translation_notes": ["Periodate oxidation 翻译为高碘酸钠氧化。"],
                    "abstract_translation_zh": ["这是摘要的完整中文翻译。"],
                    "paper_core_contribution": ["论文说明氧化与二胺改性可形成材料界面证据。"],
                    "paper_deep_analysis": ["该文需要重点核验方法、对照组、界面结合证据和性能边界。"],
                    "researcher_interest_points": ["研究人员会关注反应条件、材料表征、性能指标和可复现参数。"],
                    "literature_matching_directions": [
                        "研究对象/材料体系：匹配脱木质素竹材；方法/技术路线：匹配高碘酸钠氧化和二胺改性。"
                    ],
                    "borrowable_content": ["方法路线"],
                },
                "claims": [
                    {
                        "claim": "题名与脱木质素竹材相关。",
                        "fact_level": "source_explicit",
                        "evidence": {
                            "paper_id": "paper_bamboo_oxidation",
                            "section": "metadata",
                            "quote": "Periodate oxidation",
                            "traceable": True,
                        },
                    },
                    {
                        "claim": "可作为项目方向摘要。",
                        "fact_level": "ai_summary",
                        "evidence": {
                            "paper_id": "paper_bamboo_oxidation",
                            "section": "abstract",
                            "quote": None,
                            "traceable": False,
                        },
                    },
                ],
            }
        )
    ]
    project = unwrap(client.post("/api/v1/projects", json={"name": "真实 AI 研读"}))
    unwrap(
        client.post(
            f"/api/v1/projects/{project['id']}/profile:generate",
            json={"one_sentence": "我研究脱木质素竹材高碘酸钠氧化和二胺热压。"},
        )
    )
    unwrap(client.post(f"/api/v1/projects/{project['id']}/profile:confirm"))

    for _ in override_settings(openai_settings()):
        analysis = unwrap(
            client.post(
                "/api/v1/papers/paper_bamboo_oxidation/analysis",
                json={
                    "project_id": project["id"],
                    "analysis_type": "quick",
                    "input_scope": "abstract",
                },
            )
        )

    assert analysis["model"] == "qwen3.6-plus"
    assert analysis["claims"][0]["fact_level"] == "source_explicit"
    costs = unwrap(client.get("/api/v1/me/costs"))
    cost = next(item for item in costs if item["id"] == analysis["cost_record_id"])
    assert cost["provider"] == "openai"
    assert cost["model"] == "qwen3.6-plus"


def test_openai_invalid_json_does_not_write_analysis(monkeypatch):
    monkeypatch.setattr(ai_module.httpx, "AsyncClient", FakeAsyncClient)
    FakeAsyncClient.responses = ["not-json"]
    project = unwrap(client.post("/api/v1/projects", json={"name": "错误 AI 输出"}))

    for _ in override_settings(openai_settings()):
        response = client.post(
            "/api/v1/papers/paper_bamboo_oxidation/analysis",
            json={
                "project_id": project["id"],
                "analysis_type": "quick",
                "input_scope": "abstract",
            },
        )

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "AI_OUTPUT_SCHEMA_INVALID"


def test_openai_chat_completion_retries_transient_disconnect(monkeypatch):
    monkeypatch.setattr(ai_module.httpx, "AsyncClient", FlakyAsyncClient)
    FlakyAsyncClient.attempts = 0
    provider = ai_module.AiProvider(openai_settings())

    content = asyncio.run(
        provider._chat_completion(
            messages=[{"role": "user", "content": "ping"}],
            temperature=0,
        )
    )

    assert content == '{"ok": true}'
    assert FlakyAsyncClient.attempts == 2
