import os
from uuid import uuid4

import pytest

from research_radar_api.db import database_health
from research_radar_api.retrieval import NormalizedRecord
from research_radar_api.schemas import (
    ResearchProfile,
    ResearchProject,
    SearchTask,
    User,
)
from research_radar_api.store import InMemoryStore


POSTGRES_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql+psycopg://research_radar:research_radar@localhost:5432/research_radar",
)


def test_postgres_store_survives_rebuild():
    if os.environ.get("RUN_POSTGRES_TESTS") != "1":
        pytest.skip("Set RUN_POSTGRES_TESTS=1 with docker-compose postgres running.")
    health = database_health(POSTGRES_URL)
    if health.detail != "ok":
        pytest.skip(f"PostgreSQL is not ready: {health.detail}")

    suffix = uuid4().hex[:8]
    first = InMemoryStore(database_url=POSTGRES_URL, seed_on_empty=False)
    user = User(
        id=f"usr_pg_{suffix}",
        email=f"pg-{suffix}@example.com",
        display_name="Postgres Tester",
    )
    project = ResearchProject(
        id=f"proj_pg_{suffix}",
        owner_id=user.id,
        name="PostgreSQL persistence acceptance",
        discipline="材料科学",
    )
    profile = ResearchProfile(
        id=f"profile_pg_{suffix}",
        project_id=project.id,
        version=1,
        status="confirmed",
        source_type="one_sentence",
        research_object=["delignified bamboo"],
        methods=["periodate oxidation", "diamine modification"],
        materials=["biomass composite"],
        keywords_en=["delignified bamboo", "periodate oxidation"],
    )
    project.current_profile_id = profile.id
    task = SearchTask(
        id=f"search_pg_{suffix}",
        project_id=project.id,
        profile_id=profile.id,
        task_type="exact",
        query_text="delignified bamboo periodate oxidation diamine",
    )
    first.users[user.id] = user
    first.projects[project.id] = project
    first.profiles[profile.id] = profile
    first.search_tasks[task.id] = task
    source_record, paper = first.ingest_source_record(
        task.id,
        NormalizedRecord(
            source="openalex",
            source_identifier=f"openalex-pg-{suffix}",
            title=f"Postgres persisted periodate oxidation record {suffix}",
            authors=[f"Persistence Tester {suffix}"],
            year=2026,
            journal="Persistence Journal",
            doi=f"10.5555/pg-{suffix}",
            abstract="A durable source record for PostgreSQL acceptance.",
            keywords=["periodate oxidation", "diamine"],
            raw_payload={"acceptance": True},
        ),
    )
    recommendations = first.create_recommendations(project.id, profile.id, force_refresh=True)
    assert source_record.paper_id == paper.id
    assert recommendations

    rebuilt = InMemoryStore(database_url=POSTGRES_URL, seed_on_empty=False)
    assert rebuilt.users[user.id].email == user.email
    assert rebuilt.projects[project.id].current_profile_id == profile.id
    assert rebuilt.search_tasks[task.id].query_text == task.query_text
    assert rebuilt.source_records[source_record.id].paper_id == paper.id
    assert rebuilt.papers[paper.id].doi == f"10.5555/pg-{suffix}"
    assert any(item.project_id == project.id for item in rebuilt.recommendations.values())
