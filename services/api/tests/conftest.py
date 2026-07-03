import os

os.environ["AI_PROVIDER"] = "mock"
os.environ["RETRIEVAL_PROVIDER"] = "mock"
os.environ["DEMO_SEED_ENABLED"] = "true"
os.environ["DEV_USER_ID"] = "usr_demo"
os.environ["LITERATURE_SCHEDULER_ENABLED"] = "false"

from research_radar_api.schemas import Paper, PaperVersion, make_id  # noqa: E402
from research_radar_api.store import store  # noqa: E402


def pytest_configure() -> None:
    if "paper_bamboo_oxidation" not in store.papers:
        paper = Paper(
            id="paper_bamboo_oxidation",
            title="Periodate oxidation and diamine crosslinking of delignified bamboo materials",
            title_zh="脱木质素竹材的高碘酸盐氧化与二胺交联研究",
            year=2024,
            journal="Carbohydrate Polymers",
            doi="10.0000/rr.bamboo.2024.001",
            authors=["Li Chen", "Yuan Zhang", "Mei Wu"],
            abstract="A test fixture about delignified bamboo and diamine bonding.",
            keywords=["delignified bamboo", "periodate oxidation", "diamine", "hot pressing"],
            fulltext_status="open_access",
        )
        store.papers[paper.id] = paper
        version = PaperVersion(
            id=make_id("ver"),
            paper_id=paper.id,
            source="OpenAlex",
            source_identifier=paper.id,
            version_type="published",
            title=paper.title,
            url=f"https://example.org/{paper.id}",
            license="open-metadata-test-fixture",
        )
        store.paper_versions[version.id] = version
