# RR-DEV-008 阶段差距审计

日期：2026-06-16  
状态：Phase 1 修复与真实 AI 接入边界审计  
基线文档：`docs/01-product-requirements.md`、`docs/02-mvp-scope.md`、`docs/06-api-contracts.md`、`docs/07-ai-and-retrieval.md`、`docs/08-acceptance-and-tests.md`

## 1. 审计结论

RR-DEV-008 后，Phase 1 工作台仍以“推荐准确闭环”为 MVP 主目标。前端页面、FastAPI 接口、数据库持久化、OpenAlex/Crossref 检索适配、推荐、反馈、AI 研读、知识库、日报/周报和站内消息已经能形成本地闭环。

但 Phase 1 仍不是完整产品落地版本。真实邮件投递、定时调度器、全文解析、Semantic Scholar/arXiv、生产认证、后台成本 UI、人工标注评测扩展、中文数据库和机构权限能力仍未实现。

## 2. 页面功能差距

| 页面/模块 | 当前状态 | 对应需求 | 说明 |
| --- | --- | --- | --- |
| 研究工作台与项目抽屉 | 已实现 | RR-MVP-002 | 项目列表在“研究工作台”下作为二级目录，新增项目只保留 `+` 入口。 |
| 空项目状态 | 已实现 | RR-MVP-002 | 无项目时显示空态并提示添加项目，不展示伪数据。 |
| 一句话画像弹窗 | 已实现 | RR-MVP-003 | 默认空值，placeholder 不写入业务数据。 |
| 画像编辑与确认 | 已实现 | RR-MVP-003, RR-MVP-006 | 在弹窗内保存、确认并生成诊断。 |
| 推荐列表与反馈 | 已实现 | RR-MVP-015, RR-MVP-018 | 支持推荐展示、反馈写回、刷新推荐。 |
| 检索数据源面板 | 已实现 | RR-MVP-010, RR-MVP-011, RR-MVP-012 | 展示 retrieval provider、任务状态、source statuses、SourceRecord 和 Paper 关联。 |
| AI 快速分析/标准研读 | 部分实现 | RR-MVP-020, RR-MVP-021 | 支持 mock 与 OpenAI-compatible 真实调用；全文证据定位未实现。 |
| 知识库基础沉淀 | 部分实现 | RR-MVP-023, RR-MVP-024 | 可加入知识库和搜索；高级笔记、标签体系、知识图谱未实现。 |
| 日报/周报/消息 | 部分实现 | RR-MVP-028, RR-MVP-029 | 可生成报告和站内消息；真实邮件投递与定时调度未实现。 |
| 成本额度入口 | 部分实现 | RR-MVP-033 | 成本记录已入库；后台成本分析 UI 未实现。 |
| 上传基石论文 | 后端占位 | RR-MVP-004 | API 有上传队列记录；前端未形成完整上传研读流程。 |
| 生产登录/权限 | 未实现 | RR-MVP-001 | 目前仅开发用户 header；生产认证需要后续阶段实现。 |

## 3. 后端真实通信与 mock 边界

