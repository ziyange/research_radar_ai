"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import {
  Activity,
  Bell,
  BookOpen,
  BookmarkPlus,
  CheckCircle2,
  ClipboardList,
  Database,
  FileSearch,
  Inbox,
  Library,
  Loader2,
  MailX,
  Microscope,
  Pencil,
  RefreshCw,
  Search,
  Sparkles,
  WandSparkles,
  X,
  Zap,
} from "lucide-react";

import type {
  FeedbackType,
  Diagnosis,
  HealthStatus,
  KnowledgeItem,
  Message,
  PaperAnalysis,
  RadarReport,
  Recommendation,
  ResearchProfile,
  SearchTask,
  SourceRecord,
  TaskStatus,
  UserFeedback,
} from "../../lib/api";
import {
  channelLabels,
  feedbackLabels,
  fulltextLabels,
  knowledgeStatusLabels,
  sourceLabels,
  taskLabels,
} from "./workbench-config";
import { EmptyState, TagList } from "./workbench-ui";
import type { BusyKey } from "./workbench-types";

function profileState(profile: ResearchProfile | null) {
  if (!profile) {
    return "未生成画像";
  }
  return `v${profile.version} / ${profile.status} / 置信度 ${Math.round(profile.confidence * 100)}%`;
}

export function ProjectProgressPanel({
  diagnosis,
  profile,
  profileConfirmed,
  recommendationCount,
  taskRuns,
  onOpenDiagnosis,
  onOpenGap,
  onOpenTasks,
}: {
  diagnosis: Diagnosis | null;
  profile: ResearchProfile | null;
  profileConfirmed: boolean;
  recommendationCount: number;
  taskRuns: TaskStatus[];
  onOpenDiagnosis: () => void;
  onOpenGap: () => void;
  onOpenTasks: () => void;
}) {
  return (
    <section className="panel compact-panel">
      <div className="panel-header compact">
        <div>
          <p className="eyebrow">项目操作中心</p>
          <h2 className="panel-title">项目进展</h2>
        </div>
        <div className="state-badges">
          <span className={`state-badge ${profileConfirmed ? "done" : ""}`}>{profileState(profile)}</span>
          <span className="state-badge">{recommendationCount} 条推荐</span>
        </div>
      </div>
      <div className="summary-grid">
        <ProgressEntry
          icon={<Sparkles size={17} />}
          label="首日诊断"
          value={diagnosis?.technical_route ?? "确认画像后生成诊断"}
          onClick={onOpenDiagnosis}
        />
        <ProgressEntry
          icon={<Database size={17} />}
          label="研究空白"
          value={diagnosis?.research_gap_candidate ?? "等待推荐与反馈形成 gap"}
          onClick={onOpenGap}
        />
        <ProgressEntry
          icon={<Activity size={17} />}
          label="最近任务"
          value={taskRuns[0]?.message ?? "暂无任务运行记录"}
          onClick={onOpenTasks}
        />
      </div>
    </section>
  );
}

function ProgressEntry({
  icon,
  label,
  onClick,
  value,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  value: string;
}) {
  return (
    <button className="summary-item interactive" type="button" onClick={onClick}>
      {icon}
      <span>{label}</span>
      <b>{value}</b>
      <em>查看详情</em>
    </button>
  );
}

