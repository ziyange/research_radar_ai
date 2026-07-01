import asyncio
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
ANALYSIS_LIST_FIELDS = {
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
    "borrowable_content",
    "applicability_to_project",
    "reproducibility_notes",
    "risk_and_uncertainty",
    "follow_up_questions",
    "deep_reading_checklist",
}
ANALYSIS_REQUIRED_FIELDS = {
    "title_zh",
    "one_sentence_conclusion",
    "summary_zh",
    "relation_to_project",
    "recommendation_level",
    "worth_deep_reading",
    "paper_metadata",
    "fulltext_availability",
    *ANALYSIS_LIST_FIELDS,
}


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


def paper_metadata_snapshot(paper: Paper) -> dict[str, Any]:
    return {
        "paper_id": paper.id,
        "title": paper.title,
        "title_zh": paper.title_zh,
        "authors": paper.authors,
        "year": paper.year,
        "journal": paper.journal,
        "doi": paper.doi,
        "abstract": paper.abstract,
        "keywords": paper.keywords,
        "fulltext_status": paper.fulltext_status,
        "source_count": paper.source_count,
    }


def fulltext_availability_snapshot(paper: Paper, input_scope: str) -> dict[str, Any]:
    return {
        "status": paper.fulltext_status,
        "input_scope": input_scope,
        "has_fulltext_input": input_scope == "fulltext",
        "legal_access_note": (
            "当前返回完整论文元数据和合法来源入口；未自动下载或转述受版权保护全文。"
        ),
        "limitations": (
            "当前分析基于全文输入。"
            if input_scope == "fulltext"
            else "当前分析基于元数据/摘要，实验参数、图表和页码证据需要回到原文核验。"
        ),
    }


