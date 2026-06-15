# RR-DEV-004 AI 安全、成本额度与任务降级验收报告

日期：2026-06-15

## 完成范围

- 覆盖 `RR-MVP-020` 至 `RR-MVP-022`：快速分析与标准研读均输出结构化 `PaperAnalysis`，关键结论覆盖 `source_explicit`、`ai_summary`、`cross_paper_comparison`、`ai_inference`、`research_inspiration` 五类事实分级。
- 覆盖 `RR-MVP-030` 至 `RR-MVP-032`：`CostRecord` 可按用户、项目、论文、任务、模型、功能归属；快速分析与标准研读均写入 `/api/v1/me/costs`；标准研读扣减额度。
- 覆盖 `RR-MVP-031`：额度不足时高成本标准研读不执行，返回稳定错误码 `QUOTA_EXHAUSTED`，并生成 `waiting` 状态任务。
- 覆盖 `RR-MVP-034`：分析任务与失败/等待任务可通过 `/api/v1/tasks/{task_id}` 追踪，保留 `error_code`、`retryable`、`retry_count`、用户可见 `message`。
- 覆盖 `RR-MVP-035`：新增 AI 安全评测脚本，校验虚构 DOI 数为 0、事实/推测混淆数为 0。

## 新增与修改

- 修改 `services/api/src/research_radar_api/ai.py`：增强 mock provider 的事实分级输出，新增 DOI 与事实分级安全校验。
- 修改 `services/api/src/research_radar_api/main.py`：补充分析任务状态、额度拦截、成本记录、AI 安全失败处理和稳定错误响应。
- 修改 `services/api/src/research_radar_api/store.py`、`schemas.py`：补充成本归属字段、任务等待状态、额度扣减。
- 新增 `services/api/evals/ai_safety_cases.json`。
- 新增 `services/api/evals/ai_safety_eval.py`。
- 新增 `services/api/tests/test_ai_safety_costs.py`。

## Phase 2 边界

- 未实现全文深读、图表识别、PDF 全文证据定位。
- 未接入真实 OpenAI Key；OpenAI provider 保持可配置兼容，验收使用 mock provider。
- 未保存任何 API Key、学校账号或长期 Cookie。

## 补充任务：绑定远程仓库

按任务要求，本地项目需要绑定到远程仓库：

```bash
git remote add origin git@github.com:ziyange/research_radar_ai.git
git branch -M main
git push -u origin main
```

执行结果将以最终上传结果为准；若本地尚未初始化 Git 仓库，需先执行 `git init` 并创建提交。
