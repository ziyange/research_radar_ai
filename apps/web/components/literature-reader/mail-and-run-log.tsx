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

export function MailBindModal({ mailStatus, authUrl, loading, onClose, onBind, onRebind, onOpenAuthUrl, onRefresh }) {
  const bound = Boolean(mailStatus?.authorized && mailStatus.email);
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
          <div className={`mail-bind-state ${bound ? "bound" : ""}`}>
            <strong>{bound ? "当前已授权账号" : "尚未绑定邮箱"}</strong>
            <span>{bound ? `${mailStatus.email}（来自本机 Agent Mail 授权缓存）` : "绑定后，采集任务才能开启“推送邮箱”。"}</span>
          </div>
          <div className="modal-section">
            <div className="modal-section-label">授权流程</div>
            <p className="modal-hint">
              如果这里已经显示账号，说明本机 CLI 之前保存过授权。需要换账号时请点击“切换账号并重新扫码”，系统会先清除旧凭据，再打开 Agent Mail 授权页面。完成扫码后回到这里刷新状态。
            </p>
            {authUrl ? (
              <button type="button" className="btn-ghost" onClick={onOpenAuthUrl}>
                手动打开授权页
              </button>
            ) : null}
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn-ghost" onClick={onRefresh}>
            刷新状态
          </button>
          <button type="button" className={bound ? "btn-ghost danger-soft" : "primary"} onClick={bound ? onRebind : onBind} disabled={loading}>
            {loading ? "启动授权中" : bound ? "切换账号并重新扫码" : "打开授权页面"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ActiveRunLogCard({ log, runAnalyzeState }) {
  if (!log) return null;
  const analyzeState = log.runId ? runAnalyzeState[log.runId] : null;
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
      <div className="active-step-list">
        {(log.steps || []).map((step, index) => (
          <div className={`active-step ${step.status}`} key={step.key || index}>
            <span>{step.status === "done" ? "✓" : step.status === "running" ? "…" : step.status === "failed" ? "!" : index + 1}</span>
            <p>{step.text}</p>
          </div>
        ))}
      </div>
      {log.errorMessage ? <p className="active-run-message error">{log.errorMessage}</p> : null}
      {log.exhaustedReason && log.targetMet === false ? (
        <p className="active-run-message warn">{log.exhaustedReason}</p>
      ) : null}
      {log.queryPlan?.length ? (
        <div className="active-run-subsection">
          <strong>实际检索式</strong>
          {log.queryPlan.slice(0, 8).map((item, index) => (
            <p key={`${item.source}-${item.query}-${index}`}>{index + 1}. [{item.source}] {item.query}</p>
          ))}
        </div>
      ) : null}
      {log.sourceStatuses?.length ? (
        <div className="active-run-subsection">
          <strong>来源返回</strong>
          {log.sourceStatuses.slice(0, 10).map((item, index) => (
            <p className={item.status === "failed" ? "error" : ""} key={`${item.source}-${item.query}-${index}`}>
              {item.source}：{item.status === "succeeded" ? `返回 ${item.count || 0} 条` : `失败，${item.error || "未知原因"}`}
            </p>
          ))}
        </div>
      ) : null}
      {log.savedPapers?.length ? (
        <div className="active-run-subsection">
          <strong>
            本次入库
            {analyzeState ? <em>AI 分析 {analyzeState.done}/{analyzeState.total}</em> : null}
          </strong>
          {log.savedPapers.slice(0, 8).map((paper) => (
            <p key={paper.id}>{paper.title}</p>
          ))}
        </div>
      ) : null}
      {log.mailDeliveries?.length ? (
        <div className="active-run-subsection">
          <strong>邮箱推送</strong>
          {log.mailDeliveries.slice(0, 8).map((delivery) => (
            <p key={delivery.id}>
              {delivery.kind === "analysis_report" ? "AI 分析" : "完整文献"} · {mailStatusText(delivery.status)}
            </p>
          ))}
        </div>
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

function canRetryMailDelivery(delivery) {
  if (!delivery) return false;
  if (delivery.error === "MAIL_RECIPIENT_REQUIRED") return false;
  if (delivery.status === "queued") return true;
  if (delivery.status !== "failed") return false;
  const error = String(delivery.error || "");
  return /confirmation token|AGENT_MAIL|MAIL_/i.test(error);
}

function MailDeliveryList({ deliveries, onConfirmMailDelivery, onConfirmPendingMailDeliveries, onRetryMailDelivery, loading }) {
  const latest = [...(deliveries || [])]
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
    .slice(0, 8);
  const pendingCount = (deliveries || []).filter(
    (delivery) => delivery.status === "pending_confirmation" && delivery.confirmationToken,
  ).length;
  if (!latest.length) return null;
  return (
    <div className="mail-delivery-list">
      <div className="mail-delivery-title">
        <strong>邮箱推送记录</strong>
        <span>{latest.length} 条最近记录</span>
        {pendingCount ? (
          <button type="button" onClick={onConfirmPendingMailDeliveries} disabled={loading === "mail-confirm-all"}>
            确认发送全部待确认（{pendingCount}）
          </button>
        ) : null}
      </div>
      {latest.map((delivery) => (
        <div className={`mail-delivery-row ${delivery.status}`} key={delivery.id}>
          <div>
            <strong>{delivery.subject}</strong>
            <span>
              {delivery.kind === "analysis_report" ? "AI 分析" : delivery.kind === "paper_fulltext" ? "完整文献" : "测试"} · {mailStatusText(delivery.status)}
            </span>
            {delivery.recipients?.length ? <span>To：{delivery.recipients.join(", ")}</span> : null}
            {delivery.cc?.length ? <span>CC：{delivery.cc.join(", ")}</span> : null}
            {delivery.attachments?.length ? <span>附件：{delivery.attachments.length} 个</span> : null}
            {delivery.status === "pending_confirmation" ? (
              <small>{delivery.confirmationSummary || "等待确认发送，请点击右侧“确认发送”完成投递。"}</small>
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
  mailStatus,
  onBindMail,
  onConfirmMailDelivery,
  onConfirmPendingMailDeliveries,
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
      <div className={`mail-status-card ${mailStatus?.authorized ? "bound" : ""}`}>
        <div>
          <strong>{mailStatus?.authorized ? "邮箱已绑定" : "邮箱未绑定"}</strong>
          <span>{mailStatus?.authorized ? mailStatus.email : "绑定后才能在采集任务中开启逐条推送。"}</span>
        </div>
        {!mailStatus?.authorized ? (
          <button type="button" onClick={onBindMail} disabled={loading === "mail-auth"}>
            绑定邮箱
          </button>
        ) : null}
      </div>
      <ActiveRunLogCard log={activeRunLog} runAnalyzeState={runAnalyzeState} />
      <MailDeliveryList
        deliveries={mailDeliveries || []}
        onConfirmMailDelivery={onConfirmMailDelivery}
        onConfirmPendingMailDeliveries={onConfirmPendingMailDeliveries}
        onRetryMailDelivery={onRetryMailDelivery}
        loading={loading}
      />
      <div className="run-list">
        {sortedRuns.length ? (
          sortedRuns.map((run) => {
            const status = runStatusLabel(run);
            const expanded = expandedRunIds[run.id];
            const savedPapers = (run.savedPaperIds || [])
              .map((id) => papers.find((p) => p.id === id))
              .filter(Boolean);
            const analyzeState = runAnalyzeState[run.id];
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
                    {run.sourceStatuses?.length ? (
                      <div className="run-detail-section">
                        <p className="run-detail-label">数据源检索状态</p>
                        {run.sourceStatuses.map((item, index) => (
                          <p
                            className={`run-detail-line ${item.status === "failed" ? "error" : ""}`}
                            key={index}
                          >
                            {item.source} / {item.query || run.query}：{item.status === "succeeded" ? `成功，拉取 ${item.count} 条` : `失败 — ${item.error}`}
                          </p>
                        ))}
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


