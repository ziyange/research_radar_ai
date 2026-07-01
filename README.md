# 研知雷达 Research Radar AI

AI 科研情报、知识管理与课题推进平台。

当前主产品已按 `docs/RR-MAIN-001-literature-reader-migration.md` 迁移为文献阅读器：

`采集任务 -> OpenAlex/Crossref 检索 -> 去重入库 -> 本地文献库知识图谱 -> 文献原文/PDF -> AI Markdown 分析报告 -> Agent Mail 推送`

当前主入口：

- 前端：`apps/web`，Next.js。
- 后端：`services/api`，FastAPI。
- 主 API：`/api/v1/literature/*`。
- 交接文档：[docs/RR-MAIN-004-project-handoff.md](docs/RR-MAIN-004-project-handoff.md)。

旧的 `apps/literature-reader` 独立 demo 已删除，`4177` 端口不再作为产品入口。旧 Phase 1 项目/画像/推荐接口仍在后端中作为历史兼容能力，当前主 UI 不再使用。

## 从 Clone 到启动

Windows PowerShell：

```powershell
git clone git@github.com:ziyange/research_radar_ai.git
Set-Location research_radar_ai

uv python install 3.12 --install-dir .python --cache-dir .uv-cache
uv venv .venv --python '.python\cpython-3.12.11-windows-x86_64-none\python.exe' --cache-dir .uv-cache
uv sync --cache-dir .uv-cache

npm install --cache .npm-cache
Copy-Item .env.example .env
```

启动后端：

```powershell
uv run uvicorn research_radar_api.main:app --reload --host 127.0.0.1 --port 8010 --app-dir services/api/src
```

另开终端启动前端：

```powershell
npm run dev:web
```

访问 Next.js 输出的地址，通常是 `http://localhost:3000`；如果 3000 被占用，Next.js 会自动切到 `http://localhost:3001`。

## 本地 Python 环境

本项目使用 `uv` 和项目内 Python 运行时：

- Python runtime: `.python/cpython-3.12.11-windows-x86_64-none/python.exe`
- Virtual environment: `.venv`
- Python version policy: `>=3.12,<3.13`

如果需要重建：

```powershell
uv python install 3.12 --install-dir .python --cache-dir .uv-cache
uv venv .venv --python '.python\cpython-3.12.11-windows-x86_64-none\python.exe' --cache-dir .uv-cache
uv sync --cache-dir .uv-cache
```

Linux/macOS 或 CI 可直接使用系统 Python 3.12：

```bash
uv sync --dev
```

## 配置

复制 `.env.example` 为 `.env`，按需填写：

- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `OPENAI_MODEL`
- `AI_PROVIDER`
- `DEMO_SEED_ENABLED`
- `DEV_USER_ID`
- `X_MOL_API_BASE_URL`
- `CNKI_API_BASE_URL`
- `AGENT_MAIL_DEFAULT_RECIPIENTS`

默认 `AI_PROVIDER=mock`，不会调用真实 AI API。要接入阿里云百炼，使用 OpenAI-compatible 模式，不需要新增 `DASHSCOPE_*` 变量：

```text
AI_PROVIDER=openai
OPENAI_BASE_URL=https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1
OPENAI_MODEL=qwen3.6-plus
OPENAI_API_KEY=你的百炼 API Key
AI_REQUEST_TIMEOUT_SECONDS=90
AGENT_AI_ANALYSIS_CONCURRENCY=2
```

`AI_PROVIDER=openai` 时如果缺少 key、base URL 或 model，接口会返回 `AI_PROVIDER_CONFIG_MISSING`，不会静默回退 mock。

`DEMO_SEED_ENABLED=false` 是真实业务默认值，不会初始化 demo 论文。开发演示或本地 smoke flow 可显式改为 `true`。`DEV_USER_ID=usr_demo` 仅用于开发环境免登录；生产环境应接入正式认证，不依赖该值。

本地文档/界面验收可以使用 `AI_PROVIDER=mock`；真实 AI 报告验收必须配置 OpenAI-compatible 参数。

### 文献阅读器主产品配置

主前端为 Next.js，主后端为 FastAPI。前端 API client 默认指向：

```text
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8010/api/v1
```

文献阅读器正式接口位于：

```text
GET http://127.0.0.1:8010/api/v1/literature/health
GET http://127.0.0.1:8010/api/v1/literature/library
```

首次启动 FastAPI 时，会从正式本地存储目录 `storage/literature/imported-local-data/` 导入历史文献、报告、采集记录和任务，再写入 PostgreSQL `rr_entities` 或内存开发存储。

当前邮件推送以 Agent Mail 为主。“绑定邮箱”是发送账号，不是收件人。推送邮件必须配置收件人，并开启自动确认：

