# RR-MAIN-002 主产品代码清理、文档对齐与功能补齐审计

版本：v0.1  
日期：2026-07-01  
状态：当前主产品整改基线  
适用范围：`apps/web` 主前端、`/api/v1/literature/*` 主产品 API、旧 Phase 1 兼容后端与文档差距。

## 1. 当前结论

RR-MAIN-001 之后，主产品入口已经从独立文献阅读器 demo 迁移到 `apps/web`。当前主产品体验以“采集任务、本地文献库、知识图谱、文献详情、PDF/Markdown 原文、AI 分析报告、邮箱绑定、任务日志、自动执行字段”为核心。

同时，仓库中仍保留第一版 Phase 1 后端能力，包括项目、研究画像、推荐、反馈、日报/周报、消息和成本统计。这些能力不再是当前首页的直接入口，但仍可能复用到后续主产品能力中，因此暂不粗暴删除，先标记为兼容能力并逐步迁移。

## 2. 代码入口审计

| 区域 | 当前状态 | 结论 |
| --- | --- | --- |
| `apps/web` | Next.js 主前端，首页加载文献阅读器体验 | 当前唯一主产品前端入口 |
| `apps/literature-reader` | 已移除 | 不再作为启动或验收入口 |
| `apps/web/components/literature-reader` | 迁移后的文献阅读器 UI | 需要继续拆分组件、hooks 和 API client |
| `/api/v1/literature/*` | FastAPI 主产品文献阅读器接口 | 当前主产品 API 基线 |
| `/api/v1/projects/*` 等旧路由 | 旧 Phase 1 工作台后端 | 标记为 compatibility，迁移前保留 |
| `/api/v1/agent/research-scan:run` | 独立 Agent Scan 接口 | 后续应合并进采集任务检索/分析链路 |
| `storage/literature/imported-local-data` | 从 demo 迁入的本地数据 | 作为导入兼容数据，不应再视为独立 demo |

## 3. 文档差异审计

| 文档 | 当前问题 | 处理方式 |
| --- | --- | --- |
| `01-product-requirements.md` | 主线仍偏研究项目、推荐雷达、画像闭环 | 保留原始产品目标，补充文献阅读器作为当前主产品切入点 |
| `02-mvp-scope.md` | MVP 范围未明确 RR-MAIN-001 后的主体验变化 | 增加“当前主产品基线”小节 |
| `05-data-model.md` | 缺少 `LiteratureTask`、`ScanRun`、`LiteraturePaper` 等正式实体 | 补充文献阅读器实体与旧实体映射 |
| `06-api-contracts.md` | 未把 `/api/v1/literature/*` 作为主产品 API | 补充文献阅读器接口族 |
| `08-acceptance-and-tests.md` | 验收仍偏旧工作台流程 | 增加 RR-MAIN-002 主产品验收矩阵 |
| `RR-DEV-008-gap-audit.md` | 描述旧 Phase 1 工作台缺口 | 标记为历史参考 |
| `RR-DEV-010-current-product-acceptance-audit.md` | 部分文件路径和产品形态已过期 | 标记为 RR-MAIN-001 前历史审计 |
| `RR-MAIN-001-literature-reader-migration.md` | 已成为迁移基线 | 继续保留 |
| `RR-MAIN-001-acceptance-report.md` | 已成为迁移验收记录 | 继续保留 |

## 4. 功能完成度评分

| 模块 | 当前状态 | 评分 | 主要问题 |
| --- | --- | --- | --- |
| 主前端迁移 | 已迁入 `apps/web` | 75/100 | 单文件过大，组件/状态/API 未充分拆分 |
| 独立 demo 删除 | 基本完成 | 90/100 | 需持续清理文档和脚本中的 4177 旧入口 |
| 文献采集 | 可用 | 70/100 | OpenAlex/Crossref 已接，检索翻页补足、质量筛选仍需强化 |
| 本地文献库 | 可用 | 70/100 | 图谱、列表、详情已成型，语义关系和项目归类仍弱 |
| DOI/PDF/原文获取 | 部分可用 | 55/100 | 不同出版商页面适配不足，HTML/PDF 抽取链路不稳定 |
| AI 分析报告 | 可用 | 65/100 | Markdown 可生成，证据分级、全文依据和重复内容控制仍需完善 |
| 邮箱绑定/推送 | 部分可用 | 60/100 | Agent Mail 已接，收件人、确认 token、自动推送状态仍需打磨 |
| 自动执行 | 字段已有 | 35/100 | 未接 Redis + RQ/Celery 后台调度 |
| 正式数据库模型 | 部分可用 | 45/100 | 仍使用 JSONB entity persistence，缺少正式关系模型和迁移 |
| 旧代码清理 | 未完成 | 40/100 | 旧 Phase 1 后端仍与新主产品并存 |
| 文档一致性 | 不足 | 45/100 | 核心文档未完全切换到当前主产品基线 |

