# RR-MAIN-001 文献阅读器全量迁移主产品

状态：已迁移，旧独立 demo 已移除  
日期：2026-06-30  
范围：以历史独立文献阅读器体验为基线，将主产品迁移为正式 Next.js + FastAPI 架构。

## 1. 迁移原则

- 产品体验以历史文献阅读器为准：采集任务、本地文献库、知识图谱、文献详情、PDF/Markdown 原文、AI 分析报告、删除文档、邮箱绑定、任务日志和自动执行流程不改变。
- 工程底座以正式文档为准：前端使用 Next.js，后端使用 FastAPI，数据库使用 PostgreSQL JSONB 持久化，后续可拆关系表和 pgvector。
- 旧 Phase 1 工作台不再作为主入口；主入口直接进入文献阅读器。
- 独立文献阅读器 demo 已删除，避免旧入口与主产品混淆。

## 2. 功能映射

| Demo 能力 | 正式主产品落点 | 对应需求 |
| --- | --- | --- |
| 采集任务 | `/api/v1/literature/tasks` 与 Next.js 采集任务面板 | `RR-MVP-010`、`RR-MVP-011` |
| OpenAlex/Crossref 检索 | FastAPI literature 检索服务 | `RR-MVP-010` |
| 本地去重 | DOI + 标题归一化去重 | `RR-MVP-014` |
| 文献本地库 | PostgreSQL `rr_entities` + 本地对象存储 | `RR-MVP-023` 至 `RR-MVP-025` |
| 知识图谱 | Next.js 内 `@xyflow/react` 图谱 | `RR-MVP-024` |
| PDF/Markdown 原文 | `/api/v1/literature/files/*` 对象文件服务 | `RR-MVP-015`、`RR-MVP-020` |
| AI 分析报告 | `/api/v1/literature/analyze`，Markdown + Mermaid | `RR-MVP-020`、`RR-MVP-021`、`RR-MVP-022` |
| 邮箱绑定 | Agent Mail OAuth 启动与状态检查 | `RR-MVP-028` |
| 邮件推送 | Agent Mail 两阶段发送确认 | `RR-MVP-028` |
| 每日自动执行 | 后端调度配置字段，后续接 Redis + RQ/Celery | `RR-MVP-011` |

## 3. 正式接口

当前新增接口前缀为 `/api/v1/literature`：

- `GET /health`
- `GET /library`
- `POST /scan`
- `GET /tasks`
- `POST /tasks`
- `PUT /tasks/{task_id}`
- `DELETE /tasks/{task_id}`
- `POST /tasks/{task_id}:run`
- `POST /analyze`
- `DELETE /papers/{paper_id}`
- `POST /papers/{paper_id}:fetch-fulltext`
- `POST /papers/{paper_id}:upload-pdf`
- `POST /papers/{paper_id}/upload-pdf`
- `GET /mail/status`
- `POST /mail/auth:start`
- `GET /mail/outbox`
- `POST /mail/test`
- `POST /mail/deliveries/{delivery_id}:confirm`
- `GET /files/{relative_path}`

第一版保留 demo 响应结构，便于前端无感迁移；后续进入 API 稳定期后再抽象为更严格的 `LiteratureTask`、`LiteraturePaper`、`ScanRun`、`PaperAnalysisReport`、`MailDelivery` schema。

## 4. 数据迁移

启动 FastAPI literature 模块时会自动尝试导入正式本地存储中的历史数据：

- `storage/literature/imported-local-data/library.json`
- `storage/literature/imported-local-data/tasks.json`
- `storage/literature/imported-local-data/papers/`
- `storage/literature/imported-local-data/reports/`
- `storage/literature/imported-local-data/downloads/`
- `storage/literature/imported-local-data/mail-outbox/`

导入后的业务实体写入 PostgreSQL `rr_entities`：

- `literature_papers`
- `literature_scan_runs`
- `literature_reports`
- `literature_mail_deliveries`
- `literature_tasks`

文件资产第一版使用 `storage/literature/` 本地对象存储目录；生产环境将 `LITERATURE_STORAGE_PROVIDER=s3` 后迁移到 S3 兼容对象存储。

## 5. 邮件推送规则

Agent Mail 是发送账号绑定，不等于收件地址。任务推送必须有收件人：

- 全局默认：`AGENT_MAIL_DEFAULT_RECIPIENTS=a@example.com,b@example.com`
- 任务级收件人：`recipientEmails`，对应 `agently-cli message +send --to`
- 可选：`ccEmails`、`bccEmails`
- 新增/编辑采集任务时，开启“推送邮箱”后必须填写 To；未绑定 Agent Mail 时该开关不可用。

发送命令固定为：

```text
agently-cli message +send --to <recipient> --subject <subject> --body-file <body-file> [--cc <email>] [--bcc <email>] [--attachment <file>]
```

参数映射：

- `to`：任务表单的收件人 To；支持多个邮箱。
- `cc`、`bcc`：任务表单的可选抄送/密送。
- `subject`：系统逐篇生成，不要求用户手写；未开启 AI 分析时为 `[研知雷达] 完整文献 · {论文题名}`，开启 AI 分析时为 `[研知雷达] AI分析 · {论文题名}`。
- `body_file`：系统生成的 Markdown 文件。完整文献推送包含文献信息、摘要、链接和本地原文/解析；AI 推送包含单篇 AI Markdown 报告。
- `attachment`：最多 3 个，第一版优先附带本地 PDF；若没有 PDF，不伪造附件。

若 CLI 返回 `ctk_xxx`，邮件状态进入 `pending_confirmation`，前端展示确认发送按钮；用户确认后调用：

```text
agently-cli message +send ... --confirmation-token <ctk_xxx>
```

两类推送：

- 未开启 AI 分析：每篇新文献生成一封“完整文献卡片”。
- 开启 AI 分析：每篇新文献先生成 AI Markdown 报告，再推送“AI 分析报告”。

自动化执行与邮箱推送是两个独立能力：每日自动执行决定任务何时运行，推送邮箱决定任务完成后是否逐篇生成邮件投递记录。两者可以同时开启，但不能互相替代。

没有收件人、未绑定 Agent Mail、CLI 不可用或未确认时，不允许显示为已发送。

## 6. 验收标准

- 主入口 `/` 显示文献阅读器，不显示旧工作台。
- 自动导入 demo 数据后，至少能看到 43 篇文献、12 份报告、14 次采集记录。
- 点击采集任务可执行 OpenAlex/Crossref 检索、评分、去重、保存文献。
- 本地文献库知识图谱、右侧列表、文献详情、删除、PDF 上传、原文/报告切换保持 demo 行为。
- AI 分析报告输出 Markdown，包含中文标题翻译、摘要翻译、文献信息表、研究主题、Mermaid 核心流程图、方法与实验设计、关键结果与证据、局限、可借鉴点、关系判断、精读问题、后续检索建议。
- 邮件测试必须先进入 `pending_confirmation` 或明确失败原因；用户确认后才能进入 `sent`。
- 所有新增接口通过后端测试；前端通过 lint、TypeScript 与 build。

## 7. 当前边界

- Redis + RQ/Celery 调度器字段已保留，本轮先保证任务配置和手动执行；生产级常驻 worker 在下一阶段落地。
- S3 provider 字段已保留，本轮默认本地对象存储。
- 不绕过出版社、X-MOL、知网、学校统一认证、验证码或 robots.txt。
- 无合法 PDF/HTML 正文时，只保存元数据和摘要，并提示用户打开 DOI 或上传 PDF。