def enrich_analysis_result(
    result: dict[str, Any],
    paper: Paper,
    profile: ResearchProfile | None,
    analysis_type: str,
    input_scope: str,
) -> dict[str, Any]:
    enriched = dict(result)
    enriched.setdefault("title_zh", paper.title_zh)
    enriched.setdefault("one_sentence_conclusion", "需结合摘要和原文判断是否值得深读。")
    enriched.setdefault(
        "summary_zh",
        paper.abstract or "当前仅有元数据，需补充摘要或全文后再深读。",
    )
    enriched.setdefault("relation_to_project", "未提供研究画像，需人工确认与项目关系。")
    enriched.setdefault(
        "recommendation_level",
        "deep_read" if analysis_type == "standard" else "screening",
    )
    enriched.setdefault("worth_deep_reading", analysis_type == "standard")
    enriched["paper_metadata"] = {
        **paper_metadata_snapshot(paper),
        **dict(enriched.get("paper_metadata") or {}),
    }
    enriched["fulltext_availability"] = {
        **fulltext_availability_snapshot(paper, input_scope),
        **dict(enriched.get("fulltext_availability") or {}),
    }
    project_focus = []
    if profile:
        project_focus = [
            *profile.research_object[:3],
            *profile.methods[:3],
            *profile.materials[:3],
            *profile.metrics[:3],
        ]
    defaults = {
        "title_translation_notes": [
            "给出论文标题的准确中文翻译；专有名词、材料名和方法名应保留可核验英文。"
        ],
        "abstract_translation_zh": [
            "完整翻译摘要；如果摘要缺失，必须说明无法完成摘要翻译。"
        ],
        "paper_core_contribution": [
            "概括论文自身解决的核心问题、主要贡献和结果边界。"
        ],
        "paper_deep_analysis": [
            "从研究问题、方法设计、结果证据、创新性和局限性分析论文本身的阅读价值。"
        ],
        "researcher_interest_points": [
            "研究人员通常会重点关注可复现实验条件、变量控制、对照组、关键结果和可迁移方法。"
        ],
        "literature_matching_directions": [
            "按研究对象/材料、方法/技术路线、指标/结果、机制、应用场景、时间范围、证据类型和排除条件判断匹配度。"
        ],
        "research_background": ["从题名和摘要提取研究背景，需回到原文确认完整语境。"],
        "research_problem": ["摘要未完整披露研究问题时，应标记为待核验。"],
        "research_object": [paper.title_zh],
        "methodology": ["根据摘要/元数据识别方法；完整实验流程需要原文核验。"],
        "materials_or_dataset": ["材料、样本或数据集未在摘要中完整出现时不得补写。"],
        "experimental_design": ["当前输入范围不足以恢复完整实验设计。"],
        "key_results": ["关键结果需优先引用摘要明确表述。"],
        "innovation_points": ["创新点为 AI 归纳，需与原文引言/讨论核验。"],
        "limitations": ["当前分析不包含图表、页码和完整实验参数证据。"],
        "borrowable_content": ["研究问题拆解", "方法路线", "写作背景证据"],
        "applicability_to_project": project_focus or ["需结合用户项目画像判断适配度。"],
        "reproducibility_notes": ["记录可复现实验所需参数；摘要缺失时标记为不可追溯。"],
        "risk_and_uncertainty": ["元数据/摘要级分析可能遗漏条件、对照组和负结果。"],
        "follow_up_questions": ["原文是否提供完整实验参数、对照组、统计显著性和局限讨论？"],
        "deep_reading_checklist": ["核验 DOI 与来源", "阅读方法和结果", "检查图表与补充材料"],
    }
    for field, default in defaults.items():
        value = enriched.get(field)
        if isinstance(value, str):
            enriched[field] = [value]
        elif not isinstance(value, list) or not value:
            enriched[field] = default
        else:
            enriched[field] = [str(item) for item in value if str(item).strip()]
    return enriched


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
        short_text = text[:32] or "用户研究方向"
        return {
            "discipline": discipline or "材料科学",
            "subfield": "待确认方向",
            "research_object": ["用户描述的研究对象"],
            "research_questions": ["改性方法如何影响材料性能", "哪些文献最接近当前技术路线"],
            "goals": ["找到高相关论文", "沉淀可追溯科研证据", "发现可验证研究空白"],
            "methods": ["文献检索", "方法迁移", "证据对比"],
            "materials": ["目标材料"],
            "reagents": [],
            "metrics": ["力学性能", "界面结合", "热稳定性"],
            "mechanisms": [],
            "applications": [],
            "keywords_zh": [short_text],
            "keywords_en": [],
            "synonyms": [],
            "exclusions": [],
            "confidence": 0.62,
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
        relation = "可作为当前研究方向的候选参考"
        if profile and set(profile.methods).intersection(set(paper.keywords or [])):
            relation = "与当前画像中的方法关键词存在直接重合"

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
                claim="与用户方向相比，该论文可用于对照研究对象、方法路线、评价指标或证据强度。",
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
                claim="可启发用户优先比较变量设置、评价指标和结果证据之间的关系。",
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
            "result": enrich_analysis_result(
                {
                "title_zh": paper.title_zh,
                "one_sentence_conclusion": "建议纳入首批筛选，并结合摘要判断是否标准研读。",
                "summary_zh": paper.abstract or "当前仅有元数据，需补充摘要或全文后再深读。",
                "relation_to_project": relation,
                "recommendation_level": "high" if analysis_type == "quick" else "deep_read",
                "worth_deep_reading": True,
                    "research_background": ["围绕论文题名和摘要识别研究背景。"],
                    "research_problem": ["判断该文是否解决与用户方向相近的科学或工程问题。"],
                    "research_object": [paper.title_zh],
                    "methodology": ["从摘要提取方法路线；未出现的实验细节不补写。"],
                    "materials_or_dataset": paper.keywords or ["摘要未明确材料或数据集。"],
                    "experimental_design": ["摘要级输入不足以完整复现实验设计。"],
                    "key_results": [paper.abstract[:160]] if paper.abstract else ["摘要缺失，关键结果不可追溯。"],
                    "innovation_points": ["可作为相关方向筛选和标准研读候选。"],
                    "limitations": ["当前不是全文研读，缺少图表、页码和完整参数。"],
                "borrowable_content": ["实验路线", "方法对比", "写作背景证据"],
                    "applicability_to_project": [relation],
                    "reproducibility_notes": ["需要原文方法部分核验样品、仪器、对照组和统计方法。"],
                    "risk_and_uncertainty": ["摘要未披露的信息不得作为原文事实。"],
                    "follow_up_questions": ["该文是否提供可复现实验参数？", "是否有对照实验和统计显著性？"],
                    "deep_reading_checklist": ["核验 DOI", "阅读方法", "提取结果图表", "记录局限"],
                },
                paper=paper,
                profile=profile,
                analysis_type=analysis_type,
                input_scope=input_scope,
            ),
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
            "paper_metadata, fulltext_availability, title_translation_notes, abstract_translation_zh, "
            "paper_core_contribution, paper_deep_analysis, researcher_interest_points, "
            "literature_matching_directions, research_background, research_problem, research_object, "
            "methodology, materials_or_dataset, experimental_design, key_results, innovation_points, "
            "limitations, borrowable_content, applicability_to_project, reproducibility_notes, "
            "risk_and_uncertainty, follow_up_questions, deep_reading_checklist。"
            "除 paper_metadata、fulltext_availability、worth_deep_reading 外，上述研读维度必须尽量使用字符串数组。"
            "title_zh 必须是论文英文标题的准确中文翻译；title_translation_notes 说明关键术语如何翻译。"
            "abstract_translation_zh 必须完整翻译输入摘要，不要只总结；若无摘要，说明摘要缺失。"
            "summary_zh 是摘要后的凝练总结，不得替代 abstract_translation_zh。"
            "paper_core_contribution 必须回答论文自身到底解决了什么问题、贡献是什么。"
            "paper_deep_analysis 必须深入分析论文本身：研究问题、方法设计、证据强度、结果边界、局限。"
            "researcher_interest_points 必须站在研究人员阅读文献的角度，指出最值得追问和摘录的内容。"
            "literature_matching_directions 必须按文献筛选维度判断匹配方向："
            "研究对象/材料体系、方法/技术路线、指标/结局、作用机制、应用场景、"
            "发表时间与时效性、证据类型/研究设计、全文可获取性、与用户排除项的冲突、"
            "是否能支持研究空白或方法迁移；每一项都要写明匹配/部分匹配/不匹配及依据。"
            "paper_metadata 用输入论文元数据，不得编造；fulltext_availability 说明是否有全文输入、开放全文状态和限制。"
            "如果 input_scope 不是 fulltext，必须明确说明当前不是全文研读，不得声称阅读了正文、图表或补充材料。"
            "claims 必须是数组，每项包含 claim, fact_level, evidence；"
            "fact_level 只能是 source_explicit, ai_summary, cross_paper_comparison, "
            "ai_inference, research_inspiration；evidence 包含 paper_id, section, quote, traceable。"
            "不得虚构 DOI；证据不足时 traceable=false。"
            "原文片段 quote 必须短，只用于证据定位。"
            f"\n论文元数据 JSON: {json.dumps(paper_metadata_snapshot(paper), ensure_ascii=False)}"
            f"\n全文可获取性 JSON: {json.dumps(fulltext_availability_snapshot(paper, input_scope), ensure_ascii=False)}"
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
        result = enrich_analysis_result(
            payload["result"],
            paper=paper,
            profile=profile,
            analysis_type=analysis_type,
            input_scope=input_scope,
        )
        missing_fields = sorted(ANALYSIS_REQUIRED_FIELDS - set(result))
        if missing_fields:
            raise AiOutputValidationError(
                f"AI analysis result is missing required fields: {', '.join(missing_fields)}."
            )
        return {
            "result": result,
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
        content: object | None = None
        last_exc: httpx.HTTPError | None = None
        for attempt in range(2):
            try:
                async with httpx.AsyncClient(
                    timeout=self.settings.ai_request_timeout_seconds
                ) as client:
                    response = await client.post(
                        f"{self.settings.openai_base_url.rstrip('/')}/chat/completions",
                        headers=headers,
                        json=payload,
                    )
                    if response.status_code == 429 or response.status_code >= 500:
                        response.raise_for_status()
                    response.raise_for_status()
                    content = response.json()["choices"][0]["message"]["content"]
                    break
            except httpx.HTTPError as exc:
                last_exc = exc
                if attempt == 1:
                    raise
                await asyncio.sleep(1.5)
        else:
            if last_exc:
                raise last_exc
            raise AiOutputValidationError("AI response was not returned.")
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
