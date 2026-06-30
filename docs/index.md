# 研知雷达 Research Radar AI 文档基线

版本：v0.1  
日期：2026-06-14  
状态：MVP 文档基线  
适用范围：第一轮只建立需求、架构、开发规划、接口与验收标准，不实现业务代码。

## 1. 文档原则

研知雷达采用文档优先开发方式。后续所有设计、开发、测试、验收、排期和需求变更都必须以 `docs/` 中的文档为准。

核心规则：

1. 先更新文档，再改代码。
2. 所有 MVP 功能必须有稳定需求编号。
3. 所有测试项、验收项、接口和数据模型必须反向关联需求编号。
4. AI 输出必须区分事实、归纳、对比、推测和启发。
5. 文献获取必须优先使用开放、合规、可审计的数据来源。
6. MVP 第一验收目标是推荐准确，而不是功能数量。

## 2. 文档地图

| 文档 | 作用 | 主要读者 |
| --- | --- | --- |
| [01-product-requirements.md](./01-product-requirements.md) | 完整 PRD、用户、场景、MVP 需求编号 | 产品、研发、测试 |
| [02-mvp-scope.md](./02-mvp-scope.md) | MVP 范围、暂不实现内容、七日体验、指标 | 产品、研发、运营 |
| [03-user-flows.md](./03-user-flows.md) | 冷启动、推荐、研读、知识库、推送流程 | 产品、设计、前后端 |
| [04-architecture.md](./04-architecture.md) | 系统架构、服务边界、任务流、成本控制 | 架构、后端、运维 |
| [05-data-model.md](./05-data-model.md) | 核心实体、字段、关系和状态机 | 后端、数据、测试 |
| [06-api-contracts.md](./06-api-contracts.md) | 前后端接口、任务接口、错误约定 | 前端、后端、测试 |
| [07-ai-and-retrieval.md](./07-ai-and-retrieval.md) | AI 工作流、检索规划、排重、推荐评分 | AI、后端、数据 |
| [08-acceptance-and-tests.md](./08-acceptance-and-tests.md) | 验收标准、测试矩阵、AI 评测集要求 | 测试、产品、研发 |
| [09-roadmap.md](./09-roadmap.md) | MVP 到机构版的阶段目标 | 产品、管理、研发 |
| [10-risk-compliance.md](./10-risk-compliance.md) | 数据合规、版权、AI 幻觉、成本风险 | 产品、法务、研发 |
| [11-future-capability-backlog.md](./11-future-capability-backlog.md) | 原始方案中未进入 MVP 的长期能力追踪 | 产品、研发、管理 |
| [RR-DEV-008-gap-audit.md](./RR-DEV-008-gap-audit.md) | Phase 1 已实现/未实现、真实通信/mock 边界和后续缺口 | 产品、研发、测试 |
| [RR-DEV-008-report.md](./RR-DEV-008-report.md) | RR-DEV-008 修复内容、验收命令和浏览器证据 | 产品、研发、测试 |
| [RR-DEV-009-workbench-agent-ux-plan.md](./RR-DEV-009-workbench-agent-ux-plan.md) | 工作台信息架构、详情承载、二级页面与验收标准 | 产品、设计、前后端、测试 |
| [RR-DEV-010-current-product-acceptance-audit.md](./RR-DEV-010-current-product-acceptance-audit.md) | 当前产品完成度、模块评分、代码证据、缺口和下一阶段验收动作 | 产品、研发、测试、管理 |
| [RR-DEV-011-standalone-agent-research-scan.md](./RR-DEV-011-standalone-agent-research-scan.md) | 独立 Agent Research Scan 接口、AI 查询扩展、OpenAlex/Crossref 正式接入、HITL、筛选、去重和 AI 分析验收 | 产品、AI、后端、测试 |
| [RR-MAIN-001-literature-reader-migration.md](./RR-MAIN-001-literature-reader-migration.md) | 文献阅读器 demo 全量迁移主产品的接口、数据、邮件与验收基线 | 产品、前端、后端、测试 |
| [RR-MAIN-001-acceptance-report.md](./RR-MAIN-001-acceptance-report.md) | RR-MAIN-001 实施结果、验收命令、邮件实发前置条件和后续动作 | 产品、前端、后端、测试 |

## 3. 需求编号规则

需求编号格式：`RR-MVP-数字`。

后续能力编号格式：`RR-FUTURE-数字`。

`RR-FUTURE-*` 仅表示来自原始方案、但未进入当前 MVP 的长期能力。它们不是被删除的需求，也不会自动扩大 MVP 范围。任一 `RR-FUTURE-*` 进入开发前，必须先升级为具体阶段需求编号，并补齐接口、数据模型、测试和验收标准。

示例：

- `RR-MVP-003`：一句话研究方向冷启动。
- `RR-MVP-014`：跨源文献排重。
- `RR-MVP-018`：用户反馈写回推荐权重。
- `RR-FUTURE-003`：中文学术数据源。
- `RR-FUTURE-009`：高级数据源合规策略。

测试编号格式：

- 单元测试：`UT-RR-MVP-数字`。
- 集成测试：`IT-RR-MVP-数字`。
- 端到端测试：`E2E-RR-MVP-数字`。
- AI 评测：`EVAL-RR-MVP-数字`。

验收编号格式：

- `AC-RR-MVP-数字-序号`。

## 4. MVP 技术默认值

第一版 MVP 默认技术栈：

- Web 前端：Next.js。
- 后端与 AI/文献服务：Python FastAPI。
- 主数据库：PostgreSQL。
- 向量检索：pgvector。
- 缓存与限流：Redis。
- 对象存储：S3 兼容存储。
- 异步任务：Celery 或 RQ，优先选择实现成本更低的一种。
- 邮件推送：事务邮件服务或 SMTP。
- 后期复杂工作流：Temporal，仅在任务编排复杂度明确超过 Celery/RQ 后引入。

## 5. MVP 数据源默认值

MVP 仅使用开放、合规、可审计数据源：

- OpenAlex。
- Crossref。
- Semantic Scholar。
- arXiv。

MVP 不实现：

- 全自动知网登录。
- 云端保存学校账号、图书馆密码或统一认证密码。
- 大规模全文下载。
- 中文商业数据库自动抓取。
- 机构权限绕过。

## 6. 变更流程

任何后续变更必须按以下顺序执行：

1. 在相关文档中新增或修改需求、接口、数据模型或验收标准。
2. 更新 [08-acceptance-and-tests.md](./08-acceptance-and-tests.md) 的测试矩阵。
3. 由产品和研发确认影响范围。
4. 开发实现。
5. 按文档验收。
6. 若实现与文档冲突，以文档为准，先修正文档或实现中的一方。

如果变更来自 [11-future-capability-backlog.md](./11-future-capability-backlog.md)，必须先确认它是否仍属于长期能力；进入实现时再升级为对应阶段的正式需求、接口和测试项。
