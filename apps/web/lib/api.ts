const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8010/api/v1";

type ApiEnvelope<T> = {
  request_id: string;
  data: T;
};

type ApiErrorEnvelope = {
  request_id?: string;
  error?: {
    code?: string;
    message?: string;
    details?: Record<string, unknown>;
  };
};

export class ApiError extends Error {
  code: string;
  status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

export type User = {
  id: string;
  email: string;
  display_name: string;
  role: "user" | "admin";
  plan: "free" | "student" | "pro" | "team";
  quota_balance: number;
};

export type ResearchProject = {
  id: string;
  owner_id: string;
  name: string;
  discipline: string | null;
  description: string | null;
  status: "active" | "archived";
  current_profile_id: string | null;
};

export type ResearchProfile = {
  id: string;
  project_id: string;
  version: number;
  status: "draft" | "confirmed" | "superseded";
  source_type: string;
  discipline: string | null;
  subfield: string | null;
  research_object: string[];
  research_questions: string[];
  goals: string[];
  methods: string[];
  materials: string[];
  reagents: string[];
  metrics: string[];
  mechanisms: string[];
  applications: string[];
  keywords_zh: string[];
  keywords_en: string[];
  synonyms: string[];
  exclusions: string[];
  preferences: Record<string, unknown>;
  confidence: number;
};

export type SearchTask = {
  id: string;
  project_id: string;
  profile_id: string;
  task_type: "exact" | "expanded" | "method_transfer" | "citation_network" | "exploratory";
  query_text: string;
  language: "zh" | "en" | "mixed";
  filters: Record<string, unknown>;
  status: "pending" | "running" | "succeeded" | "failed" | "paused";
  last_run_at: string | null;
};

export type TaskStatus = {
  task_id: string;
  type: string;
  status: "pending" | "running" | "succeeded" | "failed" | "retrying" | "cancelled";
  retryable: boolean;
  retry_count: number;
  error_code: string | null;
  message: string | null;
};

export type Recommendation = {
  id: string;
  project_id: string;
  paper: {
    id: string;
    title: string;
    title_zh: string;
    year: number;
    journal: string;
    doi: string | null;
  };
  profile_id: string;
  channel: "exact" | "explore" | "method_transfer";
  score_total: number;
  score_topic: number;
  score_method: number;
  score_material: number;
  score_mechanism: number;
  score_novelty: number;
  score_quality: number;
  score_heat: number;
  rank: number;
  explanation: Record<string, string>;
  fulltext_status: "open_access" | "author_manuscript" | "repository" | "unknown";
  batch_date: string;
};

export type FeedbackType =
  | "very_relevant"
  | "method_useful"
  | "background_citation"
  | "irrelevant"
  | "exclude_material"
  | "exclude_application"
  | "want_more"
  | "add_to_experiment"
  | "add_to_writing";

export type UserFeedback = {
  id: string;
  user_id: string;
  project_id: string;
  paper_id: string;
  recommendation_id: string | null;
  feedback_type: string;
  note: string | null;
  created_at: string;
};

export type PaperAnalysis = {
  id: string;
  paper_id: string;
  project_id: string | null;
  analysis_type: "quick" | "standard";
  input_scope: "metadata" | "abstract" | "fulltext";
  result: Record<string, unknown>;
  claims: Array<{
    claim: string;
    fact_level:
      | "source_explicit"
      | "ai_summary"
      | "cross_paper_comparison"
      | "ai_inference"
      | "research_inspiration";
    evidence: {
      paper_id: string;
      section: string | null;
      quote: string | null;
      traceable: boolean;
    };
  }>;
  evidence_labels_valid: boolean;
  traceability_score: number;
  model: string;
  cost_record_id: string | null;
};

export type KnowledgeItem = {
  id: string;
  user_id: string;
  project_id: string;
  paper_id: string;
  status: "saved" | "read" | "read_later" | "irrelevant";
  tags: string[];
  note: string | null;
};

export type RadarReport = {
  id: string;
  user_id: string;
  project_id: string;
  report_type: "daily" | "weekly";
  period_start: string;
  period_end: string;
  content: {
    new_papers?: number;
    deduped_papers?: number;
    high_relevance?: string[];
    suggested_deep_reads?: string[];
    method_inspirations?: string[];
    next_actions?: string[];
  };
  message_status: "draft" | "published" | "emailed" | "failed";
};

export type Message = {
  id: string;
  user_id: string;
  report_id: string | null;
  title: string;
  body: string;
  read: boolean;
  created_at: string;
};

export type CostRecord = {
  id: string;
  user_id: string;
  project_id: string | null;
  feature: string;
  provider: string | null;
  model: string | null;
  estimated_cost: number;
  quota_delta: number;
};

export type Diagnosis = {
  requirement_id: string;
  understanding: {
    research_object: string[];
    methods: string[];
    materials: string[];
  };
  keywords_zh: string[];
  keywords_en: string[];
  highly_related_papers: Recommendation[];
  method_transfer_papers: Recommendation[];
  research_gap_candidate: string;
  technical_route: string;
  knowledge_gap: string;
};

export type RecommendationList = {
  items: Recommendation[];
  next_cursor: string | null;
};

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("x-user-id", "usr_demo");
  if (!(options.body instanceof FormData)) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => ({}))) as
    | ApiEnvelope<T>
    | ApiErrorEnvelope;

  if (!response.ok) {
    const errorPayload = payload as ApiErrorEnvelope;
    throw new ApiError(
      errorPayload.error?.message ?? "请求失败，请稍后重试。",
      errorPayload.error?.code ?? "REQUEST_FAILED",
      response.status
    );
  }

  return (payload as ApiEnvelope<T>).data;
}

