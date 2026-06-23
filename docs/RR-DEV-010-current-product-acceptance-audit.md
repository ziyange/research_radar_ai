# RR-DEV-010 当前产品完成度与验收审计

日期：2026-06-23  
状态：当前阶段验收基线  
适用范围：对照 `docs/` 文档体系、当前代码实现和测试证据，判断研知雷达当前完成了什么、完成质量如何、还缺什么、哪些功能尚未开始。

## 1. 审计结论

当前项目已经完成“Phase 1 本地 MVP 闭环”的主体工程：项目、画像、检索、排重、推荐、反馈、AI 研读、知识库、日报/周报、站内消息、成本、审计和任务状态已有可运行代码与自动化测试。

但当前项目还不能定义为“产品落地版”。原因是：

1. 生产认证、真实调度、真实邮件、全文解析、生产部署和真实用户评测仍未完成。
2. 推荐准确性仍主要由一个种子方向和脚本指标支撑，尚未扩展到多个真实研究方向和人工标注集。
3. `RR-DEV-009` 工作台信息架构大改已经写入工作区，但截至本审计文档落地时，仍处于“开发完成待浏览器验收/待提交”状态。
4. AI 能力支持 OpenAI-compatible 真实调用，但标准研读仍是摘要/元数据级，不是全文证据级研读。

## 2. 评分规则

| 分数 | 定义 |
| --- | --- |
| 9-10 | 文档、代码、测试、浏览器或实机验收齐全，可作为稳定交付基线。 |
| 7-8 | 主流程可用，自动化测试覆盖核心路径，但仍存在产品化、体验或真实数据不足。 |
| 5-6 | 有可运行雏形或后端能力，但功能不完整、体验弱、测试或真实验收不足。 |
| 3-4 | 只有占位、mock、接口骨架或局部实现，尚不能作为用户可用功能。 |
| 0-2 | 尚未开始，或只在文档中规划。 |

状态定义：

- `已完成`：代码、文档、测试证据基本齐全。
- `基本完成`：主链路完成，但还缺生产化、真实数据或体验验收。
- `部分完成`：有核心代码，但缺关键流程、前端承载、真实验证或完整测试。
- `占位`：接口或数据结构存在，但还不能解决用户真实场景。
- `未开始`：尚无可用实现。
- `待验收`：代码已写入工作区，但还未完成浏览器验收、提交或推送。

## 3. 当前工作区状态

当前有未提交改动，主要属于 `RR-DEV-009` 工作台体验大改：

| 类别 | 文件 | 状态 |
| --- | --- | --- |
| 前端工作台 | `apps/web/components/workbench/*` | 新增，待浏览器验收和提交 |
| 前端入口 | `apps/web/components/phase-one-workbench.tsx` | 已改为薄 re-export，待提交 |
| 前端样式 | `apps/web/app/globals.css` | 已补详情抽屉、chip 编辑器、二级页样式，待提交 |
| 二级页面 | `apps/web/app/knowledge/page.tsx`、`apps/web/app/reports/page.tsx` | 新增，待浏览器验收和提交 |
| API client | `apps/web/lib/api.ts` | 补齐详情接口方法，待提交 |
| 后端接口 | `services/api/src/research_radar_api/main.py` | 补 `GET /knowledge/{item_id}`、`GET /messages/{message_id}`，清理任务详情路由重复，待提交 |
| 后端测试 | `services/api/tests/test_workbench_details.py` | 新增详情接口测试，待提交 |
| 文档 | `docs/RR-DEV-009-workbench-agent-ux-plan.md` | 新增，已纳入文档索引但待提交 |

因此，本审计把 `RR-DEV-009` 相关能力标记为“待验收”，不计为已发布完成。

## 4. 总体评分

| 维度 | 分数 | 判断 |
| --- | ---: | --- |
| 文档基线 | 9.0/10 | PRD、MVP 范围、流程、架构、数据模型、API、AI 检索、验收、路线图、未来能力均已建立。 |
| 后端 MVP 闭环 | 7.5/10 | FastAPI 主链路和测试较完整；但生产认证、调度器、真实邮件、全文解析仍缺。 |
| 前端工作台 | 6.5/10 | RR-DEV-009 后结构显著改善，但当前仍待浏览器验收和提交。 |
| AI 能力 | 6.0/10 | 支持 mock 与 OpenAI-compatible；但全文证据、真实模型人工验收、受控 Agent 未完成。 |
| 检索与推荐 | 6.5/10 | OpenAlex/Crossref 已接，推荐评分可跑；Semantic Scholar/arXiv、人工评测集和真实用户验证不足。 |
| 知识库与报告 | 6.5/10 | 收藏、标签、备注、搜索、日报、周报、消息已具备；但深度知识组织、真实推送、历史运营视图不足。 |
| 产品落地度 | 5.0/10 | 适合本地试点和内部验收，不适合直接面向真实用户上线。 |

