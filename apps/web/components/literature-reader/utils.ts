/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
export function parseEmailList(value) {
  return String(value || "")
    .split(/[,，;\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function invalidEmails(values) {
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return values.filter((item) => !emailPattern.test(item));
}

export function scoreTone(score) {
  if (score >= 80) return "high";
  if (score >= 60) return "medium";
  return "low";
}

export function paperThemeTone(paper) {
  const source = `${paper.matchedQuery || ""} ${paper.journal || ""} ${(paper.keywords || []).slice(0, 4).join(" ")} ${paper.title || ""}`;
  let hash = 0;
  for (const char of source) hash = (hash * 31 + char.charCodeAt(0)) % 9973;
  return hash % 6;
}

export function doiUrl(value) {
  const doi = String(value || "")
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "");
  return doi ? `https://doi.org/${doi}` : "";
}

export function short(value, length = 120) {
  if (!value) return "暂无摘要";
  return value.length > length ? `${value.slice(0, length)}...` : value;
}

export function paperSearchText(paper) {
  return `${paper.title || ""} ${paper.journal || ""} ${paper.year || ""} ${paper.doi || ""} ${(paper.keywords || []).join(" ")} ${(paper.authors || []).join(" ")}`.toLowerCase();
}

export function sortPapers(papers, sort) {
  return [...papers].sort((a, b) => {
    if (sort === "score-asc") return (a.rawScore || 0) - (b.rawScore || 0);
    if (sort === "year-desc") return (b.year || 0) - (a.year || 0);
    if (sort === "year-asc") return (a.year || 0) - (b.year || 0);
    if (sort === "title-asc") return String(a.title || "").localeCompare(String(b.title || ""));
    if (sort === "title-desc") return String(b.title || "").localeCompare(String(a.title || ""));
    return (b.rawScore || 0) - (a.rawScore || 0);
  });
}

export function buildLibraryGroups(papers, tasks, scanRuns) {
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

export function filterLibraryGroups(groups, activeGroupId, query, sort) {
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
