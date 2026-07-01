/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-unused-vars, react-hooks/exhaustive-deps */
// @ts-nocheck
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Books,
  Brain,
  CaretDown,
  CaretLeft,
  CaretRight,
  Database,
  DownloadSimple,
  FileText,
  Lightning,
  LinkSimple,
  MagnifyingGlass,
  PencilSimple,
  Plus,
  Play,
  Trash,
  UploadSimple,
  X,
} from "@phosphor-icons/react";
import { ActivityCenter } from "./activity-center";
import { api, defaultScan } from "./api";
import { LibraryGraphView, makeLibraryGraph } from "./library-graph";
import { LibraryPaperListPanel } from "./library-paper-list-panel";
import { MailBindModal, mailStatusText, RunLogList } from "./mail-and-run-log";
import { renderMarkdown } from "./markdown";
import { TaskModal } from "./task-modal";
import {
  buildLibraryGroups,
  doiUrl,
  filterLibraryGroups,
  invalidEmails,
  paperSearchText,
  paperThemeTone,
  parseEmailList,
  scoreTone,
  short,
  sortPapers,
} from "./utils";

function taskMailPushReady(task) {
  const recipients = parseEmailList((task?.recipientEmails || []).join(", "));
  const cc = parseEmailList((task?.ccEmails || []).join(", "));
  const bcc = parseEmailList((task?.bccEmails || []).join(", "));
  return Boolean(task?.notifyAfterRun && recipients.length && !invalidEmails([...recipients, ...cc, ...bcc]).length);
}