## 5. 旧能力处理策略

旧 Phase 1 后端不直接删除，按以下策略处理：

| 类别 | 能力 | 处理策略 |
| --- | --- | --- |
| 可复用 | 项目、研究画像、推荐、反馈、成本 | 迁移到文献阅读器主线后再移除旧路由 |
| 可复用但需改造 | 日报、周报、消息 | 改为基于文献库、采集任务和 AI 报告生成 |
| 保留兼容 | 旧测试覆盖的 MVP 路由 | 在替代接口和测试完成前保留 |
| 应停止扩展 | 旧工作台前端形态 | 不再恢复，不再新增功能 |

## 6. 功能补齐清单

| 优先级 | 功能 | 实现目标 | 用户流程 | 开发方式 |
| --- | --- | --- | --- | --- |
| P0 | 文档基线更新 | 当前产品以文献阅读器为主线 | 用户按文档知道入口、流程和验收标准 | 更新核心文档并引用本审计 |
| P0 | 前端组件化 | 降低后续维护成本 | 用户体验不变 | 拆组件、hooks、API client |
| P0 | 后端模块化 | 让 API 可持续扩展 | 前端继续调用同一 API | 拆分 `literature.py`，保留路由兼容 |
| P0 | 邮箱推送闭环 | 任务完成后逐条推送文献或 AI 报告 | 填收件人、开启推送、任务完成、待确认发送 | 固化 `to`、`subject`、`body_file`、附件和 confirmation token |
| P0 | DOI/PDF 获取修复 | 尽量拿到合法公开 PDF 或正文 | 点击获取原文后下载 PDF、抽取 HTML 或提示上传 | 增强 DOI redirect 和出版商页面解析 |
| P1 | 采集质量提升 | 返回足量、去重、符合条件的文献 | 设置方向、篇数、年份、评分后自动补足 | OpenAlex/Crossref 翻页、多 query 扩展、评分过滤 |
| P1 | AI 报告强化 | 形成科研阅读笔记 | 生成表格、流程图、证据、借鉴点 | 优化 prompt、证据标签、Mermaid、全文/摘要区别 |
| P1 | 自动调度 | 每日任务真正后台执行 | 设置每日时间后后端自动跑 | 接 Redis + RQ/Celery |
| P1 | 正式数据库模型 | 从 JSONB 过渡到可维护 schema | 数据稳定保存并可迁移 | 新增关系模型和迁移脚本 |
| P1 | 项目/研究方向归类 | 文献库可按项目沉淀 | 用户按项目看任务、文献、报告 | 引入 `ResearchProject` 到 literature task/library |
| P2 | 推荐与反馈回路 | 回到原 PRD 的推荐准确闭环 | 点有用、无关、方法迁移后排序纠偏 | 融合旧推荐逻辑到文献库 |
| P2 | 日报/周报 | 从单篇报告升级为研究雷达报告 | 自动汇总新增文献和趋势 | 复用旧报告能力，改为 literature 数据源 |
| P2 | 成本与额度 UI | 用户知道 AI/检索成本 | 查看本次任务消耗 | 接入 `CostRecord`，展示任务级成本 |
| P2 | Semantic Scholar/arXiv | 扩展开放数据源 | 用户选择更多来源 | 新增适配器，统一 `SourceRecord` |
| P3 | 语义知识图谱 | 从视觉图谱升级为知识关系 | 看主题、方法、材料、指标关系 | 抽取 claim、entity、relation，建立独立图谱层 |

## 7. RR-MAIN-002 验收标准

1. `apps/web` 是唯一主前端入口，README 和文档不再引导使用 4177 demo。
2. `apps/web` 中文献阅读器核心 API、工具函数、Markdown/图谱/任务/邮件组件完成拆分。
3. `/api/v1/literature/*` 路由保持兼容，同时后端实现拆分到文献阅读器模块。
4. 旧 Phase 1 后端在文档中明确标记为 compatibility，不再作为当前主产品入口。
5. 本文档被加入 `docs/index.md`。
6. 自动检查通过：后端 pytest、ruff，前端 lint、TypeScript、build。

## 8. 后续阶段

RR-MAIN-002 之后，建议按顺序推进：

1. RR-MAIN-003：邮件推送闭环和 Agent Mail 两阶段确认体验。
2. RR-MAIN-004：DOI/PDF/HTML 原文获取与上传解析稳定化。
3. RR-MAIN-005：采集质量提升和足量补齐策略。
4. RR-MAIN-006：AI 报告证据分级与全文/摘要来源约束。
5. RR-MAIN-007：Redis + RQ/Celery 自动调度。
6. RR-MAIN-008：正式数据库 schema 与迁移。
