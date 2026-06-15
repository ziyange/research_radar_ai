# RR-DEV-006 Phase 1 发布前总验收报告

日期：2026-06-15

## 结论

Phase 1 MVP 已整理为可重复验收、可交付、可部署的状态。默认验收路径不需要 secrets，不接真实 OpenAI Key，不接真实邮件服务，不访问 live OpenAlex/Crossref，不依赖本机 PostgreSQL。

默认发布前检查由 GitHub Actions 和本地脚本共同覆盖：

```powershell
python -m pytest
ruff check
npm run lint:web
npx tsc --noEmit --project apps/web/tsconfig.json
npm run build
python services/api/evals/recommendation_eval.py --top-n 10
python services/api/evals/ai_safety_eval.py
```

## CI 与本地验收

- CI 文件：`.github/workflows/ci.yml`
- Windows 本地脚本：`scripts/check_phase1.ps1`
- Linux/macOS 本地脚本：`scripts/check_phase1.sh`

2026-06-15 本地验收结果：

- `python -m pytest`：14 passed, 2 skipped；跳过项为 live retrieval 和 PostgreSQL opt-in。
- `ruff check`：passed。
- `npm run lint:web`：passed。
- `npx tsc --noEmit --project apps/web/tsconfig.json`：passed。
- `npm run build`：passed。
- `python services/api/evals/recommendation_eval.py --top-n 10`：Top 10 hit rate 0.9、irrelevant ratio 0.0、explanation coverage 1.0。
- `python services/api/evals/ai_safety_eval.py`：hallucinated DOI 0、fact/inference confusion 0、missing fact level 0。

CI 默认环境变量：

- `AI_PROVIDER=mock`
- `RETRIEVAL_PROVIDER=mock`
- `DATABASE_URL=sqlite+memory://ci`
- `RUN_LIVE_RETRIEVAL_TESTS=0`
- `RUN_POSTGRES_TESTS=0`

显式 opt-in 验收：

- PostgreSQL/pgvector：设置 `DATABASE_URL` 和 `RUN_POSTGRES_TESTS=1` 后运行 `services/api/tests/test_postgres_persistence.py`。
- live OpenAlex/Crossref：设置 `RUN_LIVE_RETRIEVAL_TESTS=1` 后运行 `services/api/tests/test_live_retrieval.py`。

## Phase 1 范围边界

已完成或 mock 完成：

- 研究画像、检索规划、开放来源检索、排重、推荐、反馈纠偏、AI 分析、知识库、日报/周报、站内消息、mock email、成本额度、审计和任务状态闭环。

仍属于 Phase 2 或未来能力：

- 全文 PDF 章节/表格/图证据定位。
- 真实邮件服务和生产投递。
- 真实 OpenAI Key 的生产接入。
- Semantic Scholar/arXiv 扩展。
- Zotero、浏览器扩展、桌面端、移动端。
- 课题组/机构版、私有部署、复杂知识图谱。

## RR-MVP 验收矩阵

