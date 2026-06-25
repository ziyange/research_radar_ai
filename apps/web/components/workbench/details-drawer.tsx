"use client";

import type { ReactNode } from "react";
import { BookOpen, ExternalLink, Loader2, RefreshCw, Save, Sparkles } from "lucide-react";

import type {
  Diagnosis,
  KnowledgeItem,
  Message,
  Paper,
  PaperAnalysis,
  PaperVersion,
  RadarReport,
  Recommendation,
  SearchTask,
  SourceRecord,
  TaskStatus,
} from "../../lib/api";
import {
  factLevelLabels,
  futureSourceNotes,
  knowledgeStatusLabels,
  taskLabels,
} from "./workbench-config";
import { DetailDrawer, EmptyState, TagList } from "./workbench-ui";
import type { DetailView, KnowledgeDraft } from "./workbench-types";

function asText(value: unknown, fallback = "暂无") {
  if (Array.isArray(value)) {
    return value.length ? value.join("、") : fallback;
  }
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return fallback;
}

function sourceRecordTitle(record: SourceRecord) {
  return record.normalized_payload?.title ?? record.source_identifier;
}

function sourceRecordDoi(record: SourceRecord) {
  return record.normalized_payload?.doi ?? "无 DOI";
}

function fullPaperLink(paper: Paper | null, versions: PaperVersion[]) {
  return (
    versions.find((version) => version.fulltext_url)?.fulltext_url ??
    versions.find((version) => version.url)?.url ??
    (paper?.doi ? `https://doi.org/${paper.doi}` : null)
  );
}

