import type { FeedbackType, KnowledgeItem, Recommendation, SearchTask } from "../../lib/api";

export const feedbackLabels: Record<FeedbackType, string> = {
  very_relevant: "高度相关",
  method_useful: "方法可借鉴",
  background_citation: "背景引用",
  irrelevant: "不相关",
  exclude_material: "排除材料",
  exclude_application: "排除应用",
  want_more: "想看更多",
  add_to_experiment: "加入实验",
  add_to_writing: "加入写作",
};

export const channelLabels: Record<Recommendation["channel"], string> = {
  exact: "精确通道",
  explore: "扩展探索",
  method_transfer: "方法迁移",
};

export const taskLabels: Record<SearchTask["task_type"], string> = {
  exact: "精确检索",
  expanded: "扩展检索",
  method_transfer: "方法迁移",
  citation_network: "引用网络",
  exploratory: "探索检索",
};

export const fulltextLabels: Record<Recommendation["fulltext_status"], string> = {
  open_access: "开放全文",
  author_manuscript: "作者稿",
  repository: "仓储可查",
  unknown: "全文未知",
};

export const knowledgeStatusLabels: Record<KnowledgeItem["status"], string> = {
  saved: "已收藏",
  read: "已读",
  read_later: "稍后读",
  irrelevant: "不相关",
};

export const factLevelLabels: Record<string, string> = {
  source_explicit: "原文事实",
  ai_summary: "AI 归纳",
  cross_paper_comparison: "多文献对比",
  ai_inference: "AI 推测",
  research_inspiration: "研究启发",
};

export const sourceLabels: Record<string, string> = {
  mock: "开发模拟数据源",
  live: "开放检索数据源",
  openalex: "OpenAlex",
  crossref: "Crossref",
  semantic_scholar: "Semantic Scholar",
  arxiv: "arXiv",
};

export const futureSourceNotes = [
  "Semantic Scholar：未接入，后续阶段用于语义相似与引用网络增强。",
  "arXiv：未接入，后续阶段用于预印本追踪。",
];