```text
EMAIL_PROVIDER=agent_mail
AGENT_MAIL_ENABLED=true
AGENT_MAIL_CLI=agently-cli
AGENT_MAIL_AUTO_CONFIRM=true
AGENT_MAIL_DEFAULT_RECIPIENTS=reader@example.com
```

采集任务表单开启“推送邮箱”后，需要填写收件人 To；CC/BCC 可选。邮件参数映射为：

- `to`：任务级收件人或 `AGENT_MAIL_DEFAULT_RECIPIENTS`
- `subject`：系统按每篇论文自动生成 `[研知雷达] 完整文献 · {标题}` 或 `[研知雷达] AI分析 · {标题}`
- `body_file`：生成的 Markdown 文件，完整文献包含文献信息、摘要、链接和本地原文/解析；AI 任务包含单篇 AI 报告
- `attachment`：最多 3 个，第一版优先附带本地 PDF

`EMAIL_PROVIDER=smtp` 时，任务完成后会直接自动发送，不需要人工确认。`EMAIL_PROVIDER=agent_mail` 且 `AGENT_MAIL_AUTO_CONFIRM=true` 时，任务完成后会自动发起投递，若 CLI 返回 `ctk_xxx`，后端会立即带 `confirmation-token` 完成第二次发送。`AGENT_MAIL_AUTO_CONFIRM=false` 时，仍保留前端人工确认流程。

如后续要接通用事务邮件，也可以切换 SMTP：

```text
EMAIL_PROVIDER=smtp
EMAIL_FROM=Research Radar AI <no-reply@example.com>
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USERNAME=your-account@example.com
SMTP_PASSWORD=your-smtp-password-or-app-password
SMTP_USE_TLS=true
```

### Agent 来源配置

`POST /api/v1/agent/research-scan:run` 支持按研究方向、发布时间、评分和篇数扫描候选文献。默认正式来源是 OpenAlex/Crossref 官方开放元数据 API；AI 只负责把中文或混合语言研究方向扩展成英文检索计划，篇数、筛选、去重和逐篇分析由后端程序控制。

```text
OPENALEX_EMAIL=
AGENT_SOURCE_TIMEOUT_SECONDS=20
X_MOL_API_BASE_URL=
X_MOL_API_KEY=
CNKI_API_BASE_URL=
CNKI_API_KEY=
```

OpenAlex/Crossref 通过项目内 `retrieval/openalex.py` 和 `retrieval/crossref.py` 正式适配器调用开放 API。未配置官方/合作 API 时不会抓取 X-MOL/CNKI 搜索页，也不会返回硬编码假论文；CNKI 只允许官方 API、机构合作接口或用户授权导出记录，不保存学校账号、图书馆密码、统一认证密码或长期 Cookie。

### 数据库模式

默认 `DATABASE_URL=sqlite+memory://dev`，后端使用内存开发存储，不需要 Docker，适合快速跑通前后端流程。

如需启用 PostgreSQL/pgvector 持久化：

```powershell
docker compose up -d postgres
Copy-Item .env.example .env
```

然后在 `.env` 中改为：

```text
DATABASE_URL=postgresql+psycopg://research_radar:research_radar@localhost:5432/research_radar
```

依赖安装后应能导入 PostgreSQL 驱动：

```powershell
uv sync --cache-dir .uv-cache
.venv\Scripts\python.exe -c "import psycopg; print(psycopg.__version__)"
```

启动 API 后，`GET /api/v1/health` 的 `database` 应返回：

```json
{"configured": true, "driver": "postgresql", "detail": "ok"}
```

如果本机没有 Docker，但已经安装 PostgreSQL 到 `E:\commSoft\PostgreSQL-16.4`，可用本地安装直接启动：

```powershell
& 'E:\commSoft\PostgreSQL-16.4\pgsql\bin\pg_ctl.exe' start -D 'E:\commSoft\PostgreSQL-16.4\data' -l 'E:\Programs\research_radar_ai\tmp\postgres-local.log' -w
& 'E:\commSoft\PostgreSQL-16.4\pgsql\bin\pg_isready.exe' -h 127.0.0.1 -p 5432 -U postgres
& 'E:\commSoft\PostgreSQL-16.4\pgsql\bin\psql.exe' -h 127.0.0.1 -p 5432 -U postgres -d postgres -c "DO `$`$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'research_radar') THEN CREATE ROLE research_radar LOGIN PASSWORD 'research_radar'; END IF; END `$`$;"
& 'E:\commSoft\PostgreSQL-16.4\pgsql\bin\createdb.exe' -h 127.0.0.1 -p 5432 -U postgres -O research_radar research_radar
```

本地普通 PostgreSQL 安装可能没有 pgvector 扩展，此时 health 会返回 `pgvector=false`，但 JSONB 持久化验收仍可运行。服务器推荐使用 `docker-compose.yml` 中的 `pgvector/pgvector:pg16` 镜像，health 应返回 `pgvector=true`。

