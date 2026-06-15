import re
from typing import Any

import httpx

from .schemas import AnalysisClaim, ClaimEvidence, Paper, ResearchProfile
from .settings import Settings


FACT_LEVELS = {
    "source_explicit",
    "ai_summary",
    "cross_paper_comparison",
    "ai_inference",
    "research_inspiration",
}

DOI_PATTERN = re.compile(r"\b10\.\d{4,9}/[-._;()/:A-Z0-9]+\b", re.IGNORECASE)


class AiProvider:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    async def analyze_paper(
        self,
        paper: Paper,
        profile: ResearchProfile | None,
        analysis_type: str,
        input_scope: str,
    ) -> dict[str, Any]:
        if self.settings.ai_provider == "openai" and self.settings.openai_api_key:
            return await self._openai_compatible_analysis(
                paper=paper,
                profile=profile,
                analysis_type=analysis_type,
                input_scope=input_scope,
            )
        return self._mock_analysis(paper, profile, analysis_type, input_scope)

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
            "你是科研文献分析助手。请用 JSON 输出中文题名、一句话结论、中文摘要、"
            "与用户研究方向的关系、是否值得深读，并区分事实与启发。"
            f"\n论文标题: {paper.title}\n摘要: {paper.abstract or '无'}"
            f"\n用户画像: {profile.model_dump_json() if profile else '无'}"
            f"\n分析类型: {analysis_type}; 输入范围: {input_scope}"
        )
        headers = {
            "Authorization": f"Bearer {self.settings.openai_api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": self.settings.openai_model,
            "messages": [
                {"role": "system", "content": "只输出简洁中文分析，避免虚构 DOI。"},
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.2,
        }
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                f"{self.settings.openai_base_url.rstrip('/')}/chat/completions",
                headers=headers,
                json=payload,
            )
            response.raise_for_status()
            content = response.json()["choices"][0]["message"]["content"]

        claim = AnalysisClaim(
            claim="模型已基于论文元数据和用户画像生成分析，需人工核验关键科研判断。",
            fact_level="ai_summary",
            evidence=ClaimEvidence(paper_id=paper.id, section=input_scope, traceable=False),
        )
        return {
            "result": {
                "title_zh": paper.title_zh,
                "one_sentence_conclusion": content[:160],
                "summary_zh": content,
                "relation_to_project": "由模型基于画像判断",
                "recommendation_level": "model_generated",
                "worth_deep_reading": True,
            },
            "claims": [claim.model_dump(mode="json")],
            "model": self.settings.openai_model,
        }


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