## 5. 模块级验收审计

### 5.1 文档与需求基线

评分：9.0/10  
状态：已完成

| 项目 | 证据 |
| --- | --- |
| 产品需求 | `docs/01-product-requirements.md` 定义 `RR-MVP-001` 至 `RR-MVP-035`。 |
| MVP 范围 | `docs/02-mvp-scope.md` 明确 Phase 1 以推荐闭环为第一目标。 |
| 用户流程 | `docs/03-user-flows.md` 覆盖冷启动、推荐、研读、知识库、推送。 |
| 架构 | `docs/04-architecture.md` 定义 Next.js、FastAPI、PostgreSQL、Redis、对象存储、任务系统边界。 |
| 数据模型 | `docs/05-data-model.md` 定义 User、ResearchProject、ResearchProfile、Paper、Recommendation 等实体。 |
| API 合约 | `docs/06-api-contracts.md` 定义认证、项目、画像、检索、推荐、AI、知识库、报告、成本接口。 |
| AI 与检索 | `docs/07-ai-and-retrieval.md` 定义画像生成、检索任务、排重、推荐评分、事实分级。 |
| 验收测试 | `docs/08-acceptance-and-tests.md` 定义 E2E、AI 评测、成本、合规验收。 |
| 路线图 | `docs/09-roadmap.md` 定义 Phase 0 至 Phase 6。 |
| 未来能力 | `docs/11-future-capability-backlog.md` 防止微信、飞书、钉钉、月报、中文数据库、自定义来源等长期能力丢失。 |

不足：

- `docs/08-acceptance-and-tests.md` 中推荐质量阈值仍未最终补具体数值，文档明确“补充前不得声称推荐系统完成最终验收”。
- Phase 1 后续验收报告较多，需要本文件作为“当前状态总览”统一承接。

下一步验收要求：

- 每次阶段开发结束后，新增阶段报告并更新本文件或其后续版本。
- 推荐评测阈值需要在扩展人工标注集后回写 `docs/08-acceptance-and-tests.md`。

### 5.2 用户账号与权限

对应需求：`RR-MVP-001`  
评分：5.5/10  
状态：部分完成

| 维度 | 当前实现 |
| --- | --- |
| 文档依据 | `docs/01-product-requirements.md` 要求注册、登录、退出、当前用户会话。 |
| 后端代码 | `services/api/src/research_radar_api/main.py` 中 `POST /api/v1/auth/register`、`POST /api/v1/auth/login`、`POST /api/v1/auth/logout`、`GET /api/v1/me`。 |
| 前端代码 | `apps/web/lib/api.ts` 有 `me()`，工作台通过 `NEXT_PUBLIC_DEV_USER_ID` 开发态免登录。 |
| 测试证据 | `services/api/tests/test_mvp_flow.py` 覆盖 health 与主流程；报告中记录了 RR-MVP-001 完成开发态 API。 |

不足：

- 生产登录系统未完成，没有验证码、密码安全策略、session/cookie 管理、刷新 token、退出后的真实会话失效。
- 多用户隔离依赖开发态 `x-user-id`，不适合生产。
- 没有前端登录页和权限错误页。

下一步验收要求：

- 增加生产认证方案文档。
- 实现正式登录页、后端认证中间件、用户 session。
- 增加多用户隔离测试：用户 A 不能访问用户 B 的项目、知识库、报告、成本。

### 5.3 研究项目

对应需求：`RR-MVP-002`  
评分：7.5/10  
状态：基本完成

| 维度 | 当前实现 |
| --- | --- |
| 文档依据 | `docs/01-product-requirements.md`、`docs/02-mvp-scope.md` 要求项目创建、查看、编辑、归档。 |
| 后端代码 | `main.py` 中 `GET/POST /projects`、`GET/PATCH /projects/{project_id}`、`POST /projects/{project_id}:archive`。 |
| 前端代码 | `apps/web/components/workbench/phase-one-workbench.tsx` 左侧“研究工作台”抽屉和 `+` 新增项目入口。 |
| 数据模型 | `ResearchProject` 位于 `services/api/src/research_radar_api/schemas.py`。 |

