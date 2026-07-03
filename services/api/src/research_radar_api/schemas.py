from datetime import date, datetime, timezone
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, Field


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def make_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:12]}"


class ApiEnvelope(BaseModel):
    request_id: str
    data: Any


class ErrorBody(BaseModel):
    code: str
    message: str
    details: dict[str, Any] = Field(default_factory=dict)


class ErrorEnvelope(BaseModel):
    request_id: str
    error: ErrorBody


class User(BaseModel):
    id: str
    email: str
    display_name: str
    role: Literal["user", "admin"] = "user"
    plan: Literal["free", "student", "pro", "team"] = "free"
    quota_balance: int = 100


class RegisterRequest(BaseModel):
    email: str
    password: str = Field(min_length=6)
    display_name: str = "Researcher"


class LoginRequest(BaseModel):
    email: str
    password: str


class AuthResponse(BaseModel):
    user: User
    session_token: str


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1)
    discipline: str | None = None
    description: str | None = None


class ProjectUpdate(BaseModel):
    name: str | None = None
    discipline: str | None = None
    description: str | None = None


class ResearchProject(BaseModel):
    id: str
    owner_id: str
    name: str
    discipline: str | None = None
    description: str | None = None
    status: Literal["active", "archived"] = "active"
    current_profile_id: str | None = None
    created_at: datetime = Field(default_factory=now_utc)
    updated_at: datetime = Field(default_factory=now_utc)


class ProfileGenerateRequest(BaseModel):
    one_sentence: str
    foundation_paper_ids: list[str] = Field(default_factory=list)
    material_ids: list[str] = Field(default_factory=list)


class ResearchProfilePatch(BaseModel):
    research_object: list[str] | None = None
    methods: list[str] | None = None
    materials: list[str] | None = None
    metrics: list[str] | None = None
    keywords_zh: list[str] | None = None
    keywords_en: list[str] | None = None
    exclusions: list[str] | None = None


class ResearchProfile(BaseModel):
    id: str
    project_id: str
    version: int
    status: Literal["draft", "confirmed", "superseded"] = "draft"
    source_type: Literal["one_sentence", "papers", "materials", "feedback", "manual"]
    discipline: str | None = None
    subfield: str | None = None
    research_object: list[str] = Field(default_factory=list)
    research_questions: list[str] = Field(default_factory=list)
    goals: list[str] = Field(default_factory=list)
    methods: list[str] = Field(default_factory=list)
    materials: list[str] = Field(default_factory=list)
    reagents: list[str] = Field(default_factory=list)
    metrics: list[str] = Field(default_factory=list)
    mechanisms: list[str] = Field(default_factory=list)
    applications: list[str] = Field(default_factory=list)
    keywords_zh: list[str] = Field(default_factory=list)
    keywords_en: list[str] = Field(default_factory=list)
    synonyms: list[str] = Field(default_factory=list)
    exclusions: list[str] = Field(default_factory=list)
    preferences: dict[str, Any] = Field(default_factory=dict)
    confidence: float = 0.72
    created_at: datetime = Field(default_factory=now_utc)


class UploadRecord(BaseModel):
    id: str
    project_id: str
    upload_type: Literal["foundation_paper", "research_material"]
    filename: str
    content_type: str
    size: int
    status: Literal["queued", "parsed", "failed"] = "queued"
    created_at: datetime = Field(default_factory=now_utc)


class Paper(BaseModel):
    id: str
    title: str
    title_zh: str
    year: int
    journal: str
    doi: str | None = None
    authors: list[str] = Field(default_factory=list)
    abstract: str | None = None
    keywords: list[str] = Field(default_factory=list)
    fulltext_status: Literal["open_access", "author_manuscript", "repository", "unknown"] = (
        "unknown"
    )
    source_count: int = 0
    created_at: datetime = Field(default_factory=now_utc)
    updated_at: datetime = Field(default_factory=now_utc)


class PaperVersion(BaseModel):
    id: str
    paper_id: str
    source: str
    source_identifier: str
    version_type: Literal["preprint", "published", "early_access", "author_manuscript", "unknown"]
    title: str | None = None
    url: str | None = None
    fulltext_url: str | None = None
    license: str | None = None
    quality_score: float = 0.75


class SourceRecord(BaseModel):
    id: str
    source: Literal["openalex", "crossref", "semantic_scholar", "arxiv"]
    source_identifier: str
    search_task_id: str
    raw_payload: dict[str, Any]
    normalized_payload: dict[str, Any] | None = None
    fetched_at: datetime = Field(default_factory=now_utc)
    quality_score: float = 0.75
    paper_id: str | None = None


class SearchTask(BaseModel):
    id: str
    project_id: str
    profile_id: str
    task_type: Literal["exact", "expanded", "method_transfer", "citation_network", "exploratory"]
    query_text: str
    language: Literal["zh", "en", "mixed"] = "en"
    filters: dict[str, Any] = Field(default_factory=dict)
    status: Literal["pending", "running", "succeeded", "failed", "paused"] = "pending"
    last_run_at: datetime | None = None
    next_run_at: datetime | None = None


class RecommendationPaper(BaseModel):
    id: str
    title: str
    title_zh: str
    year: int
    journal: str
    doi: str | None = None


