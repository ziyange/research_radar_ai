import argparse
import asyncio
import json
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[3]
SRC = ROOT / "services" / "api" / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from research_radar_api.ai import AiProvider, validate_analysis_safety  # noqa: E402
from research_radar_api.schemas import AnalysisClaim, Paper  # noqa: E402
from research_radar_api.settings import Settings  # noqa: E402
from research_radar_api.store import InMemoryStore  # noqa: E402


def load_dataset(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


async def evaluate(dataset: dict[str, Any]) -> dict[str, Any]:
    store = InMemoryStore(database_url="sqlite+memory://ai-safety-eval", seed_on_empty=True)
    provider = AiProvider(Settings(ai_provider="mock", retrieval_provider="mock"))
    totals = {
        "dataset_id": dataset["dataset_id"],
        "case_count": len(dataset["cases"]),
        "hallucinated_doi_count": 0,
        "fact_inference_confusion_count": 0,
        "missing_fact_level_count": 0,
        "cases": [],
    }
    for case in dataset["cases"]:
        if case["paper_id"] not in store.papers:
            store.papers[case["paper_id"]] = Paper(
                id=case["paper_id"],
                title=case.get("title") or "AI safety evaluation fixture paper",
                title_zh=case.get("title_zh") or "AI 安全评测夹具论文",
                year=case.get("year") or 2026,
                journal=case.get("journal") or "Evaluation Fixture",
                doi=case.get("doi") or "",
                authors=case.get("authors") or ["Evaluation Fixture"],
                abstract=case.get("abstract") or "This fixture is used only for AI safety evaluation.",
                keywords=case.get("keywords") or ["ai safety", "evaluation"],
                fulltext_status="open_access",
            )
        paper = store.papers[case["paper_id"]]
        raw = await provider.analyze_paper(
            paper=paper,
            profile=None,
            analysis_type=case["analysis_type"],
            input_scope=case["input_scope"],
        )
        claims = [AnalysisClaim.model_validate(item) for item in raw["claims"]]
        safety = validate_analysis_safety(raw["result"], claims, paper)
        missing_expected = sorted(set(case["expected_fact_levels"]) - {item.fact_level for item in claims})
        totals["hallucinated_doi_count"] += safety["hallucinated_doi_count"]
        totals["fact_inference_confusion_count"] += safety["fact_inference_confusion_count"]
        totals["missing_fact_level_count"] += len(missing_expected)
        totals["cases"].append(
            {
                "case_id": case["case_id"],
                "hallucinated_doi_count": safety["hallucinated_doi_count"],
                "fact_inference_confusion_count": safety["fact_inference_confusion_count"],
                "missing_fact_levels": missing_expected,
            }
        )
    return totals


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--dataset",
        type=Path,
        default=Path(__file__).with_name("ai_safety_cases.json"),
    )
    args = parser.parse_args()
    metrics = asyncio.run(evaluate(load_dataset(args.dataset)))
    print(json.dumps(metrics, ensure_ascii=False, indent=2))
    return int(
        metrics["hallucinated_doi_count"] > 0
        or metrics["fact_inference_confusion_count"] > 0
        or metrics["missing_fact_level_count"] > 0
    )


if __name__ == "__main__":
    raise SystemExit(main())
