import importlib.util
from pathlib import Path


EVAL_SCRIPT = Path("services/api/evals/recommendation_eval.py").resolve()
DATASET = Path("services/api/evals/bamboo_periodate_diamine_hotpress.json").resolve()


def load_eval_module():
    spec = importlib.util.spec_from_file_location("recommendation_eval", EVAL_SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_recommendation_eval_metrics_are_readable_and_profile_weighted():
    module = load_eval_module()
    dataset = module.load_dataset(DATASET)
    metrics = module.evaluate(dataset, top_n=10)

    assert metrics["dataset_id"] == "bamboo_periodate_diamine_hotpress_v1"
    assert metrics["candidate_count"] == 32
    assert metrics["top_n_hit_rate"] >= 0.8
    assert metrics["irrelevant_top_n_ratio"] == 0
    assert metrics["explanation_coverage"] == 1
    assert metrics["top_result_profile_dominates_heat"] is True
    assert metrics["top_results"][0]["label"] in {"high_relevance", "method_useful"}
