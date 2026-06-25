"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ChevronDown,
  ChevronRight,
  CircleSlash2,
  CreditCard,
  FileSearch,
  Inbox,
  LayoutDashboard,
  Library,
  Loader2,
  Plus,
  Radar,
  Settings,
  WandSparkles,
} from "lucide-react";

import {
  api,
  type Diagnosis,
  type EmailPreference,
  type FeedbackType,
  type HealthStatus,
  type KnowledgeItem,
  type Message,
  type Paper,
  type PaperAnalysis,
  type PaperVersion,
  type RadarReport,
  type Recommendation,
  type ResearchProfile,
  type ResearchProject,
  type SearchTask,
  type SourceRecord,
  type TaskStatus,
  type User,
  type UserFeedback,
} from "../../lib/api";
import { WorkbenchDetailDrawer } from "./details-drawer";
import { useBusyState, useToast } from "./hooks";
import {
  KnowledgePanel,
  ProfilePanel,
  ProjectProgressPanel,
  ReadingPanel,
  RecommendationRadarPanel,
  ReportsPanel,
  SourcesPanel,
} from "./workbench-panels";
import { ChipEditor, Modal, Toast } from "./workbench-ui";
import type { ActiveModal, DetailView, KnowledgeDraft, ProfileDraft, ProjectForm } from "./workbench-types";

const emptyProjectForm: ProjectForm = {
  name: "",
  discipline: "",
  description: "",
};

const emptyProfileDraft: ProfileDraft = {
  research_object: [],
  methods: [],
  materials: [],
  metrics: [],
  keywords_zh: [],
  keywords_en: [],
  exclusions: [],
};

const emptyKnowledgeDraft: KnowledgeDraft = {
  status: "read_later",
  tags: [],
  note: "",
};

function draftFromProfile(profile: ResearchProfile | null): ProfileDraft {
  if (!profile) {
    return emptyProfileDraft;
  }
  return {
    research_object: profile.research_object,
    methods: profile.methods,
    materials: profile.materials,
    metrics: profile.metrics,
    keywords_zh: profile.keywords_zh,
    keywords_en: profile.keywords_en,
    exclusions: profile.exclusions,
  };
}

function projectMatches(project: ResearchProject, projectId: string | null) {
  return Boolean(projectId && project.id === projectId);
}

