# 研知雷达 Research Radar AI

AI 科研情报、知识管理与课题推进平台。

当前实现遵循 `docs/` 文档基线，优先落地 MVP 推荐闭环：

`研究画像生成 -> 检索规划 -> 开放数据源检索 -> 跨源排重 -> 个性化推荐 -> AI 快速分析 -> 用户反馈 -> 推荐纠偏 -> 日报/周报触达`

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

## 配置

复制 `.env.example` 为 `.env`，按需填写：

- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `OPENAI_MODEL`
- `AI_PROVIDER`

默认 `AI_PROVIDER=mock`，不会调用真实 AI API。你填入配置并切换 provider 后，后端再走 OpenAI 兼容接口。

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
uv run uvicorn research_radar_api.main:app --host 0.0.0.0 --port 8000 --app-dir services/api/src
```

## 后端

```powershell
uv run uvicorn research_radar_api.main:app --reload --app-dir services/api/src
```

健康检查：

```text
GET http://127.0.0.1:8000/api/v1/health
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

## 测试

```powershell
uv run pytest
npm run build
```

PostgreSQL 实机持久化验收需先启动 docker-compose 的 postgres，并显式打开：

```powershell
$env:DATABASE_URL="postgresql+psycopg://research_radar:research_radar@localhost:5432/research_radar"
$env:RUN_POSTGRES_TESTS="1"
.venv\Scripts\python.exe -m pytest services/api/tests/test_postgres_persistence.py
```

## 文档约束

- MVP 需求编号：`RR-MVP-*`
- 长期能力编号：`RR-FUTURE-*`
- 新需求必须先更新文档，再进入开发。
