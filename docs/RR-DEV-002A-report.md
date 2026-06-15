# RR-DEV-002A 持久化实机验收补充报告

日期：2026-06-15

## 结论

RR-DEV-002A 已补齐 PostgreSQL 基础持久化实机验收路径。

- `.venv` 已可 `import psycopg`，版本 `3.3.4`。
- 本机无 Docker，已改用 `E:\commSoft\PostgreSQL-16.4` 启动 PostgreSQL 16.4。
- FastAPI `/api/v1/health` 在 PostgreSQL URL 下返回 `configured=true`、`driver=postgresql`、`detail=ok`。
- 新增 PostgreSQL 持久化验收测试，创建用户、项目、画像、检索任务、来源记录、论文、推荐后重建 store 可读回。

本机 PostgreSQL 安装没有 pgvector 扩展，因此 health 返回 `pgvector=false`。服务器部署应使用 `docker-compose.yml` 的 `pgvector/pgvector:pg16` 镜像，届时应返回 `pgvector=true`。

## 本机启动命令

```powershell
& 'E:\commSoft\PostgreSQL-16.4\pgsql\bin\pg_ctl.exe' start -D 'E:\commSoft\PostgreSQL-16.4\data' -l 'E:\Programs\research_radar_ai\tmp\postgres-local.log' -w
& 'E:\commSoft\PostgreSQL-16.4\pgsql\bin\pg_isready.exe' -h 127.0.0.1 -p 5432 -U postgres
```

确保项目角色和数据库：

```powershell
& 'E:\commSoft\PostgreSQL-16.4\pgsql\bin\psql.exe' -h 127.0.0.1 -p 5432 -U postgres -d postgres -c "DO `$`$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'research_radar') THEN CREATE ROLE research_radar LOGIN PASSWORD 'research_radar'; END IF; END `$`$;"
& 'E:\commSoft\PostgreSQL-16.4\pgsql\bin\createdb.exe' -h 127.0.0.1 -p 5432 -U postgres -O research_radar research_radar
```

## 服务器部署命令

```bash
docker compose up -d postgres redis minio
uv sync --cache-dir .uv-cache
export DATABASE_URL="postgresql+psycopg://research_radar:research_radar@127.0.0.1:5432/research_radar"
export RUN_POSTGRES_TESTS=1
.venv/bin/python -m pytest services/api/tests/test_postgres_persistence.py
uv run uvicorn research_radar_api.main:app --host 0.0.0.0 --port 8010 --app-dir services/api/src
```

## 验收命令与结果

```powershell
uv sync --cache-dir .uv-cache
.venv\Scripts\python.exe -c "import psycopg; print(psycopg.__version__)"
```

结果：`3.3.4`

```powershell
$env:PYTHONPATH='services/api/src'
.venv\Scripts\python.exe -c "from research_radar_api.db import database_health; print(database_health('postgresql+psycopg://research_radar:research_radar@127.0.0.1:5432/research_radar'))"
```

结果：`DatabaseHealth(configured=True, driver='postgresql', detail='ok', pgvector=False)`

```powershell
$env:DATABASE_URL='postgresql+psycopg://research_radar:research_radar@127.0.0.1:5432/research_radar'
$env:RUN_POSTGRES_TESTS='1'
.venv\Scripts\python.exe -m pytest services/api/tests/test_postgres_persistence.py -q
```

结果：`1 passed`

```powershell
$env:DATABASE_URL='postgresql+psycopg://research_radar:research_radar@127.0.0.1:5432/research_radar'
$env:PYTHONPATH='services/api/src'
.venv\Scripts\python.exe -c "from fastapi.testclient import TestClient; from research_radar_api.main import app; print(TestClient(app).get('/api/v1/health').json()['data']['database'])"
```

结果：`{'configured': True, 'driver': 'postgresql', 'detail': 'ok', 'pgvector': False}`

## 代码补充

- `psycopg[binary]` 已进入 `pyproject.toml` 和 `uv.lock`。
- `database_health` 支持 `postgresql+psycopg://` 连接串并返回 `pgvector` 可用性。
- PostgreSQL 初始化现在会尝试启用 pgvector；若本机没有该扩展，不阻断 JSONB 持久化表初始化。
- 新增 `services/api/tests/test_postgres_persistence.py`，用于显式 PostgreSQL 实机验收。
