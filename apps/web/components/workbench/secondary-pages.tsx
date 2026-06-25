"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Inbox, Library, Loader2, Save } from "lucide-react";

import { api, type KnowledgeItem, type Message, type RadarReport, type ResearchProject } from "../../lib/api";
import { knowledgeStatusLabels } from "./workbench-config";
import { EmptyState } from "./workbench-ui";

export function KnowledgePageView() {
  const [projects, setProjects] = useState<ResearchProject[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [selected, setSelected] = useState<KnowledgeItem | null>(null);
  const [note, setNote] = useState("");
  const [tags, setTags] = useState("");
  const [loading, setLoading] = useState(true);

  const loadProject = useCallback(async (projectId: string) => {
    setLoading(true);
    try {
      const nextItems = await api.knowledge(projectId);
      setItems(nextItems);
      const first = nextItems[0] ?? null;
      setSelected(first);
      setNote(first?.note ?? "");
      setTags(first?.tags.join("，") ?? "");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    async function load() {
      const projectList = await api.projects();
      setProjects(projectList);
      const firstProject = projectList[0] ?? null;
      setActiveProjectId(firstProject?.id ?? null);
      if (firstProject) {
        await loadProject(firstProject.id);
      } else {
        setLoading(false);
      }
    }
    void load();
  }, [loadProject]);

  async function saveSelected() {
    if (!selected) {
      return;
    }
    const updated = await api.updateKnowledge(selected.id, {
      tags: tags
        .split(/[,，\n]/)
        .map((item) => item.trim())
        .filter(Boolean),
      note,
    });
    setSelected(updated);
    setItems((current) => current.map((item) => (item.id === updated.id ? updated : item)));
  }

  return (
    <main className="secondary-page">
      <SecondaryHeader icon={<Library size={20} />} title="知识库" />
      <section className="secondary-layout">
        <aside className="secondary-list">
          <div className="secondary-toolbar">
            {projects.map((project) => (
              <button
                className={`ghost-button small ${project.id === activeProjectId ? "active-soft" : ""}`}
                key={project.id}
                type="button"
                onClick={() => {
                  setActiveProjectId(project.id);
                  void loadProject(project.id);
                }}
              >
                {project.name}
              </button>
            ))}
          </div>
          {loading ? <LoadingLine /> : null}
          {!loading && items.length === 0 ? <EmptyState text="当前项目暂无知识库条目。" /> : null}
          {items.map((item) => (
            <button
              className={`message-row ${selected?.id === item.id ? "active-row" : ""}`}
              key={item.id}
              type="button"
              onClick={() => {
                setSelected(item);
                setNote(item.note ?? "");
                setTags(item.tags.join("，"));
              }}
            >
              <b>{knowledgeStatusLabels[item.status]}</b>
              <span>{item.tags.join("、") || "未设置标签"}</span>
              <em>{item.paper_id}</em>
            </button>
          ))}
        </aside>
        <section className="secondary-detail">
          {selected ? (
            <>
              <p className="eyebrow">KnowledgeItem</p>
              <h2>{selected.paper_id}</h2>
              <label>
                标签
                <input value={tags} onChange={(event) => setTags(event.target.value)} />
              </label>
              <label>
                备注
                <textarea rows={8} value={note} onChange={(event) => setNote(event.target.value)} />
              </label>
              <button className="primary-button fit" type="button" onClick={() => void saveSelected()}>
                <Save size={16} />
                保存
              </button>
            </>
          ) : (
            <EmptyState text="选择左侧知识库条目查看详情。" />
          )}
        </section>
      </section>
    </main>
  );
}

export function ReportsPageView() {
  const [projects, setProjects] = useState<ResearchProject[]>([]);
  const [reports, setReports] = useState<RadarReport[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedReport, setSelectedReport] = useState<RadarReport | null>(null);
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const projectList = await api.projects();
      const firstProject = projectList[0] ?? null;
      const [messageList, reportList] = await Promise.all([
        api.messages(),
        firstProject ? api.reports(firstProject.id) : Promise.resolve([]),
      ]);
      setProjects(projectList);
      setMessages(messageList);
      setReports(reportList);
      setSelectedReport(reportList[0] ?? null);
      setSelectedMessage(messageList[0] ?? null);
      setLoading(false);
    }
    void load();
  }, []);

  return (
    <main className="secondary-page">
      <SecondaryHeader icon={<Inbox size={20} />} title="报告与消息" />
      <section className="secondary-layout">
        <aside className="secondary-list">
          <div className="secondary-toolbar">
            <span className="state-badge">{projects.length ? projects[0].name : "暂无项目"}</span>
          </div>
          {loading ? <LoadingLine /> : null}
          {reports.map((report) => (
            <button
              className={`message-row ${selectedReport?.id === report.id ? "active-row" : ""}`}
              key={report.id}
              type="button"
              onClick={() => {
                setSelectedReport(report);
                setSelectedMessage(null);
              }}
            >
              <b>{report.report_type === "daily" ? "每日科研雷达" : "每周科研周报"}</b>
              <span>{report.period_start} - {report.period_end}</span>
              <em>{report.message_status}</em>
            </button>
          ))}
          {messages.map((message) => (
            <button
              className={`message-row ${selectedMessage?.id === message.id ? "active-row" : ""}`}
              key={message.id}
              type="button"
              onClick={() => {
                setSelectedMessage(message);
                setSelectedReport(null);
              }}
            >
              <b>{message.title}</b>
              <span>{message.body}</span>
              <em>{message.read ? "已读" : "未读"}</em>
            </button>
          ))}
        </aside>
        <section className="secondary-detail">
          {selectedReport ? (
            <>
              <p className="eyebrow">RadarReport</p>
              <h2>{selectedReport.report_type === "daily" ? "每日科研雷达" : "每周科研周报"}</h2>
              <pre>{JSON.stringify(selectedReport.content, null, 2)}</pre>
            </>
          ) : null}
          {selectedMessage ? (
            <>
              <p className="eyebrow">Message</p>
              <h2>{selectedMessage.title}</h2>
              <p>{selectedMessage.body}</p>
              <span className="state-badge">{selectedMessage.read ? "已读" : "未读"}</span>
            </>
          ) : null}
          {!selectedReport && !selectedMessage ? <EmptyState text="选择左侧报告或消息查看详情。" /> : null}
        </section>
      </section>
    </main>
  );
}

function SecondaryHeader({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <header className="secondary-header">
      <Link className="ghost-button small" href="/">
        <ArrowLeft size={15} />
        返回工作台
      </Link>
      <div>
        <p className="eyebrow">二级页面</p>
        <h1>
          {icon}
          {title}
        </h1>
      </div>
    </header>
  );
}

function LoadingLine() {
  return (
    <div className="state-line loading">
      <Loader2 className="spin" size={16} />
      正在加载...
    </div>
  );
}
