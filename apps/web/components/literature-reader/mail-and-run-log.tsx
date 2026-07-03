/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import { CaretDown, CaretRight, FileText, X } from "@phosphor-icons/react";

function runStatusLabel(run) {
  if (run._failed) return { key: "failed", text: "执行失败" };
  if (run.targetMet === false) return { key: "running", text: "未拿满" };
  if (run.savedCount !== undefined) return { key: "done", text: "已完成" };
  return { key: "done", text: "已完成" };
}

function formatRunTime(iso) {
  if (!iso) return "";
  try {
    const date = new Date(iso);
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  } catch {
    return iso;
  }
}

function sourceStatusSummary(statuses) {
  const buckets = new Map();
  for (const item of statuses || []) {
    const source = item.source || "unknown";
    const bucket = buckets.get(source) || { source, ok: 0, failed: 0, count: 0, errors: new Set() };
    if (item.status === "succeeded") {
      bucket.ok += 1;
      bucket.count += Number(item.count || 0);
    } else {
      bucket.failed += 1;
      bucket.errors.add(item.errorType || "unknown");
    }
    buckets.set(source, bucket);
  }
  return [...buckets.values()].map((item) => ({
    ...item,
    errors: [...item.errors],
    degraded: item.ok > 0 && item.failed > 0,
  }));
}

function sourceFailureLabel(errorType) {
  const labels = {
    rate_limited: "限流",
    service_unavailable: "服务不可用",
    server_error: "服务错误",
    timeout: "超时",
    unknown: "未知错误",
  };
  return labels[errorType] || labels.unknown;
}