export function PhaseOneWorkbench() {
  const [user, setUser] = useState<User | null>(null);
  const [quota, setQuota] = useState<{ quota_balance: number; plan: User["plan"] } | null>(null);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [projects, setProjects] = useState<ResearchProject[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [profile, setProfile] = useState<ResearchProfile | null>(null);
  const [oneSentence, setOneSentence] = useState("");
  const [diagnosis, setDiagnosis] = useState<Diagnosis | null>(null);
  const [searchTasks, setSearchTasks] = useState<SearchTask[]>([]);
  const [taskRuns, setTaskRuns] = useState<TaskStatus[]>([]);
  const [sourceRecords, setSourceRecords] = useState<Record<string, SourceRecord[]>>({});
  const [selectedSourceTaskId, setSelectedSourceTaskId] = useState<string | null>(null);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [selectedRecommendationId, setSelectedRecommendationId] = useState<string | null>(null);
  const [feedbackItems, setFeedbackItems] = useState<UserFeedback[]>([]);
  const [analysis, setAnalysis] = useState<PaperAnalysis | null>(null);
  const [paperDetail, setPaperDetail] = useState<Paper | null>(null);
  const [paperVersions, setPaperVersions] = useState<PaperVersion[]>([]);
  const [paperAnalysesByPaper, setPaperAnalysesByPaper] = useState<Record<string, PaperAnalysis[]>>({});
  const [recommendationDetail, setRecommendationDetail] = useState<Recommendation | null>(null);
  const [knowledgeItems, setKnowledgeItems] = useState<KnowledgeItem[]>([]);
  const [knowledgeDetail, setKnowledgeDetail] = useState<KnowledgeItem | null>(null);
  const [knowledgeDraft, setKnowledgeDraft] = useState<KnowledgeDraft>(emptyKnowledgeDraft);
  const [knowledgeQuery, setKnowledgeQuery] = useState("");
  const [reports, setReports] = useState<RadarReport[]>([]);
  const [reportDetail, setReportDetail] = useState<RadarReport | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageDetail, setMessageDetail] = useState<Message | null>(null);
  const [emailPreference, setEmailPreference] = useState<EmailPreference | null>(null);
  const [modal, setModal] = useState<ActiveModal>(null);
  const [detail, setDetail] = useState<DetailView>(null);
  const [workbenchOpen, setWorkbenchOpen] = useState(true);
  const [projectForm, setProjectForm] = useState<ProjectForm>(emptyProjectForm);
  const [profileDraft, setProfileDraft] = useState<ProfileDraft>(emptyProfileDraft);

  const { toast, showToast } = useToast();
  const { busy, runAction, setBusyKey } = useBusyState();

  const activeProject = useMemo(
    () => projects.find((project) => projectMatches(project, activeProjectId)) ?? null,
    [activeProjectId, projects]
  );

  const selectedRecommendation = useMemo(
    () =>
      recommendations.find((recommendation) => recommendation.id === selectedRecommendationId) ??
      recommendations[0] ??
      null,
    [recommendations, selectedRecommendationId]
  );

  const selectedSourceTask = useMemo(
    () => searchTasks.find((task) => task.id === selectedSourceTaskId) ?? searchTasks[0] ?? null,
    [searchTasks, selectedSourceTaskId]
  );

  const selectedSourceRecords = selectedSourceTask ? sourceRecords[selectedSourceTask.id] ?? [] : [];
  const profileConfirmed = profile?.status === "confirmed";
  const latestPaperAnalyses = paperDetail ? paperAnalysesByPaper[paperDetail.id] ?? [] : [];

  const analysisPaperIds = useMemo(() => {
    const ids = new Set<string>();
    Object.entries(paperAnalysesByPaper).forEach(([paperId, items]) => {
      if (items.length > 0) {
        ids.add(paperId);
      }
    });
    if (analysis) {
      ids.add(analysis.paper_id);
    }
    return ids;
  }, [analysis, paperAnalysesByPaper]);

  const filteredRecommendations = useMemo(() => {
    const query = knowledgeQuery.trim().toLowerCase();
    if (!query) {
      return recommendations;
    }
    return recommendations.filter((recommendation) =>
      [
        recommendation.paper.title,
        recommendation.paper.title_zh,
        recommendation.paper.journal,
        recommendation.channel,
        ...Object.values(recommendation.explanation),
      ]
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }, [knowledgeQuery, recommendations]);

  const sourceSummaryForPaper = useCallback(
    (paperId: string) => {
      const sources = new Set(
        Object.values(sourceRecords)
          .flat()
          .filter((record) => record.paper_id === paperId)
          .map((record) => record.source)
      );
      if (sources.size === 0) {
        return health?.retrieval_provider === "mock" ? "开发模拟/诊断推荐" : "推荐池";
      }
      return Array.from(sources).join(" / ");
    },
    [health?.retrieval_provider, sourceRecords]
  );

  const resetProjectContext = useCallback(() => {
    setProfile(null);
    setDiagnosis(null);
    setSearchTasks([]);
    setTaskRuns([]);
    setSourceRecords({});
    setSelectedSourceTaskId(null);
    setRecommendations([]);
    setSelectedRecommendationId(null);
    setFeedbackItems([]);
    setAnalysis(null);
    setPaperDetail(null);
    setPaperVersions([]);
    setPaperAnalysesByPaper({});
    setRecommendationDetail(null);
    setKnowledgeItems([]);
    setKnowledgeDetail(null);
    setReports([]);
    setReportDetail(null);
    setDetail(null);
  }, []);

  const loadRetrievalArtifacts = useCallback(async (projectId: string, knownTasks?: SearchTask[], knownRuns?: TaskStatus[]) => {
    const tasks = knownTasks ?? (await api.searchTasks(projectId));
    const taskStatuses =
      knownRuns ?? (await Promise.all(tasks.map((task) => api.taskStatus(task.id).catch(() => null))));
    const sourceEntries = await Promise.all(
      tasks.map(async (task) => [task.id, await api.sourceRecords(task.id).catch(() => [])] as const)
    );
    setSearchTasks(tasks);
    setTaskRuns(taskStatuses.filter((status): status is TaskStatus => Boolean(status)));
    setSourceRecords(Object.fromEntries(sourceEntries));
    setSelectedSourceTaskId((current) => current ?? tasks[0]?.id ?? null);
  }, []);

  const loadProjectContext = useCallback(
    async (project: ResearchProject) => {
      resetProjectContext();
      if (!project.current_profile_id) {
        return;
      }
      try {
        const currentProfile = await api.profile(project.id);
        setProfile(currentProfile);
        setProfileDraft(draftFromProfile(currentProfile));
        if (currentProfile.status !== "confirmed") {
          return;
        }
        const [nextDiagnosis, recList, savedFeedback, savedKnowledge, reportList, messageList] =
          await Promise.all([
            api.diagnosis(project.id),
            api.recommendations(project.id),
            api.projectFeedback(project.id),
            api.knowledge(project.id),
            api.reports(project.id),
            api.messages(),
          ]);
        await loadRetrievalArtifacts(project.id);
        setDiagnosis(nextDiagnosis);
        setRecommendations(recList.items);
        setSelectedRecommendationId(recList.items[0]?.id ?? null);
        setFeedbackItems(savedFeedback);
        setKnowledgeItems(savedKnowledge);
        setReports(reportList);
        setMessages(messageList);
      } catch {
        showToast("warning", "项目上下文加载失败，可重新生成画像。");
      }
    },
    [loadRetrievalArtifacts, resetProjectContext, showToast]
  );

  const loadInitial = useCallback(async () => {
    await runAction("initial", async () => {
      const [serviceHealth, me, quotaData, projectList, messageList, preference] =
        await Promise.all([
          api.health(),
          api.me(),
          api.quota(),
          api.projects(),
          api.messages(),
          api.emailPreference(),
        ]);
      setHealth(serviceHealth);
      setUser(me);
      setQuota(quotaData);
      setProjects(projectList);
      setMessages(messageList);
      setEmailPreference(preference);
      const firstProject = projectList[0] ?? null;
      setActiveProjectId(firstProject?.id ?? null);
      if (firstProject) {
        await loadProjectContext(firstProject);
      }
    }, (message) => showToast("error", message || "请求失败，请稍后重试。"));
  }, [loadProjectContext, runAction, showToast]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  useEffect(() => {
    setProfileDraft(draftFromProfile(profile));
  }, [profile]);

  function updateProfileDraft(key: keyof ProfileDraft, values: string[]) {
    setProfileDraft((current) => ({ ...current, [key]: values }));
  }

  async function handleCreateProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runAction("project", async () => {
      const project = await api.createProject({
        name: projectForm.name.trim(),
        discipline: projectForm.discipline.trim() || undefined,
        description: projectForm.description.trim() || undefined,
      });
      setProjects((current) => [project, ...current]);
      setActiveProjectId(project.id);
      resetProjectContext();
      setProjectForm(emptyProjectForm);
      setOneSentence("");
      showToast("success", "项目已创建，请生成研究画像。");
      setModal("profileWizard");
    }, (message) => showToast("error", message || "请求失败，请稍后重试。"));
  }

  async function handleGenerateProfile() {
    if (!activeProject) {
      setModal("project");
      showToast("warning", "请先在研究工作台下新增项目。");
      return;
    }
    await runAction("profile", async () => {
      const nextProfile = await api.generateProfile(activeProject.id, oneSentence.trim());
      setProfile(nextProfile);
      setProfileDraft(draftFromProfile(nextProfile));
      setDiagnosis(null);
      showToast("success", "画像草稿已生成。");
      setModal("profileEdit");
    }, (message) => showToast("error", message || "请求失败，请稍后重试。"));
  }

  async function patchProfileDraft() {
    if (!activeProject) {
      return null;
    }
    return api.patchProfile(activeProject.id, profileDraft);
  }

  async function handleSaveProfile(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    await runAction("profile", async () => {
      const nextProfile = await patchProfileDraft();
      if (nextProfile) {
        setProfile(nextProfile);
        setProfileDraft(draftFromProfile(nextProfile));
      }
      showToast("success", "画像已保存为草稿。");
    }, (message) => showToast("error", message || "请求失败，请稍后重试。"));
  }

  async function handleSaveAndConfirmProfile() {
    if (!activeProject || !profile) {
      return;
    }
    await runAction("confirm", async () => {
      const saved = await patchProfileDraft();
      if (saved) {
        setProfile(saved);
      }
      const confirmed = await api.confirmProfile(activeProject.id);
      const nextDiagnosis = await api.diagnosis(activeProject.id);
      const nextRecommendations = nextDiagnosis.highly_related_papers.concat(nextDiagnosis.method_transfer_papers);
      setProfile(confirmed);
      setProfileDraft(draftFromProfile(confirmed));
      setDiagnosis(nextDiagnosis);
      setRecommendations(nextRecommendations);
      setSelectedRecommendationId(nextRecommendations[0]?.id ?? null);
      setModal(null);
      showToast("success", "画像已确认，首日诊断已生成。");
    }, (message) => showToast("error", message || "请求失败，请稍后重试。"));
  }

  async function handleGenerateDiagnosis() {
    if (!activeProject || !profileConfirmed) {
      showToast("warning", "请先确认研究画像。");
      return;
    }
    await runAction("confirm", async () => {
      const nextDiagnosis = await api.diagnosis(activeProject.id);
      setDiagnosis(nextDiagnosis);
      showToast("success", "诊断已重新生成。");
    }, (message) => showToast("error", message || "请求失败，请稍后重试。"));
  }

  async function handleSearchLoop() {
    if (!activeProject || !profileConfirmed) {
      showToast("warning", "请先确认研究画像。");
      return;
    }
    await runAction("search", async () => {
      const tasks = await api.generateSearchTasks(activeProject.id);
      const runResults = await Promise.all(tasks.map((task) => api.runSearchTask(task.id)));
      const recList = await api.recommendations(activeProject.id);
      const savedFeedback = await api.projectFeedback(activeProject.id);
      const savedKnowledge = await api.knowledge(activeProject.id);
      await loadRetrievalArtifacts(activeProject.id, tasks, runResults);
      setRecommendations(recList.items);
      setSelectedRecommendationId(recList.items[0]?.id ?? null);
      setFeedbackItems(savedFeedback);
      setKnowledgeItems(savedKnowledge);
      showToast("success", "检索任务已运行，推荐已更新。");
    }, (message) => showToast("error", message || "请求失败，请稍后重试。"));
  }

  async function handleRefreshRecommendations() {
    if (!activeProject || !profileConfirmed) {
      showToast("warning", "请先确认研究画像。");
      return;
    }
    await runAction("recommend", async () => {
      const recList = await api.refreshRecommendations(activeProject.id);
      const savedFeedback = await api.projectFeedback(activeProject.id);
      setRecommendations(recList.items);
      setFeedbackItems(savedFeedback);
      setSelectedRecommendationId(recList.items[0]?.id ?? null);
      showToast("success", "推荐已刷新。");
    }, (message) => showToast("error", message || "请求失败，请稍后重试。"));
  }

  async function handleFeedback(recommendation: Recommendation, feedbackType: FeedbackType) {
    await runAction("feedback", async () => {
      const feedback = await api.submitFeedback(
        recommendation.id,
        feedbackType,
        feedbackType === "irrelevant" ? "与当前材料或方法不匹配。" : "该结果对当前研究判断有帮助。"
      );
      setFeedbackItems((current) => [feedback, ...current]);
      if (activeProject) {
        const recList = await api.recommendations(activeProject.id);
        setRecommendations(recList.items);
      }
      showToast("success", "反馈已写回推荐排序。");
    }, (message) => showToast("error", message || "请求失败，请稍后重试。"));
  }

  async function openDetail(nextDetail: DetailView) {
    setDetail(nextDetail);
    if (!nextDetail) {
      return;
    }
    if (nextDetail.kind === "sources") {
      setSelectedSourceTaskId(nextDetail.taskId ?? selectedSourceTask?.id ?? null);
      return;
    }
    if (nextDetail.kind === "paper") {
      const currentRecommendation =
        recommendations.find((recommendation) => recommendation.id === nextDetail.recommendationId) ??
        selectedRecommendation;
      if (!currentRecommendation) {
        return;
      }
      setSelectedRecommendationId(currentRecommendation.id);
      setBusyKey("detail", true);
      try {
        const [rec, paper, versions, analyses] = await Promise.all([
          api.recommendation(currentRecommendation.id),
          api.paper(currentRecommendation.paper.id),
          api.paperVersions(currentRecommendation.paper.id),
          api.paperAnalyses(currentRecommendation.paper.id),
        ]);
        setRecommendationDetail(rec);
        setPaperDetail(paper);
        setPaperVersions(versions);
        setPaperAnalysesByPaper((current) => ({ ...current, [paper.id]: analyses }));
      } catch {
        showToast("error", "论文详情读取失败。");
      } finally {
        setBusyKey("detail", false);
      }
    }
    if (nextDetail.kind === "knowledge") {
      setBusyKey("detail", true);
      try {
        const item = await api.knowledgeItem(nextDetail.itemId);
        setKnowledgeDetail(item);
        setKnowledgeDraft({
          status: item.status,
          tags: item.tags,
          note: item.note ?? "",
        });
      } catch {
        showToast("error", "知识库详情读取失败。");
      } finally {
        setBusyKey("detail", false);
      }
    }
    if (nextDetail.kind === "report") {
      setBusyKey("detail", true);
      try {
        setReportDetail(await api.report(nextDetail.reportId));
      } catch {
        showToast("error", "报告详情读取失败。");
      } finally {
        setBusyKey("detail", false);
      }
    }
    if (nextDetail.kind === "message") {
      setBusyKey("detail", true);
      try {
        setMessageDetail(await api.message(nextDetail.messageId));
      } catch {
        showToast("error", "消息详情读取失败。");
      } finally {
        setBusyKey("detail", false);
      }
    }
  }

  async function handleAnalysis(analysisType: "quick" | "standard") {
    if (!activeProject || !selectedRecommendation) {
      return;
    }
    await runAction("analysis", async () => {
      const nextAnalysis = await api.createAnalysis(selectedRecommendation.paper.id, activeProject.id, analysisType);
      const [nextQuota, analyses] = await Promise.all([
        api.quota(),
        api.paperAnalyses(selectedRecommendation.paper.id),
      ]);
      setAnalysis(nextAnalysis);
      setQuota(nextQuota);
      setPaperAnalysesByPaper((current) => ({ ...current, [selectedRecommendation.paper.id]: analyses }));
      setDetail({ kind: "analysis", analysisId: nextAnalysis.id });
      showToast("success", analysisType === "quick" ? "快速分析已完成。" : "标准研读已完成并记录成本。");
    }, (message) => showToast("error", message || "请求失败，请稍后重试。"));
  }

  async function handleAddKnowledge(status: KnowledgeItem["status"] = "read_later") {
    if (!activeProject || !selectedRecommendation) {
      return;
    }
    await runAction("knowledge", async () => {
      const item = await api.addKnowledge(activeProject.id, {
        paper_id: selectedRecommendation.paper.id,
        status,
        tags: ["推荐论文", selectedRecommendation.channel],
        note: "从工作台推荐列表加入，后续可补充研读笔记和实验关联。",
      });
      const savedKnowledge = await api.knowledge(activeProject.id);
      setKnowledgeItems(savedKnowledge);
      setKnowledgeDetail(item);
      setKnowledgeDraft({ status: item.status, tags: item.tags, note: item.note ?? "" });
      setDetail({ kind: "knowledge", itemId: item.id });
      showToast("success", "论文已加入知识库。");
    }, (message) => showToast("error", message || "请求失败，请稍后重试。"));
  }

  async function handleKnowledgeSearch() {
    if (!activeProject) {
      return;
    }
    await runAction("knowledge", async () => {
      const search = await api.searchKnowledge(activeProject.id, knowledgeQuery);
      setKnowledgeItems(search);
      showToast("success", search.length > 0 ? "知识库已返回匹配条目。" : "知识库暂无匹配条目。");
    }, (message) => showToast("error", message || "请求失败，请稍后重试。"));
  }

  async function handleSaveKnowledge() {
    if (!knowledgeDetail) {
      return;
    }
    await runAction("knowledge", async () => {
      const updated = await api.updateKnowledge(knowledgeDetail.id, {
        status: knowledgeDraft.status,
        tags: knowledgeDraft.tags,
        note: knowledgeDraft.note,
      });
      setKnowledgeDetail(updated);
      setKnowledgeItems((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      showToast("success", "知识库条目已保存。");
    }, (message) => showToast("error", message || "请求失败，请稍后重试。"));
  }

  async function handleGenerateReport(reportType: "daily" | "weekly" = "daily") {
    if (!activeProject) {
      return;
    }
    await runAction("report", async () => {
      const report = await api.generateReport(activeProject.id, reportType);
      const [reportList, messageList] = await Promise.all([
        api.reports(activeProject.id),
        api.messages(),
      ]);
      setReports(reportList);
      setMessages(messageList);
      setReportDetail(report);
      setDetail({ kind: "report", reportId: report.id });
      showToast("success", reportType === "daily" ? "日报已生成。" : "周报已生成。");
    }, (message) => showToast("error", message || "请求失败，请稍后重试。"));
  }

  async function handleReadMessage(message: Message) {
    await runAction("message", async () => {
      const updated = await api.markMessageRead(message.id);
      setMessages((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setMessageDetail(updated);
      showToast("success", "站内消息已标记为已读。");
    }, (nextMessage) => showToast("error", nextMessage || "请求失败，请稍后重试。"));
  }

  async function handleRetryTask(taskId: string) {
    await runAction("search", async () => {
      const retried = await api.retryTask(taskId);
      setTaskRuns((current) => {
        const others = current.filter((item) => item.task_id !== retried.task_id);
        return [retried, ...others];
      });
      showToast("success", "任务已进入重试队列。");
    }, (message) => showToast("error", message || "请求失败，请稍后重试。"));
  }

  async function handleUnsubscribeEmail() {
    await runAction("message", async () => {
      const preference = await api.unsubscribeEmail();
      setEmailPreference(preference);
      showToast("success", "已退订邮件推送。");
    }, (message) => showToast("error", message || "请求失败，请稍后重试。"));
  }

  async function handleSelectProject(project: ResearchProject) {
    await runAction("initial", async () => {
      setActiveProjectId(project.id);
      await loadProjectContext(project);
      showToast("success", `已切换到项目：${project.name}`);
    }, (message) => showToast("error", message || "请求失败，请稍后重试。"));
  }

  function handleSelectRecommendation(recommendation: Recommendation) {
    setSelectedRecommendationId(recommendation.id);
    setAnalysis(null);
  }

  return (
    <main className="app-shell">
      {toast ? <Toast toast={toast} /> : null}

      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">R</div>
          <div>
            <h1 className="brand-title">研知雷达</h1>
            <p className="brand-subtitle">Research Radar AI</p>
          </div>
        </div>

        <nav className="nav" aria-label="主导航">
          <div className="nav-drawer">
            <div className="drawer-header">
              <button
                className="nav-button active drawer-trigger"
                type="button"
                aria-expanded={workbenchOpen}
                aria-controls="workbench-project-list"
                onClick={() => setWorkbenchOpen((current) => !current)}
              >
                <LayoutDashboard className="nav-icon" aria-hidden="true" size={18} />
                <span>研究工作台</span>
                <span className="nav-count">{projects.length}</span>
                {workbenchOpen ? <ChevronDown aria-hidden="true" size={16} /> : <ChevronRight aria-hidden="true" size={16} />}
              </button>
              <button className="icon-button drawer-add" aria-label="新增项目" type="button" onClick={() => setModal("project")}>
                <Plus size={16} />
              </button>
            </div>

            {workbenchOpen ? (
              <div className="workbench-drawer" id="workbench-project-list">
                <div className="project-list">
                  {projects.length === 0 ? (
                    <p className="empty-copy">暂无项目，点击工作台右侧 + 添加课题。</p>
                  ) : (
                    projects.map((project) => (
                      <button
                        className={`project-button ${project.id === activeProjectId ? "active" : ""}`}
                        key={project.id}
                        type="button"
                        onClick={() => {
                          void handleSelectProject(project);
                        }}
                      >
                        <span className="paper-dot" />
                        <span className="project-name">{project.name}</span>
                        <span className="project-count">{project.status}</span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            ) : null}
          </div>

          <Link className="nav-button" href="/knowledge">
            <Library className="nav-icon" aria-hidden="true" size={18} />
            <span>知识库</span>
          </Link>
          <Link className="nav-button" href="/reports">
            <Inbox className="nav-icon" aria-hidden="true" size={18} />
            <span>报告消息</span>
          </Link>
          <button className="nav-button" disabled type="button">
            <Radar className="nav-icon" aria-hidden="true" size={18} />
            <span>雷达探索</span>
            <span className="future-pill">待开放</span>
          </button>
          <button className="nav-button" disabled type="button">
            <FileSearch className="nav-icon" aria-hidden="true" size={18} />
            <span>论文追踪</span>
            <span className="future-pill">待开放</span>
          </button>
        </nav>

        <div className="sidebar-spacer" />
        <div className="bottom-nav">
          <button className="nav-button" type="button" onClick={() => setModal("quota")}>
            <CreditCard className="nav-icon" aria-hidden="true" size={18} />
            <span>额度与扩容</span>
          </button>
          <button className="nav-button" type="button" disabled>
            <Settings className="nav-icon" aria-hidden="true" size={18} />
            <span>设置</span>
            <span className="future-pill">待开放</span>
          </button>
        </div>
      </aside>

      <section className="main">
        <header className="topbar">
          <div className="context-title">
            <span>研究工作台</span>
            <strong>{activeProject?.name ?? "当前没有项目"}</strong>
          </div>
          <div className="state-badges topbar-badges">
            <span className={`state-badge ${profileConfirmed ? "done" : ""}`}>{profile ? profile.status : "未画像"}</span>
            <span className="state-badge">{recommendations.length} 条推荐</span>
            <span className="state-badge">{health?.retrieval_provider === "live" ? "live 数据源" : "mock 数据源"}</span>
          </div>
          <div className="quota">
            <strong>额度 {quota?.quota_balance ?? "-"}</strong>
            <div className="quota-bar" aria-hidden="true">
              <div className="quota-fill" />
            </div>
          </div>
          <div className="user-pill">
            <div className="avatar">{user?.display_name?.slice(0, 1) ?? "研"}</div>
            <div>
              <strong>{user?.display_name ?? "加载中"}</strong>
              <div className="brand-subtitle">{user?.plan ?? "free"} plan</div>
            </div>
          </div>
        </header>

        {!activeProject ? (
          <div className="workspace empty-workspace">
            <section className="empty-project-panel">
              <LayoutDashboard size={28} aria-hidden="true" />
              <h2>当前没有项目</h2>
              <p>请展开左侧“研究工作台”，点击右侧加号添加课题。</p>
              <button className="primary-button" type="button" onClick={() => setModal("project")}>
                <Plus size={16} />
                添加项目
              </button>
            </section>
          </div>
        ) : (
          <div className="workspace">
            <section className="radar-column">
              <ProjectProgressPanel
                diagnosis={diagnosis}
                profile={profile}
                profileConfirmed={Boolean(profileConfirmed)}
                recommendationCount={recommendations.length}
                taskRuns={taskRuns}
                onOpenDiagnosis={() => void openDetail({ kind: "diagnosis" })}
                onOpenGap={() => void openDetail({ kind: "gap" })}
                onOpenTasks={() => void openDetail({ kind: "tasks" })}
              />

              <RecommendationRadarPanel
                analysisPaperIds={analysisPaperIds}
                busy={busy}
                feedbackItems={feedbackItems}
                knowledgeItems={knowledgeItems}
                knowledgeQuery={knowledgeQuery}
                recommendations={filteredRecommendations}
                selectedRecommendation={selectedRecommendation}
                setKnowledgeQuery={setKnowledgeQuery}
                sourceSummaryForPaper={sourceSummaryForPaper}
                onFeedback={(recommendation, feedbackType) => void handleFeedback(recommendation, feedbackType)}
                onOpenPaper={(recommendation) => void openDetail({ kind: "paper", recommendationId: recommendation.id })}
                onRefresh={() => void handleRefreshRecommendations()}
                onRunSearch={() => void handleSearchLoop()}
                onSelect={handleSelectRecommendation}
              />
            </section>

            <aside className="side-column">
              <ProfilePanel profile={profile} onEdit={() => setModal(profile ? "profileEdit" : "profileWizard")} />
              <SourcesPanel
                health={health}
                searchTasks={searchTasks}
                sourceRecords={sourceRecords}
                taskRuns={taskRuns}
                onOpenSources={(taskId) => void openDetail({ kind: "sources", taskId })}
              />
              <ReadingPanel
                analysis={analysis}
                busy={busy}
                selectedRecommendation={selectedRecommendation}
                onAddKnowledge={() => void handleAddKnowledge("read_later")}
                onAnalyze={(analysisType) => void handleAnalysis(analysisType)}
                onOpenAnalysis={() => void openDetail({ kind: "analysis", analysisId: analysis?.id })}
              />
              <KnowledgePanel
                busy={busy}
                knowledgeItems={knowledgeItems}
                knowledgeQuery={knowledgeQuery}
                setKnowledgeQuery={setKnowledgeQuery}
                onSearch={() => void handleKnowledgeSearch()}
                onOpenKnowledge={(item) => void openDetail({ kind: "knowledge", itemId: item.id })}
              />
              <ReportsPanel
                busy={busy}
                emailUnsubscribed={Boolean(emailPreference?.reports_unsubscribed)}
                messages={messages}
                reports={reports}
                onGenerateReport={(reportType) => void handleGenerateReport(reportType)}
                onOpenMessage={(message) => void openDetail({ kind: "message", messageId: message.id })}
                onOpenReport={(report) => void openDetail({ kind: "report", reportId: report.id })}
                onUnsubscribeEmail={() => void handleUnsubscribeEmail()}
              />
            </aside>
          </div>
        )}
      </section>

      {modal === "project" ? (
        <Modal title="新增研究项目" onClose={() => setModal(null)}>
          <form className="modal-form" onSubmit={handleCreateProject}>
            <label>
              项目名称
              <input
                value={projectForm.name}
                onChange={(event) => setProjectForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="例如：高性能生物质热压材料研究"
                required
              />
            </label>
            <label>
              学科
              <input
                value={projectForm.discipline}
                onChange={(event) => setProjectForm((current) => ({ ...current, discipline: event.target.value }))}
                placeholder="例如：材料科学"
              />
            </label>
            <label>
              简述
              <textarea
                value={projectForm.description}
                onChange={(event) => setProjectForm((current) => ({ ...current, description: event.target.value }))}
                placeholder="简要描述研究对象、方法、指标或阶段目标"
                rows={3}
              />
            </label>
            <div className="button-row right">
              <button className="ghost-button" type="button" onClick={() => setModal(null)}>
                取消
              </button>
              <button className="primary-button" type="submit" disabled={busy.project || !projectForm.name.trim()}>
                {busy.project ? <Loader2 className="spin" size={16} /> : <Plus size={16} />}
                创建项目
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      {modal === "profileWizard" ? (
        <Modal title="一句话生成研究画像" onClose={() => setModal(null)}>
          <form
            className="modal-form"
            onSubmit={(event) => {
              event.preventDefault();
              void handleGenerateProfile();
            }}
          >
            <label>
              研究方向
              <textarea
                value={oneSentence}
                onChange={(event) => setOneSentence(event.target.value)}
                placeholder="例如：我研究某类材料在某种处理方法后的性能、机制或应用。"
                rows={5}
              />
            </label>
            <div className="button-row right">
              <button className="ghost-button" type="button" onClick={() => setModal(null)}>
                稍后再说
              </button>
              <button className="primary-button" type="submit" disabled={!activeProject || busy.profile || !oneSentence.trim()}>
                {busy.profile ? <Loader2 className="spin" size={16} /> : <WandSparkles size={16} />}
                生成画像草稿
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      {modal === "profileEdit" ? (
        <Modal title="结构化编辑研究画像" onClose={() => setModal(null)}>
          <form className="modal-form profile-edit-form structured-profile" onSubmit={handleSaveProfile}>
            <div className="profile-version-strip">
              <span>{profile ? `v${profile.version}` : "未生成"}</span>
              <span>{profile?.status ?? "draft"}</span>
              <span>置信度 {profile ? Math.round(profile.confidence * 100) : 0}%</span>
              <span>来源：{profile?.source_type ?? "manual"}</span>
            </div>
            <ChipEditor
              label="研究对象"
              values={profileDraft.research_object}
              suggestions={profile?.research_object ?? []}
              onChange={(values) => updateProfileDraft("research_object", values)}
            />
            <ChipEditor
              label="研究方法"
              values={profileDraft.methods}
              suggestions={profile?.methods ?? []}
              onChange={(values) => updateProfileDraft("methods", values)}
            />
            <ChipEditor
              label="核心材料"
              values={profileDraft.materials}
              suggestions={profile?.materials ?? []}
              onChange={(values) => updateProfileDraft("materials", values)}
            />
            <ChipEditor
              label="性能指标"
              values={profileDraft.metrics}
              suggestions={profile?.metrics ?? []}
              onChange={(values) => updateProfileDraft("metrics", values)}
            />
            <ChipEditor
              label="中文关键词"
              values={profileDraft.keywords_zh}
              suggestions={profile?.keywords_zh ?? []}
              onChange={(values) => updateProfileDraft("keywords_zh", values)}
            />
            <ChipEditor
              label="英文关键词"
              values={profileDraft.keywords_en}
              suggestions={profile?.keywords_en ?? []}
              onChange={(values) => updateProfileDraft("keywords_en", values)}
            />
            <ChipEditor
              label="排除方向"
              values={profileDraft.exclusions}
              suggestions={profile?.exclusions ?? []}
              onChange={(values) => updateProfileDraft("exclusions", values)}
            />
            <div className="button-row right">
              <button className="ghost-button" type="button" onClick={() => setModal(null)}>
                取消
              </button>
              <button className="ghost-button" type="submit" disabled={busy.profile}>
                保存草稿
              </button>
              <button className="ghost-button" type="button" disabled={!profileConfirmed || busy.confirm} onClick={() => void handleGenerateDiagnosis()}>
                生成新诊断
              </button>
              <button className="primary-button" type="button" disabled={!profile || profileConfirmed || busy.confirm} onClick={() => void handleSaveAndConfirmProfile()}>
                {busy.confirm ? <Loader2 className="spin" size={16} /> : null}
                确认画像
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      {modal === "quota" ? (
        <Modal title="额度与扩容" onClose={() => setModal(null)}>
          <div className="report-detail">
            <p>当前计划：{quota?.plan ?? "free"}</p>
            <p>剩余额度：{quota?.quota_balance ?? "-"}</p>
            <p>Phase 1 仅展示扩容入口，不接入真实支付或会员体系。</p>
            <button className="primary-button" type="button" disabled title="Phase 1 不进入付费扩容">
              <CircleSlash2 size={16} />
              付费扩容暂未开放
            </button>
          </div>
        </Modal>
      ) : null}

      <WorkbenchDetailDrawer
        analysis={analysis}
        detail={detail}
        diagnosis={diagnosis}
        isBusy={Boolean(busy.detail)}
        knowledgeDetail={knowledgeDetail}
        knowledgeDraft={knowledgeDraft}
        messageDetail={messageDetail}
        paper={paperDetail}
        paperAnalyses={latestPaperAnalyses}
        paperVersions={paperVersions}
        recommendation={recommendationDetail ?? selectedRecommendation}
        reportDetail={reportDetail}
        searchTasks={searchTasks}
        selectedSourceRecords={selectedSourceRecords}
        selectedSourceTask={selectedSourceTask}
        taskRuns={taskRuns}
        onAnalyze={(analysisType) => void handleAnalysis(analysisType)}
        onClose={() => setDetail(null)}
        onEditProfile={() => {
          setModal("profileEdit");
          setDetail(null);
        }}
        onKnowledgeDraftChange={setKnowledgeDraft}
        onReadMessage={(message) => void handleReadMessage(message)}
        onRetryTask={(taskId) => void handleRetryTask(taskId)}
        onRunSearch={() => void handleSearchLoop()}
        onSaveKnowledge={() => void handleSaveKnowledge()}
      />
    </main>
  );
}
