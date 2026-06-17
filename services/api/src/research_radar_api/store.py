from datetime import date
from typing import Any, Callable

from .db import EntityPersistence
from .dedup import match_existing, normalize_doi
from .recommender import rank_papers
from .retrieval import NormalizedRecord
from .schemas import (
    AuditLog,
    CostRecord,
    EmailOutboxRecord,
    EmailPreference,
    KnowledgeItem,
    Message,
    Paper,
    PaperAnalysis,
    PaperVersion,
    RadarReport,
    Recommendation,
    RecommendationPaper,
    ResearchProfile,
    ResearchProject,
    SearchTask,
    SourceRecord,
    TaskStatus,
    UploadRecord,
    User,
    UserFeedback,
    make_id,
    now_utc,
)
from .settings import get_settings


class PersistDict(dict[str, Any]):
    def __init__(self, entity_type: str, persist: Callable[[str, Any], None]) -> None:
        super().__init__()
        self.entity_type = entity_type
        self.persist = persist

    def __setitem__(self, key: str, value: Any) -> None:
        super().__setitem__(key, value)
        self.persist(self.entity_type, value)


class InMemoryStore:
    """Development store for the document-first MVP skeleton.

    This keeps Phase 1 and MVP API behavior testable before PostgreSQL migrations land.
    The public schemas already mirror docs/05-data-model.md so swapping storage later is
    a persistence change, not an API redesign.
    """

    def __init__(self, database_url: str | None = None, seed_on_empty: bool | None = None) -> None:
        settings = get_settings()
        self.persistence = EntityPersistence(database_url or settings.database_url)
        self.users: dict[str, User] = PersistDict("users", self.persist_entity)
        self.projects: dict[str, ResearchProject] = PersistDict("projects", self.persist_entity)
        self.profiles: dict[str, ResearchProfile] = PersistDict("profiles", self.persist_entity)
        self.uploads: dict[str, UploadRecord] = PersistDict("uploads", self.persist_entity)
        self.papers: dict[str, Paper] = PersistDict("papers", self.persist_entity)
        self.paper_versions: dict[str, PaperVersion] = PersistDict(
            "paper_versions", self.persist_entity
        )
        self.source_records: dict[str, SourceRecord] = PersistDict(
            "source_records", self.persist_entity
        )
        self.search_tasks: dict[str, SearchTask] = PersistDict("search_tasks", self.persist_entity)
        self.recommendations: dict[str, Recommendation] = PersistDict(
            "recommendations", self.persist_entity
        )
        self.feedback: dict[str, UserFeedback] = PersistDict("feedback", self.persist_entity)
        self.analyses: dict[str, PaperAnalysis] = PersistDict("analyses", self.persist_entity)
        self.knowledge: dict[str, KnowledgeItem] = PersistDict("knowledge", self.persist_entity)
        self.reports: dict[str, RadarReport] = PersistDict("reports", self.persist_entity)
        self.messages: dict[str, Message] = PersistDict("messages", self.persist_entity)
        self.email_preferences: dict[str, EmailPreference] = PersistDict(
            "email_preferences", self.persist_entity
        )
        self.email_outbox: dict[str, EmailOutboxRecord] = PersistDict(
            "email_outbox", self.persist_entity
        )
        self.costs: dict[str, CostRecord] = PersistDict("costs", self.persist_entity)
        self.tasks: dict[str, TaskStatus] = PersistDict("tasks", self.persist_entity)
        self.audit_logs: dict[str, AuditLog] = PersistDict("audit_logs", self.persist_entity)
        loaded = self.load_persisted_entities()
        should_seed = settings.demo_seed_enabled if seed_on_empty is None else seed_on_empty
        if should_seed and not loaded:
            self.seed()

    def persist_entity(self, entity_type: str, entity: Any) -> None:
        if hasattr(entity, "model_dump"):
            self.persistence.save(
                entity_type,
                entity.id if hasattr(entity, "id") else entity.task_id,
                entity.model_dump(mode="json"),
            )

    def load_persisted_entities(self) -> bool:
        rows = self.persistence.load_all()
        if not rows:
            return False
        mapping: dict[str, tuple[dict[str, Any], type[Any], str]] = {
            "users": (self.users, User, "id"),
            "projects": (self.projects, ResearchProject, "id"),
            "profiles": (self.profiles, ResearchProfile, "id"),
            "uploads": (self.uploads, UploadRecord, "id"),
            "papers": (self.papers, Paper, "id"),
            "paper_versions": (self.paper_versions, PaperVersion, "id"),
            "source_records": (self.source_records, SourceRecord, "id"),
            "search_tasks": (self.search_tasks, SearchTask, "id"),
            "recommendations": (self.recommendations, Recommendation, "id"),
            "feedback": (self.feedback, UserFeedback, "id"),
            "analyses": (self.analyses, PaperAnalysis, "id"),
            "knowledge": (self.knowledge, KnowledgeItem, "id"),
            "reports": (self.reports, RadarReport, "id"),
            "messages": (self.messages, Message, "id"),
            "email_preferences": (self.email_preferences, EmailPreference, "id"),
            "email_outbox": (self.email_outbox, EmailOutboxRecord, "id"),
            "costs": (self.costs, CostRecord, "id"),
            "tasks": (self.tasks, TaskStatus, "task_id"),
            "audit_logs": (self.audit_logs, AuditLog, "id"),
        }
        for entity_type, payloads in rows.items():
            if entity_type not in mapping:
                continue
            target, model, key = mapping[entity_type]
            for payload in payloads:
                entity = model.model_validate(payload)
                dict.__setitem__(target, getattr(entity, key), entity)
        return True

    def seed(self) -> None:
        user = User(
            id="usr_demo",
            email="researcher@example.com",
            display_name="张同学",
            plan="free",
            quota_balance=10000,
        )
        self.users[user.id] = user

        papers = [
            Paper(
                id="paper_bamboo_oxidation",
                title="Periodate oxidation and diamine crosslinking of delignified bamboo materials",
                title_zh="脱木质素竹材的高碘酸盐氧化与二胺交联研究",
                year=2024,
                journal="Carbohydrate Polymers",
                doi="10.0000/rr.bamboo.2024.001",
                authors=["Li Chen", "Yuan Zhang", "Mei Wu"],
                abstract="A study on aldehyde-functionalized delignified bamboo and diamine bonding.",
                keywords=["delignified bamboo", "periodate oxidation", "diamine", "hot pressing"],
                fulltext_status="open_access",
            ),
            Paper(
                id="paper_cellulose_network",
                title="Aldehyde cellulose networks for high-strength biomass composites",
                title_zh="用于高强度生物质复合材料的醛基纤维素网络",
                year=2023,
                journal="ACS Sustainable Chemistry & Engineering",
                doi="10.0000/rr.cellulose.2023.018",
                authors=["Ava Lin", "Kai Zhou"],
                abstract="Periodate oxidation introduces aldehyde groups for tunable crosslinking.",
                keywords=["cellulose", "aldehyde", "biomass composite"],
                fulltext_status="repository",
            ),
            Paper(
                id="paper_hot_pressing",
                title="Hot-pressed lignocellulosic panels with bio-based crosslinkers",
                title_zh="生物基交联剂热压木质纤维板材",
                year=2022,
                journal="Industrial Crops and Products",
                doi="10.0000/rr.panel.2022.007",
                authors=["Hao Sun", "Nora Liu"],
                abstract="Hot pressing and green crosslinkers improve dimensional stability.",
                keywords=["hot pressing", "lignocellulosic", "crosslinker"],
                fulltext_status="unknown",
            ),
            Paper(
                id="paper_chitosan_transfer",
                title="Diamine-inspired crosslinking strategy for chitosan membranes",
                title_zh="壳聚糖膜的二胺启发交联策略",
                year=2024,
                journal="Journal of Membrane Science",
                doi="10.0000/rr.transfer.2024.021",
                authors=["Rui Wang", "Jin Yang"],
                abstract="A transferable amine crosslinking strategy for bio-derived membranes.",
                keywords=["diamine", "chitosan", "method transfer"],
                fulltext_status="author_manuscript",
            ),
            Paper(
                id="paper_mechanism_gap",
                title="Interfacial bonding mechanisms in oxidized biomass laminates",
                title_zh="氧化生物质层压材料中的界面结合机理",
                year=2025,
                journal="Materials Today Bio",
                doi="10.0000/rr.mechanism.2025.003",
                authors=["Xia He", "Ming Zhao"],
                abstract="Mechanistic evidence for aldehyde-amine bonding at biomass interfaces.",
                keywords=["interface", "aldehyde amine", "mechanism"],
                fulltext_status="open_access",
            ),
        ]
        for paper in papers:
            self.papers[paper.id] = paper
            version = PaperVersion(
                id=make_id("ver"),
                paper_id=paper.id,
                source="OpenAlex",
                source_identifier=paper.id,
                version_type="published",
                title=paper.title,
                url=f"https://example.org/{paper.id}",
                license="open-metadata",
            )
            self.paper_versions[version.id] = version

    def audit(
        self,
        action: str,
        requirement_id: str,
        user_id: str | None = None,
        project_id: str | None = None,
    ) -> AuditLog:
        log = AuditLog(
            id=make_id("audit"),
            user_id=user_id,
            project_id=project_id,
            action=action,
            requirement_id=requirement_id,
        )
        self.audit_logs[log.id] = log
        return log

    def add_cost(
        self,
        user_id: str,
        feature: str,
        requirement_id: str,
        project_id: str | None = None,
        paper_id: str | None = None,
        provider: str = "mock",
        model: str = "mock-research-radar",
        quota_delta: int = 0,
        estimated_cost: float = 0.0,
        task_id: str | None = None,
        input_tokens: int | None = None,
        output_tokens: int | None = None,
    ) -> CostRecord:
        record = CostRecord(
            id=make_id("cost"),
            user_id=user_id,
            project_id=project_id,
            paper_id=paper_id,
            feature=feature,
            provider=provider,
            model=model,
            quota_delta=quota_delta,
            estimated_cost=estimated_cost,
            task_id=task_id,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
        )
        self.costs[record.id] = record
        if quota_delta:
            user = self.users[user_id]
            user.quota_balance += quota_delta
            self.users[user.id] = user
        self.audit(feature, requirement_id, user_id=user_id, project_id=project_id)
        return record

    def ingest_source_record(
        self,
        task_id: str,
        record: NormalizedRecord,
    ) -> tuple[SourceRecord, Paper]:
        existing_source = next(
            (
                item
                for item in self.source_records.values()
                if item.source == record.source
                and item.source_identifier == record.source_identifier
            ),
            None,
        )
        if existing_source and existing_source.paper_id:
            return existing_source, self.papers[existing_source.paper_id]

        paper = match_existing(record, list(self.papers.values()))
        if not paper:
            paper = Paper(
                id=make_id("paper"),
                title=record.title,
                title_zh=record.title,
                year=record.year or date.today().year,
                journal=record.journal or "Unknown venue",
                doi=normalize_doi(record.doi),
                authors=record.authors,
                abstract=record.abstract,
                keywords=record.keywords,
                fulltext_status="open_access" if record.open_access else "unknown",
                source_count=0,
            )
            self.papers[paper.id] = paper
        else:
            if not paper.abstract and record.abstract:
                paper.abstract = record.abstract
            if not paper.doi and record.doi:
                paper.doi = normalize_doi(record.doi)
            if not paper.keywords and record.keywords:
                paper.keywords = record.keywords
            if paper.fulltext_status == "unknown" and record.open_access:
                paper.fulltext_status = "open_access"
            paper.updated_at = now_utc()

        source_record = existing_source or SourceRecord(
            id=make_id("src"),
            source=record.source,  # type: ignore[arg-type]
            source_identifier=record.source_identifier,
            search_task_id=task_id,
            raw_payload=record.raw_payload,
            normalized_payload=record.payload(),
            quality_score=record.quality_score,
            paper_id=paper.id,
        )
        source_record.paper_id = paper.id
        source_record.normalized_payload = record.payload()
        self.source_records[source_record.id] = source_record

        already_versioned = any(
            version.paper_id == paper.id
            and version.source.lower() == record.source
            and version.source_identifier == record.source_identifier
            for version in self.paper_versions.values()
        )
        if not already_versioned:
            version = PaperVersion(
                id=make_id("ver"),
                paper_id=paper.id,
                source=record.source,
                source_identifier=record.source_identifier,
                version_type="published",
                title=record.title,
                url=record.url,
                fulltext_url=record.fulltext_url,
                license=record.license,
                quality_score=record.quality_score,
            )
            self.paper_versions[version.id] = version
        paper.source_count = len(
            {version.source_identifier for version in self.paper_versions.values() if version.paper_id == paper.id}
        )
        return source_record, paper

    def project_papers(self, project_id: str) -> list[Paper]:
        task_ids = {
            task.id for task in self.search_tasks.values() if task.project_id == project_id
        }
        paper_ids = {
            source.paper_id
            for source in self.source_records.values()
            if source.search_task_id in task_ids and source.paper_id
        }
        if not paper_ids:
            if get_settings().retrieval_provider != "mock":
                return []
            return list(self.papers.values())
        return [paper for paper in self.papers.values() if paper.id in paper_ids]

    def create_recommendations(
        self,
        project_id: str,
        profile_id: str,
        force_refresh: bool = False,
    ) -> list[Recommendation]:
        existing = [
            item for item in self.recommendations.values() if item.project_id == project_id
        ]
        if existing and not force_refresh:
            return sorted(existing, key=lambda item: item.rank)

        profile = self.profiles[profile_id]
        project_feedback = [item for item in self.feedback.values() if item.project_id == project_id]
        existing_by_paper = {item.paper.id: item for item in existing}
        created = rank_papers(
            project_id=project_id,
            profile=profile,
            papers=self.project_papers(project_id),
            feedback=project_feedback,
            existing=existing_by_paper,
        )
        if created:
            for recommendation in created:
                self.recommendations[recommendation.id] = recommendation
            return created

        if get_settings().retrieval_provider != "mock":
            return []

        ranked_papers = [
            ("paper_bamboo_oxidation", "exact", 0.96),
            ("paper_cellulose_network", "exact", 0.91),
            ("paper_hot_pressing", "exact", 0.86),
            ("paper_chitosan_transfer", "method_transfer", 0.82),
            ("paper_mechanism_gap", "method_transfer", 0.8),
        ]
        created: list[Recommendation] = []
        for rank, (paper_id, channel, score) in enumerate(ranked_papers, start=1):
            if paper_id not in self.papers:
                continue
            paper = self.papers[paper_id]
            recommendation = Recommendation(
                id=make_id("rec"),
                project_id=project_id,
                paper=RecommendationPaper(
                    id=paper.id,
                    title=paper.title,
                    title_zh=paper.title_zh,
                    year=paper.year,
                    journal=paper.journal,
                    doi=paper.doi,
                ),
                profile_id=profile_id,
                channel=channel,  # type: ignore[arg-type]
                score_total=score,
                score_topic=round(score - 0.04, 2),
                score_method=round(score - 0.08, 2),
                score_material=round(score - 0.1, 2),
                score_mechanism=round(score - 0.13, 2),
                score_novelty=0.74,
                score_quality=0.82,
                score_heat=0.42,
                score_user_preference=0.5,
                rank=rank,
                explanation={
                    "topic": "命中用户研究对象或上位生物质材料方向",
                    "method": "命中高碘酸盐氧化、二胺交联或热压相关方法",
                    "score_basis": (
                        "主要贡献: topic="
                        f"{0.30 * (score - 0.04):.3f}, method={0.20 * (score - 0.08):.3f}, "
                        f"material={0.12 * (score - 0.1):.3f}; feedback_adjustment=0.000"
                    ),
                    "recommendation_type": "高相关" if channel == "exact" else "方法可借鉴",
                    "uncertainty": "基于种子样例评分，真实验收需使用评测集和人工标注。",
                    "usefulness": "可用于背景引用、方法比较或实验路线启发",
                },
                fulltext_status=paper.fulltext_status,
            )
            self.recommendations[recommendation.id] = recommendation
            created.append(recommendation)
        return created

    def create_report(self, user_id: str, project_id: str, report_type: str) -> RadarReport:
        from .notifications import create_report

        user = self.users[user_id]
        report = create_report(self, user, project_id, report_type)  # type: ignore[arg-type]
        return report

    def email_preference_for_user(self, user_id: str) -> EmailPreference:
        preference = next(
            (item for item in self.email_preferences.values() if item.user_id == user_id),
            None,
        )
        if preference:
            return preference
        preference = EmailPreference(id=make_id("emailpref"), user_id=user_id)
        self.email_preferences[preference.id] = preference
        return preference


store = InMemoryStore()
