# 研知雷达 Research Radar AI

AI 科研情报、知识管理与课题推进平台。

当前主产品已按 `docs/RR-MAIN-001-literature-reader-migration.md` 迁移为文献阅读器：

`采集任务 -> OpenAlex/Crossref 检索 -> 去重入库 -> 本地文献库知识图谱 -> 文献原文/PDF -> AI Markdown 分析报告 -> Agent Mail 推送`

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

Phase 1 默认验收全部使用 mock AI，不需要也不读取真实 OpenAI Key。

### 文献阅读器主产品配置

主前端为 Next.js，主后端为 FastAPI。Next.js 会把浏览器侧 `/api/v1/*` 请求代理到：

```text
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8010/api/v1
```

文献阅读器正式接口位于：

```text
GET http://127.0.0.1:8010/api/v1/literature/health
GET http://127.0.0.1:8010/api/v1/literature/library
```

首次启动 FastAPI 时，会从 `apps/literature-reader/local-data/` 导入 demo 已有文献、报告、采集记录和任务，再写入 PostgreSQL `rr_entities` 或内存开发存储。

Agent Mail 中“绑定邮箱”是发送账号，不是收件人。推送邮件必须配置收件人：

```text
EMAIL_PROVIDER=agent_mail
AGENT_MAIL_ENABLED=true
AGENT_MAIL_CLI=agently-cli
AGENT_MAIL_DEFAULT_RECIPIENTS=reader@example.com
```

采集任务表单开启“推送邮箱”后，需要填写收件人 To；CC/BCC 可选。邮件参数映射为：

- `to`：任务级收件人或 `AGENT_MAIL_DEFAULT_RECIPIENTS`
- `subject`：系统按每篇论文自动生成 `[研知雷达] 完整文献 · {标题}` 或 `[研知雷达] AI分析 · {标题}`
- `body_file`：生成的 Markdown 文件，完整文献包含文献信息、摘要、链接和本地原文/解析；AI 任务包含单篇 AI 报告
- `attachment`：最多 3 个，第一版优先附带本地 PDF

邮件发送遵循 Agent Mail 两阶段确认：任务完成后会自动发起投递；若 CLI 返回 `ctk_xxx`，状态先进入 `pending_confirmation`，前端点击确认后才会带 `confirmation-token` 完成发送。

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

当前 `/` 直接进入文献阅读器主界面。旧 Phase 1 工作台、`/knowledge`、`/reports` 页面已经从主 Web 移除；独立 `apps/literature-reader` 仅作为迁移对照保留。

## Phase 1 本地总验收

默认验收不需要 secrets、不访问 live OpenAlex/Crossref、不依赖 PostgreSQL。Windows 上建议先进入 `.venv`，确保 `python` 和 `ruff` 来自项目环境：

```powershell
uv sync --cache-dir .uv-cache
npm install
.\.venv\Scripts\Activate.ps1
.\scripts\check_phase1.ps1
```

Linux/macOS 等价命令：

```bash
uv sync --dev
npm ci
source .venv/bin/activate
bash scripts/check_phase1.sh
```

脚本覆盖以下发布前检查：

```powershell
python -m pytest
ruff check --no-cache
npm run lint:web
npx tsc --noEmit --project apps/web/tsconfig.json
npm run build
python services/api/evals/recommendation_eval.py --top-n 10
python services/api/evals/ai_safety_eval.py
```

GitHub Actions 使用同一组检查，见 `.github/workflows/ci.yml`。CI 环境变量固定为 `AI_PROVIDER=mock`、`RETRIEVAL_PROVIDER=mock`、`DATABASE_URL=sqlite+memory://ci`、`RUN_LIVE_RETRIEVAL_TESTS=0`、`RUN_POSTGRES_TESTS=0`。

## 新机器从 clone 到跑通验收

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

启动本地 MVP：

```powershell
$env:AI_PROVIDER="mock"
$env:RETRIEVAL_PROVIDER="mock"
$env:DATABASE_URL="sqlite+memory://dev"
$env:DEMO_SEED_ENABLED="true"
$env:DEV_USER_ID="usr_demo"
uv run uvicorn research_radar_api.main:app --reload --host 127.0.0.1 --port 8010 --app-dir services/api/src
```

另开一个终端：

```powershell
npm run dev:web
```

如未复制 `apps/web/.env.example`，前端本地免登录 smoke 需要设置：

```powershell
$env:NEXT_PUBLIC_DEV_USER_ID="usr_demo"
```

访问：

- API: `http://127.0.0.1:8010/api/v1/health`
- Web: `http://localhost:3000`

## 可选实机验收

PostgreSQL 实机持久化验收需先启动 docker-compose 的 postgres，并显式打开：

```powershell
$env:DATABASE_URL="postgresql+psycopg://research_radar:research_radar@localhost:5432/research_radar"
$env:RUN_POSTGRES_TESTS="1"
.venv\Scripts\python.exe -m pytest services/api/tests/test_postgres_persistence.py
```

真实 OpenAlex/Crossref smoke 测试也必须显式打开，默认 CI 不运行：

```powershell
$env:RUN_LIVE_RETRIEVAL_TESTS="1"
python -m pytest services/api/tests/test_live_retrieval.py
```

## Phase 1 / Phase 2 边界

Phase 1 已完成的是 MVP 闭环：账号与项目、画像、上传队列、检索规划、OpenAlex/Crossref 适配与 mock 降级、排重、推荐、反馈纠偏、快速/标准 AI 分析的 mock 验收、知识库基础状态、日报/周报、站内消息、mock email outbox、成本额度、审计与任务状态。

仍属于 Phase 2 或未来能力：全文 PDF 章节/表格/图证据定位、真实邮件服务、真实 OpenAI Key 生产接入、Semantic Scholar/arXiv 扩展、Zotero、浏览器扩展、移动端、团队/机构版、私有部署和复杂知识图谱。

## 文档约束

- MVP 需求编号：`RR-MVP-*`
- 长期能力编号：`RR-FUTURE-*`
- 新需求必须先更新文档，再进入开发。