| 需求 | 状态 | Phase 1 证据 | 边界说明 |
| --- | --- | --- | --- |
| RR-MVP-001 | 完成 | 注册、登录、退出、当前用户 API；`test_mvp_flow.py` 与审计日志覆盖。 | 开发态 session token，不是生产认证系统。 |
| RR-MVP-002 | 完成 | 项目创建、编辑、归档 API；项目权限检查。 | 团队协作不在 Phase 1。 |
| RR-MVP-003 | mock 完成 | 一句话生成结构化画像；生成成本记录。 | 使用规则/mock 画像生成，不接真实 LLM。 |
| RR-MVP-004 | mock 完成 | `POST /projects/{id}/uploads` 支持 `foundation_paper` 并创建解析任务。 | 仅记录上传与队列，不做全文解析。 |
| RR-MVP-005 | mock 完成 | 上传 `research_material` 进入解析队列。 | 解析流水线是队列占位，全文处理进入 Phase 2。 |
| RR-MVP-006 | mock 完成 | 画像包含对象、方法、材料、指标、关键词、排除项。 | 画像准确性需种子用户试点。 |
| RR-MVP-007 | 完成 | 画像 patch、版本、确认与 supersede 流程。 | 复杂差异对比 UI 未做。 |
| RR-MVP-008 | mock 完成 | 首日诊断返回关键词、3 篇高相关、2 篇方法迁移和研究空白候选。 | 研究空白仍为低置信度候选。 |
| RR-MVP-009 | 完成 | 精确、扩展、方法迁移检索任务生成。 | citation/exploratory 仅保留模型字段。 |
| RR-MVP-010 | 完成 | OpenAlex 与 Crossref 适配器；默认 mock/降级；live smoke opt-in。 | Semantic Scholar/arXiv 未进入本次交付。 |
| RR-MVP-011 | mock 完成 | 检索任务可运行、记录状态、失败降级、可重试。 | 真正定时调度器未接入，Phase 1 以可运行任务验收。 |
| RR-MVP-012 | 完成 | `year_from`、open access 等 filter 进入检索任务和适配器。 | 更多高级过滤待后续扩展。 |
| RR-MVP-013 | 完成 | `NormalizedRecord` 标准化并写入 `SourceRecord`/`Paper`。 | 来源原始字段保留在 raw payload。 |
| RR-MVP-014 | 完成 | DOI、标题/作者年份、来源合并排重路径。 | 语义相似为轻量实现，需人工抽检。 |
| RR-MVP-015 | 完成 | `fulltext_status`、open access 标记、来源版本信息。 | 不自动下载全文。 |
| RR-MVP-016 | 需人工试点 | 推荐排序脚本与 `recommendation_eval.py --top-n 10`。 | 当前只有 1 个种子方向，最终准确率需 5-10 个方向人工标注。 |
| RR-MVP-017 | 完成 | 推荐解释包含 topic、method、score_basis、type、uncertainty。 | 解释质量需人工抽检继续校准。 |
| RR-MVP-018 | 完成 | 用户反馈保存并影响 refresh 后排序。 | 长期偏好学习为轻量规则。 |
| RR-MVP-019 | mock 完成 | radar settings API 与前端控制台入口。 | 控制台是 MVP 调参入口，非完整运营后台。 |
| RR-MVP-020 | mock 完成 | 快速 AI 分析结构、事实分级、成本记录。 | 使用 mock AI；真实模型需单独验收。 |
| RR-MVP-021 | mock 完成 | 标准研读结构、任务状态、额度扣减。 | 不做全文深读。 |
| RR-MVP-022 | mock 完成 | 五类事实分级与 schema 校验。 | 人工样本复核仍需试点。 |
| RR-MVP-023 | 完成 | 收藏、已读、稍后阅读、不相关状态。 | 批量操作未做。 |
| RR-MVP-024 | 完成 | 标签、备注、项目分类基础字段与更新 API。 | 高级标签体系未做。 |
| RR-MVP-025 | 完成 | 知识库按标题、标签、备注搜索。 | 作者搜索可由扩展字段补强。 |
| RR-MVP-026 | 完成 | 日报生成，包含新论文、排重、高相关、建议深读。 | 自动定时发送未接调度器。 |
| RR-MVP-027 | 完成 | 周报生成，包含高价值论文、趋势、知识库增长、下周建议。 | 需要种子用户周周期试点。 |
| RR-MVP-028 | mock 完成 | mock email outbox、失败状态、退订/订阅。 | 不接真实 SMTP 或第三方邮件。 |
| RR-MVP-029 | 完成 | 站内消息列表与标记已读。 | 推送实时提醒未做。 |
| RR-MVP-030 | 完成 | AI 和画像生成成本记录，含 token、模型、功能、任务归属。 | 真实模型价格表未接入。 |
| RR-MVP-031 | 完成 | 标准研读额度扣减，额度不足返回 `QUOTA_EXHAUSTED` 和 waiting task。 | 研点商业规则仍需产品确认。 |
| RR-MVP-032 | 完成 | `/api/v1/admin/costs` 可查询成本记录。 | 聚合报表 UI 未做。 |
| RR-MVP-033 | 完成 | 关键操作写审计日志，不保存密钥、学校账号或长期 Cookie。 | 需发布前抽查日志样本。 |
| RR-MVP-034 | 完成 | 任务状态、降级、错误码、retry 接口。 | 后台 worker/队列未接入。 |
| RR-MVP-035 | mock 完成 | `ai_safety_eval.py` 校验虚构 DOI、事实/推测混淆、事实分级缺失。 | 真实模型上线前必须重新跑安全评测与人工抽检。 |

## 发布阻断项检查

- 虚构 DOI：默认 mock 安全评测要求为 0。
- 推荐解释：Top N 解释覆盖由推荐评测脚本检查。
- 用户反馈写回：E2E 流程覆盖 feedback 后 ranking 变化。
- 成本记录：AI 分析和画像生成写入 cost records。
- 上传权限：上传记录按项目 owner 校验读取。
- 敏感凭证：默认 `.env.example` 不包含真实密钥，CI 不需要 secrets。
- 数据源合规：默认 CI 不访问 live 数据源；live 测试需显式 opt-in。

## 新机器命令链

Windows PowerShell：

```powershell
git clone git@github.com:ziyange/research_radar_ai.git
Set-Location research_radar_ai
uv python install 3.12 --install-dir .python --cache-dir .uv-cache
uv venv .venv --python '.python\cpython-3.12.11-windows-x86_64-none\python.exe' --cache-dir .uv-cache
uv sync --cache-dir .uv-cache
npm install
Copy-Item .env.example .env
.\.venv\Scripts\Activate.ps1
.\scripts\check_phase1.ps1
```

启动服务：

```powershell
$env:AI_PROVIDER="mock"
$env:RETRIEVAL_PROVIDER="mock"
$env:DATABASE_URL="sqlite+memory://dev"
uv run uvicorn research_radar_api.main:app --reload --host 127.0.0.1 --port 8010 --app-dir services/api/src
```

另开终端：

```powershell
npm run dev:web
```

访问：

- API: `http://127.0.0.1:8010/api/v1/health`
- Web: `http://localhost:3000`
