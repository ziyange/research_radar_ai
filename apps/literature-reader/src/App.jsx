import { useEffect, useMemo, useRef, useState } from "react";
import {
  Controls,
  Handle,
  Position,
  ReactFlow,
} from "@xyflow/react";
import {
  Books,
  Brain,
  CaretDown,
  CaretLeft,
  CaretRight,
  CaretUp,
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
import "@xyflow/react/dist/style.css";
import "./styles.css";

const defaultScan = {
  query: "",
  count: 5,
  yearFrom: 2021,
  minScore: 70,
  sources: ["openalex", "crossref"],
  downloadOpenPdf: true,
  autoAnalyze: false,
  dailyEnabled: false,
  dailyTime: "09:00",
  dailyTimezone: "Asia/Shanghai",
  notifyAfterRun: false,
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
  async getMailStatus() {
    const response = await fetch("/api/mail/status");
    if (!response.ok) throw new Error("无法读取邮箱绑定状态");
    return response.json();
  },
  async startMailAuth() {
    const response = await fetch("/api/mail/auth/start", { method: "POST" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || data.error || "启动邮箱授权失败");
    return data;
  },
  async getMailOutbox() {
    const response = await fetch("/api/mail/outbox");
    if (!response.ok) throw new Error("无法读取邮箱推送记录");
    return response.json();
  },
  async confirmMailDelivery(id) {
    const response = await fetch(`/api/mail/deliveries/${encodeURIComponent(id)}/confirm`, { method: "POST" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || data.error || "确认发送失败");
    return data;
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
  async uploadPdf(id, file) {
    const response = await fetch(`/api/papers/${encodeURIComponent(id)}/upload-pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/pdf" },
      body: file,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || data.error || "上传 PDF 失败");
    return data;
  },
};

function scoreTone(score) {
  if (score >= 80) return "high";
  if (score >= 60) return "medium";
  return "low";
}

function paperThemeTone(paper) {
  const source = `${paper.matchedQuery || ""} ${paper.journal || ""} ${(paper.keywords || []).slice(0, 4).join(" ")} ${paper.title || ""}`;
  let hash = 0;
  for (const char of source) hash = (hash * 31 + char.charCodeAt(0)) % 9973;
  return hash % 6;
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

function paperSearchText(paper) {
  return `${paper.title || ""} ${paper.journal || ""} ${paper.year || ""} ${paper.doi || ""} ${(paper.keywords || []).join(" ")} ${(paper.authors || []).join(" ")}`.toLowerCase();
}

function sortPapers(papers, sort) {
  return [...papers].sort((a, b) => {
    if (sort === "score-asc") return (a.rawScore || 0) - (b.rawScore || 0);
    if (sort === "year-desc") return (b.year || 0) - (a.year || 0);
    if (sort === "year-asc") return (a.year || 0) - (b.year || 0);
    if (sort === "title-asc") return String(a.title || "").localeCompare(String(b.title || ""));
    if (sort === "title-desc") return String(b.title || "").localeCompare(String(a.title || ""));
    return (b.rawScore || 0) - (a.rawScore || 0);
  });
}

function buildLibraryGroups(papers, tasks, scanRuns) {
  const paperById = new Map((papers || []).map((paper) => [paper.id, paper]));
  const groupedIds = new Set();
  const groups = [];

  for (const task of tasks || []) {
    const ids = [];
    for (const run of scanRuns || []) {
      if (run.taskId !== task.id) continue;
      for (const paperId of run.savedPaperIds || []) {
        if (paperById.has(paperId) && !ids.includes(paperId)) ids.push(paperId);
      }
    }
    ids.forEach((id) => groupedIds.add(id));
    groups.push({
      id: task.id,
      type: "task",
      label: task.query || "未命名采集任务",
      meta: `${ids.length} 篇 · ${task.yearFrom ? `${task.yearFrom} 起` : "不限年份"} · 评分≥${task.minScore ?? 0}`,
      papers: ids.map((id) => paperById.get(id)).filter(Boolean),
    });
  }

  const unclassified = (papers || []).filter((paper) => !groupedIds.has(paper.id));
  if (unclassified.length || !groups.length) {
    groups.push({
      id: "unclassified",
      type: "unclassified",
      label: "未归类文档",
      meta: `${unclassified.length} 篇 · 无采集任务来源`,
      papers: unclassified,
    });
  }

  return groups.filter((group) => group.papers.length || group.id === "unclassified");
}

function filterLibraryGroups(groups, activeGroupId, query, sort) {
  const normalized = query.trim().toLowerCase();
  return groups
    .filter((group) => activeGroupId === "all" || group.id === activeGroupId)
    .map((group) => ({
      ...group,
      papers: sortPapers(
        group.papers.filter((paper) => !normalized || paperSearchText(paper).includes(normalized)),
        sort,
      ),
    }))
    .filter((group) => group.papers.length || !normalized);
}

function makeLibraryGraph(groups, allGroups, query, focusedPaperId, reportPaperIds = new Set(), pulsePaperId = "") {
  const nodes = [];
  const edges = [];
  const hasQuery = Boolean(query.trim());
  const normalized = query.trim().toLowerCase();
  const clusterGapY = 1050;
  const groupSize = 88;
  const ringRadius = 230;
  const paperBox = {
    side: { width: 158, height: 70 },
    vertical: { width: 132, height: 96 },
  };

  function sideFromAngle(angle) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    if (Math.abs(cos) > Math.abs(sin)) return cos > 0 ? "right" : "left";
    return sin > 0 ? "bottom" : "top";
  }

  function boxForSide(side) {
    return side === "top" || side === "bottom" ? paperBox.vertical : paperBox.side;
  }

  function oppositeSide(side) {
    if (side === "left") return "right";
    if (side === "right") return "left";
    if (side === "top") return "bottom";
    return "top";
  }

  groups.forEach((group, groupIndex) => {
    const isSingleCluster = groups.length === 1;
    const clusterX = 460;
    const clusterY = isSingleCluster ? 330 : 330 + groupIndex * clusterGapY;
    nodes.push({
      id: `group-${group.id}`,
      type: "taskNode",
      position: { x: clusterX - groupSize / 2, y: clusterY - groupSize / 2 },
      draggable: false,
      data: {
        label: group.label,
        meta: group.meta,
        count: group.papers.length,
        center: { x: clusterX, y: clusterY },
        dimmed: hasQuery && !group.papers.length,
      },
    });

    group.papers.forEach((paper, paperIndex) => {
      const total = Math.max(group.papers.length, 1);
      const ring = paperIndex < 10 ? 0 : Math.floor((paperIndex - 10) / 16) + 1;
      const indexInRing = ring === 0 ? paperIndex : (paperIndex - 10) % 16;
      const countInRing = ring === 0 ? Math.min(total, 10) : Math.min(Math.max(total - 10 - (ring - 1) * 16, 1), 16);
      const angle = -Math.PI / 2 + (indexInRing / countInRing) * Math.PI * 2 + ring * 0.18;
      const radius = ringRadius + ring * 150;
      const side = sideFromAngle(angle);
      const box = boxForSide(side);
      const score = Math.max(20, Math.min(32, 18 + (paper.rawScore || 0) / 8.5));
      const matched = !hasQuery || paperSearchText(paper).includes(normalized);
      const selected = focusedPaperId === paper.id;
      const dimmed = !matched || (focusedPaperId && !selected);
      const nodeId = `paper-${paper.id}`;
      const nodePosition = {
        x: clusterX + Math.cos(angle) * radius - box.width / 2,
        y: clusterY + Math.sin(angle) * radius - box.height / 2,
      };
      nodes.push({
        id: nodeId,
        type: "paperNode",
        position: nodePosition,
        data: {
          paper,
          groupLabel: group.label,
          center: { x: nodePosition.x + box.width / 2, y: nodePosition.y + box.height / 2 },
          dimmed,
          selected,
          pulsing: pulsePaperId === paper.id || String(pulsePaperId).startsWith(`${paper.id}:`),
          scoreSize: score,
          side,
          themeTone: paperThemeTone(paper),
          sourceType: String(paper.source || "").toLowerCase().includes("crossref") ? "crossref" : "openalex",
          hasPdf: Boolean(paper.localPdfUrl),
          hasReport: reportPaperIds.has(paper.id),
        },
      });
    });
  });

  if (!nodes.length && allGroups.length) {
    return makeLibraryGraph(allGroups, [], "", focusedPaperId, reportPaperIds, pulsePaperId);
  }

  return { nodes, edges };
}

function TaskGraphNode({ data }) {
  return (
    <div className={`graph-task-node ${data.dimmed ? "dimmed" : ""}`}>
      <Handle id="source-top" type="source" position={Position.Top} className="graph-handle" />
      <Handle id="source-right" type="source" position={Position.Right} className="graph-handle" />
      <Handle id="source-bottom" type="source" position={Position.Bottom} className="graph-handle" />
      <Handle id="source-left" type="source" position={Position.Left} className="graph-handle" />
      <strong>{data.label}</strong>
      <div className="group-hover-card">
        <b>{data.label}</b>
        <span>{data.meta}</span>
        <span>当前节点连接 {data.count} 篇文献</span>
      </div>
    </div>
  );
}

function PaperGraphNode({ data }) {
  const paper = data.paper;
  const score = Math.round(paper.rawScore || 0);
  const size = data.scoreSize || 54;
  return (
    <div
      className={`graph-paper-node side-${data.side || "right"} ${scoreTone(score)} source-${data.sourceType || "openalex"} ${data.hasPdf ? "has-pdf" : ""} ${data.hasReport ? "has-report" : ""} ${data.selected ? "selected" : ""} ${data.pulsing ? "pulsing" : ""} ${data.dimmed ? "dimmed" : ""}`}
      style={{ "--node-size": `${size}px` }}
      data-theme={data.themeTone ?? 0}
    >
      <Handle id="source-top" type="source" position={Position.Top} className="graph-handle" />
      <Handle id="source-right" type="source" position={Position.Right} className="graph-handle" />
      <Handle id="source-bottom" type="source" position={Position.Bottom} className="graph-handle" />
      <Handle id="source-left" type="source" position={Position.Left} className="graph-handle" />
      <Handle id="target-top" type="target" position={Position.Top} className="graph-handle" />
      <Handle id="target-right" type="target" position={Position.Right} className="graph-handle" />
      <Handle id="target-bottom" type="target" position={Position.Bottom} className="graph-handle" />
      <Handle id="target-left" type="target" position={Position.Left} className="graph-handle" />
      <span className="paper-dot" />
      <strong>{paper.title}</strong>
      <div className="paper-hover-card">
        <b>{paper.title}</b>
        <span>{paper.year || "未知年份"} · {paper.journal || paper.source || "未知期刊"}</span>
        <span>评分 {score} · {paper.openAccess ? "开放获取" : "开放状态未知"} · {paper.source || "未知来源"}</span>
        <span>资产: {paper.localPdfUrl ? "本地 PDF" : paper.localFullTextUrl ? "公开全文 Markdown" : "元数据/摘要"} · {data.hasReport ? "已有 AI 报告" : "未生成 AI 报告"}</span>
        <span>DOI: {paper.doi || "未提供"}</span>
        <span>来源任务: {data.groupLabel}</span>
        <em>{short(paper.abstract, 220)}</em>
      </div>
    </div>
  );
}

const libraryNodeTypes = {
  taskNode: TaskGraphNode,
  paperNode: PaperGraphNode,
};

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
  const [status, setStatus] = useState({ tone: "idle", message: "准备就绪" });
  const [loading, setLoading] = useState(null);
  const [runningTaskIds, setRunningTaskIds] = useState({});
  const [analyzingPaperIds, setAnalyzingPaperIds] = useState({});
  const [fetchingFullTextIds, setFetchingFullTextIds] = useState({});
  const [retrievalStatus, setRetrievalStatus] = useState(null);
  const [error, setError] = useState("");
  const [taskModal, setTaskModal] = useState(null);
  const [mailBindModal, setMailBindModal] = useState(false);
  const [expandedRunIds, setExpandedRunIds] = useState({});
  const [runAnalyzeState, setRunAnalyzeState] = useState({});
  const [activeRunLog, setActiveRunLog] = useState(null);
  const reactFlowInstanceRef = useRef(null);
  const paperRowRefs = useRef({});
  const pulseTimerRef = useRef(null);

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
  }, []);

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

  async function bindAgentMail() {
    setError("");
    setLoading("mail-auth");
    try {
      const data = await api.startMailAuth();
      if (data.authUrl) {
        window.open(data.authUrl, "_blank", "noopener,noreferrer");
        setStatus({ tone: "running", message: "已打开 Agent Mail 授权页面，授权完成后会自动刷新状态" });
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
      setStatus({ tone: "success", message: "邮件发送已确认" });
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
    setError("");
    setActiveView("scan");
    setActiveRunLog(buildRunningLog(task));
    setRunningTaskIds((current) => ({ ...current, [task.id]: true }));
    setStatus({ tone: "running", message: `正在执行：${short(task.query, 42)}` });
    try {
      const data = await api.runTask(task.id);
      setLibrary(data.library);
      setSelectedPaperId((current) => current || data.library?.papers?.[0]?.id || null);
      setActiveRunLog({
        ...buildRunningLog(task),
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
          ...(task.notifyAfterRun
            ? [{ key: "mail", status: "done", text: `邮箱推送已生成 ${data.mailDeliveries?.length || 0} 条记录。` }]
            : []),
        ],
      });
      setExpandedRunIds((current) => ({ ...current, [data.run.id]: true }));
      setStatus({
        tone: data.run.savedCount > 0 ? "success" : "warning",
        message:
          data.run.savedCount > 0
            ? `已保存 ${data.run.savedCount} 篇${task.notifyAfterRun ? `，生成 ${data.mailDeliveries?.length || 0} 条邮箱推送` : ""}`
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
  const sourceMarkdown = selectedPaper
    ? `${!selectedPaper.localPdfUrl && !selectedPaper.localFullTextUrl ? `# 未获取到完整论文原文\n\n当前只保存了开放数据源返回的元数据和摘要，不等同于完整论文正文。可以先打开 DOI/来源页面下载 PDF，再在右侧上传本地 PDF。系统也可以尝试自动访问 DOI/来源页，优先下载合法公开 PDF，其次抽取公开 HTML 正文。\n\n- DOI/来源链接: ${doiUrl(selectedPaper.doi) || selectedPaper.landingPageUrl || selectedPaper.sourceUrl ? `[打开来源页面](${doiUrl(selectedPaper.doi) || selectedPaper.landingPageUrl || selectedPaper.sourceUrl})` : "未提供"}\n\n---\n\n` : ""}${(paperMarkdown || selectedReportMarkdown).replace(
      /- 本地 PDF:.*/g,
      `- 本地 PDF: ${selectedPaper.localPdfPath || "未下载"}`,
    )}`
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
        {error ? <div className="error-strip">{error}</div> : null}

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
                      <span className={`task-tag ${task.dailyEnabled ? "on" : ""}`}>
                        {task.dailyEnabled ? `每日 ${task.dailyTime}` : "不自动执行"}
                      </span>
                      <span className={`task-tag ${task.notifyAfterRun ? "on" : ""}`}>
                        {task.notifyAfterRun ? "推送邮箱" : "不推送"}
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
                  if (selectedPaper && !selectedPaperReport && !selectedPaperIsAnalyzing) runAnalysis(selectedPaper);
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
            activeRunLog={activeRunLog}
            expandedRunIds={expandedRunIds}
            setExpandedRunIds={setExpandedRunIds}
            runAnalyzeState={runAnalyzeState}
            mailDeliveries={library.mailDeliveries || []}
            mailStatus={mailStatus}
            onBindMail={() => setMailBindModal(true)}
            onConfirmMailDelivery={confirmMailDelivery}
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
              {!selectedPaper.localPdfUrl ? <UploadPdfButton paper={selectedPaper} /> : null}
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
          mailStatus={mailStatus}
        />
      ) : null}
      {mailBindModal ? (
        <MailBindModal
          mailStatus={mailStatus}
          loading={loading === "mail-auth"}
          onClose={() => setMailBindModal(false)}
          onBind={bindAgentMail}
          onRefresh={() => refresh().catch(() => null)}
        />
      ) : null}
    </main>
  );
}

function LibraryGraphView({
  paperCount,
  visiblePaperCount,
  nodes,
  query,
  onGraphInit,
  onClearFocus,
  onFocusPaper,
  onOpenPaper,
  onGoScan,
}) {
  const defaultViewport = { x: -30, y: 6, zoom: 0.92 };
  const canvasRef = useRef(null);
  const flowRef = useRef(null);
  const [viewport, setViewport] = useState(defaultViewport);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = canvasRef.current;
    if (!element) return undefined;

    function updateSize() {
      const rect = element.getBoundingClientRect();
      setCanvasSize({ width: rect.width, height: rect.height });
    }

    updateSize();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const hiddenCategories = useMemo(() => {
    if (!canvasSize.width || !canvasSize.height || !nodes.length) return [];
    const margin = 42;
    const buckets = new Map();

    for (const node of nodes) {
      if (node.type !== "paperNode") continue;
      const center = node.data?.center;
      if (!center) continue;
      const x = center.x * viewport.zoom + viewport.x;
      const y = center.y * viewport.zoom + viewport.y;
      const horizontal = x < margin ? "left" : x > canvasSize.width - margin ? "right" : "";
      const vertical = y < margin ? "up" : y > canvasSize.height - margin ? "down" : "";
      if (!horizontal && !vertical) continue;
      const key = vertical && horizontal ? `${vertical}-${horizontal}` : vertical || horizontal;
      const distance = Math.hypot(
        x < margin ? margin - x : x > canvasSize.width - margin ? x - (canvasSize.width - margin) : 0,
        y < margin ? margin - y : y > canvasSize.height - margin ? y - (canvasSize.height - margin) : 0,
      );
      const label = node.data?.groupLabel || "未归类文献";
      const bucket = buckets.get(label) || { key: label, label, direction: key, count: 0, target: node, distance };
      bucket.count += 1;
      if (distance < bucket.distance) {
        bucket.target = node;
        bucket.distance = distance;
        bucket.direction = key;
      }
      buckets.set(label, bucket);
    }

    const order = ["up-left", "up", "up-right", "left", "right", "down-left", "down", "down-right"];
    return [...buckets.values()].sort((a, b) => {
      const byDirection = order.indexOf(a.direction) - order.indexOf(b.direction);
      if (byDirection !== 0) return byDirection;
      return a.label.localeCompare(b.label);
    });
  }, [canvasSize.height, canvasSize.width, nodes, viewport]);

  function directionIcon(direction) {
    if (direction.includes("up")) return <CaretUp size={13} />;
    if (direction.includes("down")) return <CaretDown size={13} />;
    if (direction.includes("left")) return <CaretLeft size={13} />;
    return <CaretRight size={13} />;
  }

  function directionLabel(direction) {
    const labels = {
      up: "上",
      down: "下",
      left: "左",
      right: "右",
      "up-left": "左上",
      "up-right": "右上",
      "down-left": "左下",
      "down-right": "右下",
    };
    return labels[direction] || direction;
  }

  function handleNodeClick(_, node) {
    if (node.type !== "paperNode") return;
    onFocusPaper(node.data.paper);
  }

  function handleNodeDoubleClick(_, node) {
    if (node.type !== "paperNode") return;
    onOpenPaper(node.data.paper);
  }

  function handleCanvasPointerDown(event) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (
      target.closest(
        ".react-flow__node, .react-flow__controls, .react-flow__edge, .graph-direction-nav, .paper-hover-card, .group-hover-card",
      )
    ) {
      return;
    }
    onClearFocus();
  }

  function handleGraphInit(instance) {
    flowRef.current = instance;
    onGraphInit(instance);
  }

  function jumpToDirection(item) {
    const center = item.target?.data?.center;
    if (!center || !flowRef.current?.setCenter) return;
    flowRef.current.setCenter(center.x, center.y, { zoom: Math.max(viewport.zoom, 0.96), duration: 520 });
    if (item.target.type === "paperNode") onFocusPaper(item.target.data.paper);
  }

  return (
    <section className="library-graph-workspace">
      <div className="library-graph-header">
        <div>
          <span>本地文献库</span>
          <h1>知识图谱</h1>
          <p>
            按采集任务/搜索条件组织文献关系。单击同步图谱与列表，再次单击或双击进入详情。
          </p>
        </div>
        <div className="graph-summary">
          <strong>{paperCount}</strong>
          <span>本地文献</span>
          {query.trim() ? <em>匹配 {visiblePaperCount}</em> : null}
        </div>
      </div>

      <div className="graph-canvas" ref={canvasRef} onPointerDownCapture={handleCanvasPointerDown}>
        {paperCount ? (
          <>
          {hiddenCategories.length ? (
            <div className="graph-direction-nav" aria-label="视角外文献导航">
              <span>视角导航</span>
              {hiddenCategories.map((item) => (
                <button
                  type="button"
                  key={item.key}
                  title={`${directionLabel(item.direction)}：${item.label}（${item.count}）`}
                  onClick={() => jumpToDirection(item)}
                >
                  {directionIcon(item.direction)}
                  <b>{item.label}</b>
                  <em>{item.count}</em>
                </button>
              ))}
            </div>
          ) : null}
          <ReactFlow
            nodes={nodes}
            edges={[]}
            nodeTypes={libraryNodeTypes}
            onInit={handleGraphInit}
            onMove={(_, nextViewport) => setViewport(nextViewport)}
            onNodeClick={handleNodeClick}
            onNodeDoubleClick={handleNodeDoubleClick}
            onPaneClick={onClearFocus}
            defaultViewport={defaultViewport}
            minZoom={0.42}
            maxZoom={1.45}
            nodesConnectable={false}
            elementsSelectable={false}
            nodesFocusable={false}
            edgesFocusable={false}
          >
            <Controls showInteractive={false} />
          </ReactFlow>
          </>
        ) : (
          <div className="graph-empty-state">
            <Database size={34} />
            <strong>本地文献库为空</strong>
            <span>先执行采集任务，文献入库后会在这里形成“搜索条件到文献”的知识图谱。</span>
            <button type="button" onClick={onGoScan}>去采集任务</button>
          </div>
        )}
      </div>
    </section>
  );
}

function LibraryPaperListPanel({
  groups,
  visibleGroups,
  activeGroupId,
  query,
  sort,
  selectedPaperId,
  highlightPulseId,
  paperRowRefs,
  onGroupChange,
  onQueryChange,
  onSortChange,
  onFocusPaper,
  onOpenPaper,
  onDeletePaper,
  loading,
}) {
  const total = groups.reduce((sum, group) => sum + group.papers.length, 0);
  const visibleTotal = visibleGroups.reduce((sum, group) => sum + group.papers.length, 0);

  return (
    <div className="library-list-panel">
      <div className="paper-heading">
        <span>Library</span>
        <h2>文献列表</h2>
        <p>按采集任务/搜索条件分组浏览；搜索会同步高亮中间图谱节点。</p>
      </div>

      <div className="library-filter-section">
        <label>
          <span>二级类目</span>
          <select value={activeGroupId} onChange={(event) => onGroupChange(event.target.value)}>
            <option value="all">全部搜索条件（{total}）</option>
            {groups.map((group) => (
              <option value={group.id} key={group.id}>{group.label}（{group.papers.length}）</option>
            ))}
          </select>
        </label>
        <label>
          <span>排序</span>
          <select value={sort} onChange={(event) => onSortChange(event.target.value)}>
            <option value="score-desc">评分最高</option>
            <option value="score-asc">评分最低</option>
            <option value="year-desc">时间最新</option>
            <option value="year-asc">时间最早</option>
            <option value="title-asc">名称 A-Z</option>
            <option value="title-desc">名称 Z-A</option>
          </select>
        </label>
      </div>

      <div className="right-paper-list">
        {visibleGroups.length ? (
          visibleGroups.map((group) => (
            <section className="right-paper-group" key={group.id}>
              <div className="right-group-title">
                <strong>{group.label}</strong>
                <span>{group.papers.length} 篇</span>
              </div>
              {group.papers.length ? (
                group.papers.map((paper) => (
                  <button
                    className={`right-paper-row ${paper.id === selectedPaperId ? "selected" : ""} ${String(highlightPulseId).startsWith(`${paper.id}:`) ? "pulsing" : ""}`}
                    type="button"
                    key={paper.id}
                    ref={(element) => {
                      if (element) paperRowRefs.current[paper.id] = element;
                      else delete paperRowRefs.current[paper.id];
                    }}
                    onClick={() => onFocusPaper(paper)}
                    onDoubleClick={() => onOpenPaper(paper)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        onOpenPaper(paper);
                      }
                    }}
                  >
                    <span className={`score ${scoreTone(paper.rawScore || 0)}`}>{Math.round(paper.rawScore || 0)}</span>
                    <span className="right-paper-main">
                      <strong>{paper.title}</strong>
                      <small>{paper.year || "未知年份"} · {paper.journal || paper.source || "未知来源"}</small>
                    </span>
                    <span className="right-paper-assets">
                      {paper.localPdfUrl ? "PDF" : paper.localFullTextUrl ? "全文" : "摘要"}
                    </span>
                    <span
                      className="right-delete-paper"
                      role="button"
                      tabIndex={0}
                      title="删除文献"
                      aria-disabled={loading === `delete-${paper.id}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (loading !== `delete-${paper.id}`) onDeletePaper(paper);
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        event.stopPropagation();
                        if (loading !== `delete-${paper.id}`) onDeletePaper(paper);
                      }}
                    >
                      <Trash size={14} />
                    </span>
                  </button>
                ))
              ) : (
                <div className="empty-state compact">该类目下暂无匹配文献。</div>
              )}
            </section>
          ))
        ) : (
          <div className="empty-state">没有匹配的文献。</div>
        )}
      </div>

      <div className="library-search-footer">
        <div>
          <strong>{visibleTotal}</strong>
          <span>{query.trim() ? "匹配结果" : "当前列表"}</span>
        </div>
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="搜索标题、期刊、年份、DOI、关键词"
        />
      </div>
    </div>
  );
}