export function App() {
  const [library, setLibrary] = useState({ papers: [], scanRuns: [], reports: [] });
  const [health, setHealth] = useState(null);
  const [mailStatus, setMailStatus] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [selectedPaperId, setSelectedPaperId] = useState(null);
  const [focusedPaperId, setFocusedPaperId] = useState(null);
  const [highlightPulseId, setHighlightPulseId] = useState("");
  const [activeView, setActiveView] = useState("library");
  const [activeLibraryGroupId, setActiveLibraryGroupId] = useState("all");
  const [libraryQuery, setLibraryQuery] = useState("");
  const [librarySort, setLibrarySort] = useState("score-desc");
  const [readingMode, setReadingMode] = useState("analysis");
  const [paperMarkdown, setPaperMarkdown] = useState("");
  const [status, setStatusState] = useState({ tone: "idle", message: "准备就绪" });
  const [activities, setActivities] = useState([]);
  const [activityOpen, setActivityOpen] = useState(false);
  const [loading, setLoading] = useState(null);
  const [runningTaskIds, setRunningTaskIds] = useState({});
  const [analyzingPaperIds, setAnalyzingPaperIds] = useState({});
  const [fetchingFullTextIds, setFetchingFullTextIds] = useState({});
  const [retrievalStatus, setRetrievalStatus] = useState(null);
  const [error, setError] = useState("");
  const [taskModal, setTaskModal] = useState(null);
  const [mailBindModal, setMailBindModal] = useState(false);
  const [mailAuthUrl, setMailAuthUrl] = useState("");
  const [expandedRunIds, setExpandedRunIds] = useState({});
  const [runAnalyzeState, setRunAnalyzeState] = useState({});
  const [activeRunLog, setActiveRunLog] = useState(null);
  const reactFlowInstanceRef = useRef(null);
  const paperRowRefs = useRef({});
  const pulseTimerRef = useRef(null);
  const activityTimersRef = useRef({});

  function removeActivity(id) {
    setActivities((current) => current.filter((item) => item.id !== id));
    if (activityTimersRef.current[id]) {
      window.clearTimeout(activityTimersRef.current[id]);
      delete activityTimersRef.current[id];
    }
  }

  function setStatus(next) {
    setStatusState(next);
    if (!next?.message || next.tone === "idle") return;
    const id = `activity_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    setActivities((current) => {
      const kept = next.tone === "running" ? current : current.filter((item) => item.tone !== "running");
      return [{ id, ...next, createdAt: new Date().toISOString() }, ...kept].slice(0, 18);
    });
    if (next.tone === "success") {
      activityTimersRef.current[id] = window.setTimeout(() => removeActivity(id), 3000);
    }
    if (next.tone === "error" || next.tone === "warning") {
      setActivityOpen(true);
    }
  }

  async function refresh() {
    const [libraryData, healthData, tasksData, mailData] = await Promise.all([
      api.getLibrary(),
      api.getHealth(),
      api.getTasks(),
      api.getMailStatus().catch(() => null),
    ]);
    setLibrary(libraryData);
    setHealth(healthData);
    setMailStatus(mailData);
    setTasks(tasksData.tasks || []);
    setSelectedPaperId((current) => current || libraryData.papers?.[0]?.id || null);
  }

  useEffect(() => {
    refresh().catch((err) => {
      setError(err.message);
      setStatus({ tone: "error", message: "本地服务未启动或不可用" });
    });
  }, []);

  const selectedPaper = useMemo(
    () => library.papers?.find((paper) => paper.id === selectedPaperId) || library.papers?.[0],
    [library.papers, selectedPaperId],
  );
  const libraryGroups = useMemo(
    () => buildLibraryGroups(library.papers || [], tasks, library.scanRuns || []),
    [library.papers, library.scanRuns, tasks],
  );
  const graphGroups = useMemo(
    () =>
      libraryGroups
        .filter((group) => activeLibraryGroupId === "all" || group.id === activeLibraryGroupId)
        .map((group) => ({ ...group, papers: sortPapers(group.papers, librarySort) })),
    [activeLibraryGroupId, libraryGroups, librarySort],
  );
  const visibleGroups = useMemo(
    () => filterLibraryGroups(libraryGroups, activeLibraryGroupId, libraryQuery, librarySort),
    [activeLibraryGroupId, libraryGroups, libraryQuery, librarySort],
  );
  const reportPaperIds = useMemo(
    () => new Set((library.reports || []).flatMap((report) => report.paperIds || [])),
    [library.reports],
  );
  const libraryGraph = useMemo(
    () => makeLibraryGraph(graphGroups, libraryGroups, libraryQuery, focusedPaperId, reportPaperIds, highlightPulseId),
    [focusedPaperId, graphGroups, highlightPulseId, libraryGroups, libraryQuery, reportPaperIds],
  );
  const visiblePaperCount = visibleGroups.reduce((sum, group) => sum + group.papers.length, 0);
  const selectedPaperReport = useMemo(() => {
    if (!selectedPaper) return null;
    return (
      library.reports?.find(
        (report) => report.paperIds?.length === 1 && report.paperIds.includes(selectedPaper.id),
      ) || null
    );
  }, [library.reports, selectedPaper]);

  useEffect(() => {
    if (activeLibraryGroupId === "all") return;
    if (!libraryGroups.some((group) => group.id === activeLibraryGroupId)) {
      setActiveLibraryGroupId("all");
    }
  }, [activeLibraryGroupId, libraryGroups]);

  useEffect(() => {
    if (!selectedPaper) return;
    setReadingMode("source");
    setPaperMarkdown("");
    const sourceUrl = selectedPaper.localFullTextUrl || selectedPaper.localMarkdownUrl;
    if (!sourceUrl) return;
    fetch(sourceUrl)
      .then((response) => (response.ok ? response.text() : ""))
      .then(setPaperMarkdown)
      .catch(() => setPaperMarkdown(""));
  }, [selectedPaper?.id, selectedPaper?.localFullTextUrl, selectedPaper?.localMarkdownUrl]);

  useEffect(() => () => {
    if (pulseTimerRef.current) window.clearTimeout(pulseTimerRef.current);
    Object.values(activityTimersRef.current || {}).forEach((timer) => window.clearTimeout(timer));
  }, []);

  async function saveTask(form) {
    setError("");
    setLoading("task-save");
    try {
      if (taskModal?.id) {
        const data = await api.updateTask(taskModal.id, form);
        const updated = data.task || data;
        setTasks(data.tasks || ((current) => current.map((t) => (t.id === updated.id ? updated : t))));
        setStatus({ tone: "success", message: "任务配置已更新" });
      } else {
        const data = await api.createTask(form);
        const created = data.task || data;
        setTasks(data.tasks || ((current) => [created, ...current]));
        setStatus({ tone: "success", message: "已新增采集任务" });
      }
      setTaskModal(null);
    } catch (err) {
      setError(err.message);
      setStatus({ tone: "error", message: err.message });
    } finally {
      setLoading(null);
    }
  }

  async function bindAgentMail(forceRebind = false) {
    setError("");
    setLoading("mail-auth");
    try {
      if (forceRebind) {
        const logout = await api.logoutMailAuth();
        setMailStatus(logout.mail || { authorized: false, email: "" });
      }
      const data = await api.startMailAuth();
      if (data.authUrl) {
        setMailAuthUrl(data.authUrl);
        setStatus({ tone: "running", message: "Agent Mail 授权已启动；如浏览器未自动打开，请在弹窗中手动打开授权页" });
      }
      window.setTimeout(() => refresh().catch(() => null), 4000);
      window.setTimeout(() => refresh().catch(() => null), 12000);
    } catch (err) {
      setError(err.message);
      setStatus({ tone: "error", message: err.message });
    } finally {
      setLoading(null);
    }
  }

  async function confirmMailDelivery(delivery) {
    if (!delivery) return;
    setLoading(`mail-confirm-${delivery.id}`);
    try {
      const data = await api.confirmMailDelivery(delivery.id);
      setLibrary(data.library);
      const message = data.delivery?.status === "sent" ? "邮件发送已确认" : "确认令牌已刷新，请再次确认发送";
      setStatus({ tone: "success", message });
    } catch (err) {
      setError(err.message);
      setStatus({ tone: "error", message: err.message });
    } finally {
      setLoading(null);
    }
  }

  async function confirmPendingMailDeliveries() {
    setLoading("mail-confirm-all");
    try {
      const data = await api.confirmPendingMailDeliveries();
      setLibrary(data.library);
      const sentCount = (data.confirmed || []).filter((item) => item.status === "sent").length;
      setStatus({ tone: "success", message: sentCount ? `已确认发送 ${sentCount} 封邮件` : "已处理待确认邮件" });
    } catch (err) {
      setError(err.message);
      setStatus({ tone: "error", message: err.message });
    } finally {
      setLoading(null);
    }
  }

  async function retryMailDelivery(delivery) {
    if (!delivery) return;
    setLoading(`mail-retry-${delivery.id}`);
    try {
      const data = await api.retryMailDelivery(delivery.id);
      setLibrary(data.library);
      setStatus({ tone: "success", message: data.delivery?.status === "sent" ? "邮件已发送" : "已重新生成邮件确认" });
    } catch (err) {
      setError(err.message);
      setStatus({ tone: "error", message: err.message });
    } finally {
      setLoading(null);
    }
  }

  async function deleteTask(task) {
    if (!task) return;
    const ok = window.confirm(`删除该采集任务？\n\n${task.query}`);
    if (!ok) return;
    setError("");
    setLoading(`task-delete-${task.id}`);
    try {
      await api.deleteTask(task.id);
      setTasks((current) => current.filter((t) => t.id !== task.id));
      setStatus({ tone: "success", message: "已删除采集任务" });
    } catch (err) {
      setError(err.message);
      setStatus({ tone: "error", message: err.message });
    } finally {
      setLoading(null);
    }
  }

  function buildRunningLog(task) {
    const sources = (task.sources || ["openalex", "crossref"]).join(" / ");
    return {
      id: `active_${task.id}_${Date.now()}`,
      taskId: task.id,
      taskName: task.query,
      status: "running",
      startedAt: new Date().toISOString(),
      meta: [
        `目标 ${task.count || 5} 篇`,
        task.yearFrom ? `${task.yearFrom} 年起` : "不限年份",
        `评分≥${task.minScore ?? 70}`,
        `来源 ${sources}`,
      ],
      steps: [
        { key: "prepare", status: "done", text: "读取任务参数：研究方向、篇数、年份、评分阈值、数据源和去重策略。" },
        { key: "plan", status: "running", text: "扩展检索式：把中文研究方向转换为可用于 OpenAlex/Crossref 的英文查询组合。" },
        { key: "search", status: "pending", text: `等待公开数据源返回：${sources}。` },
        { key: "score", status: "pending", text: "等待评分、筛选、跨源 DOI/标题去重。" },
        { key: "save", status: "pending", text: "等待入库，并按配置尝试获取开放 PDF 或 HTML 全文。" },
        ...(task.autoAnalyze
          ? [{ key: "analysis", status: "pending", text: "等待采集完成后，将新入库文献提交 AI 分析队列。" }]
          : []),
      ],
    };
  }

  async function runScan(task) {
    if (!task || runningTaskIds[task.id]) return;
    const pushReady = taskMailPushReady(task);
    const effectiveTask = pushReady ? task : { ...task, notifyAfterRun: false };
    setError("");
    setActiveView("scan");
    setActiveRunLog(buildRunningLog(effectiveTask));
    setRunningTaskIds((current) => ({ ...current, [task.id]: true }));
    setStatus({ tone: "running", message: `正在执行：${short(task.query, 42)}` });
    try {
      const data = await api.runTask(task.id);
      setLibrary(data.library);
      if (data.tasks) setTasks(data.tasks);
      setSelectedPaperId((current) => current || data.library?.papers?.[0]?.id || null);
      setActiveRunLog({
        ...buildRunningLog(effectiveTask),
        id: data.run.id,
        runId: data.run.id,
        status: data.run.savedCount > 0 ? "done" : "warning",
        startedAt: data.run.createdAt,
        savedPapers: data.papers || [],
        mailDeliveries: data.mailDeliveries || [],
        queryPlan: data.run.queryPlan || [],
        sourceStatuses: data.run.sourceStatuses || [],
        targetMet: data.run.targetMet,
        exhaustedReason: data.run.exhaustedReason,
        steps: [
          { key: "prepare", status: "done", text: "已读取任务参数并生成检索计划。" },
          { key: "search", status: "done", text: `公开数据源检索完成，候选 ${data.run.candidateCount || 0} 篇。` },
          { key: "save", status: "done", text: `完成：保存 ${data.run.savedCount || 0} 篇，去重 ${data.run.duplicateCount || 0} 篇。` },
          ...(task.autoAnalyze
            ? [{ key: "analysis", status: "done", text: "AI 分析已由后端逐篇处理并落盘。" }]
            : []),
          ...(pushReady
            ? [{ key: "mail", status: "done", text: `邮箱推送已生成 ${data.mailDeliveries?.length || 0} 条记录。` }]
            : []),
        ],
      });
      setExpandedRunIds((current) => ({ ...current, [data.run.id]: true }));
      setStatus({
        tone: data.run.savedCount > 0 ? "success" : "warning",
        message:
          data.run.savedCount > 0
            ? `已保存 ${data.run.savedCount} 篇${pushReady ? `，生成 ${data.mailDeliveries?.length || 0} 条邮箱推送` : ""}`
            : "未发现新的可入库文献",
      });
    } catch (err) {
      setError(err.message);
      setStatus({ tone: "error", message: err.message });
      const failed = {
        id: `scan_failed_${Date.now()}`,
        taskId: task.id,
        query: task.query,
        count: task.count,
        createdAt: new Date().toISOString(),
        savedCount: 0,
        candidateCount: 0,
        uniqueCount: 0,
        duplicateCount: 0,
        savedPaperIds: [],
        sourceStatuses: [],
        queryPlan: [],
        duplicateTitles: [],
        _failed: true,
        _errorMessage: err.message,
        targetMet: false,
        exhaustedReason: err.message,
      };
      setActiveRunLog(null);
      setLibrary((current) => ({
        ...current,
        scanRuns: [failed, ...(current.scanRuns || [])].slice(0, 30),
      }));
    } finally {
      setRunningTaskIds((current) => {
        const next = { ...current };
        delete next[task.id];
        return next;
      });
    }
  }

  async function runAnalysis(targetPaper = selectedPaper, options = {}) {
    const paper = targetPaper;
    const paperIds = paper ? [paper.id] : [];
    if (!paperIds.length) {
      setError("请先选择一篇本地文献");
      return;
    }
    if (!paper.localFullTextUrl) {
      setError("请先获取或上传完整论文原文，再生成 AI 分析报告。");
      setStatus({ tone: "warning", message: "请先获取或上传完整论文原文，再生成 AI 分析报告。" });
      return;
    }
    if (analyzingPaperIds[paper.id]) return;
    setError("");
    setAnalyzingPaperIds((current) => ({ ...current, [paper.id]: true }));
    if (options.focus !== false) setReadingMode("analysis");
    setStatus({ tone: "running", message: `AI 正在分析：${short(paper.title, 42)}` });
    try {
      const data = await api.analyze({
        paperIds,
        query: paper.title,
        title: `${paper.title} AI 阅读报告`,
        limit: 1,
      });
      setLibrary(data.library);
      if (options.focus !== false) setReadingMode("analysis");
      setStatus({ tone: "success", message: "AI 分析报告已保存到本地" });
    } catch (err) {
      setError(err.message);
      setStatus({ tone: "error", message: err.message });
    } finally {
      setAnalyzingPaperIds((current) => {
        const next = { ...current };
        delete next[paper.id];
        return next;
      });
    }
  }

  async function deletePaper(paper) {
    if (!paper) return;
    const ok = window.confirm(`从本地文献库删除这篇文献？\n\n${paper.title}`);
    if (!ok) return;
    setError("");
    setLoading(`delete-${paper.id}`);
    try {
      const data = await api.deletePaper(paper.id);
      setLibrary(data.library);
      const nextPaper = data.library.papers?.find((item) => item.id !== paper.id) || data.library.papers?.[0] || null;
      setSelectedPaperId(nextPaper?.id || null);
      setFocusedPaperId(nextPaper?.id || null);
      setActiveView("library");
      if (nextPaper) pulsePaper(nextPaper.id);
      setStatus({ tone: "success", message: "已从本地文献库删除" });
    } catch (err) {
      setError(err.message);
      setStatus({ tone: "error", message: err.message });
    } finally {
      setLoading(null);
    }
  }

  async function fetchFullText(paper) {
    if (!paper || fetchingFullTextIds[paper.id]) return;
    setError("");
    setFetchingFullTextIds((current) => ({ ...current, [paper.id]: true }));
    setStatus({ tone: "running", message: "正在从公开来源页抽取正文文本..." });
    try {
      const data = await api.fetchFullText(paper.id);
      setLibrary(data.library);
      setRetrievalStatus(data.retrieval || { method: data.method || (data.reused ? "reused" : "") });
      setStatus({
        tone: "success",
        message:
          data.method === "pdf"
            ? "完整 PDF 已保存到本地"
            : data.method === "html-fulltext"
              ? "公开 HTML 全文已保存为 Markdown"
              : data.reused
                ? "本地已存在完整文献资产"
                : "文献资产已更新",
      });
      setReadingMode("source");
    } catch (err) {
      setError(err.message);
      setRetrievalStatus(err.retrieval || null);
      setStatus({ tone: "error", message: err.message });
    } finally {
      setFetchingFullTextIds((current) => {
        const next = { ...current };
        delete next[paper.id];
        return next;
      });
    }
  }

  async function uploadPaperPdf(paper, file) {
    if (!paper || !file) return;
    if (file.type && file.type !== "application/pdf") {
      setStatus({ tone: "error", message: "请上传 PDF 文件" });
      return;
    }
    setError("");
    setLoading(`upload-pdf-${paper.id}`);
    setStatus({ tone: "running", message: "正在保存用户上传的 PDF..." });
    try {
      const data = await api.uploadPdf(paper.id, file);
      setLibrary(data.library);
      setSelectedPaperId(paper.id);
      setReadingMode("source");
      setStatus({ tone: "success", message: "PDF 已上传并绑定到当前文献" });
    } catch (err) {
      setError(err.message);
      setStatus({ tone: "error", message: err.message });
    } finally {
      setLoading(null);
    }
  }

  function UploadPdfButton({ paper, compact = false }) {
    if (!paper) return null;
    const uploading = loading === `upload-pdf-${paper.id}`;
    return (
      <label className={compact ? "upload-pdf-link" : "wide-action upload-pdf-button"}>
        <UploadSimple size={15} />
        {uploading ? "上传中" : "上传本地 PDF"}
        <input
          type="file"
          accept="application/pdf,.pdf"
          disabled={uploading}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) uploadPaperPdf(paper, file);
          }}
        />
      </label>
    );
  }

  const selectedReportMarkdown =
    selectedPaperReport?.markdown ||
    paperMarkdown ||
    "# 尚未选择文献\n\n先在左侧检索入库或选择一篇文献。中间阅读区默认展示当前文献原文；点击 AI 分析报告后，系统会为当前文献生成并展示单篇分析。\n\n## 工作流\n\n- 左侧选择文献\n- 中间阅读该文献原文：有本地 PDF 时用 PDF 阅读器，否则用 Markdown\n- 点击 AI 分析报告生成单篇分析\n- 右侧查看证据、AI 操作和本地文件入口\n";
  const selectedPaperHasLocalSource = Boolean(selectedPaper?.localPdfUrl || selectedPaper?.localFullTextUrl);
  const selectedPaperAnalysisReady = Boolean(selectedPaper?.localFullTextUrl);
  const sourceMarkdown = selectedPaper
    ? (paperMarkdown || selectedReportMarkdown).replace(
        /- 本地 PDF:.*/g,
        `- 本地 PDF: ${selectedPaper.localPdfPath || "未下载"}`,
      )
    : selectedReportMarkdown;
  const selectedPaperIsAnalyzing = Boolean(selectedPaper && analyzingPaperIds[selectedPaper.id]);
  const selectedPaperIsFetchingFullText = Boolean(selectedPaper && fetchingFullTextIds[selectedPaper.id]);

  function pulsePaper(paperId) {
    if (!paperId) return;
    if (pulseTimerRef.current) window.clearTimeout(pulseTimerRef.current);
    setHighlightPulseId(`${paperId}:${Date.now()}`);
    pulseTimerRef.current = window.setTimeout(() => setHighlightPulseId(""), 950);
  }

  function focusPaper(paper, options = {}) {
    if (!paper) return;
    setSelectedPaperId(paper.id);
    setFocusedPaperId(paper.id);
    pulsePaper(paper.id);

    if (options.scrollList !== false) {
      window.requestAnimationFrame(() => {
        paperRowRefs.current[paper.id]?.scrollIntoView({ block: "center", behavior: "smooth" });
      });
    }

    if (options.centerGraph) {
      window.requestAnimationFrame(() => {
        const node = libraryGraph.nodes.find((item) => item.id === `paper-${paper.id}`);
        const center = node?.data?.center;
        if (center && reactFlowInstanceRef.current?.setCenter) {
          reactFlowInstanceRef.current.setCenter(center.x, center.y, { zoom: 1.02, duration: 560 });
        }
      });
    }
  }

  function selectPaperFromLibrary(paper) {
    if (!paper) return;
    const alreadyFocused = focusedPaperId === paper.id;
    focusPaper(paper, { scrollList: true, centerGraph: true });
    if (alreadyFocused) {
      setActiveView("paper");
      setReadingMode("source");
    }
  }

  function openPaper(paper) {
    focusPaper(paper, { scrollList: true, centerGraph: true });
    setActiveView("paper");
    setReadingMode("source");
  }

  return (
    <main className="reader-shell">
      <aside className="library-panel">
        <div className="brand-row">
          <div className="brand-mark"><Books size={22} weight="fill" /></div>
          <div>
            <strong>文献阅读器</strong>
            <span>Local Paper Studio</span>
          </div>
        </div>

        <section className="feature-panel">
          <button className={`feature-item ${activeView === "scan" ? "active" : ""}`} onClick={() => setActiveView("scan")}>
            <MagnifyingGlass size={17} />
            <span>采集任务</span>
          </button>
          <button className={`feature-item ${activeView === "library" || activeView === "paper" ? "active" : ""}`} onClick={() => setActiveView("library")}>
            <Database size={17} />
            <span>本地文献库</span>
            <small>{library.papers?.length || 0}</small>
          </button>
        </section>
      </aside>

      <section className="reader-panel">
        {activeView === "scan" ? (
          <section className="workspace-panel scan-workspace task-workspace">
            <div className="task-list-header">
              <div className="workspace-title">
                <span>采集任务</span>
                <h1>采集任务列表</h1>
                <p>管理可复用的文献采集任务，一键执行或编辑配置。自动执行和邮箱推送互相独立，推送会在任务完成后按条发送文献或 AI 分析。</p>
              </div>
              <div className="task-header-actions">
                <button
                  className={`mail-bind-btn ${mailStatus?.authorized ? "bound" : ""}`}
                  type="button"
                  onClick={() => setMailBindModal(true)}
                  disabled={loading === "mail-auth"}
                >
                  <Lightning size={16} weight="fill" />
                  {mailStatus?.authorized ? `已绑定 ${mailStatus.email}` : "绑定邮箱"}
                </button>
                <button className="add-task-btn" type="button" onClick={() => setTaskModal({ mode: "create" })}>
                  <Plus size={16} weight="bold" />
                  新增任务
                </button>
              </div>
            </div>
            <div className="task-list">
              {tasks.length ? (
                tasks.map((task) => {
                  const pushReady = taskMailPushReady(task);
                  return (
                  <div className="task-row" key={task.id}>
                    <div className="task-row-top">
                      <div className="task-query">{task.query}</div>
                      <div className="task-actions">
                        <button
                          className="task-run-btn"
                          type="button"
                          disabled={Boolean(runningTaskIds[task.id])}
                          onClick={() => runScan(task)}
                        >
                          <Play size={14} weight="fill" />
                          {runningTaskIds[task.id] ? "执行中" : "执行"}
                        </button>
                        <button
                          className="task-edit-btn"
                          type="button"
                          disabled={loading === `task-delete-${task.id}`}
                          onClick={() => setTaskModal({ mode: "edit", id: task.id, ...task })}
                        >
                          <PencilSimple size={14} />
                          编辑
                        </button>
                        <button
                          className="task-delete-btn"
                          type="button"
                          disabled={loading === `task-delete-${task.id}`}
                          onClick={() => deleteTask(task)}
                        >
                          <Trash size={14} />
                        </button>
                      </div>
                    </div>
                    <div className="task-meta">
                      <span className="task-tag">{task.count} 篇</span>
                      <span className="task-tag">{task.yearFrom ? `${task.yearFrom} 起` : "不限年份"}</span>
                      <span className="task-tag">评分≥{task.minScore}</span>
                      {task.sources?.map((src) => (
                        <span className="task-tag" key={src}>{src === "openalex" ? "OpenAlex" : "Crossref"}</span>
                      ))}
                      <span className={`task-tag ${task.downloadOpenPdf ? "on" : ""}`}>
                        {task.downloadOpenPdf ? "下载 PDF" : "不下载 PDF"}
                      </span>
                      <span className={`task-tag ${task.autoAnalyze ? "on" : ""}`}>
                        <Brain size={12} />
                        {task.autoAnalyze ? "AI 分析" : "不分析"}
                      </span>
                      <span className={`task-tag ${task.dailyEnabled ? "on" : ""}`}>
                        {task.dailyEnabled ? `每日 ${task.dailyTime}` : "不自动执行"}
                      </span>
                      <span className={`task-tag ${pushReady ? "on" : ""}`}>
                        {pushReady ? "推送邮箱" : "不推送"}
                      </span>
                      {pushReady ? (
                        <span className="task-tag on">To {task.recipientEmails?.length || 0}</span>
                      ) : null}
                    </div>
                  </div>
                  );
                })
              ) : (
                <div className="empty-state">暂无采集任务，点击右上角“新增任务”创建。</div>
              )}
            </div>
          </section>
        ) : null}

        {activeView === "library" ? (
          <LibraryGraphView
            paperCount={library.papers?.length || 0}
            visiblePaperCount={visiblePaperCount}
            nodes={libraryGraph.nodes}
            edges={libraryGraph.edges}
            query={libraryQuery}
            focusedPaperId={focusedPaperId}
            onGraphInit={(instance) => {
              reactFlowInstanceRef.current = instance;
            }}
            onClearFocus={() => {
              setFocusedPaperId(null);
              setHighlightPulseId("");
            }}
            onFocusPaper={selectPaperFromLibrary}
            onOpenPaper={openPaper}
            onGoScan={() => setActiveView("scan")}
          />
        ) : null}

        {activeView === "paper" ? (
          <>
            <div className="paper-mode-bar">
              <button className="detail-back-btn" type="button" onClick={() => setActiveView("library")}>
                <CaretLeft size={15} />
                退出
              </button>
              <button className={readingMode === "source" ? "active" : ""} onClick={() => setReadingMode("source")} disabled={!selectedPaper?.localMarkdownUrl && !selectedPaper?.localPdfUrl}>
                <FileText size={15} />
                文献原文
              </button>
              <button
                className={readingMode === "analysis" ? "active" : ""}
                onClick={() => {
                  setReadingMode("analysis");
                  if (selectedPaper && selectedPaperAnalysisReady && !selectedPaperReport && !selectedPaperIsAnalyzing) {
                    runAnalysis(selectedPaper);
                  }
                }}
                disabled={!selectedPaper}
              >
                <Brain size={15} />
                AI 分析报告
              </button>
              {selectedPaper ? (
                <button
                  className="detail-delete-btn"
                  type="button"
                  onClick={() => deletePaper(selectedPaper)}
                  disabled={loading === `delete-${selectedPaper.id}`}
                >
                  <Trash size={15} />
                  删除该文档
                </button>
              ) : null}
            </div>
            {readingMode === "source" && selectedPaper?.localPdfUrl ? (
              <iframe className="pdf-reader" title={selectedPaper.title} src={selectedPaper.localPdfUrl} />
            ) : readingMode === "source" && selectedPaper && !selectedPaperHasLocalSource ? (
              <div className="no-fulltext-state">
                <span>未获取到完整论文原文</span>
                <h2>{selectedPaper.title}</h2>
                <dl>
                  <div><dt>DOI</dt><dd>{selectedPaper.doi || "未提供"}</dd></div>
                  <div><dt>年份</dt><dd>{selectedPaper.year || "未知"}</dd></div>
                  <div><dt>期刊</dt><dd>{selectedPaper.journal || selectedPaper.source || "未知"}</dd></div>
                </dl>
                <p>
                  当前只保存了开放数据源返回的元数据和摘要，不等同于完整论文正文。你可以先打开 DOI/来源页面下载 PDF，
                  再回到这里上传；系统也可以尝试自动访问 DOI/来源页，优先下载合法公开 PDF，其次抽取公开 HTML 正文。
                </p>
                <ol>
                  <li>打开 DOI/来源页面，确认出版商页面是否提供合法 PDF。</li>
                  <li>在来源页面下载 PDF 到本地。</li>
                  <li>回到本页面，通过下面的上传入口上传 PDF。</li>
                </ol>
                <div className="no-fulltext-actions">
                  <a
                    className="wide-action ghost"
                    href={doiUrl(selectedPaper.doi) || selectedPaper.landingPageUrl || selectedPaper.sourceUrl || "#"}
                    target="_blank"
                    rel="noreferrer"
                  >
                    打开来源页面
                  </a>
                  <button
                    className="wide-action ghost"
                    onClick={() => fetchFullText(selectedPaper)}
                    disabled={selectedPaperIsFetchingFullText}
                  >
                    {selectedPaperIsFetchingFullText ? "正在尝试自动获取" : "尝试自动获取 DOI 原文/PDF"}
                  </button>
                  <UploadPdfButton paper={selectedPaper} compact />
                </div>
              </div>
            ) : readingMode === "analysis" && selectedPaperIsAnalyzing ? (
              <div className="analysis-loading">
                <div className="spinner" />
                <strong>AI 正在分析当前文献</strong>
                <span>后台最多同时处理 3 篇，超过后会自动排队。</span>
              </div>
            ) : readingMode === "analysis" && !selectedPaperReport ? (
                <div className="analysis-loading">
                <Brain size={28} />
                <strong>{selectedPaperAnalysisReady ? "尚未生成 AI 分析报告" : "请先获取或上传全文"}</strong>
                <span>{selectedPaperAnalysisReady ? "报告会基于本地完整正文生成。" : "当前只有元数据/摘要，系统不会生成摘要级报告。"}</span>
                <button className="wide-action" onClick={() => runAnalysis(selectedPaper)} disabled={!selectedPaper || !selectedPaperAnalysisReady}>
                  {selectedPaperAnalysisReady ? "点击生成报告" : "请先获取或上传全文"}
                </button>
              </div>
            ) : (
              <article className="markdown-reader">{renderMarkdown(readingMode === "source" ? sourceMarkdown : selectedReportMarkdown)}</article>
            )}
          </>
        ) : null}
      </section>

      <aside className="inspector-panel">
        {activeView === "scan" ? (
          <RunLogList
            scanRuns={library.scanRuns || []}
            papers={library.papers || []}
            activeRunLog={activeRunLog}
            expandedRunIds={expandedRunIds}
            setExpandedRunIds={setExpandedRunIds}
            runAnalyzeState={runAnalyzeState}
            mailDeliveries={library.mailDeliveries || []}
            mailStatus={mailStatus}
            onBindMail={() => setMailBindModal(true)}
            onConfirmMailDelivery={confirmMailDelivery}
            onConfirmPendingMailDeliveries={confirmPendingMailDeliveries}
            onRetryMailDelivery={retryMailDelivery}
            loading={loading}
          />
        ) : null}

        {activeView === "library" ? (
          <LibraryPaperListPanel
            groups={libraryGroups}
            visibleGroups={visibleGroups}
            activeGroupId={activeLibraryGroupId}
            query={libraryQuery}
            sort={librarySort}
            selectedPaperId={focusedPaperId}
            highlightPulseId={highlightPulseId}
            paperRowRefs={paperRowRefs}
            onGroupChange={setActiveLibraryGroupId}
            onQueryChange={setLibraryQuery}
            onSortChange={setLibrarySort}
            onFocusPaper={selectPaperFromLibrary}
            onOpenPaper={openPaper}
            onDeletePaper={deletePaper}
            loading={loading}
          />
        ) : null}

        {activeView === "paper" ? (
          selectedPaper && selectedPaperHasLocalSource ? (
            <div className="paper-inspector">
            <div className="paper-heading">
              <span>{selectedPaper.source}</span>
              <h2>{selectedPaper.title}</h2>
              <p>{short(selectedPaper.abstract, 180)}</p>
            </div>
            <div className="inspector-stack">
              <InfoCard label="匹配评分" value={`${Math.round(selectedPaper.rawScore || 0)} / 100`} />
              <InfoCard label="发表信息" value={`${selectedPaper.year || "未知年份"} · ${selectedPaper.journal || selectedPaper.source}`} />
              <InfoCard label="开放状态" value={selectedPaper.openAccess ? "开放获取" : "未知或受限"} />
              <InfoCard
                label="AI 分析状态"
                value={
                  selectedPaperIsAnalyzing
                    ? "排队/分析中"
                    : selectedPaperReport
                      ? `${selectedPaperReport.model || "AI"} · 已生成`
                      : "未生成，点击生成报告"
                }
              />
              <InfoCard label="作者数量" value={`${selectedPaper.authors?.length || 0} 位`} />
              <InfoCard
                label="原文状态"
                value={
                  selectedPaper.localPdfUrl
                    ? "本地 PDF"
                    : selectedPaper.localFullTextUrl
                      ? "公开全文 Markdown"
                      : "元数据/摘要"
                }
              />
              <InfoCard label="关键词/主题" value={selectedPaper.keywords?.slice(0, 8).join(" / ") || "未提供"} />
              <Evidence label="摘要证据" text={short(selectedPaper.abstract, 260)} />
              <Evidence label="去重键" text={selectedPaper.doi || selectedPaper.title} />
              {!selectedPaper.localPdfUrl ? (
                <button
                  className="wide-action ghost"
                  onClick={() => fetchFullText(selectedPaper)}
                  disabled={selectedPaperIsFetchingFullText}
                >
                  {selectedPaperIsFetchingFullText
                    ? "正在访问 DOI/来源页"
                    : selectedPaper.localFullTextUrl
                      ? "重新获取 DOI 原文/PDF"
                    : "获取 DOI 原文/PDF"}
                </button>
              ) : null}
              {!selectedPaper.localPdfUrl ? <UploadPdfButton paper={selectedPaper} /> : null}
              {retrievalStatus ? (
                <div className="retrieval-card">
                  <strong>
                    {retrievalStatus.method === "pdf"
                      ? "PDF 获取成功"
                      : retrievalStatus.method === "pdf-extract-failed"
                        ? "PDF 已保存但未抽取到可分析正文"
                      : retrievalStatus.method === "html-fulltext"
                        ? "已获取 HTML 全文"
                        : "获取记录"}
                  </strong>
                  <span>
                    {retrievalStatus.method === "pdf"
                      ? "已保存完整 PDF，并提取出可用于 AI 分析的正文。"
                      : retrievalStatus.method === "pdf-extract-failed"
                        ? "当前 PDF 可能是扫描版或文本不足，请确认后上传可复制文本的 PDF。"
                      : retrievalStatus.method === "html-fulltext"
                        ? "未直接拿到 PDF，已把公开页面正文保存为 Markdown。"
                        : "未发现可直接保存的完整 PDF 或正文。"}
                  </span>
                  {(retrievalStatus.attempts || []).slice(-4).map((attempt, index) => (
                    <small key={`${attempt.url}-${index}`}>
                      {attempt.type}: {attempt.ok ? "成功" : attempt.reason || "失败"} · {attempt.url}
                    </small>
                  ))}
                </div>
              ) : null}
              <FileLine label="DOI" path={doiUrl(selectedPaper.doi)} url={doiUrl(selectedPaper.doi)} />
              <FileLine label="来源页面" path={selectedPaper.landingPageUrl || selectedPaper.sourceUrl} url={selectedPaper.landingPageUrl || selectedPaper.sourceUrl} />
              <FileLine label="公开全文" path={selectedPaper.localFullTextPath} url={selectedPaper.localFullTextUrl} />
              <FileLine label="本地PDF" path={selectedPaper.localPdfPath} url={selectedPaper.localPdfUrl} onOpen={() => setReadingMode("source")} />
              <FileLine label="在线PDF" path={selectedPaper.pdfUrl} url={selectedPaper.pdfUrl} />
              <FileLine label="AI报告" path={selectedPaperReport?.markdownPath} url={selectedPaperReport?.markdownUrl} />
            </div>
          </div>
          ) : (
            <div className="empty-state tall">选择一篇本地文献后，这里会显示分析维度、证据和文件路径。</div>
          )
        ) : null}
      </aside>

      {taskModal ? (
        <TaskModal
          mode={taskModal.mode}
          initial={taskModal.mode === "edit" ? taskModal : defaultScan}
          loading={loading === "task-save"}
          onClose={() => setTaskModal(null)}
          onSave={saveTask}
          mailStatus={mailStatus}
        />
      ) : null}
      {mailBindModal ? (
        <MailBindModal
          mailStatus={mailStatus}
          authUrl={mailAuthUrl}
          loading={loading === "mail-auth"}
          onClose={() => setMailBindModal(false)}
          onBind={() => bindAgentMail(false)}
          onRebind={() => bindAgentMail(true)}
          onOpenAuthUrl={() => {
            if (mailAuthUrl) window.open(mailAuthUrl, "_blank", "noopener,noreferrer");
          }}
          onRefresh={() => refresh().catch(() => null)}
        />
      ) : null}
      <ActivityCenter
        activities={activities}
        open={activityOpen}
        onToggle={() => setActivityOpen((current) => !current)}
        onRemove={removeActivity}
      />
    </main>
  );
}

function InfoCard({ label, value }) {
  return (
    <div className="info-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Evidence({ label, text }) {
  return (
    <div className="evidence-card">
      <span>{label}</span>
      <p>{text}</p>
    </div>
  );
}

function FileLine({ label, path, url, onOpen }) {
  const canOpen = Boolean(url);
  return (
    <div className="file-line">
      <span>{label}</span>
      <strong>{path || "未生成"}</strong>
      {canOpen && onOpen ? (
        <button type="button" onClick={onOpen} aria-label={label}>
          打开
        </button>
      ) : null}
      {canOpen && !onOpen ? (
        <a href={url} target="_blank" rel="noreferrer" aria-label={label}>
          <LinkSimple size={16} />
        </a>
      ) : null}
    </div>
  );
}
