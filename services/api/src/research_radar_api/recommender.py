from __future__ import annotations

from datetime import date

from .dedup import normalize_title
from .schemas import Paper, Recommendation, RecommendationPaper, ResearchProfile, UserFeedback, make_id


POSITIVE = {"very_relevant", "method_useful", "want_more", "add_to_experiment", "add_to_writing"}
NEGATIVE = {"irrelevant", "exclude_material", "exclude_application"}


def _tokens(values: list[str]) -> set[str]:
    tokens: set[str] = set()
    for value in values:
        tokens.update(token for token in normalize_title(value).split() if len(token) > 2)
    return tokens


def _score_text(paper: Paper, terms: set[str]) -> float:
    if not terms:
        return 0.0
    haystack = normalize_title(
        " ".join([paper.title, paper.abstract or "", " ".join(paper.keywords)])
    )
    hits = sum(1 for term in terms if term in haystack)
    return min(1.0, hits / max(1, min(len(terms), 5)))


def _recommendation_type(
    score_topic: float,
    score_method: float,
    score_material: float,
    score_mechanism: float,
) -> str:
    if score_topic >= 0.4 and score_material >= 0.2:
        return "高相关"
    if score_method >= max(score_topic, 0.2):
        return "方法可借鉴"
    if score_mechanism >= 0.2:
        return "背景引用"
    return "探索启发"


def _score_formula_summary(
    *,
    score_topic: float,
    score_method: float,
    score_material: float,
    score_mechanism: float,
    score_novelty: float,
    score_quality: float,
    score_user_preference: float,
    score_heat: float,
    feedback_adjustment: float,
) -> str:
    weighted = {
        "topic": 0.30 * score_topic,
        "method": 0.20 * score_method,
        "material": 0.12 * score_material,
        "mechanism": 0.10 * score_mechanism,
        "novelty": 0.08 * score_novelty,
        "quality": 0.08 * score_quality,
        "user_preference": 0.07 * score_user_preference,
        "heat": 0.05 * score_heat,
    }
    top_parts = sorted(weighted.items(), key=lambda item: item[1], reverse=True)[:3]
    parts = ", ".join(f"{name}={value:.3f}" for name, value in top_parts)
    return f"主要贡献: {parts}; feedback_adjustment={feedback_adjustment:.3f}"


def feedback_bias(paper: Paper, feedback: list[UserFeedback]) -> tuple[float, list[str]]:
    bias = 0.0
    notes: list[str] = []
    for item in feedback:
        if item.paper_id == paper.id and item.feedback_type in NEGATIVE:
            bias -= 0.35
            notes.append("该论文曾被标记为不相关或需排除，排序下调")
        elif item.paper_id == paper.id and item.feedback_type in POSITIVE:
            bias += 0.08
            notes.append("该论文曾收到正向反馈，排序小幅上调")
    if any(item.feedback_type == "method_useful" for item in feedback):
        if _score_text(paper, {"method", "oxidation", "crosslinking", "diamine", "hot", "pressing"}):
            bias += 0.06
            notes.append("历史反馈偏好方法可借鉴论文，方法信号上调")
    return bias, notes


def rank_papers(
    project_id: str,
    profile: ResearchProfile,
    papers: list[Paper],
    feedback: list[UserFeedback],
    existing: dict[str, Recommendation],
) -> list[Recommendation]:
    topic_terms = _tokens(profile.research_object + profile.materials + profile.keywords_en)
    method_terms = _tokens(profile.methods + profile.synonyms)
    material_terms = _tokens(profile.materials)
    mechanism_terms = _tokens(profile.mechanisms + profile.metrics)

    scored: list[tuple[float, Recommendation]] = []
    for paper in papers:
        bias, feedback_notes = feedback_bias(paper, feedback)
        score_topic = _score_text(paper, topic_terms)
        score_method = _score_text(paper, method_terms)
        score_material = _score_text(paper, material_terms)
        score_mechanism = _score_text(paper, mechanism_terms)
        score_novelty = 0.85 if paper.year >= date.today().year - 2 else 0.58
        score_quality = min(1.0, 0.55 + 0.08 * paper.source_count + (0.1 if paper.doi else 0))
        score_heat = min(1.0, 0.35 + 0.05 * paper.source_count)
        score_user_preference = max(0.0, min(1.0, 0.5 + bias))
        total = (
            0.30 * score_topic
            + 0.20 * score_method
            + 0.12 * score_material
            + 0.10 * score_mechanism
            + 0.08 * score_novelty
            + 0.08 * score_quality
            + 0.07 * score_user_preference
            + 0.05 * score_heat
            + bias
        )
        if total <= 0:
            continue
        channel = "method_transfer" if score_method >= score_topic and score_method > 0 else "exact"
        rec = existing.get(paper.id) or Recommendation(
            id=make_id("rec"),
            project_id=project_id,
            paper=RecommendationPaper(
                id=paper.id,
                title=paper.title,
                title_zh=paper.title_zh,
                year=paper.year,
                journal=paper.journal,
                doi=paper.doi,
            ),
            profile_id=profile.id,
            channel=channel,
            score_total=0,
            score_topic=0,
            score_method=0,
            score_material=0,
            score_mechanism=0,
            score_novelty=0,
            score_quality=0,
            score_user_preference=0,
            score_heat=0,
            rank=0,
            explanation={},
            fulltext_status=paper.fulltext_status,
        )
        rec.profile_id = profile.id
        rec.channel = channel  # type: ignore[assignment]
        rec.score_total = round(max(0.01, min(0.99, total)), 3)
        rec.score_topic = round(score_topic, 3)
        rec.score_method = round(score_method, 3)
        rec.score_material = round(score_material, 3)
        rec.score_mechanism = round(score_mechanism, 3)
        rec.score_novelty = round(score_novelty, 3)
        rec.score_quality = round(score_quality, 3)
        rec.score_user_preference = round(score_user_preference, 3)
        rec.score_heat = round(score_heat, 3)
        recommendation_type = _recommendation_type(
            score_topic,
            score_method,
            score_material,
            score_mechanism,
        )
        rec.explanation = {
            "topic": "命中研究对象、材料或英文关键词" if score_topic else "主题命中较弱",
            "method": "命中方法或同义词信号" if score_method else "方法信号较弱",
            "score_basis": _score_formula_summary(
                score_topic=score_topic,
                score_method=score_method,
                score_material=score_material,
                score_mechanism=score_mechanism,
                score_novelty=score_novelty,
                score_quality=score_quality,
                score_user_preference=score_user_preference,
                score_heat=score_heat,
                feedback_adjustment=bias,
            ),
            "recommendation_type": recommendation_type,
            "uncertainty": (
                "摘要或关键词覆盖不足，需回到原文核验。"
                if max(score_topic, score_method, score_material) < 0.4
                else "基于开放元数据和摘要评分，实验参数仍需原文确认。"
            ),
            "usefulness": "; ".join(feedback_notes) or "按画像关键词、方法、材料和来源质量综合排序",
        }
        scored.append((rec.score_total, rec))

    scored.sort(key=lambda item: item[0], reverse=True)
    for rank, (_, rec) in enumerate(scored, start=1):
        rec.rank = rank
    return [rec for _, rec in scored]
