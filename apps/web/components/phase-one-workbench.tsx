"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

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

type ModalKind = "project" | "profile" | "report" | "quota" | "notice" | null;

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

function asErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "操作失败，请稍后重试。";
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
  const [modal, setModal] = useState<ModalKind>(null);
  const [notice, setNotice] = useState("请选择或新增研究项目，开始 Phase 1 MVP 闭环。");
  const [error, setError] = useState<string | null>(null);
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

  const setBusyKey = useCallback((key: BusyKey, value: boolean) => {
    setBusy((current) => ({ ...current, [key]: value }));
  }, []);

  const runAction = useCallback(
    async (key: BusyKey, action: () => Promise<void>) => {
      setError(null);
      setBusyKey(key, true);
      try {
        await action();
      } catch (actionError) {
        setError(asErrorMessage(actionError));
      } finally {
        setBusyKey(key, false);
      }
    },
    [setBusyKey]
  );

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
      setActiveProjectId(projectList[0]?.id ?? null);
      if (projectList.length === 0) {
        setModal("project");
      }
    });
  }, [runAction]);

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
      setProfile(null);
      setDiagnosis(null);
      setSearchTasks([]);
      setTaskRuns([]);
      setRecommendations([]);
      setFeedbackItems([]);
      setAnalysis(null);
      setKnowledgeItems([]);
      setReports([]);
      setEmailOutbox([]);
      setNotice("项目已创建。下一步输入一句研究方向生成画像。");
      setModal(null);
    });
  }

  async function handleGenerateProfile() {
    if (!activeProject) {
      setNotice("请先新增研究项目。");
      setModal("project");
      return;
    }
    await runAction("profile", async () => {
      const nextProfile = await api.generateProfile(activeProject.id, oneSentence);
      setProfile(nextProfile);
      setDiagnosis(null);
      setNotice("画像草稿已生成，可编辑后确认。");
    });
  }

  async function handleSaveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeProject) {
      return;
    }
    await runAction("profile", async () => {
      const nextProfile = await api.patchProfile(activeProject.id, {
        research_object: splitTags(profileDraft.research_object),
        methods: splitTags(profileDraft.methods),
        materials: splitTags(profileDraft.materials),
        metrics: splitTags(profileDraft.metrics),
        keywords_zh: splitTags(profileDraft.keywords_zh),
        keywords_en: splitTags(profileDraft.keywords_en),
        exclusions: splitTags(profileDraft.exclusions),
      });
      setProfile(nextProfile);
      setNotice("画像已保存为新草稿版本。");
      setModal(null);
    });
  }

  async function handleConfirmProfile() {
    if (!activeProject || !profile) {
      return;
    }
    await runAction("confirm", async () => {
      const confirmed = await api.confirmProfile(activeProject.id);
      const nextDiagnosis = await api.diagnosis(activeProject.id);
      setProfile(confirmed);
      setDiagnosis(nextDiagnosis);
      setRecommendations(nextDiagnosis.highly_related_papers.concat(nextDiagnosis.method_transfer_papers));
      setSelectedRecommendationId(nextDiagnosis.highly_related_papers[0]?.id ?? null);
      setNotice("画像已确认，首日诊断已生成。");
    });
  }

  async function handleSearchLoop() {
    if (!activeProject || profile?.status !== "confirmed") {
      setNotice("请先确认研究画像，再生成检索任务。");
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
      setNotice("检索任务已运行，推荐列表已更新。");
    });
  }

  async function handleRefreshRecommendations() {
    if (!activeProject || profile?.status !== "confirmed") {
      setNotice("请先确认研究画像。");
      return;
    }
    await runAction("recommend", async () => {
      const recList = await api.refreshRecommendations(activeProject.id);
      const savedFeedback = await api.projectFeedback(activeProject.id);
      setRecommendations(recList.items);
      setFeedbackItems(savedFeedback);
      setSelectedRecommendationId(recList.items[0]?.id ?? null);
      setNotice("推荐已刷新，反馈后的分数变化会保留在列表中。");
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
      setNotice(`已提交反馈：${feedbackLabels[feedbackType]}。`);
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
      setNotice(analysisType === "quick" ? "快速分析已完成。" : "标准研读已完成并记录成本。");
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
      setNotice("论文已加入知识库，搜索结果已刷新。");
    });
  }

  async function handleKnowledgeSearch() {
    if (!activeProject) {
      return;
    }
    await runAction("knowledge", async () => {
      const search = await api.searchKnowledge(activeProject.id, knowledgeQuery);
      setKnowledgeItems(search);
      setNotice(search.length > 0 ? "知识库已返回匹配条目。" : "知识库暂无匹配条目。");
    });
  }

  async function handleGenerateReport(reportType: "daily" | "weekly" = "daily") {
    if (!activeProject) {
      return;
    }
    await runAction("report", async () => {
      const report = await api.generateReport(activeProject.id, reportType);
      const [reportList, messageList, outbox] = await Promise.all([
        api.reports(activeProject.id),
        api.messages(),
        api.emailOutbox(),
      ]);
      setReports(reportList);
      setMessages(messageList);
      setEmailOutbox(outbox);
      setModal("report");
      setNotice(
        report.report_type === "daily"
          ? "日报已生成，站内消息和邮件 outbox 已更新。"
          : "周报已生成，站内消息和邮件 outbox 已更新。"
      );
    });
  }

  async function handleReadMessage(message: Message) {
    await runAction("message", async () => {
      const updated = await api.markMessageRead(message.id);
      setMessages((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setNotice("站内消息已标记为已读。");
    });
  }

  async function handleUnsubscribeEmail() {
    await runAction("message", async () => {
      const preference = await api.unsubscribeEmail();
      setEmailPreference(preference);
      setNotice("已退订邮件推送；后续报告仍会生成站内消息。");
    });
  }

  const profileReady = Boolean(profile);
  const profileConfirmed = profile?.status === "confirmed";
  const latestReport = reports[0] ?? null;
  const latestEmail = latestReport
    ? emailOutbox.find((item) => item.report_id === latestReport.id) ?? null
    : emailOutbox[0] ?? null;

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">R</div>
          <div>
            <h1 className="brand-title">研知雷达</h1>
            <p className="brand-subtitle">Research Radar AI</p>
          </div>
        </div>

        <nav className="nav" aria-label="主导航">
          {["工作台", "雷达探索", "论文追踪", "项目管理", "知识库", "消息中心"].map((item) => (
            <button
              className="nav-button"
              key={item}
              type="button"
              onClick={() => {
                setNotice(`${item}已聚焦。本阶段保持在 Phase 1 闭环工作台内完成验收。`);
                setModal("notice");
              }}
            >
              <span className="nav-icon" aria-hidden="true">
                {item.slice(0, 1)}
              </span>
              {item}
            </button>
          ))}
        </nav>

        <section className="project-section">
          <div className="section-label">
            <span>我的项目</span>
            <button
              className="icon-button"
              aria-label="新增项目"
              type="button"
              onClick={() => setModal("project")}
            >
              +
            </button>
          </div>
          <div className="project-list">
            {projects.length === 0 ? (
              <p className="empty-copy">暂无项目，请新增研究项目。</p>
            ) : (
              projects.map((project) => (
                <button
                  className={`project-button ${project.id === activeProjectId ? "active" : ""}`}
                  key={project.id}
                  type="button"
                  onClick={() => {
                    setActiveProjectId(project.id);
                    setNotice(`已切换到项目：${project.name}`);
                  }}
                >
                  <span className="paper-dot" />
                  {project.name}
                  <span className="project-count">{project.status}</span>
                </button>
              ))
            )}
          </div>
        </section>

        <div className="sidebar-spacer" />
        <div className="bottom-nav">
          <button className="nav-button" type="button" onClick={() => setModal("quota")}>
            <span className="nav-icon" aria-hidden="true">
              Q
            </span>
            额度与扩容
          </button>
          <button
            className="nav-button"
            type="button"
            onClick={() => {
              setNotice("Phase 1 暂不进入团队、移动端或完整知识图谱设置。");
              setModal("notice");
            }}
          >
            <span className="nav-icon" aria-hidden="true">
              S
            </span>
            设置
          </button>
        </div>
      </aside>

      <section className="main">
        <header className="topbar">
          <label className="search">
            <span aria-hidden="true">/</span>
            <input
              placeholder="搜索推荐、知识库标签、关键词..."
              value={knowledgeQuery}
              onChange={(event) => setKnowledgeQuery(event.target.value)}
            />
          </label>
          <div className="quota">
            <strong>额度 {quota?.quota_balance ?? "-"}</strong>
            <div className="quota-bar" aria-hidden="true">
              <div className="quota-fill" />
            </div>
            <button className="ghost-button" type="button" onClick={() => setModal("quota")}>
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

        <div className="workspace">
          <div className="primary-stack">
            {error ? <StatusBanner tone="error" text={error} /> : null}
            <StatusBanner tone="info" text={notice} />

            <section className="panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">E2E-001</p>
                  <h2 className="panel-title">冷启动到首日诊断</h2>
                </div>
                <button className="primary-button" type="button" onClick={() => setModal("project")}>
                  新增项目
                </button>
              </div>
              <div className="flow-grid">
                <div className="flow-card">
                  <span className="step-index">1</span>
                  <h3>创建研究项目</h3>
                  <p>{activeProject?.name ?? "尚未创建项目"}</p>
                  <button className="ghost-button" type="button" onClick={() => setModal("project")}>
                    {activeProject ? "新增研究项目" : "创建项目"}
                  </button>
                </div>
                <div className="flow-card">
                  <span className="step-index">2</span>
                  <h3>一句话生成画像</h3>
                  <textarea
                    value={oneSentence}
                    onChange={(event) => setOneSentence(event.target.value)}
                    rows={4}
                  />
                  <button
                    className="primary-button"
                    type="button"
                    disabled={!activeProject || busy.profile}
                    onClick={handleGenerateProfile}
                  >
                    {busy.profile ? "生成中..." : "生成画像草稿"}
                  </button>
                </div>
                <div className="flow-card">
                  <span className="step-index">3</span>
                  <h3>确认画像</h3>
                  <p>
                    {profile
                      ? `v${profile.version} / ${profile.status} / 置信度 ${Math.round(
                          profile.confidence * 100
                        )}%`
                      : "等待画像草稿"}
                  </p>
                  <div className="button-row">
                    <button
                      className="ghost-button"
                      type="button"
                      disabled={!profileReady}
                      onClick={() => setModal("profile")}
                    >
                      编辑画像
                    </button>
                    <button
                      className="primary-button"
                      type="button"
                      disabled={!profileReady || profileConfirmed || busy.confirm}
                      onClick={handleConfirmProfile}
                    >
                      {busy.confirm ? "确认中..." : "确认并生成诊断"}
                    </button>
                  </div>
                </div>
              </div>
              {diagnosis ? (
                <div className="diagnosis-strip">
                  <div>
                    <b>首日诊断</b>
                    <span>{diagnosis.technical_route}</span>
                  </div>
                  <div>
                    <b>研究空白</b>
                    <span>{diagnosis.research_gap_candidate}</span>
                  </div>
                </div>
              ) : (
                <EmptyState text="确认画像后自动生成首日诊断。" />
              )}
            </section>

            <section className="panel recommendations">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">E2E-002</p>
                  <h2 className="panel-title">检索任务、推荐与反馈纠偏</h2>
                </div>
                <div className="button-row">
                  <button
                    className="primary-button"
                    type="button"
                    disabled={!profileConfirmed || busy.search}
                    onClick={handleSearchLoop}
                  >
                    {busy.search ? "运行中..." : "生成检索任务"}
                  </button>
                  <button
                    className="ghost-button"
                    type="button"
                    disabled={!profileConfirmed || busy.recommend}
                    onClick={handleRefreshRecommendations}
                  >
                    获取推荐
                  </button>
                </div>
              </div>
              <div className="task-strip">
                {searchTasks.length === 0 ? (
                  <EmptyState text="确认画像后生成精确、扩展、方法迁移三类检索任务。" />
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
                  <EmptyState text="暂无推荐。请先生成检索任务并获取推荐。" />
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
                      onSelect={() => setSelectedRecommendationId(recommendation.id)}
                    />
                  ))
                )}
              </div>
            </section>
          </div>

          <div className="two-column-stack">
            <section className="panel">
              <div className="panel-header">
                <h2 className="panel-title">我的研究画像</h2>
                <button
                  className="ghost-button"
                  type="button"
                  disabled={!profileReady}
                  onClick={() => setModal("profile")}
                >
                  编辑画像
                </button>
              </div>
              {profile ? <ProfileSummary profile={profile} /> : <EmptyState text="尚未生成画像。" />}
            </section>

            <section className="panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">E2E-003</p>
                  <h2 className="panel-title">AI 研读与知识库沉淀</h2>
                </div>
              </div>
              <div className="profile-body">
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
                        AI 快速分析
                      </button>
                      <button
                        className="ghost-button"
                        type="button"
                        disabled={busy.analysis}
                        onClick={() => handleAnalysis("standard")}
                      >
                        标准研读
                      </button>
                      <button
                        className="ghost-button"
                        type="button"
                        disabled={busy.knowledge}
                        onClick={() => handleAddKnowledge("read_later")}
                      >
                        加入知识库
                      </button>
                      <button
                        className="ghost-button"
                        type="button"
                        disabled={busy.knowledge}
                        onClick={handleKnowledgeSearch}
                      >
                        搜索知识库
                      </button>
                    </div>
                  </>
                ) : (
                  <EmptyState text="选择一条推荐后可触发分析和收藏。" />
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

            <section className="panel">
              <div className="panel-header">
                <h2 className="panel-title">知识库搜索结果</h2>
                <span className="relevance">{knowledgeItems.length} 条</span>
              </div>
              <div className="profile-body">
                {knowledgeItems.length === 0 ? (
                  <EmptyState text="加入论文后可按标题、标签、备注搜索。" />
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

            <section className="panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">E2E-004</p>
                  <h2 className="panel-title">日报/周报、消息与邮件</h2>
                </div>
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => (latestReport ? setModal("report") : handleGenerateReport("daily"))}
                >
                  查看完整报告
                </button>
              </div>
              <div className="profile-body">
                <div className="button-row">
                  <button
                    className="primary-button"
                    type="button"
                    disabled={!activeProject || busy.report}
                    onClick={() => handleGenerateReport("daily")}
                  >
                    生成日报/站内消息
                  </button>
                  <button
                    className="ghost-button"
                    type="button"
                    disabled={!activeProject || busy.report}
                    onClick={() => handleGenerateReport("weekly")}
                  >
                    生成周报
                  </button>
                  <button
                    className="ghost-button"
                    type="button"
                    disabled={emailPreference?.reports_unsubscribed || busy.message}
                    onClick={handleUnsubscribeEmail}
                  >
                    {emailPreference?.reports_unsubscribed ? "邮件已退订" : "退订邮件"}
                  </button>
                </div>
                <div className="compact-row">
                  <b>邮件 outbox</b>
                  <span>
                    {latestEmail
                      ? `${latestEmail.recipient_email} / ${latestEmail.status}`
                      : emailPreference?.reports_unsubscribed
                        ? "已退订，后续不生成邮件任务。"
                        : "暂无邮件任务。"}
                  </span>
                  <span>{latestEmail?.failure_reason ?? "dev/mock 邮件边界"}</span>
                </div>
                {messages.length === 0 ? (
                  <EmptyState text="暂无站内消息。" />
                ) : (
                  messages.slice(0, 3).map((message) => (
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

            <section className="panel">
              <div className="panel-header">
                <h2 className="panel-title">任务与消耗</h2>
                <button className="ghost-button" type="button" onClick={() => setModal("quota")}>
                  去扩容
                </button>
              </div>
              <div className="cost-body">
                <table className="task-table">
                  <thead>
                    <tr>
                      <th>任务</th>
                      <th>状态</th>
                      <th>说明</th>
                    </tr>
                  </thead>
                  <tbody>
                    {taskRuns.length === 0 ? (
                      <tr>
                        <td colSpan={3}>暂无任务运行记录。</td>
                      </tr>
                    ) : (
                      taskRuns.map((task) => (
                        <tr key={task.task_id}>
                          <td>{task.type}</td>
                          <td className={task.status === "succeeded" ? "status-done" : "status-running"}>
                            {task.status}
                          </td>
                          <td>{task.message}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </div>
      </section>

      <button
        className="floating-add"
        aria-label="新增研究项目"
        type="button"
        onClick={() => setModal("project")}
      >
        +
      </button>

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
                {busy.project ? "创建中..." : "创建项目"}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      {modal === "profile" ? (
        <Modal title="编辑研究画像" onClose={() => setModal(null)}>
          <form className="modal-form" onSubmit={handleSaveProfile}>
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
              <button className="primary-button" type="submit" disabled={busy.profile}>
                保存画像
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
                  <b>高相关论文</b>
                  <ul>
                    {(latestReport.content.high_relevance ?? []).map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                  <b>建议深读</b>
                  <ul>
                    {(latestReport.content.suggested_deep_reads ?? []).map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                  <b>方法启发</b>
                  <ul>
                    {(latestReport.content.method_inspirations ?? []).map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </>
              ) : (
                <>
                  <p>知识库增长：{latestReport.content.knowledge_growth ?? 0}</p>
                  <p>{latestReport.content.feedback_changes?.summary ?? "暂无反馈变化。"}</p>
                  <b>高价值论文</b>
                  <ul>
                    {(latestReport.content.high_value_papers ?? []).map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                  <b>趋势</b>
                  <ul>
                    {(latestReport.content.trends ?? []).map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                  <b>下周建议</b>
                  <ul>
                    {(latestReport.content.next_week_suggestions ?? []).map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
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
              付费扩容暂未开放
            </button>
          </div>
        </Modal>
      ) : null}

      {modal === "notice" ? (
        <Modal title="交互说明" onClose={() => setModal(null)}>
          <p className="modal-copy">{notice}</p>
        </Modal>
      ) : null}
    </main>
  );
}

function StatusBanner({ text, tone }: { text: string; tone: "info" | "error" }) {
  return <div className={`status-banner ${tone}`}>{text}</div>;
}

function LoadingState({ text }: { text: string }) {
  return <div className="state-line loading">{text}</div>;
}

function EmptyState({ text }: { text: string }) {
  return <div className="state-line">{text}</div>;
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
            {(values as string[]).map((value, index) => (
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
          {Object.values(recommendation.explanation).map((item) => (
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
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onFeedback(recommendation, "very_relevant");
            }}
          >
            +
          </button>
          <button
            className="paper-action"
            aria-label="标记方法可借鉴"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onFeedback(recommendation, "method_useful");
            }}
          >
            M
          </button>
          <button
            className="paper-action"
            aria-label="标记不相关"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onFeedback(recommendation, "irrelevant");
            }}
          >
            -
          </button>
        </div>
      </div>
    </article>
  );
}

function Modal({
  children,
  onClose,
  title,
}: {
  children: React.ReactNode;
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
            x
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  );
}