已完成：

- 项目创建、列表、切换、编辑和归档 API。
- 前端工作台一级导航下展开项目列表，新增入口唯一化。
- 无项目空态已设计为提示添加项目。

不足：

- 前端没有完整项目管理二级页，例如归档、编辑项目详情、项目统计。
- 没有团队共享项目、权限角色、项目成员。
- 项目删除策略未定义。

下一步验收要求：

- 增加项目管理页或项目详情抽屉。
- 补归档/恢复的前端入口和测试。

### 5.4 一句话冷启动与研究画像

对应需求：`RR-MVP-003`、`RR-MVP-006`、`RR-MVP-007`、`RR-MVP-008`  
评分：7.0/10  
状态：基本完成

| 维度 | 当前实现 |
| --- | --- |
| 文档依据 | `docs/07-ai-and-retrieval.md` 第 2 节定义画像生成结构化输出；`docs/03-user-flows.md` 定义冷启动流程。 |
| 后端代码 | `main.py` 中 `POST /projects/{project_id}/profile:generate`、`GET/PATCH /profile`、`POST /profile:confirm`、`GET /diagnosis`、`GET /profile/versions`。 |
| AI 代码 | `services/api/src/research_radar_api/ai.py` 中 `AiProvider.generate_profile()` 支持 mock 与 OpenAI-compatible。 |
| 前端代码 | RR-DEV-009 新增 `phase-one-workbench.tsx`、`workbench-panels.tsx`、`details-drawer.tsx`、`workbench-ui.tsx`，画像编辑使用 chip/tag。 |
| 测试证据 | `test_mvp_flow.py::test_cold_start_to_diagnosis_flow`；`test_openai_compatible_ai.py::test_openai_compatible_profile_generation_writes_structured_profile`。 |

已完成：

- 一句话生成画像草稿。
- 画像包含对象、方法、材料、指标、关键词、排除项。
- 画像可修改、确认、生成首日诊断。
- RR-DEV-009 已把画像编辑从文本框升级为结构化 chip/tag 编辑器。

不足：

- 基石论文、研究材料对画像增强仍不完整。
- 画像版本差异 UI 不完整。
- 首日诊断仍偏 rule-based，不是独立 AI Agent。
- RR-DEV-009 浏览器验收尚未完成。

下一步验收要求：

- 浏览器验收：创建项目 -> 生成画像 -> 编辑 chip -> 保存草稿 -> 确认画像 -> 打开诊断详情。
- 验证 `AI_PROVIDER=openai` 下画像 JSON schema 失败不写正式数据。

### 5.5 基石论文与研究材料上传

对应需求：`RR-MVP-004`、`RR-MVP-005`  
评分：3.5/10  
状态：占位

| 维度 | 当前实现 |
| --- | --- |
| 文档依据 | `docs/01-product-requirements.md` 要求上传 1 至 3 篇关键论文、研究材料，并增强画像。 |
| 后端代码 | `main.py` 中 `POST /projects/{project_id}/uploads`、`GET /projects/{project_id}/uploads`、`GET /uploads/{upload_id}`。 |
| 数据模型 | `UploadRecord` 位于 `schemas.py`。 |

已完成：

- 后端可接收上传请求并创建上传记录与任务状态。
- 上传记录能按项目读取。

不足：

- 前端没有完整上传流程。
- 没有 PDF/DOCX/TXT 解析。
- 上传内容没有真正进入画像生成、检索规划或论文实体。
- 没有文件存储、对象存储、病毒扫描、敏感内容扫描。

下一步验收要求：

- 实现前端上传入口和上传列表。
- 增加解析 worker 或至少 mock 解析结果。
- 验证上传材料能够影响 `ResearchProfile`。

### 5.6 检索规划、数据源、标准化与排重

对应需求：`RR-MVP-009` 至 `RR-MVP-015`  
评分：7.0/10  
状态：基本完成

