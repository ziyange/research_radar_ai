"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  Bell,
  BookOpen,
  BookmarkPlus,
  CheckCircle2,
  CircleSlash2,
  ClipboardList,
  CreditCard,
  Database,
  FileSearch,
  Inbox,
  LayoutDashboard,
  Library,
  Loader2,
  MailX,
  MessageSquare,
  Microscope,
  Pencil,
  Plus,
  Radar,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  WandSparkles,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";

import {
  ApiError,
  EmailOutboxRecord,
  EmailPreference,
  FeedbackType,
  KnowledgeItem,
  Message,
  PaperAnalysis,
  RadarReport,
  Recommendation,
  ResearchProfile,
  ResearchProject,
  SearchTask,
  TaskStatus,
  User,
  UserFeedback,
  api,
} from "../lib/api";

const defaultProject = {
  name: "脱木质素竹材热压材料研究",
  discipline: "材料科学",
  description: "关注高碘酸钠氧化和二胺改性后的力学与界面性能。",
};

const defaultOneSentence =
  "我研究脱木质素竹片经过高碘酸钠氧化和二胺改性后的热压材料性能。";

const feedbackLabels: Record<FeedbackType, string> = {
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

const channelLabels: Record<Recommendation["channel"], string> = {
  exact: "精确通道",
  explore: "扩展探索",
  method_transfer: "方法迁移",
};

const taskLabels: Record<SearchTask["task_type"], string> = {
  exact: "精确检索",
  expanded: "扩展检索",
  method_transfer: "方法迁移",
  citation_network: "引用网络",
  exploratory: "探索检索",
};

type ActiveModal = "project" | "profileWizard" | "profileEdit" | "report" | "quota" | null;

type ToastState = {
  tone: "success" | "error" | "warning";
  message: string;
} | null;

type NavItem = {
  label: string;
  icon: LucideIcon;
  status: "active" | "future";
};

type BusyKey =
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
  | "message";

const navItems: NavItem[] = [
  { label: "研究工作台", icon: LayoutDashboard, status: "active" },
  { label: "雷达探索", icon: Radar, status: "future" },
  { label: "论文追踪", icon: FileSearch, status: "future" },
  { label: "知识库", icon: Library, status: "future" },
  { label: "消息中心", icon: Inbox, status: "future" },
];

function asErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "请求失败，请稍后重试。";
}

function joinTags(values: string[]) {
  return values.join("，");
}

