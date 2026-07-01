/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import { Trash } from "@phosphor-icons/react";
import { scoreTone } from "./utils";

export function LibraryPaperListPanel({
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