export function RecommendationRadarPanel({
  analysisPaperIds,
  busy,
  feedbackItems,
  knowledgeItems,
  knowledgeQuery,
  onFeedback,
  onOpenPaper,
  onRefresh,
  onRunSearch,
  onSelect,
  recommendations,
  selectedRecommendation,
  setKnowledgeQuery,
  sourceSummaryForPaper,
}: {
  analysisPaperIds: Set<string>;
  busy: Partial<Record<BusyKey, boolean>>;
  feedbackItems: UserFeedback[];
  knowledgeItems: KnowledgeItem[];
  knowledgeQuery: string;
  onFeedback: (recommendation: Recommendation, feedbackType: FeedbackType) => void;
  onOpenPaper: (recommendation: Recommendation) => void;
  onRefresh: () => void;
  onRunSearch: () => void;
  onSelect: (recommendation: Recommendation) => void;
  recommendations: Recommendation[];
  selectedRecommendation: Recommendation | null;
  setKnowledgeQuery: (value: string) => void;
  sourceSummaryForPaper: (paperId: string) => string;
}) {
  return (
    <section className="panel recommendations">
      <div className="panel-header">
        <div>
          <p className="eyebrow">E2E-002 / 推荐闭环</p>
          <h2 className="panel-title">项目推荐列表</h2>
        </div>
        <div className="panel-tools">
          <label className="panel-search">
            <Search size={15} aria-hidden="true" />
            <input
              placeholder="筛选论文、来源、原因"
              value={knowledgeQuery}
              onChange={(event) => setKnowledgeQuery(event.target.value)}
            />
          </label>
          <button className="primary-button" type="button" disabled={busy.search} onClick={onRunSearch}>
            {busy.search ? <Loader2 className="spin" size={16} /> : <Zap size={16} />}
            {busy.search ? "运行中" : "生成检索"}
          </button>
          <button className="ghost-button" type="button" disabled={busy.recommend} onClick={onRefresh}>
            <RefreshCw size={16} />
            刷新推荐
          </button>
        </div>
      </div>

      <div className="paper-list">
        {busy.search || busy.recommend ? <EmptyState text="正在同步推荐结果..." /> : null}
        {!busy.search && !busy.recommend && recommendations.length === 0 ? (
          <EmptyState text="确认画像后先生成检索任务，推荐结果会在这里形成可反馈列表。" />
        ) : (
          recommendations.map((recommendation) => (
            <RecommendationRow
              feedback={feedbackItems.find((item) => item.recommendation_id === recommendation.id)}
              isActive={selectedRecommendation?.id === recommendation.id}
              isAnalyzed={analysisPaperIds.has(recommendation.paper.id)}
              isInKnowledge={knowledgeItems.some((item) => item.paper_id === recommendation.paper.id)}
              key={recommendation.id}
              recommendation={recommendation}
              sourceSummary={sourceSummaryForPaper(recommendation.paper.id)}
              onFeedback={onFeedback}
              onOpenPaper={() => onOpenPaper(recommendation)}
              onSelect={() => onSelect(recommendation)}
            />
          ))
        )}
      </div>
    </section>
  );
}

