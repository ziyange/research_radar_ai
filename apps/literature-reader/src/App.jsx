import { useEffect, useMemo, useState } from "react";
import {
  Books,
  Brain,
  CaretDown,
  CaretRight,
  Database,
  DownloadSimple,
  FileText,
  LinkSimple,
  MagnifyingGlass,
  Trash,
} from "@phosphor-icons/react";
import "./styles.css";

const defaultScan = {
  query: "",
  count: 5,
  yearFrom: 2021,
  minScore: 70,
  sources: ["openalex", "crossref"],
  downloadOpenPdf: true,
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
    if (!response.ok) throw new Error(data.message || data.error || "获取全文失败");
    return data;
  },
};

function scoreTone(score) {
  if (score >= 80) return "high";
  if (score >= 60) return "medium";
  return "low";
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
  });
  flushList();
  flushTable();
  flushCode();
  return blocks;
}

export function App() {
  const [library, setLibrary] = useState({ papers: [], scanRuns: [], reports: [] });
  const [health, setHealth] = useState(null);
  const [scan, setScan] = useState(defaultScan);
  const [selectedPaperId, setSelectedPaperId] = useState(null);
  const [activeView, setActiveView] = useState("library");
  const [libraryExpanded, setLibraryExpanded] = useState(true);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [librarySort, setLibrarySort] = useState("score-desc");
  const [readingMode, setReadingMode] = useState("analysis");
  const [paperMarkdown, setPaperMarkdown] = useState("");
  const [status, setStatus] = useState({ tone: "idle", message: "准备就绪" });
  const [scanLogs, setScanLogs] = useState([
    { tone: "idle", text: "等待采集任务。输入研究方向后，系统会检索数据源、评分、去重并保存。" },
  ]);
  const [loading, setLoading] = useState(null);
  const [analyzingPaperIds, setAnalyzingPaperIds] = useState({});
  const [fetchingFullTextIds, setFetchingFullTextIds] = useState({});
  const [error, setError] = useState("");

  async function refresh() {
    const [libraryData, healthData] = await Promise.all([api.getLibrary(), api.getHealth()]);
    setLibrary(libraryData);
    setHealth(healthData);
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

  async function runScan() {
    setError("");
    setLoading("scan");
    setScanLogs([
      { tone: "running", text: `理解研究方向：${scan.query || "未填写"}` },
      { tone: "running", text: `规划检索：来源 ${scan.sources.join(" / ")}，目标 ${scan.count} 篇，起始年份 ${scan.yearFrom || "不限"}，最低评分 ${scan.minScore}` },
      { tone: "running", text: "执行检索、评分、去重，并尝试下载开放 PDF 或抽取公开全文。" },
    ]);
    try {
      const data = await api.scan(scan);
      setLibrary(data.library);
      setSelectedPaperId((current) => current || data.papers?.[0]?.id || null);
      const noNewReason =
        data.run.savedCount === 0
          ? data.run.uniqueCount === 0
            ? "没有新增入库：达到阈值的候选文献都已存在于本地库。"
            : "没有新增入库：存在可新增候选，但保存阶段没有成功写入，请检查本地文件权限。"
          : "";
      setScanLogs((current) => [
        ...current,
        {
          tone: data.run.savedCount > 0 ? "success" : "warning",
          text: `完成：目标 ${data.run.count} 篇，保存 ${data.run.savedCount} 篇，可新增 ${data.run.uniqueCount ?? data.papers?.length ?? 0} 篇，去重 ${data.run.duplicateCount} 篇，候选 ${data.run.candidateCount} 篇。`,
        },
        ...(data.run.targetMet === false && data.run.exhaustedReason
          ? [{ tone: "warning", text: `未拿满目标：${data.run.exhaustedReason}。可降低最低评分、放宽年份或扩展研究方向。` }]
          : []),
        ...(noNewReason ? [{ tone: "warning", text: noNewReason }] : []),
        ...(data.run.queryPlan || []).map((item, index) => ({
          tone: item.source === "user" ? "running" : "success",
          text: `检索式 ${index + 1}: ${item.query}`,
        })),
        ...(data.run.duplicateTitles || []).slice(0, 5).map((title) => ({
          tone: "warning",
          text: `已去重：${title}`,
        })),
        ...(data.run.sourceStatuses || []).map((item) => ({
          tone: item.status === "succeeded" ? "success" : "error",
          text: `${item.source} / ${item.query || scan.query}: ${item.status === "succeeded" ? `拉取 ${item.count} 条` : item.error}`,
        })),
      ]);
      setStatus({
        tone: data.run.savedCount > 0 ? "success" : "warning",
        message: data.run.savedCount > 0 ? `已保存 ${data.run.savedCount} 篇` : "未发现新的可入库文献",
      });
    } catch (err) {
      setError(err.message);
      setScanLogs((current) => [...current, { tone: "error", text: `失败：${err.message}` }]);
      setStatus({ tone: "error", message: err.message });
    } finally {
      setLoading(null);
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
        query: scan.query || paper.title,
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
      setStatus({ tone: "success", message: data.reused ? "已存在公开全文文本" : "公开全文文本已保存到本地" });
      setReadingMode("source");
    } catch (err) {
      setError(err.message);
      setStatus({ tone: "error", message: err.message });
    } finally {
      setFetchingFullTextIds((current) => {
        const next = { ...current };
        delete next[paper.id];
        return next;
      });
    }
  }

  function toggleSource(source) {
    setScan((current) => {
      const sources = current.sources.includes(source)
        ? current.sources.filter((item) => item !== source)
        : [...current.sources, source];
      return { ...current, sources: sources.length ? sources : [source] };
    });
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
          <section className="workspace-panel scan-workspace">
            <div className="workspace-title">
              <span>采集任务</span>
              <h1>配置一次自动化文献采集</h1>
              <p>输入研究方向、数量、年份和评分要求，系统会检索开放数据源、评分、去重、保存，并尝试获取 PDF 或公开全文。</p>
            </div>
            <label>
              研究方向
              <textarea value={scan.query} onChange={(event) => setScan({ ...scan, query: event.target.value })} placeholder="例如：纳米材料 植物 胁迫 响应" />
            </label>
            <div className="form-grid wide-form-grid">
              <label>
                篇数
                <input type="number" min="1" max="20" value={scan.count} onChange={(event) => setScan({ ...scan, count: event.target.value })} />
              </label>
              <label>
                起始年份
                <input type="number" value={scan.yearFrom} onChange={(event) => setScan({ ...scan, yearFrom: event.target.value })} />
              </label>
              <label>
                最低评分
                <input type="number" min="0" max="100" value={scan.minScore} onChange={(event) => setScan({ ...scan, minScore: event.target.value })} />
              </label>
              <label className="switch-row">
                下载开放 PDF
                <input type="checkbox" checked={scan.downloadOpenPdf} onChange={(event) => setScan({ ...scan, downloadOpenPdf: event.target.checked })} />
              </label>
            </div>
            <div className="source-toggles">
              <button className={scan.sources.includes("openalex") ? "active" : ""} onClick={() => toggleSource("openalex")}>OpenAlex</button>
              <button className={scan.sources.includes("crossref") ? "active" : ""} onClick={() => toggleSource("crossref")}>Crossref</button>
            </div>
            <button className="primary workspace-action" onClick={runScan} disabled={loading === "scan"}>
              <DownloadSimple size={17} />
              {loading === "scan" ? "检索中" : "确认并开始采集"}
            </button>
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
          <div className="paper-inspector">
            <div className="paper-heading">
              <span>Agent Log</span>
              <h2>采集执行日志</h2>
              <p>这里展示系统如何理解任务、选择数据源、检索、去重和保存。</p>
            </div>
            <div className="scan-log-list">
              {scanLogs.map((item, index) => (
                <div className={`scan-log-item ${item.tone}`} key={`${item.text}-${index}`}>
                  <span>{index + 1}</span>
                  <p>{item.text}</p>
                </div>
              ))}
            </div>
          </div>
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
              <FileLine label="DOI" path={selectedPaper.doi ? `https://doi.org/${selectedPaper.doi}` : ""} url={selectedPaper.doi ? `https://doi.org/${selectedPaper.doi}` : ""} />
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
