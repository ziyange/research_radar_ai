import { useEffect, useMemo, useState } from "react";
import {
  Books,
  Brain,
  CaretDown,
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
  X,
} from "@phosphor-icons/react";
import "./styles.css";

const defaultScan = {
  query: "",
  count: 5,
  yearFrom: 2021,
  minScore: 70,
  sources: ["openalex", "crossref"],
  downloadOpenPdf: true,
  autoAnalyze: false,
};

const api = {
  async getLibrary() {
    const response = await fetch("/api/library");
    if (!response.ok) throw new Error("无法读取本地文献库");
    return response.json();
  },
  async getHealth() {
    const response = await fetch("/api/health");
    if (!response.ok) throw new Error("本地服务未就绪");
    return response.json();
  },
  async getTasks() {
    const response = await fetch("/api/tasks");
    if (!response.ok) throw new Error("无法读取采集任务");
    return response.json();
  },
  async createTask(payload) {
    const response = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "创建任务失败");
    return data;
  },
  async updateTask(id, payload) {
    const response = await fetch(`/api/tasks/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "更新任务失败");
    return data;
  },
  async deleteTask(id) {
    const response = await fetch(`/api/tasks/${encodeURIComponent(id)}`, { method: "DELETE" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "删除任务失败");
    return data;
  },
  async runTask(id) {
    const response = await fetch(`/api/tasks/${encodeURIComponent(id)}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.run?.error || data.error || "执行任务失败");
    return data;
  },
  async scan(payload) {
    const response = await fetch("/api/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "采集失败");
    return data;
  },
  async analyze(payload) {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || data.error || "AI 分析失败");
    return data;
  },
  async deletePaper(id) {
    const response = await fetch(`/api/papers/${encodeURIComponent(id)}`, { method: "DELETE" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "删除失败");
    return data;
  },
  async fetchFullText(id) {
    const response = await fetch(`/api/papers/${encodeURIComponent(id)}/fetch-fulltext`, { method: "POST" });
    const data = await response.json();
    if (!response.ok) {
      const error = new Error(data.message || data.error || "获取全文失败");
      error.retrieval = data.retrieval;
      throw error;
    }
    return data;
  },
};

function scoreTone(score) {
  if (score >= 80) return "high";
  if (score >= 60) return "medium";
  return "low";
}

function doiUrl(value) {
  const doi = String(value || "")
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "");
  return doi ? `https://doi.org/${doi}` : "";
}

function short(value, length = 120) {
  if (!value) return "暂无摘要";
  return value.length > length ? `${value.slice(0, length)}...` : value;
}

function InlineMarkdown({ text }) {
  const parts = String(text || "").split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      return (
        <a key={index} href={link[2]} target="_blank" rel="noreferrer">
          {link[1]}
        </a>
      );
    }
    return <span key={index}>{part}</span>;
  });
}