function TaskModal({ mode, initial, loading, onClose, onSave, mailStatus }) {
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
  });
  const mailBound = Boolean(mailStatus?.authorized && mailStatus.email);

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
      notifyAfterRun: mailBound ? Boolean(form.notifyAfterRun) : false,
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
              <button
                type="button"
                className={`switch-card ${form.notifyAfterRun ? "on" : ""}`}
                disabled={!mailBound}
                onClick={() => mailBound && update("notifyAfterRun", !form.notifyAfterRun)}
              >
                <span className="switch-card-text">
                  <strong>推送邮箱</strong>
                  <small>{mailBound ? "任务完成后逐条推送文献或 AI 分析" : "请先在采集任务页绑定 Agent 邮箱"}</small>
                </span>
                <span className={`switch-toggle ${form.notifyAfterRun ? "on" : ""}`} />
              </button>
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
          <button type="submit" className="primary" disabled={loading || !form.query.trim()}>
            {loading ? "保存中" : "保存"}
          </button>
        </div>
      </form>
    </div>
  );
}

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

function MailBindModal({ mailStatus, loading, onClose, onBind, onRefresh }) {
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
            <strong>{bound ? "已绑定邮箱" : "尚未绑定邮箱"}</strong>
            <span>{bound ? mailStatus.email : "绑定后，采集任务才能开启“推送邮箱”。"}</span>
          </div>
          <div className="modal-section">
            <div className="modal-section-label">授权流程</div>
            <p className="modal-hint">
              点击下方按钮后会打开 Agent Mail 授权页面。完成授权后回到这里刷新状态，系统会把任务执行完成后的文献或 AI 分析按条写入邮箱推送队列。
            </p>
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn-ghost" onClick={onRefresh}>
            刷新状态
          </button>
          <button type="button" className="primary" onClick={onBind} disabled={loading}>
            {loading ? "启动授权中" : bound ? "重新授权" : "打开授权页面"}
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

function mailStatusText(status) {
  if (status === "sent") return "已发送";
  if (status === "sending") return "发送中";
  if (status === "pending_confirmation") return "待确认";
  if (status === "failed") return "失败";
  if (status === "queued") return "已排队";
  return status || "未知";
}

function MailDeliveryList({ deliveries, onConfirmMailDelivery, loading }) {
  const latest = [...(deliveries || [])]
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
    .slice(0, 8);
  if (!latest.length) return null;
  return (
    <div className="mail-delivery-list">
      <div className="mail-delivery-title">
        <strong>邮箱推送记录</strong>
        <span>{latest.length} 条最近记录</span>
      </div>
      {latest.map((delivery) => (
        <div className={`mail-delivery-row ${delivery.status}`} key={delivery.id}>
          <div>
            <strong>{delivery.subject}</strong>
            <span>
              {delivery.kind === "analysis_report" ? "AI 分析" : delivery.kind === "paper_fulltext" ? "完整文献" : "测试"} · {mailStatusText(delivery.status)}
            </span>
            {delivery.error ? <small>{delivery.error}</small> : null}
          </div>
          {delivery.status === "pending_confirmation" ? (
            <button
              type="button"
              onClick={() => onConfirmMailDelivery(delivery)}
              disabled={loading === `mail-confirm-${delivery.id}`}
            >
              确认发送
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function RunLogList({
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
      <MailDeliveryList deliveries={mailDeliveries || []} onConfirmMailDelivery={onConfirmMailDelivery} loading={loading} />
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