export const api = {
  me: () => request<User>("/me"),
  quota: () => request<{ quota_balance: number; plan: User["plan"] }>("/me/quota"),
  costs: () => request<CostRecord[]>("/me/costs"),
  projects: () => request<ResearchProject[]>("/projects"),
  createProject: (payload: {
    name: string;
    discipline?: string;
    description?: string;
  }) =>
    request<ResearchProject>("/projects", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateProject: (
    projectId: string,
    payload: Partial<Pick<ResearchProject, "name" | "discipline" | "description">>
  ) =>
    request<ResearchProject>(`/projects/${projectId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  generateProfile: (projectId: string, oneSentence: string) =>
    request<ResearchProfile>(`/projects/${projectId}/profile:generate`, {
      method: "POST",
      body: JSON.stringify({ one_sentence: oneSentence }),
    }),
  patchProfile: (
    projectId: string,
    payload: Partial<
      Pick<
        ResearchProfile,
        | "research_object"
        | "methods"
        | "materials"
        | "metrics"
        | "keywords_zh"
        | "keywords_en"
        | "exclusions"
      >
    >
  ) =>
    request<ResearchProfile>(`/projects/${projectId}/profile`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  confirmProfile: (projectId: string) =>
    request<ResearchProfile>(`/projects/${projectId}/profile:confirm`, {
      method: "POST",
    }),
  diagnosis: (projectId: string) => request<Diagnosis>(`/projects/${projectId}/diagnosis`),
  generateSearchTasks: (projectId: string) =>
    request<SearchTask[]>(`/projects/${projectId}/search-tasks:generate`, {
      method: "POST",
    }),
  runSearchTask: (taskId: string) =>
    request<TaskStatus>(`/search-tasks/${taskId}:run`, {
      method: "POST",
    }),
  recommendations: (projectId: string) =>
    request<RecommendationList>(`/projects/${projectId}/recommendations`),
  refreshRecommendations: (projectId: string) =>
    request<RecommendationList>(`/projects/${projectId}/recommendations:refresh`, {
      method: "POST",
    }),
  submitFeedback: (recommendationId: string, feedbackType: FeedbackType, note?: string) =>
    request<UserFeedback>(`/recommendations/${recommendationId}/feedback`, {
      method: "POST",
      body: JSON.stringify({ feedback_type: feedbackType, note }),
    }),
  projectFeedback: (projectId: string) =>
    request<UserFeedback[]>(`/projects/${projectId}/feedback`),
  createAnalysis: (
    paperId: string,
    projectId: string,
    analysisType: "quick" | "standard" = "quick"
  ) =>
    request<PaperAnalysis>(`/papers/${paperId}/analysis`, {
      method: "POST",
      body: JSON.stringify({
        project_id: projectId,
        analysis_type: analysisType,
        input_scope: analysisType === "standard" ? "abstract" : "abstract",
      }),
    }),
  addKnowledge: (
    projectId: string,
    payload: {
      paper_id: string;
      status: KnowledgeItem["status"];
      tags: string[];
      note?: string;
    }
  ) =>
    request<KnowledgeItem>(`/projects/${projectId}/knowledge`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  searchKnowledge: (projectId: string, query: string) =>
    request<KnowledgeItem[]>(
      `/projects/${projectId}/knowledge:search?q=${encodeURIComponent(query)}`
    ),
  generateReport: (projectId: string, reportType: "daily" | "weekly" = "daily") =>
    request<RadarReport>(
      `/projects/${projectId}/reports:generate?report_type=${reportType}`,
      { method: "POST" }
    ),
  reports: (projectId: string) => request<RadarReport[]>(`/projects/${projectId}/reports`),
  messages: () => request<Message[]>("/messages"),
  markMessageRead: (messageId: string) =>
    request<Message>(`/messages/${messageId}:read`, { method: "POST" }),
};