function FlowchartBlock({ source }) {
  const labels = new Map();
  const edges = [];
  for (const rawLine of String(source || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    const edge = line.match(/^([A-Za-z0-9_]+)\[(.+?)\]\s*-->\s*([A-Za-z0-9_]+)\[(.+?)\]/);
    const simpleEdge = line.match(/^([A-Za-z0-9_]+)\s*-->\s*([A-Za-z0-9_]+)/);
    if (edge) {
      labels.set(edge[1], edge[2]);
      labels.set(edge[3], edge[4]);
      edges.push([edge[1], edge[3]]);
    } else if (simpleEdge) {
      edges.push([simpleEdge[1], simpleEdge[2]]);
    }
  }
  const orderedIds = [];
  for (const [from, to] of edges) {
    if (!orderedIds.includes(from)) orderedIds.push(from);
    if (!orderedIds.includes(to)) orderedIds.push(to);
  }
  if (!orderedIds.length) {
    return (
      <pre className="flowchart-block">
        <code>{source}</code>
      </pre>
    );
  }
  return (
    <div className="flowchart-render">
      {orderedIds.map((id, index) => (
        <div className="flow-step" key={id}>
          <div className="flow-node">
            <span>{id}</span>
            <strong>{labels.get(id) || id}</strong>
          </div>
          {index < orderedIds.length - 1 ? <div className="flow-arrow">↓</div> : null}
        </div>
      ))}
    </div>
  );
}

function renderMarkdown(markdown) {
  const lines = String(markdown || "").split(/\r?\n/);
  const blocks = [];
  let list = null;
  let table = null;
  let code = null;

  function flushList() {
    if (!list) return;
    const Tag = list.type === "ol" ? "ol" : "ul";
    blocks.push(
      <Tag key={`list-${blocks.length}`}>
        {list.items.map((item, index) => (
          <li key={index}>
            <InlineMarkdown text={item} />
          </li>
        ))}
      </Tag>,
    );
    list = null;
  }

  function flushTable() {
    if (!table) return;
    const rows = table.rows.filter((row) => !/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(row));
    const cells = rows.map((row) =>
      row
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((cell) => cell.trim()),
    );
    const [head, ...body] = cells;
    blocks.push(
      <table key={`table-${blocks.length}`}>
        <thead>
          <tr>{head?.map((cell, index) => <th key={index}><InlineMarkdown text={cell} /></th>)}</tr>
        </thead>
        <tbody>
          {body.map((row, rowIndex) => (
            <tr key={rowIndex}>{row.map((cell, index) => <td key={index}><InlineMarkdown text={cell} /></td>)}</tr>
          ))}
        </tbody>
      </table>,
    );
    table = null;
  }

  function flushCode() {
    if (!code) return;
    const source = code.lines.join("\n");
    blocks.push(code.lang === "mermaid" ? (
      <FlowchartBlock key={`code-${blocks.length}`} source={source} />
    ) : (
      <pre key={`code-${blocks.length}`}>
        <code>{source}</code>
      </pre>
    ));
    code = null;
  }

  lines.forEach((line, index) => {
    if (code) {
      if (line.startsWith("```")) flushCode();
      else code.lines.push(line);
    } else if (line.startsWith("```")) {
      flushList();
      flushTable();
      code = { lang: line.slice(3).trim(), lines: [] };
    } else if (/^\|.+\|$/.test(line.trim())) {
      flushList();
      if (!table) table = { rows: [] };
      table.rows.push(line.trim());
    } else {
      const image = line.trim().match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
      if (image) {
        flushList();
        flushTable();
        blocks.push(<img className="markdown-image" key={index} src={image[2]} alt={image[1]} />);
      } else if (line.startsWith("# ")) {
        flushList();
        flushTable();
        blocks.push(<h1 key={index}><InlineMarkdown text={line.slice(2)} /></h1>);
      } else if (line.startsWith("## ")) {
        flushList();
        flushTable();
        blocks.push(<h2 key={index}><InlineMarkdown text={line.slice(3)} /></h2>);
      } else if (line.startsWith("### ")) {
        flushList();
        flushTable();
        blocks.push(<h3 key={index}><InlineMarkdown text={line.slice(4)} /></h3>);
      } else if (line.startsWith("#### ")) {
        flushList();
        flushTable();
        blocks.push(<h4 key={index}><InlineMarkdown text={line.slice(5)} /></h4>);
      } else if (line.startsWith("- ")) {
        if (!list || list.type !== "ul") {
          flushList();
          list = { type: "ul", items: [] };
        }
        list.items.push(line.slice(2));
      } else if (/^\d+\.\s/.test(line)) {
        if (!list || list.type !== "ol") {
          flushList();
          list = { type: "ol", items: [] };
        }
        list.items.push(line.replace(/^\d+\.\s/, ""));
      } else if (line.startsWith("> ")) {
        flushList();
        flushTable();
        blocks.push(<blockquote key={index}><InlineMarkdown text={line.slice(2)} /></blockquote>);
      } else if (!line.trim()) {
        flushList();
        flushTable();
        blocks.push(<div className="md-gap" key={index} />);
      } else {
        flushList();
        flushTable();
        blocks.push(<p key={index}><InlineMarkdown text={line} /></p>);
      }
      return;
    }
  });
  flushList();
  flushTable();
  flushCode();
  return blocks;
}

export function App() {
  const [library, setLibrary] = useState({ papers: [], scanRuns: [], reports: [] });
  const [health, setHealth] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [selectedPaperId, setSelectedPaperId] = useState(null);
  const [activeView, setActiveView] = useState("library");
  const [libraryExpanded, setLibraryExpanded] = useState(true);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [librarySort, setLibrarySort] = useState("score-desc");
  const [readingMode, setReadingMode] = useState("analysis");
  const [paperMarkdown, setPaperMarkdown] = useState("");
  const [status, setStatus] = useState({ tone: "idle", message: "准备就绪" });
  const [loading, setLoading] = useState(null);
  const [runningTaskIds, setRunningTaskIds] = useState({});
  const [analyzingPaperIds, setAnalyzingPaperIds] = useState({});
  const [fetchingFullTextIds, setFetchingFullTextIds] = useState({});
  const [retrievalStatus, setRetrievalStatus] = useState(null);
  const [error, setError] = useState("");
  const [taskModal, setTaskModal] = useState(null);
  const [expandedRunIds, setExpandedRunIds] = useState({});
  const [runAnalyzeState, setRunAnalyzeState] = useState({});

  async function refresh() {
    const [libraryData, healthData, tasksData] = await Promise.all([
      api.getLibrary(),
      api.getHealth(),
      api.getTasks(),
    ]);
    setLibrary(libraryData);
    setHealth(healthData);
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
  const visiblePapers = useMemo(() => {
    const query = libraryQuery.trim().toLowerCase();
    const rows = (library.papers || []).filter((paper) => {
      if (!query) return true;
      return `${paper.title} ${paper.journal} ${paper.year} ${paper.doi} ${(paper.keywords || []).join(" ")}`
        .toLowerCase()
        .includes(query);
    });
    return rows.sort((a, b) => {
      if (librarySort === "score-asc") return (a.rawScore || 0) - (b.rawScore || 0);
      if (librarySort === "year-desc") return (b.year || 0) - (a.year || 0);
      if (librarySort === "year-asc") return (a.year || 0) - (b.year || 0);
      if (librarySort === "title-asc") return String(a.title || "").localeCompare(String(b.title || ""));
      if (librarySort === "title-desc") return String(b.title || "").localeCompare(String(a.title || ""));
      return (b.rawScore || 0) - (a.rawScore || 0);
    });
  }, [library.papers, libraryQuery, librarySort]);
  const selectedPaperReport = useMemo(() => {
    if (!selectedPaper) return null;
    return (
      library.reports?.find(
        (report) => report.paperIds?.length === 1 && report.paperIds.includes(selectedPaper.id),
      ) || null
    );
  }, [library.reports, selectedPaper]);

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

  async function saveTask(form) {
    setError("");
    setLoading("task-save");
    try {
      if (taskModal?.id) {
        const updated = await api.updateTask(taskModal.id, form);
        setTasks((current) => current.map((t) => (t.id === updated.id ? updated : t)));
        setStatus({ tone: "success", message: "任务配置已更新" });
      } else {
        const created = await api.createTask(form);
        setTasks((current) => [created, ...current]);
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

  function runStatusFor(taskId, run) {
    if (runningTaskIds[taskId]) return "running";
    if (!run) return "idle";
    if (run._failed) return "failed";
    return "done";
  }

  function latestRunForTask(taskId) {
    return (library.scanRuns || []).find((r) => r.taskId === taskId) || null;
  }

  async function runScan(task) {
    if (!task || runningTaskIds[task.id]) return;
    setError("");
    setRunningTaskIds((current) => ({ ...current, [task.id]: true }));
    setStatus({ tone: "running", message: `正在执行：${short(task.query, 42)}` });
    try {
      const data = await api.runTask(task.id);
      setLibrary(data.library);
      setSelectedPaperId((current) => current || data.papers?.[0]?.id || null);
      setStatus({
        tone: data.run.savedCount > 0 ? "success" : "warning",
        message:
          data.run.savedCount > 0
            ? `已保存 ${data.run.savedCount} 篇`
            : "未发现新的可入库文献",
      });
      if (task.autoAnalyze && data.run.savedPaperIds?.length) {
        runAutoAnalysis(data.run.savedPaperIds, task.query, data.run.id);
      }
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

  async function runAutoAnalysis(paperIds, query, runId) {
    const remaining = [...paperIds];
    setRunAnalyzeState((current) => ({
      ...current,
      [runId]: { total: paperIds.length, done: 0, paperIds: [...paperIds] },
    }));
    for (const paperId of remaining) {
      try {
        const paper = (library.papers || []).find((p) => p.id === paperId);
        const data = await api.analyze({
          paperIds: [paperId],
          query: query || paper?.title || "",
          title: `${paper?.title || "本地文献"} AI 阅读报告`,
          limit: 1,
        });
        setLibrary(data.library);
      } catch (err) {
        setError(err.message);
      } finally {
        setRunAnalyzeState((current) => {
          const state = current[runId];
          if (!state) return current;
          return { ...current, [runId]: { ...state, done: state.done + 1 } };
        });
      }
    }
  }

  async function runAnalysis(targetPaper = selectedPaper, options = {}) {
    const paper = targetPaper;
    const paperIds = paper ? [paper.id] : [];
    if (!paperIds.length) {
      setError("请先选择一篇本地文献");
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
      setActiveView(nextPaper ? "paper" : "library");
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

  const selectedReportMarkdown =
    selectedPaperReport?.markdown ||
    paperMarkdown ||
    "# 尚未选择文献\n\n先在左侧检索入库或选择一篇文献。中间阅读区默认展示当前文献原文；点击 AI 分析报告后，系统会为当前文献生成并展示单篇分析。\n\n## 工作流\n\n- 左侧选择文献\n- 中间阅读该文献原文：有本地 PDF 时用 PDF 阅读器，否则用 Markdown\n- 点击 AI 分析报告生成单篇分析\n- 右侧查看证据、AI 操作和本地文件入口\n";
  const sourceMarkdown = selectedPaper
    ? `${!selectedPaper.localPdfUrl && !selectedPaper.localFullTextUrl ? "# 未获取到完整论文原文\n\n当前只保存了开放数据源返回的元数据和摘要，不等同于完整论文正文。请在右侧点击“获取 DOI 原文/PDF”，系统会访问 DOI/来源页，优先下载合法公开 PDF，其次抽取公开 HTML 正文。\n\n---\n\n" : ""}${(paperMarkdown || selectedReportMarkdown).replace(
      /- 本地 PDF:.*/g,
      `- 本地 PDF: ${selectedPaper.localPdfPath || "未下载"}`,
    )}`
    : selectedReportMarkdown;
  const selectedPaperIsAnalyzing = Boolean(selectedPaper && analyzingPaperIds[selectedPaper.id]);
  const selectedPaperIsFetchingFullText = Boolean(selectedPaper && fetchingFullTextIds[selectedPaper.id]);

  function openPaper(paper) {
    setSelectedPaperId(paper.id);
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
          <div className={`feature-item library-feature ${activeView === "library" ? "active" : ""}`}>
            <button className="feature-main" onClick={() => setActiveView("library")}>
              <Database size={17} />
              <span>本地文献库</span>
              <small>{library.papers?.length || 0}</small>
            </button>
            <button className="feature-toggle" title={libraryExpanded ? "收起文献列表" : "展开文献列表"} onClick={() => setLibraryExpanded((value) => !value)}>
              {libraryExpanded ? <CaretDown size={16} /> : <CaretRight size={16} />}
            </button>
          </div>
        </section>

        {libraryExpanded ? (
          <section className="library-list compact-library">
            <div className="paper-list compact-paper-list">
              {library.papers?.length ? (
                library.papers.map((paper) => (
                  <div
                    key={paper.id}
                    className={`paper-row ${paper.id === selectedPaper?.id && activeView === "paper" ? "selected" : ""}`}
                    onClick={() => openPaper(paper)}
                  >
                    <span className={`score ${scoreTone(paper.rawScore || 0)}`}>{Math.round(paper.rawScore || 0)}</span>
                    <span>
                      <strong>{paper.title}</strong>
                      <small>{paper.year || "未知年份"} · {paper.journal || paper.source}</small>
                    </span>
                    <button
                      className="delete-paper"
                      type="button"
                      title="删除文献"
                      disabled={loading === `delete-${paper.id}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        deletePaper(paper);
                      }}
                    >
                      <Trash size={15} />
                    </button>
                  </div>
                ))
              ) : (
                <div className="empty-state">暂无本地文献。</div>
              )}
            </div>
          </section>
        ) : null}
      </aside>

      <section className="reader-panel">
        {error ? <div className="error-strip">{error}</div> : null}

        {activeView === "scan" ? (
          <section className="workspace-panel scan-workspace task-workspace">
            <div className="task-list-header">
              <div className="workspace-title">
                <span>采集任务</span>
                <h1>采集任务列表</h1>
                <p>管理可复用的文献采集任务，一键执行或编辑配置。勾选 AI 分析的任务在采集入库后会自动逐篇分析。</p>
              </div>
              <button className="add-task-btn" type="button" onClick={() => setTaskModal({ mode: "create" })}>
                <Plus size={16} weight="bold" />
                新增任务
              </button>
            </div>
            <div className="task-list">
              {tasks.length ? (
                tasks.map((task) => (
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
                    </div>
                  </div>
                ))
              ) : (
                <div className="empty-state">暂无采集任务，点击右上角“新增任务”创建。</div>
              )}
            </div>
          </section>
        ) : null}

        {activeView === "library" ? (
          <section className="workspace-panel library-overview">
            <div className="workspace-title">
              <span>本地文献库</span>
              <h1>{library.papers?.length || 0} 篇本地文献</h1>
              <p>像文件夹一样浏览、搜索和排序文献；点击任意文献进入阅读详情。</p>
            </div>
            <div className="library-toolbar">
              <input value={libraryQuery} onChange={(event) => setLibraryQuery(event.target.value)} placeholder="搜索标题、期刊、年份、DOI、关键词" />
              <select value={librarySort} onChange={(event) => setLibrarySort(event.target.value)}>
                <option value="score-desc">评分最高</option>
                <option value="score-asc">评分最低</option>
                <option value="year-desc">年份最新</option>
                <option value="year-asc">年份最早</option>
                <option value="title-asc">名称 A-Z</option>
                <option value="title-desc">名称 Z-A</option>
              </select>
            </div>
            <div className="paper-folder-grid">
              {visiblePapers.map((paper) => (
                <button className="paper-folder-card" key={paper.id} onClick={() => openPaper(paper)}>
                  <span className={`score ${scoreTone(paper.rawScore || 0)}`}>{Math.round(paper.rawScore || 0)}</span>
                  <strong>{paper.title}</strong>
                  <small>{paper.year || "未知年份"} · {paper.journal || paper.source}</small>
                </button>
              ))}
              {!visiblePapers.length ? <div className="empty-state">没有匹配的本地文献。</div> : null}
            </div>
          </section>
        ) : null}

        {activeView === "paper" ? (
          <>
            <div className="paper-mode-bar">
              <button className={readingMode === "source" ? "active" : ""} onClick={() => setReadingMode("source")} disabled={!selectedPaper?.localMarkdownUrl && !selectedPaper?.localPdfUrl}>
                <FileText size={15} />
                文献原文
              </button>
              <button
                className={readingMode === "analysis" ? "active" : ""}
                onClick={() => {
                  setReadingMode("analysis");
                  if (selectedPaper && !selectedPaperReport && !selectedPaperIsAnalyzing) runAnalysis(selectedPaper);
                }}
                disabled={!selectedPaper}
              >
                <Brain size={15} />
                AI 分析报告
              </button>
              <span className={status.tone === "idle" ? "" : `mode-status ${status.tone}`}>
                {readingMode === "source" && selectedPaper?.localPdfUrl
                  ? "当前以 PDF 阅读器打开本地原文"
                  : readingMode === "source" && selectedPaper?.localFullTextUrl
                    ? "当前以 Markdown 展示公开全文"
                    : readingMode === "source" && selectedPaper
                      ? "当前仅显示元数据摘要，请先获取 DOI 原文/PDF"
                    : selectedPaperIsAnalyzing
                      ? "AI 分析进行中，完成后会自动显示"
                      : selectedPaperReport
                        ? `已生成单篇 AI 报告 · ${selectedPaperReport.model || "AI"}`
                        : selectedPaper
                          ? "点击生成报告"
                          : "选择文献后显示内容"}
              </span>
            </div>
            {readingMode === "source" && selectedPaper?.localPdfUrl ? (
              <iframe className="pdf-reader" title={selectedPaper.title} src={selectedPaper.localPdfUrl} />
            ) : readingMode === "analysis" && selectedPaperIsAnalyzing ? (
              <div className="analysis-loading">
                <div className="spinner" />
                <strong>AI 正在分析当前文献</strong>
                <span>后台最多同时处理 3 篇，超过后会自动排队。</span>
              </div>
            ) : readingMode === "analysis" && !selectedPaperReport ? (
                <div className="analysis-loading">
                <Brain size={28} />
                <strong>尚未生成 AI 分析报告</strong>
                <button className="wide-action" onClick={() => runAnalysis(selectedPaper)} disabled={!selectedPaper}>点击生成报告</button>
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
            runningTaskIds={runningTaskIds}
            tasks={tasks}
            expandedRunIds={expandedRunIds}
            setExpandedRunIds={setExpandedRunIds}
            runAnalyzeState={runAnalyzeState}
          />
        ) : null}

        {activeView === "library" ? (
          <div className="paper-inspector">
            <div className="paper-heading">
              <span>AI Chat</span>
              <h2>文献库对话区</h2>
              <p>后续会用于围绕本地文献集合提问、筛选、比较和生成阅读计划。</p>
            </div>
            <div className="chat-placeholder">
              <Brain size={28} />
              <strong>对话能力待接入</strong>
              <span>当前先完成文献总览、排序、搜索和详情跳转。</span>
            </div>
          </div>
        ) : null}

        {activeView === "paper" ? (
          selectedPaper ? (
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
              {retrievalStatus ? (
                <div className="retrieval-card">
                  <strong>
                    {retrievalStatus.method === "pdf"
                      ? "PDF 获取成功"
                      : retrievalStatus.method === "html-fulltext"
                        ? "已获取 HTML 全文"
                        : "获取记录"}
                  </strong>
                  <span>
                    {retrievalStatus.method === "pdf"
                      ? "已保存完整 PDF。"
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
        />
      ) : null}
    </main>
  );
}

function TaskModal({ mode, initial, loading, onClose, onSave }) {
  const [form, setForm] = useState({
    query: initial.query || "",
    count: initial.count ?? 5,
    yearFrom: initial.yearFrom ?? new Date().getFullYear() - 5,
    minScore: initial.minScore ?? 70,
    sources: initial.sources?.length ? [...initial.sources] : ["openalex", "crossref"],
    downloadOpenPdf: initial.downloadOpenPdf !== false,
    autoAnalyze: Boolean(initial.autoAnalyze),
  });

  function update(field, value) {
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
    onSave({
      ...form,
      count: Number(form.count) || 5,
      yearFrom: form.yearFrom ? Number(form.yearFrom) : null,
      minScore: Number(form.minScore) || 0,
    });
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
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn-ghost" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="primary" disabled={loading || !form.query.trim()}>
            {loading ? "保存中" : "保存"}
          </button>
        </div>
      </form>
    </div>
  );
}

function runStatusLabel(run, runningTaskIds, tasks) {
  if (run._failed) return { key: "failed", text: "执行失败" };
  const task = tasks.find((t) => t.id === run.taskId);
  if (task && runningTaskIds[task.id]) return { key: "running", text: "执行中" };
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

function RunLogList({ scanRuns, papers, runningTaskIds, tasks, expandedRunIds, setExpandedRunIds, runAnalyzeState }) {
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
        <p>按时间倒序显示所有任务执行记录，点击展开查看检索式、来源状态、去重与采集文献详情。</p>
      </div>
      <div className="run-list">
        {sortedRuns.length ? (
          sortedRuns.map((run) => {
            const status = runStatusLabel(run, runningTaskIds, tasks);
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
