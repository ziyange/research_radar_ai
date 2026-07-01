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
  const edgeLines = lines.filter((line) => line.includes("-->"));
  const nodes = [];
  const seen = new Set();
  for (const line of edgeLines) {
    const matches = [...line.matchAll(/([A-Za-z0-9_]+)\[([^\]]+)\]/g)];
    for (const match of matches) {
      if (!seen.has(match[1])) {
        seen.add(match[1]);
        nodes.push({ id: match[1], label: match[2] });
      }
    }
  }
  if (!nodes.length) return <pre className="md-code">{source}</pre>;
  return (
    <div className="mermaid-flow">
      {nodes.map((node, index) => (
        <div className="flow-step" key={node.id}>
          <span>{index + 1}</span>
          <p>{node.label}</p>
        </div>
      ))}
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
    blocks.push(
      code.lang === "mermaid"
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