服务器部署命令：

```bash
docker compose up -d postgres redis minio
uv sync --cache-dir .uv-cache
export DATABASE_URL="postgresql+psycopg://research_radar:research_radar@127.0.0.1:5432/research_radar"
export RUN_POSTGRES_TESTS=1
.venv/bin/python -m pytest services/api/tests/test_postgres_persistence.py
uv run uvicorn research_radar_api.main:app --host 0.0.0.0 --port 8010 --app-dir services/api/src
```

## 后端

```powershell
uv run uvicorn research_radar_api.main:app --reload --host 127.0.0.1 --port 8010 --app-dir services/api/src
```

健康检查：

```text
GET http://127.0.0.1:8010/api/v1/health
```

## 前端

```powershell
npm install
npm run dev:web
```

默认访问：

```text
http://localhost:3000
```

当前 `/` 直接进入文献阅读器主界面。旧 Phase 1 工作台、`/knowledge`、`/reports` 页面以及独立文献阅读器 demo 已经移除。主前端使用 `http://localhost:3000`，API 使用 `http://127.0.0.1:8010`。

## 当前验证命令

```powershell
.\.venv\Scripts\python.exe -m pytest -p no:cacheprovider
.\.venv\Scripts\ruff.exe check --no-cache services/api
npm run lint:web
npx tsc --noEmit --project apps/web/tsconfig.json
npm run build
```

可选实机验收：

```powershell
$env:DATABASE_URL="postgresql+psycopg://research_radar:research_radar@localhost:5432/research_radar"
$env:RUN_POSTGRES_TESTS="1"
.\.venv\Scripts\python.exe -m pytest services/api/tests/test_postgres_persistence.py -p no:cacheprovider
```

```powershell
$env:RUN_LIVE_RETRIEVAL_TESTS="1"
.\.venv\Scripts\python.exe -m pytest services/api/tests/test_live_retrieval.py -p no:cacheprovider
```

## 当前功能

- 采集任务：研究方向、篇数、年份、评分、来源、是否 AI 分析、是否邮件推送。
- 开放数据源：OpenAlex、Crossref。外部 `503/429/500` 会记录为来源降级，不应直接中断整次任务。
- 本地文献库：知识图谱、右侧列表、搜索、排序、节点定位、文献详情。
- 文献原文：优先 PDF；没有全文时提示打开 DOI 下载并上传，或尝试自动获取公开 PDF/HTML。
- AI 分析：必须先有可读全文；只有元数据/摘要时禁止生成报告。
- 邮件推送：任务完成后逐篇推送完整文献卡片或 AI 分析报告。
- 浮层任务中心：采集、全文获取、上传、AI 分析、邮件状态和错误提示统一进入右下角浮层。

## 主要目录

```text
apps/web/                                  Next.js 主前端
apps/web/components/literature-reader/     文献阅读器组件域
services/api/src/research_radar_api/       FastAPI 应用
services/api/src/research_radar_api/literature.py
                                            当前主产品 API 路由
services/api/src/research_radar_api/literature_runtime/
                                            检索、全文、AI、仓储运行模块
docs/                                      文档基线、阶段报告、交接文档
storage/literature/                        本地对象存储与导入数据
```

## 常见问题

- 前端报 `Unexpected token '<'`：通常是 API 请求打到了 Next.js 页面而不是 FastAPI。检查 `NEXT_PUBLIC_API_BASE_URL` 和后端端口。
- `8010` 启动报 `WinError 10013`：端口被占用或权限限制。换端口启动，并同步修改 `NEXT_PUBLIC_API_BASE_URL`。
- OpenAlex `503` / Crossref `429`：外部服务限流或临时不可用。系统会降级并记录来源状态；建议配置 `OPENALEX_EMAIL`。
- AI 报告按钮不可用：该论文没有可读全文。先打开 DOI 下载 PDF，再在文献详情上传。
- 邮件缺少收件人：采集任务中必须填写推送邮箱 `to`，仅绑定发送邮箱不等于设置收件人。

## 当前边界与未完成

- 自动执行字段已经存在，但正式无人值守调度仍需接 Redis + RQ/Celery。
- 当前持久化仍以 `rr_entities` JSONB 为主，正式关系模型和迁移脚本仍待补。
- Semantic Scholar、arXiv、中文数据库、Zotero、浏览器扩展、移动端、团队/机构版仍属于后续阶段。
- X-MOL/CNKI 未配置官方授权 API 时不做自动抓取，不保存学校账号、图书馆密码、统一认证密码或长期 Cookie。
- 没有全文时不生成“摘要级伪分析报告”。

## 文档约束

- MVP 需求编号：`RR-MVP-*`
- 长期能力编号：`RR-FUTURE-*`
- 新需求必须先更新文档，再进入开发。
