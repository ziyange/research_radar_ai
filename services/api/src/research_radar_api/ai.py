import json
import re
from typing import Any

import httpx

from .schemas import AnalysisClaim, ClaimEvidence, Paper, ResearchProfile, ResearchProject
from .settings import Settings


FACT_LEVELS = {
    "source_explicit",
    "ai_summary",
    "cross_paper_comparison",
    "ai_inference",
    "research_inspiration",
}

DOI_PATTERN = re.compile(r"\b10\.\d{4,9}/[-._;()/:A-Z0-9]+\b", re.IGNORECASE)
JSON_BLOCK_PATTERN = re.compile(r"```(?:json)?\s*(.*?)\s*```", re.DOTALL | re.IGNORECASE)


class AiProviderConfigError(RuntimeError):
    pass


class AiOutputValidationError(RuntimeError):
    pass


def extract_json_object(content: str) -> dict[str, Any]:
    match = JSON_BLOCK_PATTERN.search(content)
    source = match.group(1) if match else content.strip()
    try:
        payload = json.loads(source)
    except json.JSONDecodeError as exc:
        raise AiOutputValidationError("AI output is not valid JSON.") from exc
    if not isinstance(payload, dict):
        raise AiOutputValidationError("AI output JSON must be an object.")
    return payload


