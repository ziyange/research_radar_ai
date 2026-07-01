/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import { useState } from "react";
import { X } from "@phosphor-icons/react";
import { invalidEmails, parseEmailList } from "./utils";

export function TaskModal({ mode, initial, loading, onClose, onSave, mailStatus }) {
  const [form, setForm] = useState({
    query: initial.query || "",
    count: initial.count ?? 5,
    yearFrom: initial.yearFrom ?? new Date().getFullYear() - 5,
    minScore: initial.minScore ?? 70,
    sources: initial.sources?.length ? [...initial.sources] : ["openalex", "crossref"],
    downloadOpenPdf: initial.downloadOpenPdf !== false,
    autoAnalyze: Boolean(initial.autoAnalyze),
    dailyEnabled: Boolean(initial.dailyEnabled),
    dailyTime: initial.dailyTime || "09:00",
    dailyTimezone: initial.dailyTimezone || "Asia/Shanghai",
    notifyAfterRun: Boolean(initial.notifyAfterRun),
    recipientEmailsText: (initial.recipientEmails || []).join(", "),
    ccEmailsText: (initial.ccEmails || []).join(", "),
    bccEmailsText: (initial.bccEmails || []).join(", "),
  });
  const [mailError, setMailError] = useState("");
  const mailBound = Boolean(mailStatus?.authorized && mailStatus.email);
  const recipientEmails = parseEmailList(form.recipientEmailsText);
  const ccEmails = parseEmailList(form.ccEmailsText);
  const bccEmails = parseEmailList(form.bccEmailsText);
  const mailInvalids = invalidEmails([...recipientEmails, ...ccEmails, ...bccEmails]);
  const canEnablePush = mailBound && recipientEmails.length > 0 && mailInvalids.length === 0;

  function update(field, value) {
    if (field === "recipientEmailsText" || field === "ccEmailsText" || field === "bccEmailsText") {
      setMailError("");
    }
    setForm((current) => ({ ...current, [field]: value }));
  }

  function toggleSource(source) {
    setForm((current) => {
      const sources = current.sources.includes(source)
        ? current.sources.filter((item) => item !== source)
        : [...current.sources, source];
      return { ...current, sources: sources.length ? sources : [source] };
    });
  }

  function submit(event) {
    event.preventDefault();
    setMailError("");
    if (mailBound && form.notifyAfterRun && !recipientEmails.length) {
      setMailError("开启推送邮箱时必须填写收件人 To。");
      return;
    }
    if (mailBound && form.notifyAfterRun && mailInvalids.length) {
      setMailError(`邮箱格式不正确：${mailInvalids.join(", ")}`);
      return;
    }
    const payload = { ...form };
    delete payload.recipientEmailsText;
    delete payload.ccEmailsText;
    delete payload.bccEmailsText;
    onSave({
      ...payload,
      count: Number(form.count) || 5,
      yearFrom: form.yearFrom ? Number(form.yearFrom) : null,
      minScore: Number(form.minScore) || 0,
      notifyAfterRun: mailBound ? Boolean(form.notifyAfterRun) : false,
      recipientEmails: mailBound && form.notifyAfterRun ? recipientEmails : [],
      ccEmails: mailBound && form.notifyAfterRun ? ccEmails : [],
      bccEmails: mailBound && form.notifyAfterRun ? bccEmails : [],
    });
  }

  function toggleMailPush() {
    if (!mailBound) return;
    if (form.notifyAfterRun) {
      update("notifyAfterRun", false);
      return;
    }
    if (!recipientEmails.length) {
      setMailError("请先填写收件人 To，再开启推送邮箱。");
      return;
    }
    if (mailInvalids.length) {
      setMailError(`邮箱格式不正确：${mailInvalids.join(", ")}`);
      return;
    }
    update("notifyAfterRun", true);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form className="modal-card" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modal-header">
          <h2>{mode === "edit" ? "编辑采集任务" : "新增采集任务"}</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">
          <div className="modal-section">
            <div className="modal-section-label">研究方向</div>
            <textarea
              value={form.query}
              onChange={(event) => update("query", event.target.value)}
              placeholder="例如：纳米材料 植物 胁迫 响应"
              required
            />
          </div>
          <div className="modal-section">
            <div className="modal-section-label">采集参数</div>
            <div className="modal-form-grid">
              <label>
                <span>篇数</span>
                <input
                  type="number"
                  min="1"
                  max="20"
                  value={form.count}
                  onChange={(event) => update("count", event.target.value)}
                />
              </label>
              <label>
                <span>起始年份</span>
                <input
                  type="number"
                  value={form.yearFrom || ""}
                  onChange={(event) => update("yearFrom", event.target.value)}
                />
              </label>
              <label>
                <span>最低评分</span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={form.minScore}
                  onChange={(event) => update("minScore", event.target.value)}
                />
              </label>
            </div>
          </div>
          <div className="modal-section">
            <div className="modal-section-label">数据源</div>
            <div className="modal-pill-row">
              <button
                type="button"
                className={`pill-btn ${form.sources.includes("openalex") ? "active" : ""}`}
                onClick={() => toggleSource("openalex")}
              >
                OpenAlex
              </button>
              <button
                type="button"
                className={`pill-btn ${form.sources.includes("crossref") ? "active" : ""}`}
                onClick={() => toggleSource("crossref")}
              >
                Crossref
              </button>
            </div>
          </div>
          <div className="modal-section">
            <div className="modal-section-label">采集后处理</div>
            <div className="modal-switches">
              <button
                type="button"
                className={`switch-card ${form.downloadOpenPdf ? "on" : ""}`}
                onClick={() => update("downloadOpenPdf", !form.downloadOpenPdf)}
              >
                <span className="switch-card-text">
                  <strong>下载开放 PDF</strong>
                  <small>采集时下载开放获取的 PDF 到本地</small>
                </span>
                <span className={`switch-toggle ${form.downloadOpenPdf ? "on" : ""}`} />
              </button>
              <button
                type="button"
                className={`switch-card ${form.autoAnalyze ? "on" : ""}`}
                onClick={() => update("autoAnalyze", !form.autoAnalyze)}
              >
                <span className="switch-card-text">
                  <strong>AI 分析</strong>
                  <small>采集入库后自动逐篇调用 AI 分析</small>
                </span>
                <span className={`switch-toggle ${form.autoAnalyze ? "on" : ""}`} />
              </button>
              <div className={`mail-push-card ${form.notifyAfterRun ? "on" : ""} ${!mailBound ? "disabled" : ""}`}>
                <div className="mail-push-head">
                  <span className="switch-card-text">
                    <strong>推送邮箱</strong>
                    <small>{mailBound ? "任务完成后逐条推送文献或 AI 分析" : "请先在采集任务页绑定 Agent 邮箱"}</small>
                  </span>
                  <button
                    type="button"
                    className={`mail-push-toggle ${form.notifyAfterRun ? "on" : ""}`}
                    disabled={!mailBound || (!form.notifyAfterRun && !canEnablePush)}
                    onClick={toggleMailPush}
                  >
                    {form.notifyAfterRun ? "已开启" : "开启推送"}
                  </button>
                </div>
                {mailBound ? (
                  <div className="mail-recipient-inline">
                    <label>
                      <span>收件人 To（必填）</span>
                      <input
                        value={form.recipientEmailsText}
                        onChange={(event) => update("recipientEmailsText", event.target.value)}
                        placeholder="name@example.com，多个邮箱用逗号分隔"
                      />
                    </label>
                    <div className="modal-form-grid mail-copy-grid">
                      <label>
                        <span>抄送 CC（可选）</span>
                        <input
                          value={form.ccEmailsText}
                          onChange={(event) => update("ccEmailsText", event.target.value)}
                          placeholder="cc@example.com"
                        />
                      </label>
                      <label>
                        <span>密送 BCC（可选）</span>
                        <input
                          value={form.bccEmailsText}
                          onChange={(event) => update("bccEmailsText", event.target.value)}
                          placeholder="bcc@example.com"
                        />
                      </label>
                    </div>
                    <p className="modal-hint">
                      Subject 由系统按每篇文献自动生成；正文使用 Markdown body_file。Agent Mail 返回确认令牌时，右侧记录会显示“确认发送”。
                    </p>
                    {mailError ? <p className="modal-error">{mailError}</p> : null}
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                className={`switch-card ${form.dailyEnabled ? "on" : ""}`}
                onClick={() => update("dailyEnabled", !form.dailyEnabled)}
              >
                <span className="switch-card-text">
                  <strong>每日自动执行</strong>
                  <small>本地服务运行时按设定时间自动执行</small>
                </span>
                <span className={`switch-toggle ${form.dailyEnabled ? "on" : ""}`} />
              </button>
            </div>
            {form.dailyEnabled ? (
              <div className="modal-form-grid schedule-grid">
                <label>
                  <span>执行时间</span>
                  <input
                    type="time"
                    value={form.dailyTime}
                    onChange={(event) => update("dailyTime", event.target.value)}
                  />
                </label>
                <label>
                  <span>时区</span>
                  <input value={form.dailyTimezone} onChange={(event) => update("dailyTimezone", event.target.value)} />
                </label>
              </div>
            ) : null}
            {!mailBound ? (
              <p className="modal-hint">邮箱未绑定时，“推送邮箱”不可开启。请先在采集任务页右上角绑定 Agent Mail。</p>
            ) : null}
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn-ghost" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="primary" disabled={loading || !form.query.trim() || (form.notifyAfterRun && !canEnablePush)}>
            {loading ? "保存中" : "保存"}
          </button>
        </div>
      </form>
    </div>
  );
}