| 维度 | 当前实现 |
| --- | --- |
| 文档依据 | `docs/07-ai-and-retrieval.md` 第 3-5 节定义检索任务、数据源、排重；`docs/02-mvp-scope.md` 要求至少接入 2 个开放数据源。 |
| 后端代码 | `main.py` 中 `POST /search-tasks:generate`、`POST /search-tasks/{task_id}:run`、`GET /source-records`、`GET /tasks/{task_id}`。 |
| 适配器 | `services/api/src/research_radar_api/retrieval/openalex.py`、`crossref.py`。 |
| 排重代码 | `services/api/src/research_radar_api/dedup.py`、`store.py::ingest_source_record()`。 |
| 前端代码 | `workbench-panels.tsx` 的 `SourcesPanel`、`details-drawer.tsx` 的来源记录详情。 |
| 测试证据 | `test_retrieval_stability.py`、`test_live_retrieval.py`、`test_mvp_flow.py`。 |

已完成：

- 生成精确、扩展、方法迁移检索任务。
- OpenAlex/Crossref live 适配器存在。
- mock 检索可生成 deterministic open metadata。
- SourceRecord、PaperVersion、Paper 能入库并关联。
- live 无 SourceRecord 时不从 seed/fallback 造推荐。
- 来源状态含 `source_statuses`、`degraded`、`error_code`。

不足：

- Semantic Scholar、arXiv 未接入。
- 定时检索调度器未接入。
- 检索过滤 UI 和复杂筛选条件不足。
- DOI、标题/作者排重是轻量实现，缺大规模真实数据评估。
- 全文可得性只标记状态，不做真实全文发现策略闭环。

下一步验收要求：

- 新增 Semantic Scholar 或 arXiv 至少一个适配器，或者明确 Phase 1 只验收 2 个数据源。
- 用 `RUN_LIVE_RETRIEVAL_TESTS=1` 做 live smoke。
- 扩展排重测试：同 DOI、无 DOI 标题相似、跨源字段缺失。

### 5.7 推荐评分、解释与反馈纠偏

对应需求：`RR-MVP-016`、`RR-MVP-017`、`RR-MVP-018`、`RR-MVP-019`  
评分：6.5/10  
状态：基本完成但需人工试点

| 维度 | 当前实现 |
| --- | --- |
| 文档依据 | `docs/07-ai-and-retrieval.md` 第 6-7 节要求个体相关度高于全局热度，反馈写回。 |
| 后端代码 | `services/api/src/research_radar_api/recommender.py`、`store.py::create_recommendations()`、`main.py` 推荐和反馈接口。 |
| 前端代码 | `RecommendationRadarPanel` 展示推荐、来源、AI 状态、知识库状态、反馈按钮。 |
| 测试证据 | `test_mvp_flow.py::test_e2e_002_daily_recommendation_feedback_changes_next_ranking`、`test_recommendation_eval.py`、`services/api/evals/recommendation_eval.py`。 |

已完成：

- 推荐分数含 topic、method、material、mechanism、novelty、quality、heat 等维度。
- 推荐解释含 `score_basis`、`recommendation_type`、`uncertainty`。
- 反馈会影响后续 refresh 后排序。
- 推荐评测脚本曾记录 Top N hit rate 0.9、irrelevant ratio 0.0、explanation coverage 1.0。

不足：

- 当前评测集过小，主要围绕一个竹材方向。
- 缺 5-10 个真实研究方向和人工标注论文集。
- `RR-MVP-019` 雷达纠偏控制台仍偏轻量 API，不是完整 UI。
- 推荐质量还不能对真实用户宣称最终达标。

下一步验收要求：

- 建立多方向推荐评测集。
- 明确 Top 10 相关率、无关率、解释通过率阈值并回写 `docs/08-acceptance-and-tests.md`。
- 增加前端纠偏控制台：更多/更少某类方法、材料、年份、全文状态。

### 5.8 AI 快速分析、标准研读与安全

对应需求：`RR-MVP-020`、`RR-MVP-021`、`RR-MVP-022`、`RR-MVP-035`  
评分：6.5/10  
状态：部分完成

| 维度 | 当前实现 |
| --- | --- |
| 文档依据 | `docs/07-ai-and-retrieval.md` 第 8 节要求事实分级；`docs/10-risk-compliance.md` 要求控制 AI 幻觉。 |
| 后端代码 | `main.py` 中 `POST /papers/{paper_id}/analysis`、`GET /analysis/{analysis_id}`、`GET /papers/{paper_id}/analysis`。 |
| AI 代码 | `services/api/src/research_radar_api/ai.py` 支持 mock 与 OpenAI-compatible `/chat/completions`。 |
| 安全代码 | `ai.py::validate_analysis_safety()`，输出 schema 和 DOI/事实分级校验。 |
| 前端代码 | `ReadingPanel`、`WorkbenchDetailDrawer` 的 AI 分析详情。 |
| 测试证据 | `test_ai_safety_costs.py`、`test_openai_compatible_ai.py`、`ai_safety_eval.py`。 |