function RecommendationRow({
  feedback,
  isActive,
  isAnalyzed,
  isInKnowledge,
  onFeedback,
  onOpenPaper,
  onSelect,
  recommendation,
  sourceSummary,
}: {
  feedback?: UserFeedback;
  isActive: boolean;
  isAnalyzed: boolean;
  isInKnowledge: boolean;
  onFeedback: (recommendation: Recommendation, feedbackType: FeedbackType) => void;
  onOpenPaper: () => void;
  onSelect: () => void;
  recommendation: Recommendation;
  sourceSummary: string;
}) {
  const feedbackText = feedback ? feedbackLabels[feedback.feedback_type as FeedbackType] : "等待反馈";
  const explanation = [
    recommendation.explanation.recommendation_type,
    recommendation.explanation.topic,
    recommendation.explanation.method,
  ].filter(Boolean);

  return (
    <article
      className={`paper-row ${isActive ? "active" : ""}`}
      onClick={() => {
        onSelect();
        onOpenPaper();
      }}
    >
      <span className={`paper-dot ${recommendation.channel === "method_transfer" ? "amber" : ""}`} />
      <div className="paper-main">
        <h3 className="paper-title">{recommendation.paper.title}</h3>
        <div className="paper-meta">
          <span>{recommendation.paper.title_zh}</span>
          <span>{recommendation.paper.journal}</span>
          <span>{recommendation.paper.year}</span>
          <span>来源：{sourceSummary}</span>
        </div>
        <div className="paper-tags">
          <span className="tag">{channelLabels[recommendation.channel]}</span>
          <span className="tag">{fulltextLabels[recommendation.fulltext_status]}</span>
          <span className={`tag ${isAnalyzed ? "solid" : ""}`}>{isAnalyzed ? "AI 已分析" : "待 AI 分析"}</span>
          <span className={`tag ${isInKnowledge ? "solid" : ""}`}>{isInKnowledge ? "已入知识库" : "未沉淀"}</span>
          {explanation.map((item) => (
            <span className="tag muted" key={item}>
              {item}
            </span>
          ))}
        </div>
      </div>
      <div className="paper-side">
        <div className="relevance">相关度 {Math.round(recommendation.score_total * 100)}%</div>
        <button
          className="ghost-button small"
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onSelect();
            onOpenPaper();
          }}
        >
          <FileSearch size={14} />
          详情
        </button>
        <div className="feedback-pill">{feedbackText}</div>
        <div className="paper-actions">
          <button
            className="paper-action"
            aria-label="标记高度相关"
            title="高度相关"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onFeedback(recommendation, "very_relevant");
            }}
          >
            <CheckCircle2 size={15} />
          </button>
          <button
            className="paper-action"
            aria-label="标记方法可借鉴"
            title="方法可借鉴"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onFeedback(recommendation, "method_useful");
            }}
          >
            <Microscope size={15} />
          </button>
          <button
            className="paper-action"
            aria-label="标记不相关"
            title="不相关"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onFeedback(recommendation, "irrelevant");
            }}
          >
            <X size={15} />
          </button>
        </div>
      </div>
    </article>
  );
}

export function ProfilePanel({
  onEdit,
  profile,
}: {
  onEdit: () => void;
  profile: ResearchProfile | null;
}) {
  return (
    <section className="panel profile-panel">
      <div className="panel-header compact">
        <div>
          <p className="eyebrow">E2E-001</p>
          <h2 className="panel-title">我的研究画像</h2>
        </div>
        <button className="icon-button" type="button" aria-label="编辑画像" onClick={onEdit}>
          {profile ? <Pencil size={16} /> : <WandSparkles size={16} />}
        </button>
      </div>
      {profile ? (
        <div className="profile-body">
          <ProfileRow label="研究对象" values={profile.research_object} />
          <ProfileRow label="研究方法" values={profile.methods} />
          <ProfileRow label="核心材料" values={profile.materials} />
          <ProfileRow label="性能指标" values={profile.metrics} />
          <ProfileRow label="中文关键词" values={profile.keywords_zh} />
          <ProfileRow label="排除方向" values={profile.exclusions} />
        </div>
      ) : (
        <EmptyState text="新建项目后，用一句话生成可编辑研究画像。" />
      )}
    </section>
  );
}

function ProfileRow({ label, values }: { label: string; values: string[] }) {
  return (
    <div className="profile-row">
      <span>{label}</span>
      <TagList values={values} limit={4} />
    </div>
  );
}