export function WorkbenchDetailDrawer({
  analysis,
  detail,
  diagnosis,
  knowledgeDetail,
  knowledgeDraft,
  onAnalyze,
  onClose,
  onEditProfile,
  onKnowledgeDraftChange,
  onReadMessage,
  onRetryTask,
  onRunSearch,
  onSaveKnowledge,
  paper,
  paperAnalyses,
  paperVersions,
  recommendation,
  reportDetail,
  messageDetail,
  selectedSourceTask,
  selectedSourceRecords,
  taskRuns,
  searchTasks,
  isBusy,
}: {
  analysis: PaperAnalysis | null;
  detail: DetailView;
  diagnosis: Diagnosis | null;
  knowledgeDetail: KnowledgeItem | null;
  knowledgeDraft: KnowledgeDraft;
  onAnalyze: (analysisType: "quick" | "standard") => void;
  onClose: () => void;
  onEditProfile: () => void;
  onKnowledgeDraftChange: (draft: KnowledgeDraft) => void;
  onReadMessage: (message: Message) => void;
  onRetryTask: (taskId: string) => void;
  onRunSearch: () => void;
  onSaveKnowledge: () => void;
  paper: Paper | null;
  paperAnalyses: PaperAnalysis[];
  paperVersions: PaperVersion[];
  recommendation: Recommendation | null;
  reportDetail: RadarReport | null;
  messageDetail: Message | null;
  selectedSourceTask: SearchTask | null;
  selectedSourceRecords: SourceRecord[];
  taskRuns: TaskStatus[];
  searchTasks: SearchTask[];
  isBusy: boolean;
}) {
  if (!detail) {
    return null;
  }

  if (detail.kind === "diagnosis") {
    return (
      <DetailDrawer title="首日诊断详情" subtitle="技术路线 / 系统理解 / 推荐入口" onClose={onClose}>
        {diagnosis ? (
          <div className="detail-stack">
            <DetailSection title="系统理解">
              <div className="detail-grid">
                <InfoBlock label="研究对象" value={<TagList values={diagnosis.understanding.research_object} />} />
                <InfoBlock label="方法链路" value={<TagList values={diagnosis.understanding.methods} />} />
                <InfoBlock label="材料范围" value={<TagList values={diagnosis.understanding.materials} />} />
              </div>
            </DetailSection>
            <DetailSection title="技术路线">
              <p>{diagnosis.technical_route}</p>
            </DetailSection>
            <DetailSection title="关键词">
              <TagList values={[...diagnosis.keywords_zh, ...diagnosis.keywords_en]} />
            </DetailSection>
            <DetailSection title="高相关与方法迁移论文">
              <RelatedPapers items={[...diagnosis.highly_related_papers, ...diagnosis.method_transfer_papers]} />
            </DetailSection>
            <div className="button-row">
              <button className="ghost-button" type="button" onClick={onEditProfile}>
                编辑画像
              </button>
              <button className="primary-button" type="button" onClick={onRunSearch}>
                <RefreshCw size={16} />
                重新检索
              </button>
            </div>
          </div>
        ) : (
          <EmptyState text="确认画像后生成首日诊断。" />
        )}
      </DetailDrawer>
    );
  }

  if (detail.kind === "gap") {
    return (
      <DetailDrawer title="研究空白详情" subtitle="候选 gap / 证据 / 下一步检索建议" onClose={onClose}>
        {diagnosis ? (
          <div className="detail-stack">
            <DetailSection title="候选研究空白">
              <p className="lead-text">{diagnosis.research_gap_candidate}</p>
            </DetailSection>
            <DetailSection title="知识缺口">
              <p>{diagnosis.knowledge_gap}</p>
            </DetailSection>
            <DetailSection title="证据来源">
              <RelatedPapers items={[...diagnosis.highly_related_papers, ...diagnosis.method_transfer_papers]} />
            </DetailSection>
            <DetailSection title="下一步动作">
              <ul className="detail-list">
                <li>围绕 gap 重新检索近三年论文。</li>
                <li>优先研读界面键合、热压窗口和力学性能相关论文。</li>
                <li>将有方法迁移价值的论文加入知识库并标记实验启发。</li>
              </ul>
            </DetailSection>
          </div>
        ) : (
          <EmptyState text="暂无研究空白，先确认画像并生成诊断。" />
        )}
      </DetailDrawer>
    );
  }

  if (detail.kind === "tasks") {
    return (
      <DetailDrawer title="任务时间线" subtitle="SearchTask / AI / 报告任务状态" onClose={onClose}>
        <div className="detail-stack">
          {searchTasks.length === 0 ? <EmptyState text="暂无检索任务。" /> : null}
          {searchTasks.map((task) => {
            const status = taskRuns.find((item) => item.task_id === task.id);
            return (
              <article className="timeline-row" key={task.id}>
                <div>
                  <b>{taskLabels[task.task_type]}</b>
                  <span>{task.query_text}</span>
                </div>
                <div className="timeline-meta">
                  <span>{status?.status ?? task.status}</span>
                  <span>{status?.message ?? "尚未运行"}</span>
                  {status?.error_code ? <span>错误：{status.error_code}</span> : null}
                </div>
                <div className="source-status-grid">
                  {status?.source_statuses.map((sourceStatus) => (
                    <span className={`source-pill ${sourceStatus.status}`} key={`${task.id}-${sourceStatus.source}`}>
                      {sourceStatus.source}: {sourceStatus.status} / {sourceStatus.record_count}
                    </span>
                  ))}
                </div>
                <button className="ghost-button small" type="button" onClick={() => onRetryTask(task.id)}>
                  <RefreshCw size={14} />
                  重试
                </button>
              </article>
            );
          })}
        </div>
      </DetailDrawer>
    );
  }

  if (detail.kind === "sources") {
    return (
      <DetailDrawer title="检索来源记录" subtitle={selectedSourceTask ? taskLabels[selectedSourceTask.task_type] : "SourceRecord"} onClose={onClose}>
        {selectedSourceTask ? (
          <div className="detail-stack">
            <DetailSection title="检索 query">
              <p>{selectedSourceTask.query_text}</p>
            </DetailSection>
            <DetailSection title="后续数据源">
              <ul className="detail-list">
                {futureSourceNotes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </DetailSection>
            {selectedSourceRecords.length === 0 ? (
              <EmptyState text="该任务暂无 SourceRecord 入库记录。" />
            ) : (
              <div className="source-record-list">
                {selectedSourceRecords.map((record) => (
                  <article className="source-record" key={record.id}>
                    <div>
                      <b>{sourceRecordTitle(record)}</b>
                      <span>
                        {record.source} · {record.normalized_payload?.year ?? "年份未知"} · {sourceRecordDoi(record)}
                      </span>
                    </div>
                    <div className="source-record-meta">
                      <span>quality {Math.round(record.quality_score * 100)}%</span>
                      <span>{record.paper_id ? `paper ${record.paper_id}` : "未关联 Paper"}</span>
                      <span>{record.normalized_payload?.open_access ? "open access" : "fulltext unknown"}</span>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        ) : (
          <EmptyState text="暂无检索任务。" />
        )}
      </DetailDrawer>
    );
  }

  if (detail.kind === "paper") {
    const link = fullPaperLink(paper, paperVersions);
    return (
      <DetailDrawer title="论文详情" subtitle="Paper / PaperVersion / SourceRecord" onClose={onClose}>
        {isBusy ? <LoadingInline /> : null}
        {paper && recommendation ? (
          <div className="detail-stack">
            <DetailSection title="论文">
              <h3>{paper.title}</h3>
              <p className="muted-text">{paper.title_zh}</p>
              <div className="source-meta">
                <span>{paper.journal}</span>
                <span>{paper.year}</span>
                <span>{paper.doi ?? "无 DOI"}</span>
                <span>{paper.fulltext_status}</span>
              </div>
              <TagList values={paper.keywords} />
            </DetailSection>
            <DetailSection title="推荐理由">
              <div className="detail-grid">
                {Object.entries(recommendation.explanation).map(([key, value]) => (
                  <InfoBlock key={key} label={key} value={value} />
                ))}
              </div>
            </DetailSection>
            <DetailSection title="版本与合法入口">
              {paperVersions.length === 0 ? <EmptyState text="暂无 PaperVersion 记录。" /> : null}
              <div className="source-record-list">
                {paperVersions.map((version) => (
                  <article className="source-record" key={version.id}>
                    <div>
                      <b>{version.source}</b>
                      <span>{version.version_type} · {version.license ?? "license unknown"}</span>
                    </div>
                    <div className="source-record-meta">
                      <span>{version.url ?? "无 source URL"}</span>
                      <span>{version.fulltext_url ?? "无 fulltext URL"}</span>
                    </div>
                  </article>
                ))}
              </div>
              {link ? (
                <a className="primary-button fit" href={link} target="_blank" rel="noreferrer">
                  <ExternalLink size={16} />
                  阅读完整论文
                </a>
              ) : (
                <button className="ghost-button fit" type="button" disabled>
                  暂无合规全文入口
                </button>
              )}
            </DetailSection>
            <DetailSection title="AI 分析">
              <div className="button-row">
                <button className="primary-button" type="button" onClick={() => onAnalyze("quick")}>
                  <Sparkles size={16} />
                  快速分析
                </button>
                <button className="ghost-button" type="button" onClick={() => onAnalyze("standard")}>
                  <BookOpen size={16} />
                  标准研读
                </button>
              </div>
              {paperAnalyses.length ? (
                <div className="source-record-list">
                  {paperAnalyses.map((item) => (
                    <article className="source-record" key={item.id}>
                      <div>
                        <b>{item.analysis_type}</b>
                        <span>{asText(item.result.one_sentence_conclusion, "已生成结构化分析")}</span>
                      </div>
                      <div className="source-record-meta">
                        <span>{item.model}</span>
                        <span>traceability {Math.round(item.traceability_score * 100)}%</span>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <EmptyState text="尚未生成 AI 分析。" />
              )}
            </DetailSection>
          </div>
        ) : (
          <EmptyState text="正在读取论文详情。" />
        )}
      </DetailDrawer>
    );
  }

  if (detail.kind === "analysis") {
    return (
      <DetailDrawer title="AI 研读详情" subtitle="结构化结论 / 事实分级 / 成本" onClose={onClose}>
        {analysis ? (
          <div className="detail-stack">
            <DetailSection title="结论">
              <p className="lead-text">{asText(analysis.result.one_sentence_conclusion)}</p>
              <p>{asText(analysis.result.relation_to_project)}</p>
            </DetailSection>
            <DetailSection title="结构化字段">
              <div className="detail-grid">
                {Object.entries(analysis.result).map(([key, value]) => (
                  <InfoBlock key={key} label={key} value={asText(value)} />
                ))}
              </div>
            </DetailSection>
            <DetailSection title="事实分级与证据">
              <div className="source-record-list">
                {analysis.claims.map((claim, index) => (
                  <article className="source-record" key={`${claim.claim}-${index}`}>
                    <div>
                      <b>{factLevelLabels[claim.fact_level] ?? claim.fact_level}</b>
                      <span>{claim.claim}</span>
                    </div>
                    <div className="source-record-meta">
                      <span>{claim.evidence.paper_id}</span>
                      <span>{claim.evidence.section ?? "section unknown"}</span>
                      <span>{claim.evidence.traceable ? "可追溯" : "不可追溯"}</span>
                    </div>
                  </article>
                ))}
              </div>
            </DetailSection>
            <DetailSection title="成本记录">
              <div className="source-meta">
                <span>{analysis.model}</span>
                <span>{analysis.cost_record_id ?? "无成本记录"}</span>
                <span>traceability {Math.round(analysis.traceability_score * 100)}%</span>
              </div>
            </DetailSection>
          </div>
        ) : (
          <EmptyState text="尚未生成 AI 分析。" />
        )}
      </DetailDrawer>
    );
  }

  if (detail.kind === "knowledge") {
    return (
      <DetailDrawer title="知识库条目详情" subtitle="状态 / 标签 / 备注 / 关联论文" onClose={onClose}>
        {knowledgeDetail ? (
          <div className="detail-stack">
            <DetailSection title="条目状态">
              <select
                className="select-input"
                value={knowledgeDraft.status}
                onChange={(event) =>
                  onKnowledgeDraftChange({ ...knowledgeDraft, status: event.target.value as KnowledgeItem["status"] })
                }
              >
                {Object.entries(knowledgeStatusLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </DetailSection>
            <DetailSection title="标签">
              <input
                value={knowledgeDraft.tags.join("，")}
                onChange={(event) =>
                  onKnowledgeDraftChange({
                    ...knowledgeDraft,
                    tags: event.target.value
                      .split(/[,，\n]/)
                      .map((item) => item.trim())
                      .filter(Boolean),
                  })
                }
                placeholder="用逗号分隔标签"
              />
            </DetailSection>
            <DetailSection title="备注">
              <textarea
                rows={5}
                value={knowledgeDraft.note}
                onChange={(event) => onKnowledgeDraftChange({ ...knowledgeDraft, note: event.target.value })}
                placeholder="记录为什么收藏、要读什么、与实验或写作的关系"
              />
            </DetailSection>
            <div className="source-meta">
              <span>paper_id: {knowledgeDetail.paper_id}</span>
              <span>project_id: {knowledgeDetail.project_id}</span>
            </div>
            <button className="primary-button fit" type="button" onClick={onSaveKnowledge}>
              <Save size={16} />
              保存知识库条目
            </button>
          </div>
        ) : (
          <EmptyState text="正在读取知识库条目。" />
        )}
      </DetailDrawer>
    );
  }

  if (detail.kind === "report") {
    return (
      <DetailDrawer title="报告详情" subtitle="日报 / 周报完整内容" onClose={onClose}>
        {reportDetail ? <ReportDetail report={reportDetail} /> : <EmptyState text="正在读取报告。" />}
      </DetailDrawer>
    );
  }

  if (detail.kind === "message") {
    return (
      <DetailDrawer title="站内消息详情" subtitle="消息正文 / 已读状态" onClose={onClose}>
        {messageDetail ? (
          <div className="detail-stack">
            <DetailSection title={messageDetail.title}>
              <p>{messageDetail.body}</p>
              <div className="source-meta">
                <span>{messageDetail.created_at}</span>
                <span>{messageDetail.read ? "已读" : "未读"}</span>
                <span>{messageDetail.report_id ?? "无关联报告"}</span>
              </div>
            </DetailSection>
            {!messageDetail.read ? (
              <button className="primary-button fit" type="button" onClick={() => onReadMessage(messageDetail)}>
                标记已读
              </button>
            ) : null}
          </div>
        ) : (
          <EmptyState text="正在读取消息。" />
        )}
      </DetailDrawer>
    );
  }

  return null;
}

function DetailSection({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="detail-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function InfoBlock({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="info-block">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

function RelatedPapers({ items }: { items: Recommendation[] }) {
  if (items.length === 0) {
    return <EmptyState text="暂无关联推荐论文。" />;
  }
  return (
    <div className="source-record-list">
      {items.map((item) => (
        <article className="source-record" key={item.id}>
          <div>
            <b>{item.paper.title}</b>
            <span>{item.paper.title_zh}</span>
          </div>
          <div className="source-record-meta">
            <span>{item.channel}</span>
            <span>score {Math.round(item.score_total * 100)}%</span>
            <span>{item.paper.doi ?? "无 DOI"}</span>
          </div>
        </article>
      ))}
    </div>
  );
}

function LoadingInline() {
  return (
    <div className="state-line loading">
      <Loader2 className="spin" size={16} />
      正在读取详情...
    </div>
  );
}

function ReportDetail({ report }: { report: RadarReport }) {
  const content = report.content;
  return (
    <div className="detail-stack">
      <DetailSection title={report.report_type === "daily" ? "每日科研雷达" : "每周科研周报"}>
        <div className="source-meta">
          <span>{report.period_start} - {report.period_end}</span>
          <span>{report.message_status}</span>
        </div>
      </DetailSection>
      {report.report_type === "daily" ? (
        <>
          <DetailSection title="新增与排重">
            <div className="detail-grid">
              <InfoBlock label="新增论文" value={String(content.new_papers ?? 0)} />
              <InfoBlock label="排重后论文" value={String(content.deduped_papers ?? 0)} />
            </div>
          </DetailSection>
          <ListSection title="高相关论文" items={content.high_relevance ?? []} />
          <ListSection title="建议深读" items={content.suggested_deep_reads ?? []} />
          <ListSection title="方法启发" items={content.method_inspirations ?? []} />
          <ListSection title="下一步动作" items={content.next_actions ?? []} />
        </>
      ) : (
        <>
          <DetailSection title="知识库与反馈">
            <div className="detail-grid">
              <InfoBlock label="知识库增长" value={String(content.knowledge_growth ?? 0)} />
              <InfoBlock label="反馈变化" value={content.feedback_changes?.summary ?? "暂无"} />
            </div>
          </DetailSection>
          <ListSection title="高价值论文" items={content.high_value_papers ?? []} />
          <ListSection title="趋势" items={content.trends ?? []} />
          <ListSection title="下周建议" items={content.next_week_suggestions ?? []} />
        </>
      )}
    </div>
  );
}

function ListSection({ items, title }: { items: string[]; title: string }) {
  return (
    <DetailSection title={title}>
      {items.length === 0 ? (
        <EmptyState text="暂无" />
      ) : (
        <ul className="detail-list">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </DetailSection>
  );
}
