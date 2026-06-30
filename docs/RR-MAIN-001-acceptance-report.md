# RR-MAIN-001 文献阅读器主产品迁移验收报告

日期：2026-06-30  
状态：主迁移完成，进入真实邮件/调度器补充验收阶段。

## 1. 完成内容

- 主入口 `/` 已从旧 Phase 1 工作台替换为文献阅读器主界面。
- 旧 Web 路由 `/knowledge`、`/reports` 和旧 workbench 组件已从 `apps/web` 移除。
- 文献阅读器 UI 已迁入 Next.js：
  - `apps/web/components/literature-reader/literature-reader-app.tsx`
  - `apps/web/app/globals.css`
  - `apps/web/app/page.tsx`
- 新增 FastAPI 正式 literature 模块：
  - `services/api/src/research_radar_api/literature.py`
  - 路由前缀：`/api/v1/literature`
- 新增 Next.js API rewrite：
  - 浏览器请求 `/api/v1/*` 会代理到 `NEXT_PUBLIC_API_BASE_URL`，默认 `http://127.0.0.1:8010/api/v1`。
- demo 数据已可自动导入正式接口：
  - 43 篇文献
  - 12 份 AI 报告
  - 14 次采集记录
  - 1 个采集任务
- Agent Mail 参数已固化：
  - 收件人 To：任务级 `recipientEmails`，可用 `AGENT_MAIL_DEFAULT_RECIPIENTS` 兜底
  - 抄送/密送：任务级 `ccEmails`、`bccEmails`
  - 主题：按每篇论文自动生成 `[研知雷达] 完整文献 · {标题}` 或 `[研知雷达] AI分析 · {标题}`
  - 正文：使用 `--body-file` 指向生成的 Markdown 文件
  - 附件：最多 3 个，第一版优先附带本地 PDF
  - 发送：遵守 `ctk_xxx` 两阶段确认

## 2. 新增接口

当前正式接口位于 `/api/v1/literature`：

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

## 3. 验收结果

自动检查：

```text
python -m pytest -q
33 passed, 3 skipped

ruff check services/api/src services/api/tests
All checks passed

npm run lint:web
passed

npx tsc --noEmit --project apps/web/tsconfig.json
passed
```

用户 PowerShell 补跑 build：

```text
npm run build
Compiled successfully
Generating static pages (5/5)
Route: /, /_not-found, /icon.svg
```

FastAPI smoke：

```text
GET /api/v1/literature/health 200
counts: papers=43, reports=12, scanRuns=14, mailDeliveries=5, tasks=1

GET /api/v1/literature/library 200
papers=43, reports=12, scanRuns=14

GET /api/v1/literature/tasks 200
tasks=1

GET /api/v1/literature/files/... 200
```

## 4. 邮件验收说明

当前代码已支持 Agent Mail，但实发必须满足：

```text
EMAIL_PROVIDER=agent_mail
AGENT_MAIL_ENABLED=true
AGENT_MAIL_CLI=agently-cli
AGENT_MAIL_DEFAULT_RECIPIENTS=收件人邮箱
```

邮件发送不是“绑定邮箱后自动成功”。绑定邮箱只是发送账号，任务还必须有收件人。  
如果 CLI 返回确认令牌，状态会进入 `pending_confirmation`，前端点击确认后才会发送并进入 `sent`。

采集任务里的“每日自动执行”和“推送邮箱”已经拆成两个独立配置：

- 每日自动执行：只决定任务是否按时间自动运行，后续需接 Redis + RQ/Celery worker。
- 推送邮箱：任务执行完成后，按新入库文献逐条生成邮件投递。未勾选 AI 分析时发送完整文献 Markdown；勾选 AI 分析时先生成单篇 AI 报告，再发送报告 Markdown。

当前 smoke 进程环境显示：

```text
mail enabled=false
installed=true
authorized=false
sendCapable=false
```

这说明代码路径可检查 CLI，但当前测试进程没有启用 Agent Mail 或没有读取到授权状态。真实发送验收需要在本机 `.env` 打开上面变量，并配置收件人后再执行 `/api/v1/literature/mail/test`。

## 5. 已知边界

- `apps/literature-reader` 仍保留为迁移对照和初始 demo 数据源；正式验收稳定后再归档或删除。
- PostgreSQL 第一版通过 `rr_entities` JSONB 持久化，后续可拆分为关系表。
- `LITERATURE_STORAGE_PROVIDER=s3` 已作为配置目标保留，本轮默认本地对象存储。
- Redis + RQ/Celery 常驻调度器尚未落地；任务自动执行字段已进入正式任务模型。
- 无合法 PDF/HTML 正文时，系统不会伪造全文，只保存元数据/摘要并提示 DOI 或上传 PDF。

## 6. 后续动作

1. 真实邮件验收：
   - `.env` 写入：
     ```text
     EMAIL_PROVIDER=agent_mail
     AGENT_MAIL_ENABLED=true
     AGENT_MAIL_CLI=agently-cli
     AGENT_MAIL_DEFAULT_RECIPIENTS=
     ```
   - 前端进入“新增任务”，绑定 Agent Mail 发送账号。
   - 开启“推送邮箱”，填写收件人 To；CC/BCC 可选。
   - 执行任务后检查右侧邮箱推送记录：`queued` 表示缺参数或未就绪，`pending_confirmation` 表示 CLI 已返回 `ctk_xxx`，点击确认后应进入 `sent`。
2. 浏览器点击验收：
   - 启动 API：`.\.venv\Scripts\python.exe -m uvicorn research_radar_api.main:app --app-dir services/api/src --host 127.0.0.1 --port 8010`
   - 启动 Web：`npm --workspace apps/web run dev`
   - 验收采集任务、本地文献库、图谱、文献详情、AI 报告、上传 PDF、删除文档、邮件 outbox。
3. 调度器落地：
   - 接入 Redis + RQ/Celery，把 `dailyEnabled/dailyTime/lastScheduledRunDate` 从字段状态升级为后台 worker。
   - worker 复用 `tasks/{id}:run` 的同一套扫描、去重、AI 分析和邮件投递逻辑。
4. 存储归档：
   - 将 `apps/literature-reader/local-data` 的 JSON 和文件资产迁入 PostgreSQL + `storage/literature` 或 S3。
   - 主产品验收稳定后归档独立 demo，避免两套数据源长期并行。
