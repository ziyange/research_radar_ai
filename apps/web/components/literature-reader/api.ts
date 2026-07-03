/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
const configuredApiBase = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8010/api/v1";

export const API_BASE = normalizeLiteratureApiBase(configuredApiBase);

function normalizeLiteratureApiBase(value) {
  const base = String(value || "").replace(/\/+$/, "");
  if (!base) return "http://127.0.0.1:8010/api/v1/literature";
  return base.endsWith("/literature") ? base : `${base}/literature`;
}

export const defaultScan = {
  query: "",
  count: 5,
  yearFrom: 2021,
  minScore: 70,
  sources: ["openalex", "crossref"],
  downloadOpenPdf: true,
  autoAnalyze: false,
  dailyEnabled: false,
  dailyTime: "09:00",
  dailyTimezone: "Asia/Shanghai",
  notifyAfterRun: false,
  recipientEmails: [],
  ccEmails: [],
  bccEmails: [],
};

async function parseApiResponse(response, fallbackMessage) {
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();
  let data = null;
  if (contentType.includes("json")) {
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new Error("本地 API 返回了无效 JSON");
    }
  } else if (text.trim().startsWith("{") || text.trim().startsWith("[")) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!data) {
    const looksLikeHtml = /<!doctype|<html[\s>]/i.test(text);
    throw new Error(
      looksLikeHtml
        ? "请求打到了页面而不是本地 API。请确认 FastAPI 已启动在 127.0.0.1:8010，并从主前端 http://127.0.0.1:3000 访问。"
        : fallbackMessage,
    );
  }
  if (!response.ok) {
    const message = apiErrorMessage(data, fallbackMessage);
    const error = new Error(message);
    error.retrieval = data.retrieval;
    error.details = data;
    throw error;
  }
  return data;
}

function apiErrorMessage(data, fallbackMessage) {
  const candidates = [data?.message, data?.run?.error, data?.error, data?.detail];
  for (const candidate of candidates) {
    const message = normalizeApiErrorValue(candidate);
    if (message) return message;
  }
  return fallbackMessage;
}

function normalizeApiErrorValue(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map(normalizeApiErrorValue).filter(Boolean).join("；");
  }
  if (typeof value === "object") {
    return (
      normalizeApiErrorValue(value.message) ||
      normalizeApiErrorValue(value.msg) ||
      normalizeApiErrorValue(value.code) ||
      JSON.stringify(value)
    );
  }
  return String(value);
}

export const api = {
  async getLibrary() {
    const response = await fetch(`${API_BASE}/library`);
    return parseApiResponse(response, "无法读取本地文献库");
  },
  async getHealth() {
    const response = await fetch(`${API_BASE}/health`);
    return parseApiResponse(response, "本地服务未就绪");
  },
  async getTasks() {
    const response = await fetch(`${API_BASE}/tasks`);
    return parseApiResponse(response, "无法读取采集任务");
  },
  async getMailStatus() {
    const response = await fetch(`${API_BASE}/mail/status`);
    return parseApiResponse(response, "无法读取邮箱绑定状态");
  },
  async getConfig() {
    const response = await fetch(`${API_BASE}/config`);
    return parseApiResponse(response, "无法读取运行配置");
  },
  async updateConfig(values) {
    const response = await fetch(`${API_BASE}/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values }),
    });
    return parseApiResponse(response, "保存运行配置失败");
  },
  async startMailAuth() {
    const response = await fetch(`${API_BASE}/mail/auth:start`, { method: "POST" });
    return parseApiResponse(response, "启动邮箱授权失败");
  },
  async getMailAuthSession(sessionId) {
    const response = await fetch(`${API_BASE}/mail/auth:sessions/${encodeURIComponent(sessionId)}`);
    return parseApiResponse(response, "读取邮箱授权状态失败");
  },
  async logoutMailAuth() {
    const response = await fetch(`${API_BASE}/mail/auth:logout`, { method: "POST" });
    return parseApiResponse(response, "退出邮箱授权失败");
  },
  async getMailOutbox() {
    const response = await fetch(`${API_BASE}/mail/outbox`);
    return parseApiResponse(response, "无法读取邮件状态");
  },
  async confirmMailDelivery(id) {
    const response = await fetch(`${API_BASE}/mail/deliveries/${encodeURIComponent(id)}:confirm`, { method: "POST" });
    return parseApiResponse(response, "确认发送失败");
  },
  async confirmPendingMailDeliveries() {
    const response = await fetch(`${API_BASE}/mail/deliveries:confirm-pending`, { method: "POST" });
    return parseApiResponse(response, "批量确认发送失败");
  },
  async retryMailDelivery(id) {
    const response = await fetch(`${API_BASE}/mail/deliveries/${encodeURIComponent(id)}:retry`, { method: "POST" });
    return parseApiResponse(response, "重试发送失败");
  },
  async createTask(payload) {
    const response = await fetch(`${API_BASE}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return parseApiResponse(response, "创建任务失败");
  },
  async updateTask(id, payload) {
    const response = await fetch(`${API_BASE}/tasks/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return parseApiResponse(response, "更新任务失败");
  },
  async deleteTask(id) {
    const response = await fetch(`${API_BASE}/tasks/${encodeURIComponent(id)}`, { method: "DELETE" });
    return parseApiResponse(response, "删除任务失败");
  },
  async runTask(id) {
    const response = await fetch(`${API_BASE}/tasks/${encodeURIComponent(id)}:run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    return parseApiResponse(response, "执行任务失败");
  },
  async runTaskAsync(id) {
    const response = await fetch(`${API_BASE}/tasks/${encodeURIComponent(id)}:run-async`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    return parseApiResponse(response, "启动任务失败");
  },
  async getRunJob(id) {
    const response = await fetch(`${API_BASE}/runs/${encodeURIComponent(id)}`);
    return parseApiResponse(response, "读取任务进度失败");
  },
  async scan(payload) {
    const response = await fetch(`${API_BASE}/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return parseApiResponse(response, "采集失败");
  },
  async analyze(payload) {
    const response = await fetch(`${API_BASE}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return parseApiResponse(response, "AI 分析失败");
  },
  async deletePaper(id) {
    const response = await fetch(`${API_BASE}/papers/${encodeURIComponent(id)}`, { method: "DELETE" });
    return parseApiResponse(response, "删除失败");
  },
  async fetchFullText(id) {
    const response = await fetch(`${API_BASE}/papers/${encodeURIComponent(id)}:fetch-fulltext`, { method: "POST" });
    return parseApiResponse(response, "获取全文失败");
  },
  async uploadPdf(id, file) {
    const response = await fetch(`${API_BASE}/papers/${encodeURIComponent(id)}:upload-pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/pdf" },
      body: file,
    });
    return parseApiResponse(response, "上传 PDF 失败");
  },
};