已完成：

- 快速分析和标准研读 API。
- AI 输出必须包含 `result` 和 `claims`。
- claims 支持五类事实分级：原文事实、AI 归纳、多文献对比、AI 推测、研究启发。
- 真实 OpenAI-compatible 配置缺失时返回 `AI_PROVIDER_CONFIG_MISSING`。
- 非 JSON、缺字段、虚构 DOI、事实分级错误时拒写正式分析。
- 成本记录和额度扣减已接。

不足：

- 标准研读仍使用 metadata/abstract，不是全文。
- 没有章节、页码、图表、表格证据定位。
- 真实模型输出质量尚未人工抽检。
- 没有受控 Agent 工作流。

下一步验收要求：

- 用真实百炼配置跑 `RUN_LIVE_AI_TESTS=1` 类测试。
- 增加至少 20 条 AI 分析人工校验样本。
- Phase 2 实现全文解析后，再升级标准研读验收标准。

### 5.9 知识库

对应需求：`RR-MVP-023`、`RR-MVP-024`、`RR-MVP-025`  
评分：6.5/10  
状态：基本完成，体验待验收

| 维度 | 当前实现 |
| --- | --- |
| 文档依据 | `docs/02-mvp-scope.md` 要求收藏、阅读状态、标签、备注和搜索。 |
| 后端代码 | `main.py` 中 `GET/POST /projects/{project_id}/knowledge`、`PATCH /knowledge/{item_id}`、`GET /knowledge/{item_id}`、`GET /knowledge:search`。 |
| 前端代码 | `KnowledgePanel`、`KnowledgePageView`、`WorkbenchDetailDrawer` 知识库详情。 |
| 测试证据 | `test_mvp_flow.py`、`test_workbench_details.py`。 |

已完成：

- 可添加论文到知识库。
- 支持 `saved`、`read`、`read_later`、`irrelevant` 状态。
- 支持标签、备注、按项目搜索。
- RR-DEV-009 新增知识库详情抽屉和二级页面。

不足：

- 还没有高级标签体系、批量操作、引用导出、知识图谱。
- 知识库详情目前主要关联 paper_id，论文详情整合仍可加强。
- 二级页面仍待浏览器验收。

下一步验收要求：

- 浏览器验收：加入知识库 -> 打开详情 -> 修改状态/标签/备注 -> 保存 -> 二级页可读。
- 增加按状态、标签过滤。

### 5.10 日报、周报、消息与邮件

对应需求：`RR-MVP-026`、`RR-MVP-027`、`RR-MVP-028`、`RR-MVP-029`  
评分：6.0/10  
状态：部分完成

| 维度 | 当前实现 |
| --- | --- |
| 文档依据 | `docs/02-mvp-scope.md`、`docs/03-user-flows.md` 定义日报/周报/推送流程。 |
| 后端代码 | `services/api/src/research_radar_api/notifications.py`、`main.py` 报告和消息接口。 |
| 前端代码 | `ReportsPanel`、`ReportsPageView`、`WorkbenchDetailDrawer` 报告和消息详情。 |
| 测试证据 | `test_reports_notifications.py`、`test_workbench_details.py`。 |

已完成：

- 手动生成日报、周报。
- 日报包含新论文、排重、高相关、建议深读、方法启发。
- 周报包含高价值论文、趋势、知识库增长、反馈变化、下周建议。
- 生成站内消息。
- mock email outbox、失败状态、退订逻辑。

不足：

- 没有真实 SMTP/API 邮件服务。
- 没有定时调度器自动生成日报/周报。
- 没有微信、企业微信、飞书、钉钉、App 推送。
- 报告内容仍 rule-based，不是高质量 LLM 长报告。

下一步验收要求：

- 接入真实事务邮件或保持 mock 但明确 Phase 1 边界。
- 引入调度器后验证每日/每周自动触发。
- 浏览器验收：生成日报/周报 -> 点击报告详情 -> 点击消息详情 -> 标记已读。

### 5.11 成本、额度、审计与任务状态

对应需求：`RR-MVP-030` 至 `RR-MVP-034`  
评分：7.0/10  
状态：基本完成

