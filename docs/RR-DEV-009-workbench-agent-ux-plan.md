# RR-DEV-009 工作台信息架构与 Agent 工具体验

日期：2026-06-17  
状态：实施中验收基线  
范围：Phase 1 工作台体验、详情承载、二级页面、前后端详情接口补齐

## 1. 目标

RR-DEV-009 的目标是把 Phase 1 从“按钮堆叠的演示页”调整为科研用户可以理解的 Agent 工具工作台。

本轮不扩大 MVP 范围，不进入 Phase 2；仍以 RR-MVP 的推荐准确闭环为第一目标：项目、画像、检索、排重、推荐、反馈、AI 研读、知识库、报告。

## 2. 主页面分区

| 区域 | 页面职责 | 数据来源 | 交互承载 |
| --- | --- | --- | --- |
| 左侧导航 | 研究工作台为一级，项目列表为其下级抽屉；知识库、报告消息进入二级页；未实现能力标记待开放 | `GET /projects` | 工作台展开/收起、`+` 新增项目、项目切换 |
| 顶部状态 | 当前项目名只显示一次，同时显示画像状态、推荐数、数据源状态、额度 | `GET /me`、`GET /me/quota`、`GET /health`、项目上下文 | 只做状态和上下文，不放重复入口 |
| 项目进展 | 首日诊断、研究空白、最近任务三个关键摘要 | `GET /diagnosis`、`GET /tasks/{id}` | 点击打开诊断详情、gap 详情、任务时间线 |
| 项目推荐列表 | 工作台主操作区，展示推荐论文、来源、推荐理由、全文状态、AI 状态、知识库状态、反馈 | `GET /recommendations`、`GET /source-records`、`GET /feedback`、`GET /knowledge` | 点击论文打开论文详情抽屉；反馈按钮写回推荐 |
| 右侧辅助区 | 画像摘要、数据源状态、选中论文研读、知识库最新、报告消息最新 | 画像、检索任务、知识库、报告、消息接口 | 画像弹窗、数据源抽屉、AI 分析抽屉、知识库详情、报告/消息详情 |

## 3. 详情承载规则

任何可点击内容都必须有明确详情承载：

- 首日诊断详情：展示系统理解、技术路线、关键词、高相关论文、方法迁移论文，并提供“编辑画像”“重新检索”。
- 研究空白详情：展示候选 gap、知识缺口、关联推荐论文和下一步检索建议。
- 最近任务详情：展示 SearchTask 时间线、source statuses、失败原因和重试入口。
- 论文详情：展示 Paper、PaperVersion、推荐解释、合法阅读入口和已有 AI 分析。
- AI 研读详情：展示结构化结论、事实分级、证据、模型和成本记录。
- 知识库详情：展示状态、标签、备注、关联 paper_id，并可编辑保存。
- 报告详情：展示日报/周报完整内容。
- 消息详情：展示站内消息正文和已读状态。

## 4. 画像编辑器

画像编辑不再使用大段文本框。以下字段必须使用 chip/tag 编辑：

- 研究对象
- 研究方法
- 核心材料
- 性能指标
- 中文关键词
- 英文关键词
- 排除方向

画像编辑器必须显示版本、状态、置信度和来源，并提供“保存草稿”“确认画像”“生成新诊断”三个动作。

## 5. 数据源规则

- `mock` 必须显示为“开发模拟数据源”，不能伪装成真实学术数据库。
- `live` 显示 OpenAlex/Crossref 的 source status、record count、错误码和降级状态。
- Semantic Scholar 与 arXiv 在本阶段只作为后续数据源说明，不允许点击后报错。
- 非 mock 检索路径下，不能在没有 SourceRecord 的情况下制造推荐。

## 6. 后端接口补齐

本轮补齐或复用以下详情接口：

- `GET /api/v1/recommendations/{recommendation_id}`
- `GET /api/v1/papers/{paper_id}`
- `GET /api/v1/papers/{paper_id}/versions`
- `GET /api/v1/papers/{paper_id}/analysis`
- `GET /api/v1/knowledge/{item_id}`
- `PATCH /api/v1/knowledge/{item_id}`
- `GET /api/v1/reports/{report_id}`
- `GET /api/v1/messages/{message_id}`
- `POST /api/v1/messages/{message_id}:read`
- `GET /api/v1/tasks/{task_id}`
- `POST /api/v1/tasks/{task_id}:retry`

重复的 `GET /api/v1/tasks/{task_id}` 路由必须清理为一个稳定实现。

## 7. 代码结构

工作台前端拆分到 `apps/web/components/workbench/`：

- `phase-one-workbench.tsx`：主容器、数据加载、动作调度。
- `workbench-panels.tsx`：主页面区域与右侧辅助面板。
- `details-drawer.tsx`：所有详情抽屉。
- `workbench-ui.tsx`：Toast、Modal、Drawer、ChipEditor、空态/加载态。
- `workbench-config.ts`：静态文案、状态映射、标签。
- `hooks.ts`：toast 与 busy action 管理。
- `secondary-pages.tsx`：知识库与报告消息二级页面。

## 8. 验收标准

- 1366x768 下整页不滚动，只允许列表、侧栏、抽屉内部滚动。
- 当前项目名在顶部只出现一次，不在项目进展面板重复。
- 左侧研究工作台下直接展开项目列表，`+` 是唯一新增项目入口。
- 点击首日诊断、研究空白、最近任务均打开详情抽屉。
- 点击推荐论文打开论文详情，显示来源、推荐理由、版本和合法阅读入口。
- 快速分析、标准研读完成后打开 AI 研读详情，不只显示 toast。
- 加入知识库后打开知识库条目详情；知识库列表条目可点击查看并编辑。
- 日报、周报、消息列表条目可点击查看完整详情。
- mock 数据源必须明确显示为开发模拟数据源。
- 控制台无 hydration、React runtime、未捕获 promise、404 favicon 错误。
- 后端详情接口测试覆盖 recommendation、paper、knowledge、report、message、task retry。

## 9. 非本轮范围

- 不实现真实全文下载。
- 不接入 Semantic Scholar、arXiv、中文数据库或机构权限。
- 不实现真实邮件投递和定时调度器。
- 不做聊天优先 Agent 主界面。
- 不做移动端优先设计；移动端仅保证不崩坏。
