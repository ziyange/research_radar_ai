/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import { useEffect, useMemo, useRef, useState } from "react";
import { Controls, Handle, Position, ReactFlow } from "@xyflow/react";
import { CaretDown, CaretLeft, CaretRight, CaretUp, Database } from "@phosphor-icons/react";
import { paperSearchText, paperThemeTone, scoreTone, short } from "./utils";

export function makeLibraryGraph(groups, allGroups, query, focusedPaperId, reportPaperIds = new Set(), pulsePaperId = "") {
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


export function LibraryGraphView({
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


