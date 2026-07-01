from __future__ import annotations

from datetime import date, timedelta
from typing import TYPE_CHECKING, Literal

from .schemas import EmailOutboxRecord, Message, RadarReport, User, make_id, now_utc
from .settings import Settings

if TYPE_CHECKING:
    from .schemas import Recommendation
    from .store import InMemoryStore


ReportType = Literal["daily", "weekly"]


def report_title(report_type: ReportType) -> str:
    return "每日科研雷达" if report_type == "daily" else "每周科研周报"


def build_daily_content(recommendations: list[Recommendation], deduped_count: int) -> dict[str, object]:
    high_relevance = [item.paper.title_zh for item in recommendations if item.score_total >= 0.8]
    if not high_relevance:
        high_relevance = [item.paper.title_zh for item in recommendations[:3]]
    method_inspirations = [
        item.paper.title_zh for item in recommendations if item.channel == "method_transfer"
    ]
    return {
        "new_papers": len(recommendations),
        "deduped_papers": deduped_count,
        "high_relevance": high_relevance[:5],
        "suggested_deep_reads": high_relevance[:2] or [item.paper.title_zh for item in recommendations[:1]],
        "method_inspirations": method_inspirations[:3],
        "next_actions": ["标记高相关论文", "选择 1 篇论文做标准研读", "将方法启发沉淀到知识库"],
    }


def build_weekly_content(
    recommendations: list[Recommendation],
    knowledge_growth: int,
    positive_feedback: int,
    negative_feedback: int,
) -> dict[str, object]:
    high_value = [item.paper.title_zh for item in recommendations if item.score_total >= 0.82]
    if not high_value:
        high_value = [item.paper.title_zh for item in recommendations[:5]]
    method_count = sum(1 for item in recommendations if item.channel == "method_transfer")
    exact_count = sum(1 for item in recommendations if item.channel == "exact")
    return {
        "high_value_papers": high_value[:7],
        "trends": [
            f"精确相关论文 {exact_count} 篇，方法迁移论文 {method_count} 篇。",
            "高相关方法、评价指标和研究空白变化仍是本周主要信号。",
        ],
        "knowledge_growth": knowledge_growth,
        "feedback_changes": {
            "positive": positive_feedback,
            "negative": negative_feedback,
            "summary": f"本周正向反馈 {positive_feedback} 条，负向纠偏 {negative_feedback} 条。",
        },
        "next_week_suggestions": [
            "优先深读高价值论文前 2 篇。",
            "补充方法迁移论文的可复现实验条件。",
            "把负反馈原因写入排除方向，减少下周噪音。",
        ],
    }


def build_report_content(store: InMemoryStore, project_id: str, report_type: ReportType) -> dict[str, object]:
    recommendations = sorted(
        [item for item in store.recommendations.values() if item.project_id == project_id],
        key=lambda item: item.rank,
    )
    if not recommendations:
        project = store.projects[project_id]
        if project.current_profile_id:
            recommendations = store.create_recommendations(project_id, project.current_profile_id)

    deduped_count = len({item.paper.id for item in recommendations})
    if report_type == "daily":
        return build_daily_content(recommendations, deduped_count)

    feedback = [item for item in store.feedback.values() if item.project_id == project_id]
    positive_types = {"very_relevant", "method_useful", "want_more", "add_to_experiment", "add_to_writing"}
    negative_types = {"irrelevant", "exclude_material", "exclude_application"}
    return build_weekly_content(
        recommendations=recommendations,
        knowledge_growth=len([item for item in store.knowledge.values() if item.project_id == project_id]),
        positive_feedback=sum(1 for item in feedback if item.feedback_type in positive_types),
        negative_feedback=sum(1 for item in feedback if item.feedback_type in negative_types),
    )


def create_report(store: InMemoryStore, user: User, project_id: str, report_type: ReportType) -> RadarReport:
    today = date.today()
    period_start = today if report_type == "daily" else today - timedelta(days=6)
    report = RadarReport(
        id=make_id("report"),
        user_id=user.id,
        project_id=project_id,
        report_type=report_type,
        period_start=period_start,
        period_end=today,
        content=build_report_content(store, project_id, report_type),
    )
    store.reports[report.id] = report
    return report


def create_message(store: InMemoryStore, user_id: str, report: RadarReport) -> Message:
    if report.report_type == "daily":
        count = report.content.get("new_papers", 0)
        body = f"今日新增 {count} 篇候选论文，已整理高相关论文和建议深读清单。"
    else:
        count = len(report.content.get("high_value_papers", []))
        body = f"本周筛出 {count} 篇高价值论文，已汇总趋势、知识库增长和下周建议。"
    message = Message(
        id=make_id("msg"),
        user_id=user_id,
        report_id=report.id,
        title=f"{report_title(report.report_type)}已生成",
        body=body,
    )
    store.messages[message.id] = message
    return message


def create_email_outbox(
    store: InMemoryStore,
    user: User,
    report: RadarReport,
    settings: Settings,
) -> EmailOutboxRecord | None:
    preference = store.email_preference_for_user(user.id)
    if preference.reports_unsubscribed:
        return None

    should_fail = settings.email_mock_force_failure or "fail" in user.email.lower()
    status: Literal["sent", "failed"] = "failed" if should_fail else "sent"
    record = EmailOutboxRecord(
        id=make_id("email"),
        user_id=user.id,
        recipient_email=user.email,
        report_id=report.id,
        report_type=report.report_type,
        subject=f"{report_title(report.report_type)} - {report.period_end.isoformat()}",
        status=status,
        failure_reason="Mock email provider forced failure." if should_fail else None,
        unsubscribed=preference.reports_unsubscribed,
        provider=settings.email_provider,
        sent_at=None if should_fail else now_utc(),
    )
    store.email_outbox[record.id] = record
    report.message_status = "failed" if should_fail else "emailed"
    store.reports[report.id] = report
    return record


def publish_report_notifications(
    store: InMemoryStore,
    user: User,
    report: RadarReport,
    settings: Settings,
) -> EmailOutboxRecord | None:
    create_message(store, user.id, report)
    return create_email_outbox(store, user, report, settings)