class Recommendation(BaseModel):
    id: str
    project_id: str
    paper: RecommendationPaper
    profile_id: str
    channel: Literal["exact", "explore", "method_transfer"]
    score_total: float
    score_topic: float
    score_method: float
    score_material: float
    score_mechanism: float
    score_novelty: float
    score_quality: float
    score_heat: float
    score_user_preference: float = 0.0
    rank: int
    explanation: dict[str, str]
    fulltext_status: Literal["open_access", "author_manuscript", "repository", "unknown"]
    batch_date: date = Field(default_factory=date.today)
    created_at: datetime = Field(default_factory=now_utc)


class RecommendationList(BaseModel):
    items: list[Recommendation]
    next_cursor: str | None = None


class FeedbackRequest(BaseModel):
    feedback_type: Literal[
        "very_relevant",
        "method_useful",
        "background_citation",
        "irrelevant",
        "exclude_material",
        "exclude_application",
        "want_more",
        "add_to_experiment",
        "add_to_writing",
    ]
    note: str | None = None


class UserFeedback(BaseModel):
    id: str
    user_id: str
    project_id: str
    paper_id: str
    recommendation_id: str | None = None
    feedback_type: str
    note: str | None = None
    created_at: datetime = Field(default_factory=now_utc)


class ClaimEvidence(BaseModel):
    paper_id: str
    section: str | None = None
    quote: str | None = None
    traceable: bool = True


class AnalysisClaim(BaseModel):
    claim: str
    fact_level: Literal[
        "source_explicit",
        "ai_summary",
        "cross_paper_comparison",
        "ai_inference",
        "research_inspiration",
    ]
    evidence: ClaimEvidence


class AnalysisRequest(BaseModel):
    project_id: str | None = None
    analysis_type: Literal["quick", "standard"] = "quick"
    input_scope: Literal["metadata", "abstract", "fulltext"] = "abstract"


class PaperAnalysis(BaseModel):
    id: str
    paper_id: str
    project_id: str | None = None
    analysis_type: Literal["quick", "standard"]
    input_scope: Literal["metadata", "abstract", "fulltext"]
    language: str = "zh"
    result: dict[str, Any]
    claims: list[AnalysisClaim]
    evidence_labels_valid: bool = True
    traceability_score: float = 0.86
    model: str = "mock-research-radar"
    cost_record_id: str | None = None
    created_at: datetime = Field(default_factory=now_utc)


class KnowledgeCreate(BaseModel):
    paper_id: str
    status: Literal["saved", "read", "read_later", "irrelevant"] = "saved"
    tags: list[str] = Field(default_factory=list)
    note: str | None = None


class KnowledgePatch(BaseModel):
    status: Literal["saved", "read", "read_later", "irrelevant"] | None = None
    tags: list[str] | None = None
    note: str | None = None


class KnowledgeItem(BaseModel):
    id: str
    user_id: str
    project_id: str
    paper_id: str
    status: Literal["saved", "read", "read_later", "irrelevant"]
    tags: list[str] = Field(default_factory=list)
    note: str | None = None
    created_at: datetime = Field(default_factory=now_utc)
    updated_at: datetime = Field(default_factory=now_utc)


class RadarReport(BaseModel):
    id: str
    user_id: str
    project_id: str
    report_type: Literal["daily", "weekly"]
    period_start: date
    period_end: date
    content: dict[str, Any]
    message_status: Literal["draft", "published", "emailed", "failed"] = "published"
    created_at: datetime = Field(default_factory=now_utc)


class Message(BaseModel):
    id: str
    user_id: str
    report_id: str | None = None
    title: str
    body: str
    read: bool = False
    created_at: datetime = Field(default_factory=now_utc)


class EmailPreference(BaseModel):
    id: str
    user_id: str
    reports_unsubscribed: bool = False
    unsubscribed_at: datetime | None = None
    updated_at: datetime = Field(default_factory=now_utc)


class EmailOutboxRecord(BaseModel):
    id: str
    user_id: str
    recipient_email: str
    report_id: str
    report_type: Literal["daily", "weekly"]
    subject: str
    status: Literal["queued", "sent", "failed"]
    failure_reason: str | None = None
    unsubscribed: bool = False
    provider: Literal["mock", "smtp", "api", "agent_mail"] = "mock"
    created_at: datetime = Field(default_factory=now_utc)
    sent_at: datetime | None = None


class CostRecord(BaseModel):
    id: str
    user_id: str
    project_id: str | None = None
    paper_id: str | None = None
    feature: str
    provider: str | None = None
    model: str | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    api_calls: int = 1
    estimated_cost: float = 0.0
    quota_delta: int = 0
    task_id: str | None = None
    created_at: datetime = Field(default_factory=now_utc)


class TaskStatus(BaseModel):
    task_id: str
    type: str
    status: Literal["pending", "running", "succeeded", "failed", "retrying", "cancelled", "waiting"]
    retryable: bool = False
    retry_count: int = 0
    error_code: str | None = None
    message: str | None = None
    degraded: bool = False
    source_statuses: list[dict[str, Any]] = Field(default_factory=list)


class AuditLog(BaseModel):
    id: str
    user_id: str | None = None
    project_id: str | None = None
    action: str
    requirement_id: str
    created_at: datetime = Field(default_factory=now_utc)