function SourceStatusDigest({ statuses }) {
  const summary = sourceStatusSummary(statuses);
  if (!summary.length) return null;
  return (
    <div className="source-status-digest">
      {summary.map((item) => (
        <div className={`source-status-chip ${item.failed ? "degraded" : "ok"}`} key={item.source}>
          <strong>{item.source}</strong>
          <span>
            {item.ok ? `成功 ${item.ok} 组 / ${item.count} 条` : ""}
            {item.ok && item.failed ? " · " : ""}
            {item.failed ? `失败 ${item.failed} 组（${item.errors.map(sourceFailureLabel).join("、")}）` : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

export function MailBindModal({
  mailStatus,
  authUrl,
  authSession,
  loading,
  refreshLoading,
  onClose,
  onBind,
  onRebind,
  onCopyAuthUrl,
  onRefresh,
}) {
  const bound = Boolean(mailStatus?.authorized && mailStatus.email);
  const relogin = mailNeedsRelogin(mailStatus);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card mail-bind-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <h2>绑定 Agent 邮箱</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">
          <div className={`mail-bind-state ${bound ? "bound" : ""} ${relogin ? "expired" : ""}`}>
            <strong>{bound ? "当前已授权账号" : relogin ? "邮箱授权已失效" : "尚未绑定邮箱"}</strong>
            <span>
              {bound
                ? `${mailStatus.email}（来自本机 Agent Mail 授权缓存）`
                : relogin
                  ? mailStatus?.authIssue || "授权已过期或刷新失败，请重新登录邮箱。"
                  : "绑定后，采集任务才能开启“推送邮箱”。"}
            </span>
          </div>
          <div className="modal-section">
            <div className="modal-section-label">授权流程</div>
            <p className="modal-hint">
              {relogin
                ? "请点击“重新登录邮箱”，系统会启动 Agent Mail OAuth。CLI 会自动打开一个授权页面，完成扫码后这里会自动回传绑定状态。"
                : "如果这里已经显示账号，说明本机 CLI 之前保存过授权。需要换账号时请点击“切换账号并重新扫码”，系统会先清除旧凭据，再启动 Agent Mail OAuth。完成扫码后这里会自动回传绑定状态。"}
            </p>
            {authUrl ? (
              <div className="mail-auth-url-fallback">
                <span>如果没有自动打开授权页面，可以复制链接到已有浏览器地址栏。</span>
                <button type="button" className="btn-ghost" onClick={onCopyAuthUrl}>
                  复制授权链接
                </button>
              </div>
            ) : null}
            {authSession ? (
              <div className={`mail-auth-session ${authSession.status || ""}`}>
                <strong>
                  {authSession.status === "authorized"
                    ? "绑定成功"
                    : authSession.status === "failed" || authSession.status === "timeout"
                      ? "授权失败"
                      : "等待登录完成"}
                </strong>
                <span>
                  {authSession.status === "authorized"
                    ? authSession.email || "邮箱已授权"
                    : authSession.error || "请在弹出的授权窗口中完成登录，系统会自动回传结果。"}
                </span>
              </div>
            ) : null}
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn-ghost" onClick={onRefresh} disabled={loading || refreshLoading}>
            {refreshLoading ? "刷新中" : "刷新状态"}
          </button>
          <button type="button" className={bound ? "btn-ghost danger-soft" : "primary"} onClick={bound || relogin ? onRebind : onBind} disabled={loading}>
            {loading ? "启动授权中" : bound ? "切换账号并重新扫码" : relogin ? "重新登录邮箱" : "打开授权页面"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function mailNeedsRelogin(mailStatus) {
  return Boolean(
    mailStatus?.requiresLogin ||
      mailStatus?.authState === "expired" ||
      mailStatus?.authState === "refresh_failed"
  );
}

export function mailBindingLabel(mailStatus) {
  if (mailStatus?.authorized && mailStatus.email) return `已绑定 ${mailStatus.email}`;
  if (mailNeedsRelogin(mailStatus)) return "邮箱授权已失效";
  return "绑定邮箱";
}

function ActiveRunLogCard({ log, runAnalyzeState }) {
  if (!log) return null;
  const analyzeState = log.runId ? runAnalyzeState[log.runId] : null;
  const currentStep =
    (log.steps || []).find((step) => step.status === "running") ||
    (log.steps || []).find((step) => step.status === "pending") ||
    (log.steps || [])[0];
  const totalSteps = (log.steps || []).length;
  const currentStepIndex = currentStep
    ? Math.max(1, (log.steps || []).findIndex((step) => step === currentStep) + 1)
    : 0;
  return (
    <div className={`active-run-card ${log.status}`}>
      <div className="active-run-header">
        <span className={`run-status-tag ${log.status === "warning" ? "running" : log.status}`}>
          {log.status === "running" ? "执行中" : log.status === "failed" ? "执行失败" : log.status === "warning" ? "未拿满目标" : "已完成"}
        </span>
        <div>
          <strong>{log.taskName}</strong>
          <small>{formatRunTime(log.startedAt)}</small>
        </div>
      </div>
      {log.meta?.length ? (
        <div className="active-run-meta">
          {log.meta.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
      ) : null}
      {currentStep ? (
        <div className="active-current-step">
          <span>{currentStep.status === "failed" ? "!" : "…"}</span>
          <div>
            <strong>当前步骤</strong>
            <p>{currentStep.text}</p>
            {totalSteps ? (
              <small className="active-current-progress">
                {currentStepIndex}/{totalSteps}
              </small>
            ) : null}
          </div>
        </div>
      ) : null}
      {analyzeState ? (
        <p className="active-run-message warn">AI 分析 {analyzeState.done}/{analyzeState.total}</p>
      ) : null}
      {log.errorMessage ? <p className="active-run-message error">{log.errorMessage}</p> : null}
      {log.exhaustedReason && log.targetMet === false ? (
        <p className="active-run-message warn">{log.exhaustedReason}</p>
      ) : null}
    </div>
  );
}

export function mailStatusText(status) {
  if (status === "sent") return "已发送";
  if (status === "sending") return "发送中";
  if (status === "pending_confirmation") return "待确认";
  if (status === "failed") return "失败";
  if (status === "queued") return "已排队";
  return status || "未知";
}

function mailErrorText(error) {
  const text = String(error || "");
  if (!text) return "";
  if (text === "AGENT_MAIL_CONFIRMATION_REQUIRED") {
    return "等待确认发送，请点击右侧“确认发送”完成投递。";
  }
  if (text === "MAIL_RECIPIENT_REQUIRED") {
    return "缺少收件人 To，请编辑采集任务并填写有效邮箱。";
  }
  if (text === "AGENT_MAIL_TIMEOUT") {
    return "Agent Mail 发送超时。通常是授权刷新、网络连接或附件上传耗时过长，请刷新邮箱绑定状态后重试。";
  }
  if (/refresh lock|authorization required|context deadline exceeded/i.test(text)) {
    return "Agent Mail 授权刷新失败。请重新绑定邮箱，或检查本机 Agent Mail CLI 是否被其他进程占用。";
  }
  if (/confirmation token/i.test(text) && /expired|invalid/i.test(text)) {
    return "确认令牌已过期或无效，请重新生成确认。";
  }
  try {
    const payload = JSON.parse(text);
    return payload?.error?.message || payload?.message || text;
  } catch {
    return text;
  }
}

function deliveryKindLabel(kind) {
  if (kind === "task_digest") return "任务汇总";
  if (kind === "analysis_report") return "AI 分析";
  if (kind === "paper_fulltext") return "完整文献";
  if (kind === "mail_test") return "测试";
  return kind || "邮件";
}

function compactList(value) {
  if (!value) return "";
  if (Array.isArray(value)) return value.filter(Boolean).join(", ");
  return String(value);
}

function objectSummaryText(value) {
  if (!value || typeof value !== "object") return "";
  const parts = [
    value.action ? `动作：${value.action}` : "",
    value.from ? `From：${value.from}` : "",
    value.to ? `To：${compactList(value.to)}` : "",
    value.subject ? `主题：${value.subject}` : "",
    value.attachment_count !== undefined ? `附件：${value.attachment_count} 个` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : JSON.stringify(value);
}

function mailConfirmationSummaryText(summary) {
  if (!summary) return "";
  if (typeof summary === "string") {
    const text = summary.trim();
    if (!text) return "";
    if (text.startsWith("{") || text.startsWith("[")) {
      try {
        return mailConfirmationSummaryText(JSON.parse(text));
      } catch {
        return text;
      }
    }
    return text;
  }
  if (Array.isArray(summary)) {
    return summary.map(mailConfirmationSummaryText).filter(Boolean).join("；");
  }
  return objectSummaryText(summary);
}

function canRetryMailDelivery(delivery) {
  if (!delivery) return false;
  if (delivery.error === "MAIL_RECIPIENT_REQUIRED") return false;
  if (delivery.status === "queued") return true;
  if (delivery.status !== "failed") return false;
  const error = String(delivery.error || "");
  return /confirmation token|AGENT_MAIL|MAIL_/i.test(error);
}

function RunMailDeliverySection({ deliveries, onConfirmMailDelivery, onRetryMailDelivery, loading }) {
  const latest = [...(deliveries || [])].sort(
    (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
  );
  if (!latest.length) return null;
  return (
    <div className="run-detail-section">
      <p className="run-detail-label">邮箱推送</p>
      {latest.map((delivery) => (
        <div className={`mail-delivery-row ${delivery.status}`} key={delivery.id}>
          <div>
            <strong>{delivery.subject}</strong>
            <span>
              {deliveryKindLabel(delivery.kind)} · {mailStatusText(delivery.status)}
            </span>
            {delivery.runId ? <span>任务运行：{delivery.runId}</span> : null}
            {delivery.recipients?.length ? <span>To：{delivery.recipients.join(", ")}</span> : null}
            {delivery.cc?.length ? <span>CC：{delivery.cc.join(", ")}</span> : null}
            {delivery.attachments?.length ? <span>附件：{delivery.attachments.length} 个</span> : null}
            {delivery.status === "pending_confirmation" ? (
              <small>{mailConfirmationSummaryText(delivery.confirmationSummary) || "等待确认发送，请点击右侧“确认发送”完成投递。"}</small>
            ) : null}
            {delivery.error ? <small>{mailErrorText(delivery.error)}</small> : null}
          </div>
          {delivery.status === "pending_confirmation" ? (
            <button
              type="button"
              onClick={() => onConfirmMailDelivery(delivery)}
              disabled={loading === `mail-confirm-${delivery.id}`}
            >
              确认发送
            </button>
          ) : canRetryMailDelivery(delivery) ? (
            <button
              type="button"
              onClick={() => onRetryMailDelivery(delivery)}
              disabled={loading === `mail-retry-${delivery.id}`}
            >
              重新生成确认
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function RunLogList({
  scanRuns,
  papers,
  activeRunLog,
  expandedRunIds,
  setExpandedRunIds,
  runAnalyzeState,
  mailDeliveries,
  onConfirmMailDelivery,
  onRetryMailDelivery,
  loading,
}) {
  const sortedRuns = [...scanRuns].sort((a, b) => {
    const ta = new Date(a.createdAt || 0).getTime();
    const tb = new Date(b.createdAt || 0).getTime();
    return tb - ta;
  });

  function toggle(id) {
    setExpandedRunIds((current) => ({ ...current, [id]: !current[id] }));
  }

  return (
    <div className="paper-inspector">
      <div className="paper-heading">
        <span>执行日志</span>
        <h2>任务执行日志</h2>
        <p>点击任务执行后，这里会先显示当前任务进度；完成后回填真实检索式、来源状态、去重与入库文献。</p>
      </div>
      <ActiveRunLogCard log={activeRunLog} runAnalyzeState={runAnalyzeState} />
      <div className="run-list">
        {sortedRuns.length ? (
          sortedRuns.map((run) => {
            const status = runStatusLabel(run);
            const expanded = expandedRunIds[run.id];
            const savedPapers = (run.savedPaperIds || [])
              .map((id) => papers.find((p) => p.id === id))
              .filter(Boolean);
            const analyzeState = runAnalyzeState[run.id];
            const runMailDeliveries = (mailDeliveries || []).filter((delivery) => delivery.runId === run.id);
            return (
              <div className={`run-item ${expanded ? "open" : ""}`} key={run.id}>
                <div className="run-summary" onClick={() => toggle(run.id)}>
                  <span className={`run-status-tag ${status.key}`}>{status.text}</span>
                  <div className="run-summary-main">
                    <div className="run-query">{run.query}</div>
                    <div className="run-stat">
                      {formatRunTime(run.createdAt)}
                      {run.savedCount !== undefined
                        ? ` · 保存 ${run.savedCount} · 去重 ${run.duplicateCount || 0} · 候选 ${run.candidateCount || 0}`
                        : ""}
                    </div>
                  </div>
                  <div className="run-caret">
                    {expanded ? <CaretDown size={16} /> : <CaretRight size={16} />}
                  </div>
                </div>
                {expanded ? (
                  <div className="run-detail">
                    {run._failed ? (
                      <div className="run-detail-section">
                        <p className="run-detail-label">失败原因</p>
                        <p className="run-detail-line error">{run._errorMessage || "未知错误"}</p>
                      </div>
                    ) : null}
                    {run.exhaustedReason && !run.targetMet ? (
                      <div className="run-detail-section">
                        <p className="run-detail-label">未拿满目标</p>
                        <p className="run-detail-line warn">{run.exhaustedReason}</p>
                      </div>
                    ) : null}
                    {run.queryPlan?.length ? (
                      <div className="run-detail-section">
                        <p className="run-detail-label">检索式（{run.queryPlan.length}）</p>
                        {run.queryPlan.map((item, index) => (
                          <p className="run-detail-line" key={index}>
                            {index + 1}. [{item.source}] {item.query}
                          </p>
                        ))}
                      </div>
                    ) : null}
                    {run.executionEvents?.length ? (
                      <div className="run-detail-section">
                        <p className="run-detail-label">执行过程（{run.executionEvents.length}）</p>
                        <div className="run-event-list">
                          {run.executionEvents.slice(0, 80).map((event, index) => (
                            <p className={`run-detail-line ${event.status === "failed" ? "error" : event.status === "warning" ? "warn" : ""}`} key={event.id || index}>
                              <span>{event.status === "done" ? "✓" : event.status === "running" ? "…" : event.status === "failed" ? "!" : event.status === "skipped" ? "−" : index + 1}</span>
                              {event.message || event.stage}
                            </p>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {run.sourceStatuses?.length ? (
                      <div className="run-detail-section">
                        <p className="run-detail-label">数据源检索状态</p>
                        <SourceStatusDigest statuses={run.sourceStatuses} />
                        <details className="source-status-details">
                          <summary>查看完整错误与 URL</summary>
                          {run.sourceStatuses.map((item, index) => (
                            <p
                              className={`run-detail-line ${item.status === "failed" ? "error" : ""}`}
                              key={index}
                            >
                              {item.source} / {item.query || run.query}：{item.status === "succeeded" ? `成功，拉取 ${item.count} 条` : `失败 — ${item.error}`}
                            </p>
                          ))}
                        </details>
                      </div>
                    ) : null}
                    {run.duplicateTitles?.length ? (
                      <div className="run-detail-section">
                        <p className="run-detail-label">去重文献（{run.duplicateCount || run.duplicateTitles.length}）</p>
                        {run.duplicateTitles.slice(0, 8).map((title, index) => (
                          <p className="run-detail-line" key={index}>· {title}</p>
                        ))}
                      </div>
                    ) : null}
                    {savedPapers.length ? (
                      <div className="run-detail-section">
                        <p className="run-detail-label">
                          采集入库文献（{savedPapers.length}）
                          {analyzeState ? (
                            <span className="run-analyze-badge" style={{ marginLeft: 8 }}>
                              AI 分析 {analyzeState.done}/{analyzeState.total}
                            </span>
                          ) : null}
                        </p>
                        <ul className="run-detail-papers">
                          {savedPapers.map((paper) => (
                            <li key={paper.id}>
                              <FileText size={13} />
                              <strong>{paper.title}</strong>
                              <small>{paper.year || ""}</small>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    <RunMailDeliverySection
                      deliveries={runMailDeliveries}
                      onConfirmMailDelivery={onConfirmMailDelivery}
                      onRetryMailDelivery={onRetryMailDelivery}
                      loading={loading}
                    />
                  </div>
                ) : null}
              </div>
            );
          })
        ) : (
          <div className="empty-state">暂无执行记录，执行任务后会在这里显示日志。</div>
        )}
      </div>
    </div>
  );
}