| 维度 | 当前实现 |
| --- | --- |
| 文档依据 | `docs/04-architecture.md`、`docs/08-acceptance-and-tests.md` 定义成本和任务验收。 |
| 后端代码 | `store.py::add_cost()`、`main.py` 中 `/me/quota`、`/me/costs`、`/admin/costs`、`/admin/audit-logs`、`/tasks/{task_id}`、`/tasks/{task_id}:retry`。 |
| 前端代码 | 顶部额度展示、额度弹窗、AI 分析后更新 quota。 |
| 测试证据 | `test_ai_safety_costs.py`、`test_workbench_details.py`。 |

已完成：

- AI 调用成本记录含 provider、model、feature、task_id、quota_delta。
- 标准研读扣额度，额度不足返回 `QUOTA_EXHAUSTED`。
- 关键操作写 audit log。
- 任务状态、错误码、降级、retry 接口可用。

不足：

- 没有后台成本分析 UI。
- 没有真实模型价格表。
- 没有 worker 队列和真正异步任务系统。
- 审计日志没有生产级查询、筛选、导出。

下一步验收要求：

- 增加成本后台页面。
- 接入 Celery/RQ 或等价任务队列。
- 增加任务取消、重试策略、失败重放测试。

### 5.12 前端工作台与 Agent 工具体验

对应需求：`RR-DEV-009`、间接承接 `RR-MVP-002` 至 `RR-MVP-029`  
评分：6.5/10  
状态：待验收

| 维度 | 当前实现 |
| --- | --- |
| 文档依据 | `docs/RR-DEV-009-workbench-agent-ux-plan.md`。 |
| 主容器 | `apps/web/components/workbench/phase-one-workbench.tsx`。 |
| 面板 | `workbench-panels.tsx`。 |
| 详情抽屉 | `details-drawer.tsx`。 |
| 通用 UI | `workbench-ui.tsx`。 |
| 静态配置 | `workbench-config.ts`。 |
| 二级页面 | `secondary-pages.tsx`、`app/knowledge/page.tsx`、`app/reports/page.tsx`。 |

已完成：

- 当前项目名顶部只显示一次。
- “项目进展”替代纯展示卡，首日诊断、研究空白、最近任务均变成可点击入口。
- 推荐列表显示来源、全文状态、AI 分析状态、知识库状态。
- 点击论文打开详情抽屉。
- AI 分析、知识库、报告、消息都有详情承载。
- 画像编辑改为 chip/tag 结构化编辑器。
- 知识库和报告消息增加二级页面。

不足：

- 浏览器验收尚未完成。
- 需要验证 1366x768 下整页不滚动，只允许面板内部滚动。
- 需要验证 console 无 hydration、runtime、未捕获 promise、404 favicon。
- 二级页面数据选择当前只偏“首个项目”，后续要支持项目切换和 URL 参数。

下一步验收要求：

- 跑真实浏览器 E2E：创建项目、画像、诊断详情、检索、推荐详情、AI 分析、知识库详情、报告消息详情。
- 截图留存到 `output/playwright/`。
- 验收通过后 commit/push。

## 6. RR-MVP 完成度矩阵