function splitTags(value: string) {
  return value
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function resultText(analysis: PaperAnalysis | null, key: string) {
  const value = analysis?.result[key];
  if (Array.isArray(value)) {
    return value.join("、");
  }
  if (typeof value === "boolean") {
    return value ? "是" : "否";
  }
  return typeof value === "string" ? value : "暂无";
}

function profileState(profile: ResearchProfile | null) {
  if (!profile) {
    return "未生成画像";
  }
  return `v${profile.version} / ${profile.status} / 置信度 ${Math.round(profile.confidence * 100)}%`;
}

export function PhaseOneWorkbench() {
  const [user, setUser] = useState<User | null>(null);
  const [quota, setQuota] = useState<{ quota_balance: number; plan: User["plan"] } | null>(null);
  const [projects, setProjects] = useState<ResearchProject[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [profile, setProfile] = useState<ResearchProfile | null>(null);
  const [oneSentence, setOneSentence] = useState(defaultOneSentence);
  const [diagnosis, setDiagnosis] = useState<Awaited<ReturnType<typeof api.diagnosis>> | null>(
    null
  );
  const [searchTasks, setSearchTasks] = useState<SearchTask[]>([]);
  const [taskRuns, setTaskRuns] = useState<TaskStatus[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [selectedRecommendationId, setSelectedRecommendationId] = useState<string | null>(null);
  const [feedbackItems, setFeedbackItems] = useState<UserFeedback[]>([]);
  const [analysis, setAnalysis] = useState<PaperAnalysis | null>(null);
  const [knowledgeItems, setKnowledgeItems] = useState<KnowledgeItem[]>([]);
  const [knowledgeQuery, setKnowledgeQuery] = useState("热压");
  const [reports, setReports] = useState<RadarReport[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [emailPreference, setEmailPreference] = useState<EmailPreference | null>(null);
  const [emailOutbox, setEmailOutbox] = useState<EmailOutboxRecord[]>([]);
  const [modal, setModal] = useState<ActiveModal>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [busy, setBusy] = useState<Partial<Record<BusyKey, boolean>>>({ initial: true });

  const [projectForm, setProjectForm] = useState(defaultProject);
  const [profileDraft, setProfileDraft] = useState({
    research_object: "",
    methods: "",
    materials: "",
    metrics: "",
    keywords_zh: "",
    keywords_en: "",
    exclusions: "",
  });

  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? null,
    [activeProjectId, projects]
  );

  const selectedRecommendation = useMemo(
    () =>
      recommendations.find((recommendation) => recommendation.id === selectedRecommendationId) ??
      recommendations[0] ??
      null,
    [recommendations, selectedRecommendationId]
  );

  const visibleRecommendations = useMemo(() => {
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

  const latestReport = reports[0] ?? null;
  const latestEmail = latestReport
    ? emailOutbox.find((item) => item.report_id === latestReport.id) ?? null
    : emailOutbox[0] ?? null;
  const profileReady = Boolean(profile);
  const profileConfirmed = profile?.status === "confirmed";

  const showAppToast = useCallback((tone: NonNullable<ToastState>["tone"], message: string) => {
    setToast({ tone, message });
  }, []);

  useEffect(() => {
    if (!toast) {
      return;
    }
    const timer = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const setBusyKey = useCallback((key: BusyKey, value: boolean) => {
    setBusy((current) => ({ ...current, [key]: value }));
  }, []);

  const runAction = useCallback(
    async (key: BusyKey, action: () => Promise<void>) => {
      setBusyKey(key, true);
      try {
        await action();
      } catch (actionError) {
        const message = asErrorMessage(actionError);
        showAppToast("error", message || "请求失败，请稍后重试。");
      } finally {
        setBusyKey(key, false);
      }
    },
    [setBusyKey, showAppToast]
  );

  const resetProjectContext = useCallback(() => {
    setProfile(null);
    setDiagnosis(null);
    setSearchTasks([]);
    setTaskRuns([]);
    setRecommendations([]);
    setSelectedRecommendationId(null);
    setFeedbackItems([]);
    setAnalysis(null);
    setKnowledgeItems([]);
    setReports([]);
  }, []);

  const loadProjectContext = useCallback(async (project: ResearchProject) => {
    resetProjectContext();
    if (!project.current_profile_id) {
      return;
    }
    try {
      const currentProfile = await api.profile(project.id);
      setProfile(currentProfile);
      if (currentProfile.status !== "confirmed") {
        return;
      }
      const [nextDiagnosis, recList, savedFeedback, savedKnowledge, reportList, outbox] =
        await Promise.all([
          api.diagnosis(project.id),
          api.recommendations(project.id),
          api.projectFeedback(project.id),
          api.searchKnowledge(project.id, "热压"),
          api.reports(project.id),
          api.emailOutbox(),
        ]);
      setDiagnosis(nextDiagnosis);
      setRecommendations(recList.items);
      setSelectedRecommendationId(recList.items[0]?.id ?? null);
      setFeedbackItems(savedFeedback);
      setKnowledgeItems(savedKnowledge);
      setReports(reportList);
      setEmailOutbox(outbox);
    } catch {
      showAppToast("warning", "项目上下文加载失败，可重新生成画像。");
    }
  }, [resetProjectContext, showAppToast]);

  const loadInitial = useCallback(async () => {
    await runAction("initial", async () => {
      const [me, quotaData, projectList, messageList, preference, outbox] = await Promise.all([
        api.me(),
        api.quota(),
        api.projects(),
        api.messages(),
        api.emailPreference(),
        api.emailOutbox(),
      ]);
      setUser(me);
      setQuota(quotaData);
      setProjects(projectList);
      setMessages(messageList);
      setEmailPreference(preference);
      setEmailOutbox(outbox);
      const firstProject = projectList[0] ?? null;
      setActiveProjectId(firstProject?.id ?? null);
      if (firstProject) {
        await loadProjectContext(firstProject);
      }
    });
  }, [loadProjectContext, runAction]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  useEffect(() => {
    if (!profile) {
      return;
    }
    setProfileDraft({
      research_object: joinTags(profile.research_object),
      methods: joinTags(profile.methods),
      materials: joinTags(profile.materials),
      metrics: joinTags(profile.metrics),
      keywords_zh: joinTags(profile.keywords_zh),
      keywords_en: joinTags(profile.keywords_en),
      exclusions: joinTags(profile.exclusions),
    });
  }, [profile]);

  async function handleCreateProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runAction("project", async () => {
      const project = await api.createProject(projectForm);
      setProjects((current) => [project, ...current]);
      setActiveProjectId(project.id);
      resetProjectContext();
      setProjectForm(defaultProject);
      showAppToast("success", "项目已创建，请生成研究画像。");
      setModal("profileWizard");
    });
  }

  async function handleGenerateProfile() {
    if (!activeProject) {
      setModal("project");
      showAppToast("warning", "请先点击左侧加号新增项目。");
      return;
    }
    await runAction("profile", async () => {
      const nextProfile = await api.generateProfile(activeProject.id, oneSentence);
      setProfile(nextProfile);
      setDiagnosis(null);
      showAppToast("success", "画像草稿已生成。");
      setModal("profileEdit");
    });
  }

  async function patchProfileDraft() {
    if (!activeProject) {
      return null;
    }
    return api.patchProfile(activeProject.id, {
      research_object: splitTags(profileDraft.research_object),
      methods: splitTags(profileDraft.methods),
      materials: splitTags(profileDraft.materials),
      metrics: splitTags(profileDraft.metrics),
      keywords_zh: splitTags(profileDraft.keywords_zh),
      keywords_en: splitTags(profileDraft.keywords_en),
      exclusions: splitTags(profileDraft.exclusions),
    });
  }

  async function handleSaveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runAction("profile", async () => {
      const nextProfile = await patchProfileDraft();
      if (nextProfile) {
        setProfile(nextProfile);
      }
      showAppToast("success", "画像已保存为草稿。");
    });
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
      const nextRecommendations = nextDiagnosis.highly_related_papers.concat(
        nextDiagnosis.method_transfer_papers
      );
      setProfile(confirmed);
      setDiagnosis(nextDiagnosis);
      setRecommendations(nextRecommendations);
      setSelectedRecommendationId(nextRecommendations[0]?.id ?? null);
      setModal(null);
      showAppToast("success", "画像已确认，首日诊断已生成。");
    });
  }

  async function handleSearchLoop() {
    if (!activeProject || !profileConfirmed) {
      showAppToast("warning", "请先确认研究画像。");
      return;
    }
    await runAction("search", async () => {
      const tasks = await api.generateSearchTasks(activeProject.id);
      const runResults = await Promise.all(tasks.map((task) => api.runSearchTask(task.id)));
      const recList = await api.recommendations(activeProject.id);
      const savedFeedback = await api.projectFeedback(activeProject.id);
      setSearchTasks(tasks);
      setTaskRuns(runResults);
      setRecommendations(recList.items);
      setSelectedRecommendationId(recList.items[0]?.id ?? null);
      setFeedbackItems(savedFeedback);
      showAppToast("success", "检索任务已运行，推荐已更新。");
    });
  }

  async function handleRefreshRecommendations() {
    if (!activeProject || !profileConfirmed) {
      showAppToast("warning", "请先确认研究画像。");
      return;
    }
    await runAction("recommend", async () => {
      const recList = await api.refreshRecommendations(activeProject.id);
      const savedFeedback = await api.projectFeedback(activeProject.id);
      setRecommendations(recList.items);
      setFeedbackItems(savedFeedback);
      setSelectedRecommendationId(recList.items[0]?.id ?? null);
      showAppToast("success", "推荐已刷新。");
    });
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
      showAppToast("success", `已提交反馈：${feedbackLabels[feedbackType]}。`);
    });
  }

  async function handleAnalysis(analysisType: "quick" | "standard") {
    if (!activeProject || !selectedRecommendation) {
      return;
    }
    await runAction("analysis", async () => {
      const nextAnalysis = await api.createAnalysis(
        selectedRecommendation.paper.id,
        activeProject.id,
        analysisType
      );
      const nextQuota = await api.quota();
      setAnalysis(nextAnalysis);
      setQuota(nextQuota);
      showAppToast(
        "success",
        analysisType === "quick" ? "快速分析已完成。" : "标准研读已完成并记录成本。"
      );
    });
  }

  async function handleAddKnowledge(status: KnowledgeItem["status"] = "read_later") {
    if (!activeProject || !selectedRecommendation) {
      return;
    }
    await runAction("knowledge", async () => {
      const item = await api.addKnowledge(activeProject.id, {
        paper_id: selectedRecommendation.paper.id,
        status,
        tags: ["方法参考", channelLabels[selectedRecommendation.channel]],
        note: "从 Phase 1 推荐闭环加入，后续比较热压参数和界面性能。",
      });
      const search = await api.searchKnowledge(activeProject.id, knowledgeQuery || "热压");
      setKnowledgeItems(search.length > 0 ? search : [item]);
      showAppToast("success", "论文已加入知识库。");
    });
  }

  async function handleKnowledgeSearch() {
    if (!activeProject) {
      return;
    }
    await runAction("knowledge", async () => {
      const search = await api.searchKnowledge(activeProject.id, knowledgeQuery);
      setKnowledgeItems(search);
      showAppToast("success", search.length > 0 ? "知识库已返回匹配条目。" : "知识库暂无匹配条目。");
    });
  }

  async function handleGenerateReport(reportType: "daily" | "weekly" = "daily") {
    if (!activeProject) {
      return;
    }
    await runAction("report", async () => {
      await api.generateReport(activeProject.id, reportType);
      const [reportList, messageList, outbox] = await Promise.all([
        api.reports(activeProject.id),
        api.messages(),
        api.emailOutbox(),
      ]);
      setReports(reportList);
      setMessages(messageList);
      setEmailOutbox(outbox);
      setModal("report");
      showAppToast("success", reportType === "daily" ? "日报已生成。" : "周报已生成。");
    });
  }

  async function handleReadMessage(message: Message) {
    await runAction("message", async () => {
      const updated = await api.markMessageRead(message.id);
      setMessages((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      showAppToast("success", "站内消息已标记为已读。");
    });
  }

  async function handleUnsubscribeEmail() {
    await runAction("message", async () => {
      const preference = await api.unsubscribeEmail();
      setEmailPreference(preference);
      showAppToast("success", "已退订邮件推送。");
    });
  }

  async function handleSelectProject(project: ResearchProject) {
    await runAction("initial", async () => {
      setActiveProjectId(project.id);
      await loadProjectContext(project);
      showAppToast("success", `已切换到项目：${project.name}`);
    });
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
          {navItems.map((item) => {
            const Icon = item.icon;
            const isFuture = item.status === "future";
            return (
              <button
                className={`nav-button ${item.status === "active" ? "active" : ""}`}
                disabled={isFuture}
                key={item.label}
                type="button"
              >
                <Icon className="nav-icon" aria-hidden="true" size={18} />
                <span>{item.label}</span>
                {isFuture ? <span className="future-pill">待开放</span> : null}
              </button>
            );
          })}
        </nav>

        <section className="project-section">
          <div className="section-parent">研究工作台</div>
          <div className="section-label">
            <span>当前项目</span>
            <button
              className="icon-button"
              aria-label="新增项目"
              type="button"
              onClick={() => setModal("project")}
            >
              <Plus size={18} />
            </button>
          </div>
          <div className="project-list">
            {projects.length === 0 ? (
              <p className="empty-copy">暂无项目。使用上方加号添加课题。</p>
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
        </section>

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
            <span>研究工作台 / 当前项目</span>
            <strong>{activeProject?.name ?? "当前没有项目"}</strong>
          </div>
          <div className="quota">
            <strong>额度 {quota?.quota_balance ?? "-"}</strong>
            <div className="quota-bar" aria-hidden="true">
              <div className="quota-fill" />
            </div>
            <button className="ghost-button small" type="button" onClick={() => setModal("quota")}>
              去扩容
            </button>
          </div>
          <div className="user-pill">
            <div className="avatar">{user?.display_name.slice(0, 1) ?? "研"}</div>
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
              <p>请使用左侧“当前项目”旁的加号添加课题。</p>
            </section>
          </div>
        ) : (
          <div className="workspace">
            <section className="radar-column">
            <section className="panel compact-panel">
              <div className="panel-header compact">
                <div>
                  <p className="eyebrow">当前项目</p>
                  <h2 className="panel-title">{activeProject.name}</h2>
                </div>
                <div className="state-badges">
                  <span className={`state-badge ${profileConfirmed ? "done" : ""}`}>
                    {profileState(profile)}
                  </span>
                  <span className="state-badge">{recommendations.length} 条推荐</span>
                </div>
              </div>
              <div className="summary-grid">
                <SummaryItem
                  icon={Sparkles}
                  label="首日诊断"
                  value={diagnosis?.technical_route ?? "确认画像后生成诊断"}
                />
                <SummaryItem
                  icon={Database}
                  label="研究空白"
                  value={diagnosis?.research_gap_candidate ?? "等待推荐与反馈"}
                />
                <SummaryItem
                  icon={Activity}
                  label="最近任务"
                  value={taskRuns[0]?.message ?? "暂无任务运行记录"}
                />
              </div>
            </section>

            <section className="panel recommendations">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">E2E-002</p>
                  <h2 className="panel-title">项目推荐列表</h2>
                </div>
                <div className="panel-tools">
                  <label className="panel-search">
                    <Search size={15} aria-hidden="true" />
                    <input
                      placeholder="筛选推荐与知识库"
                      value={knowledgeQuery}
                      onChange={(event) => setKnowledgeQuery(event.target.value)}
                    />
                  </label>
                  <button
                    className="primary-button"
                    type="button"
                    disabled={!profileConfirmed || busy.search}
                    onClick={handleSearchLoop}
                  >
                    {busy.search ? <Loader2 className="spin" size={16} /> : <Zap size={16} />}
                    {busy.search ? "运行中" : "生成检索"}
                  </button>
                  <button
                    className="ghost-button"
                    type="button"
                    disabled={!profileConfirmed || busy.recommend}
                    onClick={handleRefreshRecommendations}
                  >
                    <RefreshCw size={16} />
                    刷新推荐
                  </button>
                </div>
              </div>

              <div className="task-strip">
                {searchTasks.length === 0 ? (
                  <EmptyState text="确认画像后生成精确、扩展、方法迁移检索任务。" />
                ) : (
                  searchTasks.map((task) => (
                    <div className="task-chip" key={task.id}>
                      <b>{taskLabels[task.task_type]}</b>
                      <span>{task.query_text}</span>
                    </div>
                  ))
                )}
              </div>

              <div className="paper-list">
                {busy.search || busy.recommend ? <LoadingState text="正在同步推荐结果..." /> : null}
                {!busy.search && !busy.recommend && visibleRecommendations.length === 0 ? (
                  <EmptyState text="暂无推荐。请完成画像确认并生成检索。" />
                ) : (
                  visibleRecommendations.map((recommendation) => (
                    <RecommendationRow
                      feedback={feedbackItems.find(
                        (item) => item.recommendation_id === recommendation.id
                      )}
                      isActive={selectedRecommendation?.id === recommendation.id}
                      key={recommendation.id}
                      recommendation={recommendation}
                      onFeedback={handleFeedback}
                      onSelect={() => handleSelectRecommendation(recommendation)}
                    />
                  ))
                )}
              </div>
            </section>
            </section>

            <aside className="side-column">
            <section className="panel profile-panel">
              <div className="panel-header compact">
                <div>
                  <p className="eyebrow">E2E-001</p>
                  <h2 className="panel-title">我的研究画像</h2>
                </div>
                <button
                  className="icon-button"
                  type="button"
                  aria-label={profileReady ? "编辑画像" : "生成画像"}
                  disabled={!activeProject}
                  onClick={() => setModal(profileReady ? "profileEdit" : "profileWizard")}
                >
                  {profileReady ? <Pencil size={16} /> : <WandSparkles size={16} />}
                </button>
              </div>
              {profile ? <ProfileSummary profile={profile} /> : <EmptyState text="点击上方按钮生成画像。" />}
            </section>

            <section className="panel action-panel">
              <div className="panel-header compact">
                <div>
                  <p className="eyebrow">E2E-003</p>
                  <h2 className="panel-title">研读与沉淀</h2>
                </div>
              </div>
              <div className="profile-body compact">
                {selectedRecommendation ? (
                  <>
                    <h3 className="paper-title">{selectedRecommendation.paper.title_zh}</h3>
                    <p className="stat-label">{selectedRecommendation.paper.title}</p>
                    <div className="button-grid">
                      <button
                        className="primary-button"
                        type="button"
                        disabled={busy.analysis}
                        onClick={() => handleAnalysis("quick")}
                      >
                        <Sparkles size={16} />
                        快速分析
                      </button>
                      <button
                        className="ghost-button"
                        type="button"
                        disabled={busy.analysis}
                        onClick={() => handleAnalysis("standard")}
                      >
                        <BookOpen size={16} />
                        标准研读
                      </button>
                      <button
                        className="ghost-button"
                        type="button"
                        disabled={busy.knowledge}
                        onClick={() => handleAddKnowledge("read_later")}
                      >
                        <BookmarkPlus size={16} />
                        加入知识库
                      </button>
                      <button
                        className="ghost-button"
                        type="button"
                        disabled={busy.knowledge}
                        onClick={handleKnowledgeSearch}
                      >
                        <Search size={16} />
                        搜索知识库
                      </button>
                    </div>
                  </>
                ) : (
                  <EmptyState text="选择一条推荐后可研读和收藏。" />
                )}
                {analysis ? (
                  <div className="analysis-box">
                    <b>{resultText(analysis, "one_sentence_conclusion")}</b>
                    <span>{resultText(analysis, "relation_to_project")}</span>
                    <span>事实分级：{analysis.claims.map((claim) => claim.fact_level).join("、")}</span>
                  </div>
                ) : null}
              </div>
            </section>

            <section className="panel mini-panel">
              <div className="panel-header compact">
                <h2 className="panel-title">知识库结果</h2>
                <span className="relevance">{knowledgeItems.length} 条</span>
              </div>
              <div className="mini-list">
                {knowledgeItems.length === 0 ? (
                  <EmptyState text="加入论文后可搜索。" />
                ) : (
                  knowledgeItems.map((item) => (
                    <div className="compact-row" key={item.id}>
                      <b>{item.status}</b>
                      <span>{item.tags.join("、")}</span>
                      <span>{item.note}</span>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="panel mini-panel">
              <div className="panel-header compact">
                <div>
                  <p className="eyebrow">E2E-004</p>
                  <h2 className="panel-title">报告与消息</h2>
                </div>
                <button
                  className="icon-button"
                  type="button"
                  aria-label="查看报告"
                  onClick={() => (latestReport ? setModal("report") : handleGenerateReport("daily"))}
                >
                  <MessageSquare size={16} />
                </button>
              </div>
              <div className="report-actions">
                <button
                  className="primary-button"
                  type="button"
                  aria-label="生成日报"
                  disabled={!activeProject || busy.report}
                  onClick={() => handleGenerateReport("daily")}
                >
                  <Bell size={16} />
                  日报
                </button>
                <button
                  className="ghost-button"
                  type="button"
                  aria-label="生成周报"
                  disabled={!activeProject || busy.report}
                  onClick={() => handleGenerateReport("weekly")}
                >
                  <ClipboardList size={16} />
                  周报
                </button>
                <button
                  className="ghost-button"
                  type="button"
                  disabled={emailPreference?.reports_unsubscribed || busy.message}
                  onClick={handleUnsubscribeEmail}
                >
                  <MailX size={16} />
                  {emailPreference?.reports_unsubscribed ? "已退订" : "退订"}
                </button>
              </div>
              <div className="mini-list">
                {messages.length === 0 ? (
                  <EmptyState text="暂无站内消息。" />
                ) : (
                  messages.slice(0, 2).map((message) => (
                    <button
                      className="message-row"
                      key={message.id}
                      type="button"
                      onClick={() => handleReadMessage(message)}
                    >
                      <b>{message.title}</b>
                      <span>{message.body}</span>
                      <em>{message.read ? "已读" : "未读"}</em>
                    </button>
                  ))
                )}
              </div>
            </section>
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
                onChange={(event) =>
                  setProjectForm((current) => ({ ...current, name: event.target.value }))
                }
                required
              />
            </label>
            <label>
              学科
              <input
                value={projectForm.discipline}
                onChange={(event) =>
                  setProjectForm((current) => ({ ...current, discipline: event.target.value }))
                }
              />
            </label>
            <label>
              简述
              <textarea
                value={projectForm.description}
                onChange={(event) =>
                  setProjectForm((current) => ({ ...current, description: event.target.value }))
                }
                rows={3}
              />
            </label>
            <div className="button-row right">
              <button className="ghost-button" type="button" onClick={() => setModal(null)}>
                取消
              </button>
              <button className="primary-button" type="submit" disabled={busy.project}>
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
                rows={5}
              />
            </label>
            <div className="button-row right">
              <button className="ghost-button" type="button" onClick={() => setModal(null)}>
                稍后再说
              </button>
              <button className="primary-button" type="submit" disabled={!activeProject || busy.profile}>
                {busy.profile ? <Loader2 className="spin" size={16} /> : <WandSparkles size={16} />}
                生成画像草稿
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      {modal === "profileEdit" ? (
        <Modal title="编辑并确认研究画像" onClose={() => setModal(null)}>
          <form className="modal-form profile-edit-form" onSubmit={handleSaveProfile}>
            {Object.entries({
              research_object: "研究对象",
              methods: "方法",
              materials: "材料",
              metrics: "指标",
              keywords_zh: "中文关键词",
              keywords_en: "英文关键词",
              exclusions: "排除方向",
            }).map(([key, label]) => (
              <label key={key}>
                {label}
                <textarea
                  value={profileDraft[key as keyof typeof profileDraft]}
                  onChange={(event) =>
                    setProfileDraft((current) => ({ ...current, [key]: event.target.value }))
                  }
                  rows={2}
                />
              </label>
            ))}
            <div className="button-row right">
              <button className="ghost-button" type="button" onClick={() => setModal(null)}>
                取消
              </button>
              <button className="ghost-button" type="submit" disabled={busy.profile}>
                <Pencil size={16} />
                保存草稿
              </button>
              <button
                className="primary-button"
                type="button"
                disabled={!profileReady || profileConfirmed || busy.confirm}
                onClick={handleSaveAndConfirmProfile}
              >
                {busy.confirm ? <Loader2 className="spin" size={16} /> : <CheckCircle2 size={16} />}
                确认并生成诊断
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      {modal === "report" ? (
        <Modal title="完整报告与站内消息" onClose={() => setModal(null)}>
          {latestReport ? (
            <div className="report-detail">
              <h3>{latestReport.report_type === "daily" ? "每日科研雷达" : "每周科研周报"}</h3>
              <p>邮件状态：{latestEmail?.status ?? "未生成邮件任务"}</p>
              {latestEmail?.failure_reason ? <p>失败原因：{latestEmail.failure_reason}</p> : null}
              {latestReport.report_type === "daily" ? (
                <>
                  <p>新增论文：{latestReport.content.new_papers ?? 0}</p>
                  <p>排重后论文：{latestReport.content.deduped_papers ?? 0}</p>
                  <ReportList title="高相关论文" items={latestReport.content.high_relevance ?? []} />
                  <ReportList
                    title="建议深读"
                    items={latestReport.content.suggested_deep_reads ?? []}
                  />
                  <ReportList
                    title="方法启发"
                    items={latestReport.content.method_inspirations ?? []}
                  />
                </>
              ) : (
                <>
                  <p>知识库增长：{latestReport.content.knowledge_growth ?? 0}</p>
                  <p>{latestReport.content.feedback_changes?.summary ?? "暂无反馈变化。"}</p>
                  <ReportList
                    title="高价值论文"
                    items={latestReport.content.high_value_papers ?? []}
                  />
                  <ReportList title="趋势" items={latestReport.content.trends ?? []} />
                  <ReportList
                    title="下周建议"
                    items={latestReport.content.next_week_suggestions ?? []}
                  />
                </>
              )}
            </div>
          ) : (
            <EmptyState text="暂无报告，请先生成日报。" />
          )}
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
    </main>
  );
}

function Toast({ toast }: { toast: NonNullable<ToastState> }) {
  return (
    <div className={`toast ${toast.tone}`} role="status">
      {toast.tone === "success" ? <CheckCircle2 size={16} /> : <CircleSlash2 size={16} />}
      <span>{toast.message}</span>
    </div>
  );
}

function LoadingState({ text }: { text: string }) {
  return (
    <div className="state-line loading">
      <Loader2 className="spin" size={16} />
      {text}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="state-line">{text}</div>;
}

function SummaryItem({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="summary-item">
      <Icon size={17} aria-hidden="true" />
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

function ProfileSummary({ profile }: { profile: ResearchProfile }) {
  const rows = [
    ["研究对象", profile.research_object],
    ["研究方法", profile.methods],
    ["核心材料", profile.materials],
    ["性能指标", profile.metrics],
    ["中文关键词", profile.keywords_zh],
    ["英文关键词", profile.keywords_en],
    ["排除方向", profile.exclusions],
  ];

  return (
    <div className="profile-body">
      {rows.map(([label, values]) => (
        <div className="profile-row" key={label as string}>
          <span>{label as string}</span>
          <div className="chips">
            {(values as string[]).slice(0, 5).map((value, index) => (
              <span className={`chip ${index === 0 ? "strong" : ""}`} key={value}>
                {value}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function RecommendationRow({
  feedback,
  isActive,
  recommendation,
  onFeedback,
  onSelect,
}: {
  feedback?: UserFeedback;
  isActive: boolean;
  recommendation: Recommendation;
  onFeedback: (recommendation: Recommendation, feedbackType: FeedbackType) => void;
  onSelect: () => void;
}) {
  const feedbackText = feedback ? feedbackLabels[feedback.feedback_type as FeedbackType] : "等待反馈";
  const explanation = [
    recommendation.explanation.recommendation_type,
    recommendation.explanation.topic,
    recommendation.explanation.method,
  ].filter(Boolean);

  return (
    <article className={`paper-row ${isActive ? "active" : ""}`} onClick={onSelect}>
      <span className={`paper-dot ${recommendation.channel === "method_transfer" ? "amber" : ""}`} />
      <div>
        <h3 className="paper-title">{recommendation.paper.title}</h3>
        <div className="paper-meta">
          <span>{recommendation.paper.title_zh}</span>
          <span>{recommendation.paper.journal}</span>
          <span>{recommendation.paper.year}</span>
          <span>{recommendation.fulltext_status}</span>
        </div>
        <div className="paper-tags">
          <span className="tag">{channelLabels[recommendation.channel]}</span>
          {explanation.map((item) => (
            <span className="tag" key={item}>
              {item}
            </span>
          ))}
        </div>
      </div>
      <div className="paper-side">
        <div className="relevance">相关度 {Math.round(recommendation.score_total * 100)}%</div>
        <div className="feedback-pill">{feedbackText}</div>
        <div className="paper-actions">
          <button
            className="paper-action"
            aria-label="标记高度相关"
            title="高度相关"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onFeedback(recommendation, "very_relevant");
            }}
          >
            <CheckCircle2 size={15} />
          </button>
          <button
            className="paper-action"
            aria-label="标记方法可借鉴"
            title="方法可借鉴"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onFeedback(recommendation, "method_useful");
            }}
          >
            <Microscope size={15} />
          </button>
          <button
            className="paper-action"
            aria-label="标记不相关"
            title="不相关"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onFeedback(recommendation, "irrelevant");
            }}
          >
            <X size={15} />
          </button>
        </div>
      </div>
    </article>
  );
}

function ReportList({ items, title }: { items: string[]; title: string }) {
  return (
    <>
      <b>{title}</b>
      <ul>
        {items.length === 0 ? <li>暂无</li> : items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </>
  );
}

function Modal({
  children,
  onClose,
  title,
}: {
  children: ReactNode;
  onClose: () => void;
  title: string;
}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-modal="true"
        className="modal"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="panel-header">
          <h2 className="panel-title">{title}</h2>
          <button className="icon-button" aria-label="关闭弹窗" type="button" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  );
}