class AiProvider:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def ensure_configured(self) -> None:
        if self.settings.ai_provider != "openai":
            return
        if not self.settings.openai_api_key:
            raise AiProviderConfigError("OPENAI_API_KEY is required when AI_PROVIDER=openai.")
        if not self.settings.openai_base_url:
            raise AiProviderConfigError("OPENAI_BASE_URL is required when AI_PROVIDER=openai.")
        if not self.settings.openai_model:
            raise AiProviderConfigError("OPENAI_MODEL is required when AI_PROVIDER=openai.")

    async def generate_profile_payload(
        self,
        project: ResearchProject,
        one_sentence: str,
    ) -> dict[str, Any]:
        if self.settings.ai_provider == "openai":
            self.ensure_configured()
            prompt = (
                "你是科研画像生成助手。请只输出 JSON object，不要 Markdown。"
                "字段必须包含：discipline, subfield, research_object, research_questions, goals, "
                "methods, materials, reagents, metrics, mechanisms, applications, keywords_zh, "
                "keywords_en, synonyms, exclusions, confidence。"
                "所有列表字段必须是字符串数组；confidence 为 0 到 1 的数字。"
                f"\n项目名称: {project.name}"
                f"\n学科: {project.discipline or '未知'}"
                f"\n项目描述: {project.description or '无'}"
                f"\n一句话研究方向: {one_sentence}"
            )
            content = await self._chat_completion(
                messages=[
                    {
                        "role": "system",
                        "content": "你只输出可被 json.loads 解析的 JSON，不输出解释。",
                    },
                    {"role": "user", "content": prompt},
                ],
                temperature=0.1,
            )
            return extract_json_object(content)
        return self._mock_profile_payload(one_sentence, project.discipline)

    async def generate_retrieval_plan(
        self,
        research_direction: str,
        profile: ResearchProfile | None,
    ) -> dict[str, Any]:
        if self.settings.ai_provider == "openai":
            self.ensure_configured()
            prompt = (
                "你是科研检索规划助手。请把用户的中文或混合语言研究方向转换成可用于 "
                "OpenAlex 和 Crossref 的英文检索计划。只输出 JSON object，不要 Markdown，"
                "不要输出思维链。JSON 字段必须包含：mode, original_direction, "
                "translated_direction_en, queries, keywords_zh, keywords_en, synonyms_en, "
                "exclusions, confidence, generated_by。queries 必须是 2 到 6 条英文检索式，"
                "每条适合学术元数据检索；不要决定返回篇数，不要编造论文、DOI、作者或来源。"
                "keywords_zh、keywords_en、synonyms_en、exclusions 都是字符串数组；"
                "confidence 为 0 到 1 的数字。"
                f"\n用户研究方向: {research_direction}"
                f"\n当前研究画像: {profile.model_dump_json() if profile else '无'}"
            )
            content = await self._chat_completion(
                messages=[
                    {
                        "role": "system",
                        "content": "你只输出可被 json.loads 解析的 JSON，不输出解释。",
                    },
                    {"role": "user", "content": prompt},
                ],
                temperature=0.1,
            )
            payload = extract_json_object(content)
            if not isinstance(payload.get("queries"), list):
                raise AiOutputValidationError("AI retrieval plan must contain queries array.")
            payload["mode"] = "ai"
            payload["original_direction"] = str(payload.get("original_direction") or research_direction)
            payload["generated_by"] = str(payload.get("generated_by") or self.settings.openai_model)
            return payload
        return self._mock_retrieval_plan(research_direction)

    async def analyze_paper(
        self,
        paper: Paper,
        profile: ResearchProfile | None,
        analysis_type: str,
        input_scope: str,
    ) -> dict[str, Any]:
        if self.settings.ai_provider == "openai":
            self.ensure_configured()
            return await self._openai_compatible_analysis(
                paper=paper,
                profile=profile,
                analysis_type=analysis_type,
                input_scope=input_scope,
            )
        return self._mock_analysis(paper, profile, analysis_type, input_scope)

    def _mock_profile_payload(
        self,
        text: str,
        discipline: str | None,
    ) -> dict[str, Any]:
        is_bamboo = "竹" in text or "bamboo" in text.lower()
        return {
            "discipline": discipline or "材料科学",
            "subfield": "生物质材料" if is_bamboo else "待确认方向",
            "research_object": ["脱木质素竹片"] if is_bamboo else ["用户描述的研究对象"],
            "research_questions": ["改性方法如何影响材料性能", "哪些文献最接近当前技术路线"],
            "goals": ["找到高相关论文", "沉淀可追溯科研证据", "发现可验证研究空白"],
            "methods": ["高碘酸钠氧化", "二胺改性", "热压"] if is_bamboo else ["文献检索", "方法迁移"],
            "materials": ["脱木质素竹片", "生物质材料", "纤维素基材料"] if is_bamboo else ["目标材料"],
            "reagents": ["高碘酸钠", "二胺"] if is_bamboo else [],
            "metrics": ["力学性能", "界面结合", "热稳定性"],
            "mechanisms": ["醛基-胺基反应", "界面交联"] if is_bamboo else [],
            "applications": ["热压材料", "可持续复合材料"] if is_bamboo else [],
            "keywords_zh": ["脱木质素竹材", "高碘酸钠氧化", "二胺改性", "热压"]
            if is_bamboo
            else [text[:20]],
            "keywords_en": [
                "delignified bamboo",
                "sodium periodate oxidation",
                "diamine modification",
                "hot pressing",
            ]
            if is_bamboo
            else [],
            "synonyms": ["periodate oxidation", "aldehyde cellulose", "biomass composite"]
            if is_bamboo
            else [],
            "exclusions": ["无化学改性的竹材应用", "纯木塑复合材料"] if is_bamboo else [],
            "confidence": 0.82 if is_bamboo else 0.68,
        }

    def _mock_retrieval_plan(self, text: str) -> dict[str, Any]:
        terms = [
            item.strip()
            for item in re.split(r"[\s,，。；;:：、/|()（）\[\]\-]+", text)
            if len(item.strip()) >= 2
        ]
        latin_terms = [term.lower() for term in terms if re.search(r"[a-zA-Z]", term)]
        cjk_terms = [term for term in terms if re.search(r"[\u4e00-\u9fff]", term)]
        base_query = " ".join(latin_terms or terms or [text])
        queries = [base_query]
        if latin_terms and len(latin_terms) > 2:
            queries.append(" ".join(latin_terms[:6]))
        return {
            "mode": "rules",
            "original_direction": text,
            "translated_direction_en": base_query,
            "queries": queries,
            "keywords_zh": cjk_terms,
            "keywords_en": latin_terms,
            "synonyms_en": [],
            "exclusions": [],
            "confidence": 0.45,
            "generated_by": "mock-deterministic-query-plan",
        }

    def _mock_analysis(
        self,
        paper: Paper,
        profile: ResearchProfile | None,
        analysis_type: str,
        input_scope: str,
    ) -> dict[str, Any]:
        relation = "与当前研究方向高度相关"
        if profile and not set(profile.methods).intersection({"高碘酸钠氧化", "二胺改性", "热压"}):
            relation = "可作为方法或背景参考"

        claims = [
            AnalysisClaim(
                claim=f"论文题名为《{paper.title_zh}》。",
                fact_level="source_explicit",
                evidence=ClaimEvidence(
                    paper_id=paper.id,
                    section="metadata",
                    quote=paper.title[:120],
                    traceable=True,
                ),
            ),
            AnalysisClaim(
                claim=f"论文关注 {paper.title_zh}，可用于判断是否值得深读。",
                fact_level="ai_summary",
                evidence=ClaimEvidence(
                    paper_id=paper.id,
                    section="metadata",
                    quote=paper.title[:80],
                    traceable=True,
                ),
            ),
            AnalysisClaim(
                claim="与用户方向相比，该论文可用于对照材料改性、界面结合或热压工艺证据。",
                fact_level="cross_paper_comparison",
                evidence=ClaimEvidence(
                    paper_id=paper.id,
                    section="abstract",
                    quote=(paper.abstract or "")[:100],
                    traceable=bool(paper.abstract),
                ),
            ),
            AnalysisClaim(
                claim="若摘要未提供完整实验参数，工艺窗口和性能因果关系只能作为待验证推测。",
                fact_level="ai_inference",
                evidence=ClaimEvidence(
                    paper_id=paper.id,
                    section=input_scope,
                    quote=None,
                    traceable=False,
                ),
            ),
            AnalysisClaim(
                claim="可启发用户优先比较氧化程度、二胺种类和热压条件的交互影响。",
                fact_level="research_inspiration",
                evidence=ClaimEvidence(
                    paper_id=paper.id,
                    section="project_context",
                    quote=None,
                    traceable=False,
                ),
            ),
        ]
        return {
            "result": {
                "title_zh": paper.title_zh,
                "one_sentence_conclusion": "建议纳入首批筛选，并结合摘要判断是否标准研读。",
                "summary_zh": paper.abstract or "当前仅有元数据，需补充摘要或全文后再深读。",
                "relation_to_project": relation,
                "recommendation_level": "high" if analysis_type == "quick" else "deep_read",
                "worth_deep_reading": True,
                "borrowable_content": ["实验路线", "方法对比", "写作背景证据"],
            },
            "claims": [claim.model_dump(mode="json") for claim in claims],
            "model": "mock-research-radar",
        }

    async def _openai_compatible_analysis(
        self,
        paper: Paper,
        profile: ResearchProfile | None,
        analysis_type: str,
        input_scope: str,
    ) -> dict[str, Any]:
        prompt = (
            "你是科研文献分析助手。请只输出 JSON object，不要 Markdown。"
            "JSON 必须包含 result 和 claims。result 必须包含 title_zh, one_sentence_conclusion, "
            "summary_zh, relation_to_project, recommendation_level, worth_deep_reading, "
            "borrowable_content。claims 必须是数组，每项包含 claim, fact_level, evidence；"
            "fact_level 只能是 source_explicit, ai_summary, cross_paper_comparison, "
            "ai_inference, research_inspiration；evidence 包含 paper_id, section, quote, traceable。"
            "不得虚构 DOI；证据不足时 traceable=false。"
            f"\n论文标题: {paper.title}\n摘要: {paper.abstract or '无'}"
            f"\n论文ID: {paper.id}\n论文DOI: {paper.doi or '无'}"
            f"\n用户画像: {profile.model_dump_json() if profile else '无'}"
            f"\n分析类型: {analysis_type}; 输入范围: {input_scope}"
        )
        content = await self._chat_completion(
            messages=[
                {
                    "role": "system",
                    "content": "你只输出可被 json.loads 解析的 JSON，不输出解释。",
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0.2,
        )
        payload = extract_json_object(content)
        if not isinstance(payload.get("result"), dict) or not isinstance(payload.get("claims"), list):
            raise AiOutputValidationError("AI analysis output must contain result and claims.")
        return {
            "result": payload["result"],
            "claims": payload["claims"],
            "model": self.settings.openai_model,
        }

    async def _chat_completion(
        self,
        messages: list[dict[str, str]],
        temperature: float,
    ) -> str:
        headers = {
            "Authorization": f"Bearer {self.settings.openai_api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": self.settings.openai_model,
            "messages": messages,
            "temperature": temperature,
        }
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                f"{self.settings.openai_base_url.rstrip('/')}/chat/completions",
                headers=headers,
                json=payload,
            )
            response.raise_for_status()
            content = response.json()["choices"][0]["message"]["content"]
        if not isinstance(content, str):
            raise AiOutputValidationError("AI response content must be a string.")
        return content


def validate_analysis_safety(
    result: dict[str, Any],
    claims: list[AnalysisClaim],
    paper: Paper,
) -> dict[str, Any]:
    allowed_dois = {paper.doi.lower()} if paper.doi else set()
    text_parts = [str(value) for value in result.values()]
    text_parts.extend(claim.claim for claim in claims)
    found_dois = {item.lower() for text in text_parts for item in DOI_PATTERN.findall(text)}
    hallucinated_dois = sorted(found_dois - allowed_dois)
    fact_inference_confusions = [
        claim.claim
        for claim in claims
        if claim.fact_level == "source_explicit" and not claim.evidence.traceable
    ]
    missing_fact_levels = sorted(FACT_LEVELS - {claim.fact_level for claim in claims})
    return {
        "hallucinated_dois": hallucinated_dois,
        "hallucinated_doi_count": len(hallucinated_dois),
        "fact_inference_confusions": fact_inference_confusions,
        "fact_inference_confusion_count": len(fact_inference_confusions),
        "missing_fact_levels": missing_fact_levels,
        "all_claims_labeled": all(claim.fact_level in FACT_LEVELS for claim in claims),
    }