export function SourcesPanel({
  health,
  onOpenSources,
  searchTasks,
  sourceRecords,
  taskRuns,
}: {
  health: HealthStatus | null;
  onOpenSources: (taskId?: string) => void;
  searchTasks: SearchTask[];
  sourceRecords: Record<string, SourceRecord[]>;
  taskRuns: TaskStatus[];
}) {
  const provider = health?.retrieval_provider ?? "mock";
  return (
    <section className="panel mini-panel source-panel">
      <div className="panel-header compact">
        <div>
          <p className="eyebrow">SourceRecord</p>
          <h2 className="panel-title">检索数据源</h2>
        </div>
        <span className={`source-provider ${provider}`}>{sourceLabels[provider]}</span>
      </div>
      <div className="source-body">
        <div className="source-meta">
          <span>AI：{health?.ai?.provider ?? health?.ai_provider ?? "-"}</span>
          <span>{health?.ai?.configured ? "AI 已配置" : "AI 未配置"}</span>
          <span>{provider === "mock" ? "当前为开发模拟，不代表真实数据库覆盖" : "OpenAlex/Crossref live"}</span>
        </div>
        {searchTasks.length === 0 ? (
          <EmptyState text="生成检索任务后展示来源状态、入库记录和 Paper 关联。" />
        ) : (
          <div className="source-list">
            {searchTasks.map((task) => {
              const status = taskRuns.find((run) => run.task_id === task.id);
              const records = sourceRecords[task.id] ?? [];
              return (
                <button className="source-row" key={task.id} type="button" onClick={() => onOpenSources(task.id)}>
                  <div className="source-row-main">
                    <b>{taskLabels[task.task_type]}</b>
                    <span>{task.query_text}</span>
                  </div>
                  <strong>{records.length} 条入库</strong>
                  <div className="source-status-grid">
                    {status?.source_statuses.length ? (
                      status.source_statuses.map((sourceStatus) => (
                        <span
                          className={`source-pill ${sourceStatus.status}`}
                          key={`${task.id}-${sourceStatus.source}`}
                          title={sourceStatus.error_message ?? undefined}
                        >
                          {sourceStatus.source}: {sourceStatus.status}
                          {sourceStatus.record_count ? ` / ${sourceStatus.record_count}` : ""}
                        </span>
                      ))
                    ) : (
                      <span className="source-pill pending">等待运行</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

export function ReadingPanel({
  analysis,
  busy,
  onAddKnowledge,
  onAnalyze,
  onOpenAnalysis,
  selectedRecommendation,
}: {
  analysis: PaperAnalysis | null;
  busy: Partial<Record<BusyKey, boolean>>;
  onAddKnowledge: () => void;
  onAnalyze: (analysisType: "quick" | "standard") => void;
  onOpenAnalysis: () => void;
  selectedRecommendation: Recommendation | null;
}) {
  return (
    <section className="panel action-panel">
      <div className="panel-header compact">
        <div>
          <p className="eyebrow">E2E-003</p>
          <h2 className="panel-title">研读与沉淀</h2>
        </div>
      </div>
      <div className="profile-body compact">
        {selectedRecommendation ? (
          <>
            <h3 className="paper-title">{selectedRecommendation.paper.title_zh}</h3>
            <p className="stat-label">{selectedRecommendation.paper.title}</p>
            <div className="button-grid">
              <button className="primary-button" type="button" disabled={busy.analysis} onClick={() => onAnalyze("quick")}>
                <Sparkles size={16} />
                快速分析
              </button>
              <button className="ghost-button" type="button" disabled={busy.analysis} onClick={() => onAnalyze("standard")}>
                <BookOpen size={16} />
                标准研读
              </button>
              <button className="ghost-button" type="button" disabled={busy.knowledge} onClick={onAddKnowledge}>
                <BookmarkPlus size={16} />
                加入知识库
              </button>
              <button className="ghost-button" type="button" disabled={!analysis} onClick={onOpenAnalysis}>
                <FileSearch size={16} />
                分析详情
              </button>
            </div>
            {analysis ? (
              <button className="analysis-box interactive-box" type="button" onClick={onOpenAnalysis}>
                <b>{String(analysis.result.one_sentence_conclusion ?? "AI 分析已完成")}</b>
                <span>{String(analysis.result.relation_to_project ?? "查看结构化结论、证据和成本。")}</span>
              </button>
            ) : null}
          </>
        ) : (
          <EmptyState text="选择一条推荐后可进行 AI 研读、收藏和沉淀。" />
        )}
      </div>
    </section>
  );
}

export function KnowledgePanel({
  busy,
  knowledgeItems,
  knowledgeQuery,
  onOpenKnowledge,
  onSearch,
  setKnowledgeQuery,
}: {
  busy: Partial<Record<BusyKey, boolean>>;
  knowledgeItems: KnowledgeItem[];
  knowledgeQuery: string;
  onOpenKnowledge: (item: KnowledgeItem) => void;
  onSearch: () => void;
  setKnowledgeQuery: (value: string) => void;
}) {
  return (
    <section className="panel mini-panel">
      <div className="panel-header compact">
        <div>
          <p className="eyebrow">KnowledgeItem</p>
          <h2 className="panel-title">知识库结果</h2>
        </div>
        <Link className="ghost-button small" href="/knowledge">
          <Library size={14} />
          全部
        </Link>
      </div>
      <div className="mini-search-row">
        <label className="panel-search">
          <Search size={14} aria-hidden="true" />
          <input
            placeholder="搜索知识库"
            value={knowledgeQuery}
            onChange={(event) => setKnowledgeQuery(event.target.value)}
          />
        </label>
        <button className="ghost-button small" type="button" disabled={busy.knowledge} onClick={onSearch}>
          <Search size={14} />
          搜索
        </button>
      </div>
      <div className="mini-list">
        {knowledgeItems.length === 0 ? (
          <EmptyState text="加入论文后可点击条目查看详情、状态、标签和备注。" />
        ) : (
          knowledgeItems.slice(0, 4).map((item) => (
            <button className="compact-row clickable" key={item.id} type="button" onClick={() => onOpenKnowledge(item)}>
              <b>{knowledgeStatusLabels[item.status]}</b>
              <span>{item.tags.join("、") || "未设置标签"}</span>
              <span>{item.note ?? "暂无备注"}</span>
            </button>
          ))
        )}
      </div>
    </section>
  );
}

export function ReportsPanel({
  busy,
  emailUnsubscribed,
  messages,
  onGenerateReport,
  onOpenMessage,
  onOpenReport,
  onUnsubscribeEmail,
  reports,
}: {
  busy: Partial<Record<BusyKey, boolean>>;
  emailUnsubscribed: boolean;
  messages: Message[];
  onGenerateReport: (reportType: "daily" | "weekly") => void;
  onOpenMessage: (message: Message) => void;
  onOpenReport: (report: RadarReport) => void;
  onUnsubscribeEmail: () => void;
  reports: RadarReport[];
}) {
  return (
    <section className="panel mini-panel">
      <div className="panel-header compact">
        <div>
          <p className="eyebrow">E2E-004</p>
          <h2 className="panel-title">报告与消息</h2>
        </div>
        <Link className="ghost-button small" href="/reports">
          <Inbox size={14} />
          全部
        </Link>
      </div>
      <div className="report-actions">
        <button className="primary-button" type="button" disabled={busy.report} onClick={() => onGenerateReport("daily")}>
          <Bell size={16} />
          日报
        </button>
        <button className="ghost-button" type="button" disabled={busy.report} onClick={() => onGenerateReport("weekly")}>
          <ClipboardList size={16} />
          周报
        </button>
        <button className="ghost-button" type="button" disabled={emailUnsubscribed || busy.message} onClick={onUnsubscribeEmail}>
          <MailX size={16} />
          {emailUnsubscribed ? "已退订" : "退订"}
        </button>
      </div>
      <div className="mini-list split">
        {reports.slice(0, 2).map((report) => (
          <button className="message-row" key={report.id} type="button" onClick={() => onOpenReport(report)}>
            <b>{report.report_type === "daily" ? "每日科研雷达" : "每周科研周报"}</b>
            <span>{report.message_status}</span>
            <em>{report.period_start} - {report.period_end}</em>
          </button>
        ))}
        {messages.length === 0 && reports.length === 0 ? <EmptyState text="暂无报告或站内消息。" /> : null}
        {messages.slice(0, 3).map((message) => (
          <button className="message-row" key={message.id} type="button" onClick={() => onOpenMessage(message)}>
            <b>{message.title}</b>
            <span>{message.body}</span>
            <em>{message.read ? "已读" : "未读"}</em>
          </button>
        ))}
      </div>
    </section>
  );
}