| 需求 | 当前状态 | 分数 | 主要证据 | 主要缺口 |
| --- | --- | ---: | --- | --- |
| RR-MVP-001 用户账号 | 部分完成 | 5.5 | auth/me API | 非生产认证 |
| RR-MVP-002 研究项目 | 基本完成 | 7.5 | projects API、工作台项目抽屉 | 项目管理页不足 |
| RR-MVP-003 一句话冷启动 | 基本完成 | 7.0 | profile generate、AI provider | 真实用户输入评测不足 |
| RR-MVP-004 基石论文上传 | 占位 | 3.5 | uploads API | 无解析和前端流程 |
| RR-MVP-005 研究材料上传 | 占位 | 3.0 | uploads API | 无解析和画像增强 |
| RR-MVP-006 研究画像生成 | 基本完成 | 7.0 | profile schema、AI JSON 校验 | 准确性需试点 |
| RR-MVP-007 画像确认修改 | 基本完成 | 7.5 | PATCH/confirm、chip 编辑器 | 版本差异 UI 不足 |
| RR-MVP-008 首日诊断 | 部分完成 | 6.5 | diagnosis API、详情抽屉 | rule-based，低置信度 |
| RR-MVP-009 检索规划 | 基本完成 | 7.0 | search-tasks generate | 引用网络未完整启用 |
| RR-MVP-010 开放数据源 | 基本完成 | 7.0 | OpenAlex/Crossref | Semantic Scholar/arXiv 未接 |
| RR-MVP-011 定时检索 | 部分完成 | 5.0 | 手动 run、task status | 无调度器 |
| RR-MVP-012 检索过滤 | 部分完成 | 5.5 | filters 字段和适配器 | 前端筛选弱 |
| RR-MVP-013 元数据标准化 | 基本完成 | 7.0 | NormalizedRecord、SourceRecord | 大规模字段质量未评估 |
| RR-MVP-014 跨源排重 | 基本完成 | 6.5 | dedup.py、ingest | 语义排重轻量 |
| RR-MVP-015 开放全文发现 | 部分完成 | 5.5 | fulltext_status、versions | 不做真实全文获取 |
| RR-MVP-016 个性化推荐评分 | 基本完成 | 6.5 | recommender、eval script | 人工标注集不足 |
| RR-MVP-017 推荐解释 | 基本完成 | 7.0 | explanation、score_basis | 解释质量需人工抽检 |
| RR-MVP-018 用户反馈 | 基本完成 | 7.5 | feedback API、排序变化测试 | 长期学习轻量 |
| RR-MVP-019 雷达纠偏控制台 | 部分完成 | 4.5 | radar-settings API | UI 和策略不足 |
| RR-MVP-020 快速 AI 分析 | 部分完成 | 6.5 | analysis API、AI schema | 真实模型人工验收不足 |
| RR-MVP-021 标准 AI 研读 | 部分完成 | 5.5 | standard analysis、成本 | 非全文研读 |
| RR-MVP-022 事实分级 | 基本完成 | 7.0 | AnalysisClaim、AI safety eval | 真实模型样本不足 |
| RR-MVP-023 文献状态管理 | 基本完成 | 7.0 | KnowledgeItem | 批量管理不足 |
| RR-MVP-024 标签与分类 | 基本完成 | 6.5 | PATCH knowledge | 标签体系基础 |
| RR-MVP-025 知识库搜索 | 基本完成 | 6.5 | knowledge:search | 搜索字段和过滤不足 |
| RR-MVP-026 每日科研雷达 | 部分完成 | 6.0 | report generate | 无定时和真实推送 |
| RR-MVP-027 每周科研周报 | 部分完成 | 6.0 | weekly report | 趋势仍 rule-based |
| RR-MVP-028 邮件推送 | 占位 | 4.0 | mock outbox、退订 | 无真实 SMTP/API |
| RR-MVP-029 Web 消息中心 | 基本完成 | 6.5 | messages API、二级页 | 实时提醒不足 |
| RR-MVP-030 成本记录 | 基本完成 | 7.5 | CostRecord | 真实价格表未接 |
| RR-MVP-031 用户额度 | 基本完成 | 7.0 | quota 扣减 | 商业规则待定 |
| RR-MVP-032 后台成本统计 | 部分完成 | 5.0 | admin/costs API | 无后台 UI |
| RR-MVP-033 审计日志 | 基本完成 | 7.0 | audit logs | 生产审计查询不足 |
| RR-MVP-034 任务失败降级 | 基本完成 | 7.0 | TaskStatus、retry | 无 worker 队列 |
| RR-MVP-035 AI 安全可追溯 | 部分完成 | 6.5 | safety eval、schema | 全文证据缺失 |

## 7. 尚未开始或明确属于未来阶段

以下内容不能计入当前 MVP 完成范围：

| 能力 | 编号 | 当前状态 | 文档依据 |
| --- | --- | --- | --- |
| 微信、企业微信、飞书、钉钉、App 推送 | `RR-FUTURE-001` | 未开始 | `docs/11-future-capability-backlog.md` |
| 月报系统 | `RR-FUTURE-002` | 未开始 | `docs/11-future-capability-backlog.md` |
| 中文数据库、中文期刊、学位论文 | `RR-FUTURE-003` | 未开始 | `docs/11-future-capability-backlog.md` |
| 用户自定义来源、RSS、作者主页、会议网站 | `RR-FUTURE-004` | 未开始 | `docs/11-future-capability-backlog.md` |
| 学科专业数据库 | `RR-FUTURE-005` | 未开始 | `docs/11-future-capability-backlog.md` |
| 移动端 App 或 PWA | `RR-FUTURE-006` | 未开始 | `docs/11-future-capability-backlog.md` |
| 公开方向周报、文献时间线、组会文献包 | `RR-FUTURE-007` | 未开始 | `docs/11-future-capability-backlog.md` |
| 课题组、企业、机构集成 | `RR-FUTURE-008` | 未开始 | `docs/11-future-capability-backlog.md` |
| 高级数据源合规策略与本地权限连接器 | `RR-FUTURE-009` | 未开始 | `docs/11-future-capability-backlog.md` |
| 受控 Agent 工作流 | `RR-FUTURE-010` | 未开始 | `docs/11-future-capability-backlog.md` |

