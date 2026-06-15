# RR-DEV-003 真实开放数据源稳定性与推荐准确评测

日期：2026-06-15

## 完成内容

- OpenAlex 和 Crossref live 适配器增加每来源超时、轻量限流和一次 429/5xx 重试。
- 检索运行增加每来源状态记录：`source`、`status`、`error_code`、`error_message`、`fallback_reason`、`record_count`。
- 单一来源失败时使用该来源本地开放元数据降级记录，不影响其他可用来源入库和推荐生成。
- 推荐解释新增 `score_basis`、`recommendation_type`、`uncertainty`，并与推荐器实际评分构成一致。
- 新增脱木质素竹材方向标注评测集：`services/api/evals/bamboo_periodate_diamine_hotpress.json`。
- 新增推荐评测脚本：`services/api/evals/recommendation_eval.py`。
- PostgreSQL 持久化路径保持原有 `RUN_POSTGRES_TESTS=1` 验证方式。

## 评测集

方向：脱木质素竹材 / 高碘酸钠氧化 / 二胺改性 / 热压。

标签格式：

- `high_relevance`：高相关。
- `method_useful`：方法可借鉴。
- `background_citation`：背景引用。
- `irrelevant`：无关/低相关。

当前数据量：32 篇，四类标签各 8 篇。该数据集用于 Phase 1 推荐准确性验收的第一条种子方向，不代表最终人工验收完成。

## 评测脚本

运行：

```powershell
python services/api/evals/recommendation_eval.py --top-n 10
python services/api/evals/recommendation_eval.py --top-n 10 --json
```

输出指标：

- Top N 命中率：Top N 中 `high_relevance` 或 `method_useful` 占比。
- 无关论文进入 Top N 比例。
- 解释覆盖率：Top N 推荐是否包含评分依据、推荐类型和不确定性。
- Top 结果个人画像信号与全局热度信号对比。

## Live 检索测试

默认测试不访问网络。live smoke 测试仅在显式设置环境变量后运行：

```powershell
$env:RUN_LIVE_RETRIEVAL_TESTS="1"
pytest services/api/tests/test_live_retrieval.py
```

无网络或开放 API 不可用时，测试会 `skip` 并说明具体来源，不会伪装通过。

## 降级记录

`POST /api/v1/search-tasks/{task_id}:run` 返回的 `TaskStatus` 现在包含：

- `degraded`
- `error_code`
- `source_statuses`

示例来源状态：

```json
{
  "source": "openalex",
  "status": "degraded",
  "record_count": 1,
  "error_code": "timeout",
  "fallback_reason": "openalex live retrieval failed; used local open metadata fallback."
}
```

这样可追踪到具体失败来源：OpenAlex 或 Crossref。
