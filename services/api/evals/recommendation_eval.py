from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[3]
SRC = ROOT / "services" / "api" / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from research_radar_api.recommender import rank_papers  # noqa: E402
from research_radar_api.schemas import Paper, ResearchProfile  # noqa: E402


RELEVANT_LABELS = {"high_relevance", "method_useful"}
EXPLANATION_KEYS = {"topic", "method", "score_basis", "recommendation_type", "uncertainty"}


def load_dataset(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def profile_from_dataset(dataset: dict[str, Any]) -> ResearchProfile:
    profile = dataset["profile"]
    return ResearchProfile(
        id=f"profile_eval_{dataset['dataset_id']}",
        project_id="project_eval",
        version=1,
        status="confirmed",
        source_type="manual",
        research_object=profile["research_object"],
        methods=profile["methods"],
        materials=profile["materials"],
        mechanisms=profile["mechanisms"],
        metrics=profile["metrics"],
        keywords_en=profile["keywords_en"],
        synonyms=profile["synonyms"],
        exclusions=profile["exclusions"],
    )


def paper_from_item(item: dict[str, Any]) -> Paper:
    return Paper(
        id=item["id"],
        title=item["title"],
        title_zh=item["title"],
        year=item["year"],
        journal=item["journal"],
        doi=item.get("doi"),
        abstract=item.get("abstract"),
        keywords=item.get("keywords", []),
        source_count=1,
    )


def evaluate(dataset: dict[str, Any], top_n: int) -> dict[str, Any]:
    labels = {item["id"]: item["label"] for item in dataset["papers"]}
    papers = [paper_from_item(item) for item in dataset["papers"]]
    recommendations = rank_papers(
        project_id="project_eval",
        profile=profile_from_dataset(dataset),
        papers=papers,
        feedback=[],
        existing={},
    )
    top = recommendations[:top_n]
    top_ids = {item.paper.id for item in top}
    relevant_ids = {
        paper_id for paper_id, label in labels.items() if label in RELEVANT_LABELS
    }
    irrelevant_in_top = [item for item in top if labels[item.paper.id] == "irrelevant"]
    explanation_covered = [
        item
        for item in top
        if EXPLANATION_KEYS.issubset(item.explanation.keys())
        and "主要贡献" in item.explanation["score_basis"]
    ]
    top_result = top[0] if top else None
    personal_signal = 0.0
    heat_signal = 0.0
    if top_result:
        personal_signal = (
            0.30 * top_result.score_topic
            + 0.20 * top_result.score_method
            + 0.12 * top_result.score_material
            + 0.10 * top_result.score_mechanism
            + 0.07 * top_result.score_user_preference
        )
        heat_signal = 0.05 * top_result.score_heat

    return {
        "dataset_id": dataset["dataset_id"],
        "direction": dataset["direction"],
        "top_n": top_n,
        "candidate_count": len(recommendations),
        "top_n_hit_rate": round(len(top_ids & relevant_ids) / max(1, min(top_n, len(top))), 3),
        "irrelevant_top_n_ratio": round(len(irrelevant_in_top) / max(1, len(top)), 3),
        "explanation_coverage": round(len(explanation_covered) / max(1, len(top)), 3),
        "top_result_personal_signal": round(personal_signal, 3),
        "top_result_heat_signal": round(heat_signal, 3),
        "top_result_profile_dominates_heat": personal_signal > heat_signal,
        "top_results": [
            {
                "rank": item.rank,
                "paper_id": item.paper.id,
                "label": labels[item.paper.id],
                "score_total": item.score_total,
                "score_topic": item.score_topic,
                "score_method": item.score_method,
                "score_material": item.score_material,
                "score_heat": item.score_heat,
                "recommendation_type": item.explanation.get("recommendation_type"),
                "score_basis": item.explanation.get("score_basis"),
            }
            for item in top
        ],
    }


def print_report(metrics: dict[str, Any]) -> None:
    print(f"Dataset: {metrics['dataset_id']}")
    print(f"Direction: {metrics['direction']}")
    print(f"Top N: {metrics['top_n']}")
    print(f"Top N hit rate: {metrics['top_n_hit_rate']}")
    print(f"Irrelevant in Top N ratio: {metrics['irrelevant_top_n_ratio']}")
    print(f"Explanation coverage: {metrics['explanation_coverage']}")
    print(
        "Top result profile signal vs heat: "
        f"{metrics['top_result_personal_signal']} vs {metrics['top_result_heat_signal']}"
    )
    print("Top results:")
    for item in metrics["top_results"]:
        print(
            f"  #{item['rank']} {item['paper_id']} "
            f"[{item['label']}] score={item['score_total']} type={item['recommendation_type']}"
        )


def main() -> None:
    default_dataset = Path(__file__).with_name("bamboo_periodate_diamine_hotpress.json")
    parser = argparse.ArgumentParser(description="Evaluate Research Radar recommendations.")
    parser.add_argument("--dataset", type=Path, default=default_dataset)
    parser.add_argument("--top-n", type=int, default=10)
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON.")
    args = parser.parse_args()

    metrics = evaluate(load_dataset(args.dataset), args.top_n)
    if args.json:
        print(json.dumps(metrics, ensure_ascii=False, indent=2))
    else:
        print_report(metrics)


if __name__ == "__main__":
    main()
