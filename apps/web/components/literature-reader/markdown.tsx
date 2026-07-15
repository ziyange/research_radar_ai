/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import { Fragment } from "react";

function InlineMarkdown({ text }) {
  const parts = String(text || "").split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g);
  return (
    <>
      {parts.map((part, index) => {
        if (!part) return null;
        if (part.startsWith("**") && part.endsWith("**")) {
          return <strong key={index}>{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith("`") && part.endsWith("`")) {
          return <code key={index}>{part.slice(1, -1)}</code>;
        }
        const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (link) {
          return (
            <a key={index} href={link[2]} target="_blank" rel="noreferrer">
              {link[1]}
            </a>
          );
        }
        return <Fragment key={index}>{part}</Fragment>;
      })}
    </>
  );
}

function FlowchartBlock({ source }) {
  const lines = String(source || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const nodeMap = new Map();
  const edges = [];

  function cleanLabel(value) {
    return String(value || "")
      .replace(/^["'`]+|["'`]+$/g, "")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function readNode(raw) {
    const idMatch = String(raw || "").trim().match(/^([A-Za-z0-9_]+)/);
    if (!idMatch) return null;
    const id = idMatch[1];
    const rest = String(raw || "").trim().slice(id.length).trim();
    const labelMatch =
      rest.match(/^\[\s*"?([\s\S]*?)"?\s*\]/) ||
      rest.match(/^\(\s*"?([\s\S]*?)"?\s*\)/) ||
      rest.match(/^\{\s*"?([\s\S]*?)"?\s*\}/);
    const label = cleanLabel(labelMatch?.[1] || id);
    if (!nodeMap.has(id)) nodeMap.set(id, { id, label });
    if (label && nodeMap.get(id).label === id) nodeMap.get(id).label = label;
    return nodeMap.get(id);
  }

  for (const line of lines) {
    if (/^(flowchart|graph|style|classDef|class)\b/i.test(line)) continue;
    const edgeMatch = line.match(/^(.+?)\s*(?:-->|---|-.->|==>)\s*(.+?)(?:\s*$|;)/);
    if (edgeMatch) {
      const from = readNode(edgeMatch[1].trim());
      const to = readNode(edgeMatch[2].trim());
      if (from && to) edges.push({ from: from.id, to: to.id });
      continue;
    }
    readNode(line);
  }
  const nodes = [...nodeMap.values()];
  if (!nodes.length) return <pre className="md-code">{source}</pre>;

  const levels = new Map();
  nodes.forEach((node) => levels.set(node.id, 0));
  edges.forEach((edge) => {
    const fromLevel = levels.get(edge.from) || 0;
    levels.set(edge.to, Math.max(levels.get(edge.to) || 0, fromLevel + 1));
  });
  const grouped = new Map();
  nodes.forEach((node) => {
    const level = levels.get(node.id) || 0;
    grouped.set(level, [...(grouped.get(level) || []), node]);
  });
  const width = 920;
  const nodeWidth = 250;
  const nodeHeight = 72;
  const levelGap = 124;
  const maxLevel = Math.max(...[...grouped.keys(), 0]);
  const height = Math.max(260, 96 + maxLevel * levelGap);
  const positions = new Map();
  [...grouped.entries()].forEach(([level, group]) => {
    const gap = Math.min(300, Math.max(170, (width - nodeWidth) / Math.max(group.length, 1)));
    const startX = width / 2 - ((group.length - 1) * gap) / 2 - nodeWidth / 2;
    group.forEach((node, index) => {
      positions.set(node.id, {
        x: Math.max(28, Math.min(width - nodeWidth - 28, startX + index * gap)),
        y: 36 + level * levelGap,
      });
    });
  });

  return (
    <div className="logic-graph-shell">
      <svg className="logic-graph-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="核心逻辑流程图">
        <defs>
          <marker id="logic-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" />
          </marker>
          <linearGradient id="logic-node-bg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="100%" stopColor="#edf7ff" />
          </linearGradient>
        </defs>
        {edges.map((edge, index) => {
          const from = positions.get(edge.from);
          const to = positions.get(edge.to);
          if (!from || !to) return null;
          const x1 = from.x + nodeWidth / 2;
          const y1 = from.y + nodeHeight;
          const x2 = to.x + nodeWidth / 2;
          const y2 = to.y;
          const controlY = y1 + Math.max(34, (y2 - y1) / 2);
          return (
            <path
              className="logic-graph-edge"
              key={`${edge.from}-${edge.to}-${index}`}
              d={`M ${x1} ${y1} C ${x1} ${controlY}, ${x2} ${controlY - 18}, ${x2} ${y2 - 6}`}
              markerEnd="url(#logic-arrow)"
            />
          );
        })}
        {nodes.map((node) => {
          const position = positions.get(node.id);
          if (!position) return null;
          return (
            <foreignObject key={node.id} x={position.x} y={position.y} width={nodeWidth} height={nodeHeight}>
              <div className="logic-graph-node">
                <strong>{node.label}</strong>
              </div>
            </foreignObject>
          );
        })}
      </svg>
    </div>
  );
}

export function renderMarkdown(markdown) {
  const lines = String(markdown || "").split("\n");
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
          <li key={index}><InlineMarkdown text={item} /></li>
        ))}
      </Tag>,
    );
    list = null;
  }

  function flushTable() {
    if (!table) return;
    const [header, separator, ...rows] = table;
    const headers = header.split("|").map((cell) => cell.trim()).filter(Boolean);
    const bodyRows = rows.filter((row) => row !== separator).map((row) => row.split("|").map((cell) => cell.trim()).filter(Boolean));
    blocks.push(
      <table className="md-table" key={`table-${blocks.length}`}>
        <thead>
          <tr>{headers.map((item, index) => <th key={index}>{item}</th>)}</tr>
        </thead>
        <tbody>
          {bodyRows.map((row, rowIndex) => (
            <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}><InlineMarkdown text={cell} /></td>)}</tr>
          ))}
        </tbody>
      </table>,
    );
    table = null;
  }

  function flushCode() {
    if (!code) return;
    const content = code.lines.join("\n");
    const language = String(code.lang || "").toLowerCase();
    blocks.push(
      language.startsWith("mermaid")
        ? <FlowchartBlock source={content} key={`code-${blocks.length}`} />
        : <pre className="md-code" key={`code-${blocks.length}`}>{content}</pre>,
    );
    code = null;
  }

  lines.forEach((line, index) => {
    if (line.startsWith("```")) {
      if (code) {
        flushCode();
      } else {
        flushList();
        flushTable();
        code = { lang: line.replace(/```/g, "").trim(), lines: [] };
      }
      return;
    }
    if (code) {
      code.lines.push(line);
      return;
    }
    if (line.includes("|") && /^\s*\|?[-:\s|]+\|?\s*$/.test(lines[index + 1] || "")) {
      flushList();
      if (!table) table = [];
      table.push(line, lines[index + 1]);
      return;
    }
    if (table && line.includes("|")) {
      table.push(line);
      return;
    }
    if (table && !line.includes("|")) flushTable();

    if (line.startsWith("# ")) {
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
    } else if (line.startsWith("- ")) {
      flushTable();
      if (!list || list.type !== "ul") {
        flushList();
        list = { type: "ul", items: [] };
      }
      list.items.push(line.slice(2));
    } else if (/^\d+\.\s/.test(line)) {
      flushTable();
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