| 后端能力 | 当前状态 | 数据来源/边界 |
| --- | --- | --- |
| 用户、项目、画像、任务、论文、推荐、反馈、知识库、报告、消息、成本 | 真实 API + 可持久化 | 通过 FastAPI 暴露，PostgreSQL/JSONB 或内存开发库保存。 |
| PostgreSQL 持久化 | 部分真实 | `DATABASE_URL=postgresql+psycopg://...` 时持久化；本机无 pgvector 时不阻断 JSONB。 |
| OpenAlex/Crossref 检索 | 真实适配 | `RETRIEVAL_PROVIDER=live` 时调用外部开放 API；单源失败只降级该来源。 |
| mock 检索 | 开发可选 | `RETRIEVAL_PROVIDER=mock` 时生成 deterministic open metadata，不作为生产数据。 |
| demo seed | 开发可选 | `DEMO_SEED_ENABLED=true` 才初始化 demo 用户/论文；真实业务默认 false。 |
| 非 mock 推荐无数据处理 | 已修复 | live 检索没有 SourceRecord 时返回空推荐，不从 seed/fallback 造论文。 |
| AI 画像生成 | mock 或真实 | `AI_PROVIDER=openai` 时走 OpenAI-compatible `/chat/completions`；缺配置返回 `AI_PROVIDER_CONFIG_MISSING`。 |
| AI 快速/标准研读 | mock 或真实 | 真实 AI 输出必须是结构化 JSON，并校验 `PaperAnalysis` / `AnalysisClaim`。 |
| 首日诊断 | rule-based | 仍基于画像和推荐规则生成，不是独立真实 AI Agent。 |
| 日报/周报内容 | rule-based | 由当前推荐、反馈、知识库状态生成，不是 LLM 长报告。 |
| Email outbox | mock/dev | 只记录邮件 outbox，不接入 SMTP/API 真实投递。 |
| 定时调度器 | 未实现 | 需要后续引入 Celery/RQ 或调度服务。 |
| 全文解析与证据定位 | 未实现 | 目前只支持元数据/摘要级分析。 |

## 4. AI 板块状态

| AI 能力 | 当前状态 | 验收边界 |
| --- | --- | --- |
| 一句话画像 | 真实 OpenAI-compatible 可用 | 输出 JSON 校验为 `ResearchProfile`，失败不写正式数据。 |
| AI 快速分析 | 真实 OpenAI-compatible 可用 | 输出 JSON 校验为 `PaperAnalysis` + `AnalysisClaim`。 |
| 标准研读 | 真实 OpenAI-compatible 可用，但输入仍是摘要级 | 记录成本与额度；全文证据定位留待后续。 |
| 事实分级 | 已实现 | claim 必须区分 `source_explicit`、`ai_summary`、`cross_paper_comparison`、`ai_inference`、`research_inspiration`。 |
| DOI 幻觉检查 | 已实现 | 虚构 DOI 或 source_explicit 不可追溯时拒写分析。 |
| 受控 Agent | 未实现 | 属于 `RR-FUTURE-010`，产品成熟后再进入受控工作流。 |

## 5. 数据源板块状态

| 数据源 | 当前状态 | 说明 |
| --- | --- | --- |
| OpenAlex | 已接入 | 支持 live 检索、状态追踪、SourceRecord 入库。 |
| Crossref | 已接入 | 支持 live 检索、状态追踪、SourceRecord 入库。 |
| Semantic Scholar | 未接入 | 文档列为 MVP 默认候选，但当前 Phase 1 尚未实现。 |
| arXiv | 未接入 | 文档列为 MVP 默认候选，但当前 Phase 1 尚未实现。 |
| 中文数据库 | future | 对应 `RR-FUTURE-003`，仅能通过官方 API、授权、用户导出或合规合作接入。 |
| 自定义来源 | future | 对应 `RR-FUTURE-004`，需要来源合规与抓取策略审批。 |

## 6. 当前阶段仍未完成项

1. 真实邮件投递和邮件失败重试。
2. 日报/周报定时调度器。
3. 全文 PDF 解析、章节/图表/引用证据定位。
4. Semantic Scholar 与 arXiv 适配器。
5. 生产认证、权限、审计和多用户隔离。
6. 后台成本统计 UI 与额度运营策略。
7. 人工标注推荐评测集扩展。
8. 移动端、团队协作、机构版和中文数据库能力。

## 7. RR-DEV-008 验收重点

- 页面加载无 hydration warning、React error 或 Next overlay。
- 前端不再内置项目名、研究句子、推荐论文或知识库查询默认业务值。
- `AI_PROVIDER=openai` 缺 key/base/model 时稳定返回 `AI_PROVIDER_CONFIG_MISSING`。
- OpenAI-compatible mock httpx 响应可写入结构化画像、研读、claim 和成本记录。
- `DEMO_SEED_ENABLED=false` 时不初始化 demo 数据；live 检索无 SourceRecord 时推荐为空。
- 工作台“检索数据源”面板展示真实 task status、source statuses、SourceRecord 和 paper 关联。
