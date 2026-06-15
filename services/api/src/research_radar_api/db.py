from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any


POSTGRES_VECTOR_SQL = "CREATE EXTENSION IF NOT EXISTS vector;"

POSTGRES_BOOTSTRAP_SQL = """
CREATE TABLE IF NOT EXISTS source_records (
  id text PRIMARY KEY,
  source text NOT NULL,
  source_identifier text NOT NULL,
  search_task_id text NOT NULL,
  raw_payload jsonb NOT NULL,
  normalized_payload jsonb,
  fetched_at timestamptz NOT NULL,
  quality_score numeric NOT NULL,
  paper_id text
);

CREATE UNIQUE INDEX IF NOT EXISTS source_records_source_identifier_idx
  ON source_records(source, source_identifier);

CREATE TABLE IF NOT EXISTS rr_entities (
  entity_type text NOT NULL,
  id text NOT NULL,
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(entity_type, id)
);
"""


@dataclass(slots=True)
class DatabaseHealth:
    configured: bool
    driver: str
    detail: str
    pgvector: bool = False


def psycopg_url(database_url: str) -> str:
    return database_url.replace("postgresql+psycopg://", "postgresql://", 1)


def database_health(database_url: str) -> DatabaseHealth:
    if database_url.startswith("postgresql"):
        try:
            import psycopg  # type: ignore[import-not-found]
        except ModuleNotFoundError:
            return DatabaseHealth(
                configured=True,
                driver="postgresql",
                detail="psycopg is not installed; docker-compose PostgreSQL is ready for use once dependency is installed.",
            )
        try:
            with psycopg.connect(psycopg_url(database_url), connect_timeout=2) as connection:
                with connection.cursor() as cursor:
                    cursor.execute("SELECT 1")
                    cursor.execute(
                        "SELECT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector')"
                    )
                    pgvector_available = bool(cursor.fetchone()[0])
            return DatabaseHealth(
                configured=True,
                driver="postgresql",
                detail="ok",
                pgvector=pgvector_available,
            )
        except Exception as exc:  # pragma: no cover - depends on local service state
            return DatabaseHealth(configured=True, driver="postgresql", detail=str(exc))
    return DatabaseHealth(configured=database_url != "sqlite+memory://dev", driver="memory", detail="ok")


def postgres_schema_preview() -> dict[str, Any]:
    return {"bootstrap_sql": POSTGRES_BOOTSTRAP_SQL.strip()}


class EntityPersistence:
    def __init__(self, database_url: str) -> None:
        self.database_url = database_url
        self.enabled = database_url.startswith("postgresql")
        self.detail = "memory"
        self._psycopg: Any | None = None
        if self.enabled:
            try:
                import psycopg  # type: ignore[import-not-found]

                self._psycopg = psycopg
                self.initialize()
            except ModuleNotFoundError:
                self.enabled = False
                self.detail = "psycopg is not installed"
            except Exception as exc:
                self.enabled = False
                self.detail = str(exc)

    def initialize(self) -> None:
        if not self.enabled or self._psycopg is None:
            return
        with self._psycopg.connect(psycopg_url(self.database_url)) as connection:
            with connection.cursor() as cursor:
                try:
                    cursor.execute(POSTGRES_VECTOR_SQL)
                    connection.commit()
                except Exception:
                    connection.rollback()
                cursor.execute(POSTGRES_BOOTSTRAP_SQL)
            connection.commit()

    def load_all(self) -> dict[str, list[dict[str, Any]]]:
        if not self.enabled or self._psycopg is None:
            return {}
        rows: dict[str, list[dict[str, Any]]] = {}
        with self._psycopg.connect(psycopg_url(self.database_url)) as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT entity_type, payload FROM rr_entities")
                for entity_type, payload in cursor.fetchall():
                    rows.setdefault(entity_type, []).append(payload)
        return rows

    def save(self, entity_type: str, entity_id: str, payload: dict[str, Any]) -> None:
        if not self.enabled or self._psycopg is None:
            return
        with self._psycopg.connect(psycopg_url(self.database_url)) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO rr_entities(entity_type, id, payload)
                    VALUES (%s, %s, %s::jsonb)
                    ON CONFLICT(entity_type, id)
                    DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()
                    """,
                    (entity_type, entity_id, json.dumps(payload)),
                )
            connection.commit()
