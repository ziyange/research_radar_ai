import type { KnowledgeItem } from "../../lib/api";

export type ToastState = {
  tone: "success" | "error" | "warning";
  message: string;
} | null;

export type ActiveModal = "project" | "profileWizard" | "profileEdit" | "quota" | null;

export type DetailView =
  | { kind: "diagnosis" }
  | { kind: "gap" }
  | { kind: "tasks" }
  | { kind: "sources"; taskId?: string }
  | { kind: "paper"; recommendationId: string }
  | { kind: "analysis"; analysisId?: string }
  | { kind: "knowledge"; itemId: string }
  | { kind: "report"; reportId: string }
  | { kind: "message"; messageId: string }
  | null;

export type BusyKey =
  | "initial"
  | "project"
  | "profile"
  | "confirm"
  | "search"
  | "recommend"
  | "feedback"
  | "analysis"
  | "knowledge"
  | "report"
  | "message"
  | "detail";

export type ProjectForm = {
  name: string;
  discipline: string;
  description: string;
};

export type ProfileDraft = {
  research_object: string[];
  methods: string[];
  materials: string[];
  metrics: string[];
  keywords_zh: string[];
  keywords_en: string[];
  exclusions: string[];
};

export type KnowledgeDraft = {
  status: KnowledgeItem["status"];
  tags: string[];
  note: string;
};