## 8. 当前最重要的不足清单

按优先级排序：

1. `RR-DEV-009` 浏览器验收未完成，不能把工作台大改算作正式交付。
2. 推荐质量评测集过小，最终推荐准确性不能只靠当前单方向脚本。
3. 上传和全文解析能力不足，基石论文/研究材料尚未真正服务画像和研读。
4. 定时任务系统未实现，日报、周报、每日检索都是手动触发或 mock 验收。
5. 生产认证未实现，多用户隔离和权限不能上线。
6. 真实邮件、微信、飞书、钉钉、App 推送未实现。
7. Semantic Scholar、arXiv 未接入。
8. 后台成本统计和运营面板不足。
9. AI 标准研读不是全文级，缺章节、页码、图表证据。
10. 数据库虽然支持 PostgreSQL JSONB 持久化，但 schema/migration/pgvector 搜索还不是成熟生产形态。

## 9. 必须补充的验收动作

### 9.1 RR-DEV-009 工作台验收

必须完成：

1. 启动当前代码的 API 和 Web。
2. 1366x768 下确认整页不滚动，只允许列表、侧栏、抽屉内部滚动。
3. 项目名在顶部只出现一次。
4. 左侧研究工作台下直接展开项目列表，`+` 是唯一新增项目入口。
5. 创建项目 -> 一句话画像 -> chip 编辑 -> 保存草稿 -> 确认画像 -> 诊断详情。
6. 生成检索任务 -> 查看来源面板 -> 打开 SourceRecord 详情。
7. 点击推荐论文 -> 打开论文详情 -> 检查来源、推荐理由、版本、合法阅读入口。
8. 快速分析、标准研读 -> 打开 AI 详情 -> 检查事实分级和成本。
9. 加入知识库 -> 打开知识库详情 -> 修改标签/备注并保存。
10. 生成日报/周报 -> 打开报告详情 -> 打开消息详情 -> 标记已读。
11. 控制台无 hydration、React runtime、未捕获 promise、404 favicon。

### 9.2 自动化检查

当前阶段最低命令：

```powershell
.\.venv\Scripts\python.exe -m pytest
.\.venv\Scripts\ruff.exe check services/api
npm run lint:web
npx tsc --noEmit --project apps/web/tsconfig.json
npm run build
python services/api/evals/recommendation_eval.py --top-n 10
python services/api/evals/ai_safety_eval.py
```

当前已知最近结果：

- `pytest`：20 passed, 2 skipped。
- `ruff check services/api`：通过。
- `npm run lint:web`：通过。
- `npx tsc --noEmit --project apps/web/tsconfig.json`：通过。
- `npm run build`：需要在 RR-DEV-009 最终验收报告中记录完整输出。
- 浏览器验收：待完成。

### 9.3 推荐准确性验收

必须补：

1. 至少 5 个研究方向。
2. 每个方向至少 20-50 篇标注候选论文。
3. 标注类别至少包括：高度相关、方法迁移、背景引用、不相关、排除材料、排除应用。
4. 指标回写 `docs/08-acceptance-and-tests.md`：
   - Top 10 高相关或方法迁移比例。
   - Top 10 无关比例。
   - 推荐解释人工通过率。
   - 反馈后排序改善率。

## 10. 下一阶段建议

建议不要直接进入 Phase 2。下一阶段应命名为：

`RR-DEV-011：Phase 1 验收收口与推荐质量试点`

目标：

1. 完成并提交 `RR-DEV-009`。
2. 扩展推荐评测集。
3. 增加真实浏览器 E2E 脚本。
4. 修复 RR-DEV-009 验收发现的 UI/交互问题。
5. 把“当前可试点”和“不能上线”的边界写入发布说明。

通过标准：

- 所有自动检查通过。
- 浏览器验收通过并留截图。
- 推荐评测集至少覆盖 5 个方向。
- 文档、代码、测试、报告同步提交。
- GitHub Actions 通过。

