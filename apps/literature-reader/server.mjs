import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const dataDir = path.join(__dirname, "local-data");
const papersDir = path.join(dataDir, "papers");
const downloadsDir = path.join(dataDir, "downloads");
const reportsDir = path.join(dataDir, "reports");
const libraryFile = path.join(dataDir, "library.json");
const tasksFile = path.join(dataDir, "tasks.json");
const port = Number(process.env.LITERATURE_READER_PORT || 4177);

const defaultLibrary = {
  papers: [],
  scanRuns: [],
  reports: [],
};

const defaultTasks = { tasks: [] };

const maxAiConcurrency = Number(process.env.LITERATURE_READER_AI_CONCURRENCY || 3);
let activeAiJobs = 0;
const pendingAiJobs = [];

function enqueueAiJob(work) {
  return new Promise((resolve, reject) => {
    pendingAiJobs.push({ work, resolve, reject });
    runNextAiJob();
  });
}

function runNextAiJob() {
  if (activeAiJobs >= maxAiConcurrency || !pendingAiJobs.length) return;
  const job = pendingAiJobs.shift();
  activeAiJobs += 1;
  Promise.resolve()
    .then(job.work)
    .then(job.resolve, job.reject)
    .finally(() => {
      activeAiJobs -= 1;
      runNextAiJob();
    });
}

function parseEnvFile(content) {
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const value = trimmed
      .slice(index + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

async function loadEnv() {
  for (const candidate of [path.join(rootDir, ".env"), path.join(__dirname, ".env")]) {
    try {
      parseEnvFile(await readFile(candidate, "utf8"));
    } catch {
      // Optional local configuration.
    }
  }
}

async function ensureDataDirs() {
  await mkdir(papersDir, { recursive: true });
  await mkdir(downloadsDir, { recursive: true });
  await mkdir(reportsDir, { recursive: true });
  if (!existsSync(libraryFile)) {
    await writeFile(libraryFile, JSON.stringify(defaultLibrary, null, 2), "utf8");
  }
}

async function readLibrary() {
  await ensureDataDirs();
  try {
    return { ...defaultLibrary, ...JSON.parse(await readFile(libraryFile, "utf8")) };
  } catch {
    return { ...defaultLibrary };
  }
}

async function saveLibrary(library) {
  await ensureDataDirs();
  await writeFile(libraryFile, JSON.stringify(library, null, 2), "utf8");
}

async function readTasks() {
  await ensureDataDirs();
  try {
    return { ...defaultTasks, ...JSON.parse(await readFile(tasksFile, "utf8")) };
  } catch {
    return { ...defaultTasks };
  }
}

async function saveTasks(tasks) {
  await ensureDataDirs();
  await writeFile(tasksFile, JSON.stringify(tasks, null, 2), "utf8");
}

async function removeLocalAsset(localPath) {
  if (!localPath) return;
  const target = path.resolve(__dirname, localPath);
  if (!target.startsWith(dataDir)) return;
  await rm(target, { force: true });
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  });
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function slug(value) {
  return String(value || "paper")
    .toLowerCase()
    .replace(/https?:\/\//g, "")
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

function compactTitle(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/<[^>]*>/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function stablePaperId(paper) {
  const key = (paper.doi || compactTitle(paper.title)).toLowerCase();
  return `paper_${createHash("sha1").update(key).digest("hex").slice(0, 14)}`;
}

function abstractFromOpenAlex(value) {
  if (!value) return "";
  const words = [];
  for (const [word, positions] of Object.entries(value)) {
    for (const position of positions) words.push([position, word]);
  }
  return words
    .sort((a, b) => a[0] - b[0])
    .map((item) => item[1])
    .join(" ");
}

function parseYear(dateParts, publishedPrint, publishedOnline) {
  const parts = dateParts || publishedOnline?.["date-parts"] || publishedPrint?.["date-parts"];
  return Number(parts?.[0]?.[0]) || null;
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeOpenAlex(work) {
  const primary = work.primary_location || {};
  const best = work.best_oa_location || {};
  const source = primary.source || {};
  const openAccess = work.open_access || {};
  const doi = work.doi ? work.doi.replace(/^https:\/\/doi.org\//i, "") : null;
  const locations = (work.locations || []).slice(0, 10);
  const pdfCandidates = uniqueStrings([
    primary.pdf_url,
    best.pdf_url,
    openAccess.oa_url,
    ...locations.map((item) => item.pdf_url),
  ]);
  const landingCandidates = uniqueStrings([
    primary.landing_page_url,
    best.landing_page_url,
    work.doi,
    work.id,
    ...locations.map((item) => item.landing_page_url),
  ]);
  const paper = {
    id: "",
    title: work.display_name || "",
    doi,
    year: work.publication_year || null,
    journal: source.display_name || "OpenAlex",
    authors: (work.authorships || [])
      .slice(0, 10)
      .map((item) => item.author?.display_name)
      .filter(Boolean),
    abstract: abstractFromOpenAlex(work.abstract_inverted_index),
    keywords: (work.concepts || []).slice(0, 10).map((item) => item.display_name).filter(Boolean),
    source: "OpenAlex",
    sourceUrl: work.id,
    landingPageUrl: landingCandidates[0] || work.doi || work.id,
    pdfUrl: pdfCandidates[0] || null,
    pdfCandidates,
    landingCandidates,
    openAccess: Boolean(openAccess.is_oa || pdfCandidates.length),
    citedByCount: work.cited_by_count || 0,
    rawScore: 0,
  };
  paper.id = stablePaperId(paper);
  return paper;
}

function normalizeCrossref(item) {
  const title = item.title?.[0] || "";
  const links = Array.isArray(item.link) ? item.link : [];
  const pdfCandidates = uniqueStrings(
    links
      .filter((link) => String(link["content-type"] || "").includes("pdf") || String(link.URL || "").toLowerCase().includes(".pdf"))
      .map((link) => link.URL),
  );
  const paper = {
    id: "",
    title,
    doi: item.DOI || null,
    year: parseYear(item.issued?.["date-parts"], item["published-print"], item["published-online"]),
    journal: item["container-title"]?.[0] || "Crossref",
    authors: (item.author || [])
      .slice(0, 10)
      .map((author) => [author.given, author.family].filter(Boolean).join(" "))
      .filter(Boolean),
    abstract: stripHtml(item.abstract || ""),
    keywords: item.subject || [],
    source: "Crossref",
    sourceUrl: item.URL || (item.DOI ? `https://doi.org/${item.DOI}` : ""),
    landingPageUrl: item.URL || (item.DOI ? `https://doi.org/${item.DOI}` : ""),
    pdfUrl: pdfCandidates[0] || null,
    pdfCandidates,
    landingCandidates: uniqueStrings([item.URL, item.DOI ? `https://doi.org/${item.DOI}` : ""]),
    openAccess: Boolean(pdfCandidates.length),
    citedByCount: item["is-referenced-by-count"] || 0,
    rawScore: 0,
  };
  paper.id = stablePaperId(paper);
  return paper;
}

function queryTerms(query) {
  const stopwords = new Set([
    "and",
    "or",
    "not",
    "the",
    "with",
    "for",
    "from",
    "into",
    "under",
    "using",
    "use",
    "study",
    "studies",
    "research",
  ]);
  return String(query || "")
    .toLowerCase()
    .replace(/\b(and|or|not)\b/gi, " ")
    .split(/[,\s，、;；()"'`]+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2 && !stopwords.has(term));
}

function scorePaper(paper, query, yearFrom) {
  const terms = queryTerms(query);
  const text = `${paper.title} ${paper.abstract} ${paper.keywords.join(" ")}`.toLowerCase();
  const termHits = terms.filter((term) => text.includes(term)).length;
  const coverage = terms.length ? termHits / terms.length : 0;
  const recency = paper.year && yearFrom ? Math.max(0, Math.min(20, paper.year - yearFrom + 1)) : 0;
  const citations = Math.min(30, Math.log10((paper.citedByCount || 0) + 1) * 10);
  const access = paper.openAccess ? 12 : 0;
  const abstract = paper.abstract ? 10 : 0;
  const doi = paper.doi ? 5 : 0;
  const phraseBonus = query && text.includes(query.toLowerCase()) ? 12 : 0;
  return Math.round((termHits * 14 + coverage * 20 + phraseBonus + recency + citations + access + abstract + doi) * 10) / 10;
}

function isRelevantEnough(paper, query) {
  const terms = queryTerms(query);
  if (!terms.length) return true;
  const text = `${paper.title} ${paper.abstract} ${paper.keywords.join(" ")}`.toLowerCase();
  const hits = terms.filter((term) => text.includes(term)).length;
  if (terms.length === 1) return hits >= 1;
  return hits >= Math.min(2, terms.length);
}

function hasCjk(value) {
  return /[\u3400-\u9fff]/.test(String(value || ""));
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const normalized = String(value || "").trim().replace(/\s+/g, " ");
    if (!normalized || seen.has(normalized.toLowerCase())) continue;
    seen.add(normalized.toLowerCase());
    result.push(normalized);
  }
  return result;
}

function fallbackQueryExpansion(query) {
  const glossary = [
    [/纳米材料|纳米颗粒|纳米粒子/g, "nanomaterials nanoparticles"],
    [/植物|植株|作物/g, "plants crops"],
    [/水稻|稻/g, "rice"],
    [/土壤/g, "soil"],
    [/抗旱|干旱/g, "drought stress"],
    [/吸收|转运/g, "uptake translocation"],
    [/毒性|生态毒性/g, "toxicity ecotoxicity"],
    [/微生物|根系微生物/g, "rhizosphere microbiome"],
  ];
  let translated = query;
  for (const [pattern, replacement] of glossary) translated = translated.replace(pattern, ` ${replacement} `);
  translated = translated.replace(/[，、；;]/g, " ").replace(/\s+/g, " ").trim();

  const expansions = [query, translated];
  if (/nanomaterials|nanoparticles/i.test(translated) && /plants|crops|rice|soil/i.test(translated)) {
    expansions.push(
      "nanomaterials plant uptake translocation",
      "engineered nanoparticles plant stress",
      "nanoparticles rhizosphere soil plant",
      "nanomaterials crop growth toxicity",
    );
  }
  return uniqueStrings(expansions).slice(0, 6).map((item, index) => ({
    query: item,
    source: index === 0 ? "user" : "fallback-expansion",
  }));
}

async function expandResearchQueries(query) {
  const fallback = fallbackQueryExpansion(query);
  const ai = aiConfigured();
  if (!ai.configured || process.env.LITERATURE_READER_SCAN_AI_EXPAND === "false") return fallback;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    const response = await fetch(`${process.env.OPENAI_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL,
        temperature: 0.1,
        enable_thinking: false,
        messages: [
          {
            role: "system",
            content:
              "你是科研检索规划器。只输出 JSON object，不要 Markdown。字段 queries 为字符串数组，最多 6 个英文检索式。不要编造论文，只改写研究方向为开放学术数据库适合的检索词。",
          },
          {
            role: "user",
            content: `研究方向：${query}\n要求：覆盖同义词、英文术语、机制词和应用词。返回 JSON，例如 {"queries":["..."]}`,
          },
        ],
      }),
    });
    clearTimeout(timer);
    if (!response.ok) return fallback;
    const payload = await response.json();
    const content = payload.choices?.[0]?.message?.content || "";
    const match = content.match(/\{[\s\S]*\}/);
    const parsed = match ? JSON.parse(match[0]) : JSON.parse(content);
    const aiQueries = Array.isArray(parsed.queries) ? parsed.queries : [];
    return uniqueStrings([query, ...aiQueries, ...fallback.map((item) => item.query)])
      .slice(0, 6)
      .map((item, index) => ({ query: item, source: index === 0 ? "user" : "ai-expansion" }));
  } catch {
    return fallback;
  }
}

function candidateMatchesAnyQuery(paper, queries) {
  return queries.some((item) => isRelevantEnough(paper, item.query));
}

async function fetchOpenAlex(query, yearFrom, limit) {
  const perPage = Math.min(200, Math.max(50, limit));
  const items = [];
  let cursor = "*";
  for (let page = 0; page < 4 && items.length < limit && cursor; page += 1) {
    const params = new URLSearchParams({
      search: query,
      "per-page": String(perPage),
      cursor,
      sort: "relevance_score:desc",
    });
    if (yearFrom) params.set("filter", `from_publication_date:${yearFrom}-01-01`);
    const response = await fetch(`https://api.openalex.org/works?${params.toString()}`, {
      headers: { "User-Agent": "ResearchRadarAI-LiteratureReader/0.1" },
    });
    if (!response.ok) throw new Error(`OpenAlex ${response.status}`);
    const payload = await response.json();
    items.push(...(payload.results || []).map(normalizeOpenAlex));
    cursor = payload.meta?.next_cursor || "";
  }
  return items.slice(0, limit);
}

async function fetchCrossref(query, yearFrom, limit) {
  const rows = Math.min(100, Math.max(50, limit));
  const items = [];
  for (let offset = 0; offset < 400 && items.length < limit; offset += rows) {
    const params = new URLSearchParams({
      query,
      rows: String(rows),
      offset: String(offset),
      sort: "relevance",
      order: "desc",
    });
    if (yearFrom) params.set("filter", `from-pub-date:${yearFrom}-01-01`);
    const response = await fetch(`https://api.crossref.org/works?${params.toString()}`, {
      headers: { "User-Agent": "ResearchRadarAI-LiteratureReader/0.1 (mailto:dev@example.com)" },
    });
    if (!response.ok) throw new Error(`Crossref ${response.status}`);
    const payload = await response.json();
    const pageItems = payload.message?.items || [];
    items.push(...pageItems.map(normalizeCrossref));
    if (pageItems.length < rows) break;
  }
  return items.slice(0, limit);
}

function dedupePapers(existing, candidates) {
  const seen = new Set();
  for (const paper of existing) {
    if (paper.doi) seen.add(`doi:${paper.doi.toLowerCase()}`);
    seen.add(`title:${compactTitle(paper.title)}`);
  }
  const unique = [];
  const duplicates = [];
  for (const paper of candidates) {
    const keys = [
      paper.doi ? `doi:${paper.doi.toLowerCase()}` : null,
      `title:${compactTitle(paper.title)}`,
    ].filter(Boolean);
    if (keys.some((key) => seen.has(key))) {
      duplicates.push({ title: paper.title, doi: paper.doi, source: paper.source });
      continue;
    }
    for (const key of keys) seen.add(key);
    unique.push(paper);
  }
  return { unique, duplicates };
}

function paperMarkdown(paper) {
  return [
    `# ${paper.title}`,
    "",
    `- DOI: ${paper.doi || "未提供"}`,
    `- 年份: ${paper.year || "未知"}`,
    `- 期刊: ${paper.journal || "未知"}`,
    `- 来源: ${paper.source}`,
    `- 开放获取: ${paper.openAccess ? "是" : "否"}`,
    `- DOI/来源链接: ${paper.landingPageUrl || paper.sourceUrl || "无"}`,
    `- 本地 PDF: ${paper.localPdfPath || "未下载"}`,
    "",
    "## Authors",
    "",
    paper.authors?.length ? paper.authors.map((author) => `- ${author}`).join("\n") : "- 未提供",
    "",
    "## Keywords",
    "",
    paper.keywords?.length ? paper.keywords.map((keyword) => `- ${keyword}`).join("\n") : "- 未提供",
    "",
    "## Abstract",
    "",
    paper.abstract || "未获取到摘要。",
    "",
    "## Local Notes",
    "",
    "该 Markdown 由本地采集器生成，供 AI 从本地文献资产进行分析。",
    "",
  ].join("\n");
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractReadableHtml(html) {
  const withoutNoise = String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ");
  const candidates = [
    ...withoutNoise.matchAll(/<article[\s\S]*?<\/article>/gi),
    ...withoutNoise.matchAll(/<main[\s\S]*?<\/main>/gi),
    ...withoutNoise.matchAll(/<section[^>]+(?:article|content|main|body)[^>]*>[\s\S]*?<\/section>/gi),
  ].map((match) => match[0]);
  const source = candidates.sort((a, b) => b.length - a.length)[0] || withoutNoise;
  return decodeEntities(
    source
      .replace(/<\/(p|h1|h2|h3|h4|li|div|section)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );
}

function isBlockedOrErrorPage(html) {
  const text = String(html || "").toLowerCase();
  return (
    text.includes("cloudflare_error") ||
    text.includes("there was a problem providing the content you requested") ||
    text.includes("just a moment") ||
    text.includes("access denied") ||
    text.includes("captcha") ||
    text.includes("tdm-reservation")
  );
}

function absoluteUrl(value, baseUrl) {
  if (!value) return "";
  try {
    return new URL(decodeEntities(value), baseUrl).toString();
  } catch {
    return "";
  }
}

function discoverRedirectUrls(html, baseUrl) {
  const urls = [];
  const source = String(html || "");
  for (const match of source.matchAll(/http-equiv=["']?refresh["']?[^>]+content=["'][^"']*url=([^"']+)["']/gi)) {
    urls.push(absoluteUrl(match[1], baseUrl));
  }
  for (const match of source.matchAll(/name=["']redirectURL["'][^>]+value=["']([^"']+)["']/gi)) {
    urls.push(absoluteUrl(decodeURIComponent(match[1]), baseUrl));
  }
  for (const match of source.matchAll(/href=["']([^"']+)["']/gi)) {
    const url = absoluteUrl(match[1], baseUrl);
    if (/\/science\/article\/pii\/|\/article\//i.test(url)) urls.push(url);
  }
  return uniqueStrings(urls);
}

function fullTextMarkdown(paper, text, url) {
  return [
    `# ${paper.title}`,
    "",
    `- DOI: ${paper.doi || "未提供"}`,
    `- 年份: ${paper.year || "未知"}`,
    `- 期刊: ${paper.journal || "未知"}`,
    `- 正文来源: ${url}`,
    `- 获取方式: 公开网页正文抽取`,
    "",
    "## Full Text",
    "",
    text,
    "",
  ].join("\n");
}

function publicFileUrl(localPath) {
  return localPath ? `/local-data/${localPath.replace(/^local-data\//, "")}` : "";
}

function serializeLibrary(library) {
  return {
    ...library,
    papers: (library.papers || []).map((paper) => ({
      ...paper,
      localMarkdownUrl: publicFileUrl(paper.localMarkdownPath),
      localPdfUrl: publicFileUrl(paper.localPdfPath),
      localFullTextUrl: publicFileUrl(paper.localFullTextPath),
    })),
    reports: (library.reports || []).map((report) => ({
      ...report,
      markdownUrl: publicFileUrl(report.markdownPath),
    })),
  };
}

async function downloadPdf(paper) {
  if (!paper.pdfUrl) return null;
  return downloadPdfFromUrl(paper, paper.pdfUrl);
}

async function downloadPdfFromUrl(paper, pdfUrl) {
  if (!pdfUrl) return null;
  try {
    const response = await fetch(pdfUrl, {
      redirect: "follow",
      headers: { "User-Agent": "ResearchRadarAI-LiteratureReader/0.1" },
    });
    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    const isPdf = buffer.subarray(0, 4).toString("utf8") === "%PDF";
    if (!isPdf) return null;
    const fileName = `${paper.id}.pdf`;
    const target = path.join(downloadsDir, fileName);
    await writeFile(target, buffer);
    return path.relative(__dirname, target).replace(/\\/g, "/");
  } catch {
    return null;
  }
}

async function fetchCrossrefWorkByDoi(doi) {
  if (!doi) return {};
  try {
    const response = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
      headers: { "User-Agent": "ResearchRadarAI-LiteratureReader/0.1 (mailto:configured-locally)" },
    });
    if (!response.ok) return {};
    const item = (await response.json()).message;
    if (!item) return {};
    return normalizeCrossref(item);
  } catch {
    return {};
  }
}

async function fetchUnpaywallByDoi(doi) {
  const email = process.env.UNPAYWALL_EMAIL;
  if (!doi || !email) return {};
  try {
    const response = await fetch(`https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(email)}`);
    if (!response.ok) return {};
    const item = await response.json();
    const locations = [item.best_oa_location, ...(item.oa_locations || [])].filter(Boolean);
    const pdfCandidates = uniqueStrings(locations.map((location) => location.url_for_pdf));
    const landingCandidates = uniqueStrings(locations.map((location) => location.url).concat(item.doi_url));
    return {
      pdfCandidates,
      landingCandidates,
      pdfUrl: pdfCandidates[0] || "",
      landingPageUrl: landingCandidates[0] || "",
      openAccess: Boolean(item.is_oa || pdfCandidates.length || landingCandidates.length),
    };
  } catch {
    return {};
  }
}

function mergePaperLinks(paper, ...sources) {
  const pdfCandidates = uniqueStrings([
    paper.pdfUrl,
    ...(paper.pdfCandidates || []),
    ...sources.flatMap((source) => [source.pdfUrl, ...(source.pdfCandidates || [])]),
  ]);
  const landingCandidates = uniqueStrings([
    paper.landingPageUrl,
    paper.sourceUrl,
    paper.doi ? `https://doi.org/${paper.doi}` : "",
    ...(paper.landingCandidates || []),
    ...sources.flatMap((source) => [source.landingPageUrl, source.sourceUrl, ...(source.landingCandidates || [])]),
  ]);
  return {
    ...paper,
    pdfUrl: pdfCandidates[0] || paper.pdfUrl || null,
    pdfCandidates,
    landingPageUrl: landingCandidates[0] || paper.landingPageUrl || paper.sourceUrl || "",
    landingCandidates,
    openAccess: Boolean(paper.openAccess || sources.some((source) => source.openAccess) || pdfCandidates.length),
  };
}

async function refreshOpenAccessLinks(paper) {
  const [crossref, unpaywall] = await Promise.all([
    fetchCrossrefWorkByDoi(paper.doi),
    fetchUnpaywallByDoi(paper.doi),
  ]);
  return mergePaperLinks(paper, crossref, unpaywall);
}

async function downloadBestAvailablePdf(paper) {
  const candidates = uniqueStrings([paper.pdfUrl, ...(paper.pdfCandidates || [])]);
  for (const url of candidates) {
    const localPath = await downloadPdfFromUrl(paper, url);
    if (localPath) return { localPath, url };
  }
  return { localPath: null, url: "" };
}

async function fetchOpenFullText(paper) {
  const queue = uniqueStrings([
    paper.doi ? `https://doi.org/${paper.doi}` : "",
    paper.landingPageUrl,
    paper.sourceUrl,
    ...(paper.landingCandidates || []),
  ]);
  const visited = new Set();
  for (let index = 0; index < queue.length && index < 12; index += 1) {
    const url = queue[index];
    if (!url || visited.has(url)) continue;
    visited.add(url);
    try {
      const response = await fetch(url, {
        redirect: "follow",
        headers: {
          "User-Agent": "Mozilla/5.0 ResearchRadarAI-LiteratureReader/0.1",
          Accept: "text/html,application/xhtml+xml",
        },
      });
      if (!response.ok) continue;
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("html")) continue;
      const html = await response.text();
      for (const discovered of discoverRedirectUrls(html, url)) {
        if (!visited.has(discovered)) queue.push(discovered);
      }
      if (isBlockedOrErrorPage(html)) continue;
      const text = extractReadableHtml(html);
      if (text.length < 3000) continue;
      const target = path.join(papersDir, `${slug(paper.title || paper.id)}-${paper.id}-fulltext.md`);
      await writeFile(target, fullTextMarkdown(paper, text, url), "utf8");
      return path.relative(__dirname, target).replace(/\\/g, "/");
    } catch {
      // Public full text extraction is opportunistic.
    }
  }
  return null;
}

async function refreshPaperReadableAssets(paper) {
  const linked = await refreshOpenAccessLinks(paper);
  const pdf = await downloadBestAvailablePdf(linked);
  if (pdf.localPath) {
    return {
      paper: { ...linked, pdfUrl: pdf.url || linked.pdfUrl, localPdfPath: pdf.localPath },
      method: "pdf",
    };
  }
  const localFullTextPath = await fetchOpenFullText(linked);
  if (localFullTextPath) {
    return {
      paper: { ...linked, localFullTextPath },
      method: "html-fulltext",
    };
  }
  return { paper: linked, method: "" };
}

async function savePaperAsset(paper, downloadOpenPdf) {
  const enriched = { ...paper };
  if (downloadOpenPdf && paper.openAccess) {
    const refreshed = await refreshPaperReadableAssets(enriched);
    Object.assign(enriched, refreshed.paper);
  }
  if (!enriched.localPdfPath && paper.openAccess) {
    enriched.localFullTextPath = await fetchOpenFullText(enriched);
  }
  const markdownName = `${slug(enriched.title || enriched.id)}-${enriched.id}.md`;
  const markdownPath = path.join(papersDir, markdownName);
  await writeFile(markdownPath, paperMarkdown(enriched), "utf8");
  enriched.localMarkdownPath = path.relative(__dirname, markdownPath).replace(/\\/g, "/");
  enriched.savedAt = new Date().toISOString();
  return enriched;
}

async function handleScan(request, response) {
  const body = request._body || await readJson(request);
  const taskId = request._taskId || body.taskId || null;
  const query = String(body.query || "").trim();
  const count = Math.max(1, Math.min(20, Number(body.count || 5)));
  const yearFrom = body.yearFrom ? Number(body.yearFrom) : null;
  const minScore = body.minScore ? Number(body.minScore) : 0;
  const sources = Array.isArray(body.sources) && body.sources.length ? body.sources : ["openalex", "crossref"];
  if (!query) return sendJson(response, 400, { error: "QUERY_REQUIRED" });

  const queryPlan = await expandResearchQueries(query);
  const fetchLimitPerQuery = Math.max(120, count * 30);
  const sourceStatuses = [];
  const fetchJobs = [];
  for (const planned of queryPlan) {
    for (const source of sources) {
      fetchJobs.push({ source, planned });
    }
  }
  const batches = await Promise.all(
    fetchJobs.map(async ({ source, planned }) => {
      try {
        const items =
          source === "crossref"
            ? await fetchCrossref(planned.query, yearFrom, fetchLimitPerQuery)
            : await fetchOpenAlex(planned.query, yearFrom, fetchLimitPerQuery);
        sourceStatuses.push({
          source,
          query: planned.query,
          querySource: planned.source,
          status: "succeeded",
          count: items.length,
        });
        return items.map((paper) => ({
          ...paper,
          matchedQuery: planned.query,
          querySource: planned.source,
          rawScore: Math.max(scorePaper(paper, query, yearFrom), scorePaper(paper, planned.query, yearFrom)),
        }));
      } catch (error) {
        sourceStatuses.push({
          source,
          query: planned.query,
          querySource: planned.source,
          status: "failed",
          error: String(error.message || error),
        });
        return [];
      }
    })
  );

  const library = await readLibrary();
  const candidates = batches
    .flat()
    .sort((a, b) => b.rawScore - a.rawScore)
    .filter((paper) => paper.title && paper.rawScore >= minScore && candidateMatchesAnyQuery(paper, queryPlan));
  const { unique, duplicates } = dedupePapers(library.papers, candidates);
  const selected = unique
    .sort((a, b) => b.rawScore - a.rawScore)
    .slice(0, count);
  const saved = [];
  for (const paper of selected) saved.push(await savePaperAsset(paper, body.downloadOpenPdf !== false));

  const run = {
    id: `scan_${randomUUID()}`,
    taskId,
    query,
    count,
    yearFrom,
    minScore,
    sources,
    queryPlan,
    fetchLimitPerQuery,
    sourceStatuses,
    candidateCount: candidates.length,
    uniqueCount: unique.length,
    duplicateCount: duplicates.length,
    duplicateTitles: duplicates.slice(0, 12).map((item) => item.title),
    savedPaperIds: saved.map((p) => p.id),
    savedCount: saved.length,
    targetMet: saved.length >= count,
    exhaustedReason:
      saved.length >= count
        ? ""
        : unique.length === 0
          ? "没有找到满足评分、时间和去重条件的新文献"
          : "满足条件的新文献少于目标篇数",
    createdAt: new Date().toISOString(),
  };
  library.papers = [...saved, ...library.papers];
  library.scanRuns = [run, ...(library.scanRuns || [])].slice(0, 30);
  await saveLibrary(library);
  sendJson(response, 200, { run, papers: saved, duplicates, library: serializeLibrary(library) });
}

function aiConfigured() {
  const configured = Boolean(
    process.env.OPENAI_API_KEY && process.env.OPENAI_BASE_URL && process.env.OPENAI_MODEL
  );
  return {
    provider:
      process.env.LITERATURE_READER_AI_PROVIDER ||
      (configured ? "openai-compatible" : process.env.AI_PROVIDER || "mock"),
    model: process.env.OPENAI_MODEL || "",
    configured,
    baseUrlHost: process.env.OPENAI_BASE_URL ? new URL(process.env.OPENAI_BASE_URL).host : "",
  };
}

async function callAiForMarkdown(papers, scanContext) {
  const config = aiConfigured();
  if (!config.configured) {
    throw new Error("AI_PROVIDER_CONFIG_MISSING: set OPENAI_BASE_URL, OPENAI_MODEL and OPENAI_API_KEY");
  }
  const sections = [];
  for (const [index, paper] of papers.entries()) {
    sections.push(await callAiForSinglePaperMarkdown(paper, scanContext, index + 1));
  }
  const isSinglePaper = papers.length === 1;
  return [
    `# ${isSinglePaper ? papers[0].title : scanContext.query || "本地文献"} AI 阅读报告`,
    "",
    `- 生成时间: ${new Date().toISOString()}`,
    `- 模型: ${process.env.OPENAI_MODEL}`,
    `- 文献数量: ${papers.length}`,
    `- 数据来源: 本地已保存 Markdown/元数据`,
    isSinglePaper ? `- 对应文献: ${papers[0].title}` : "",
    "",
    isSinglePaper ? "## 单篇阅读路径" : "## 阅读顺序建议",
    "",
    ...(isSinglePaper
      ? [
          "1. 先读中文标题翻译与摘要完整翻译，确认主题是否命中。",
          "2. 再读论文重点内容深度分析，理解研究对象、方法路线、结果与限制。",
          "3. 最后读证据 claims、阅读关注点和下一步检索建议，决定是否进入原文/PDF精读。",
        ]
      : papers.map(
          (paper, index) =>
            `${index + 1}. ${paper.title} (${paper.year || "未知年份"}, ${paper.journal || paper.source})`
        )),
    "",
    ...sections,
    "",
    "## 下一步检索建议",
    "",
    "- 回到原文核验方法、图表、实验条件、统计显著性和补充材料。",
    "- 对开放全文论文优先下载 PDF 并补充全文级分析。",
    "- 针对匹配方向继续扩展同材料体系、同方法路线、同指标结果和关键机制文献。",
  ].join("\n");
}

async function callAiForSinglePaperMarkdown(paper, scanContext, index) {
  const prompt = [
    "你是严谨的科研文献分析助手。请输出 Markdown，不要输出 JSON。",
    "任务：基于本地已保存的单篇论文元数据和摘要，生成该论文的中文科研阅读分析。",
    "必须包含这些二级标题：研究主题、文献信息总表、核心逻辑流程图、中文标题翻译、摘要完整翻译、论文重点内容深度分析、实验/方法拆解、结果与证据、局限与不可追溯点、文献匹配方向、可借鉴的点、研究人员阅读关注点、事实 claims 与证据、精读问题清单、下一步检索建议。",
    "文献信息总表必须用 Markdown 表格呈现，至少包含：标题、作者、年份、期刊、研究背景、研究目的、研究方法、研究结论、证据范围。",
    "核心逻辑流程图必须用 Mermaid flowchart 代码块呈现，格式为 ```mermaid 开头，展示 背景/问题 -> 目的 -> 方法 -> 结果 -> 结论 -> 可借鉴点；如果证据不足，用“待原文核验”节点标出。",
    "论文重点内容深度分析至少覆盖：研究问题、材料/对象、方法路线、关键变量、评价指标、主要发现、机制解释、创新点、可复用方法、潜在风险。",
    "研究人员阅读关注点至少覆盖：是否值得下载全文、哪些图表/实验条件最值得核验、与当前方向的直接相关性、可迁移方法、可能补充的对照实验。",
    "如果没有全文或本地 PDF，只能说明基于摘要/元数据，不得声称阅读了正文、图表、实验数据、统计结果或补充材料；不得用常识补全作者没有提供的实验细节。",
    "所有结论必须标明证据范围：摘要可追溯、元数据可追溯、需回到原文核验、AI 推测。证据不足时宁可写“不足以判断”。",
    "文献匹配方向要按：研究对象/材料、方法/技术路线、指标/结果、机制、应用场景、发表时间、证据类型、开放全文可得性、排除条件冲突、研究空白/方法迁移价值。",
    `检索上下文：${JSON.stringify(scanContext, null, 2)}`,
    `论文序号：${index}`,
    `本地论文：${JSON.stringify(paper, null, 2)}`,
  ].join("\n\n");
  const payload = await postOpenAiCompatibleJson({
    model: process.env.OPENAI_MODEL,
    temperature: 0.2,
    enable_thinking: false,
    max_tokens: 5200,
    messages: [
      { role: "system", content: "你只输出 Markdown 小节正文，不输出解释。" },
      { role: "user", content: prompt },
    ],
  });
  return payload.choices?.[0]?.message?.content || "";
}

function postOpenAiCompatibleJson(payload) {
  const python =
    process.env.PYTHON ||
    (existsSync(path.join(rootDir, ".venv", "Scripts", "python.exe"))
      ? path.join(rootDir, ".venv", "Scripts", "python.exe")
      : "python");
  const script = `
import json
import os
import sys
import time
import httpx

payload = json.loads(sys.stdin.buffer.read().decode("utf-8"))
url = os.environ["OPENAI_BASE_URL"].rstrip("/") + "/chat/completions"
headers = {
    "Authorization": "Bearer " + os.environ["OPENAI_API_KEY"],
    "Content-Type": "application/json",
}
def clean(value):
    if isinstance(value, str):
        return value.encode("utf-8", "replace").decode("utf-8")
    if isinstance(value, list):
        return [clean(item) for item in value]
    if isinstance(value, dict):
        return {str(key): clean(item) for key, item in value.items()}
    return value

payload = clean(payload)
last_error = None
with httpx.Client(timeout=180.0) as client:
    for attempt in range(3):
        try:
            response = client.post(url, headers=headers, json=payload)
            response.raise_for_status()
            sys.stdout.buffer.write(json.dumps(response.json(), ensure_ascii=False).encode("utf-8"))
            break
        except (httpx.HTTPError, httpx.RemoteProtocolError) as exc:
            last_error = exc
            if attempt == 2:
                raise
            time.sleep(2 + attempt * 2)
`;
  return new Promise((resolve, reject) => {
    const child = spawn(python, ["-c", script], {
      cwd: rootDir,
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
      windowsHide: true,
    });
    const stdout = [];
    const stderr = [];
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("AI_REQUEST_TIMEOUT"));
    }, 190000);
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const out = Buffer.concat(stdout).toString("utf8");
      const err = Buffer.concat(stderr).toString("utf8");
      if (code !== 0) {
        reject(new Error(`AI_REQUEST_FAILED: ${err.slice(0, 2000) || out.slice(0, 2000)}`));
        return;
      }
      try {
        resolve(JSON.parse(out));
      } catch (error) {
        reject(new Error(`AI_RESPONSE_NOT_JSON: ${error.message}; ${out.slice(0, 300)}`));
      }
    });
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

async function handleAnalyze(request, response) {
  const body = await readJson(request);
  const library = await readLibrary();
  const selectedIds = Array.isArray(body.paperIds) ? new Set(body.paperIds) : null;
  const papers = library.papers
    .filter((paper) => !selectedIds || selectedIds.has(paper.id))
    .slice(0, Number(body.limit || 5));
  if (!papers.length) return sendJson(response, 400, { error: "NO_LOCAL_PAPERS" });

  try {
    const markdown = await enqueueAiJob(() => callAiForMarkdown(papers, {
      query: body.query || library.scanRuns?.[0]?.query || "",
      generatedFrom: "local-library",
      paperCount: papers.length,
    }));
    const report = {
      id: `report_${randomUUID()}`,
      title: body.title || `${body.query || "本地文献"} AI 阅读报告`,
      paperIds: papers.map((paper) => paper.id),
      model: process.env.OPENAI_MODEL,
      createdAt: new Date().toISOString(),
      markdownPath: "",
      markdown,
    };
    const reportPath = path.join(reportsDir, `${slug(report.title)}-${report.id}.md`);
    await writeFile(reportPath, markdown, "utf8");
    report.markdownPath = path.relative(__dirname, reportPath).replace(/\\/g, "/");
    const latestLibrary = await readLibrary();
    latestLibrary.reports = [report, ...(latestLibrary.reports || [])].slice(0, 30);
    await saveLibrary(latestLibrary);
    sendJson(response, 200, {
      report: { ...report, markdownUrl: publicFileUrl(report.markdownPath) },
      library: serializeLibrary(latestLibrary),
    });
  } catch (error) {
    sendJson(response, 503, { error: "AI_ANALYSIS_FAILED", message: String(error.message || error) });
  }
}

async function handleListTasks(response) {
  const tasks = await readTasks();
  sendJson(response, 200, tasks);
}

async function handleCreateTask(request, response) {
  const body = await readJson(request);
  const query = String(body.query || "").trim();
  if (!query) return sendJson(response, 400, { error: "QUERY_REQUIRED" });
  const now = new Date().toISOString();
  const task = {
    id: `task_${randomUUID()}`,
    query,
    count: Math.max(1, Math.min(20, Number(body.count || 5))),
    yearFrom: body.yearFrom ? Number(body.yearFrom) : null,
    minScore: body.minScore ? Number(body.minScore) : 0,
    sources: Array.isArray(body.sources) && body.sources.length ? body.sources : ["openalex", "crossref"],
    downloadOpenPdf: body.downloadOpenPdf !== false,
    autoAnalyze: Boolean(body.autoAnalyze),
    createdAt: now,
    updatedAt: now,
  };
  const tasks = await readTasks();
  tasks.tasks.push(task);
  await saveTasks(tasks);
  sendJson(response, 201, task);
}

async function handleUpdateTask(id, request, response) {
  const body = await readJson(request);
  const tasks = await readTasks();
  const index = tasks.tasks.findIndex((t) => t.id === id);
  if (index < 0) return sendJson(response, 404, { error: "TASK_NOT_FOUND" });
  const query = String(body.query || "").trim();
  if (!query) return sendJson(response, 400, { error: "QUERY_REQUIRED" });
  tasks.tasks[index] = {
    ...tasks.tasks[index],
    query,
    count: body.count !== undefined ? Math.max(1, Math.min(20, Number(body.count))) : tasks.tasks[index].count,
    yearFrom: body.yearFrom !== undefined ? (body.yearFrom ? Number(body.yearFrom) : null) : tasks.tasks[index].yearFrom,
    minScore: body.minScore !== undefined ? (body.minScore ? Number(body.minScore) : 0) : tasks.tasks[index].minScore,
    sources: Array.isArray(body.sources) && body.sources.length ? body.sources : tasks.tasks[index].sources,
    downloadOpenPdf: body.downloadOpenPdf !== undefined ? body.downloadOpenPdf !== false : tasks.tasks[index].downloadOpenPdf,
    autoAnalyze: body.autoAnalyze !== undefined ? Boolean(body.autoAnalyze) : tasks.tasks[index].autoAnalyze,
    updatedAt: new Date().toISOString(),
  };
  await saveTasks(tasks);
  sendJson(response, 200, tasks.tasks[index]);
}

async function handleDeleteTask(id, response) {
  const tasks = await readTasks();
  const index = tasks.tasks.findIndex((t) => t.id === id);
  if (index < 0) return sendJson(response, 404, { error: "TASK_NOT_FOUND" });
  tasks.tasks.splice(index, 1);
  await saveTasks(tasks);
  sendJson(response, 200, { deleted: id });
}

async function handleRunTask(id, request, response) {
  const tasks = await readTasks();
  const task = tasks.tasks.find((t) => t.id === id);
  if (!task) return sendJson(response, 404, { error: "TASK_NOT_FOUND" });
  const body = await readJson(request);
  const merged = {
    ...task,
    ...(body.sources ? { sources: body.sources } : {}),
    ...(body.yearFrom !== undefined ? { yearFrom: body.yearFrom } : {}),
    ...(body.minScore !== undefined ? { minScore: body.minScore } : {}),
  };
  handleScan({
    ...request,
    _taskId: task.id,
    _body: merged,
  }, response);
}

async function handleDeletePaper(id, response) {
  const library = await readLibrary();
  const paper = library.papers.find((item) => item.id === id);
  if (!paper) return sendJson(response, 404, { error: "PAPER_NOT_FOUND" });

  library.papers = library.papers.filter((item) => item.id !== id);
  const removedReports = [];
  library.reports = (library.reports || [])
    .map((report) => {
      const paperIds = (report.paperIds || []).filter((paperId) => paperId !== id);
      return { ...report, paperIds };
    })
    .filter((report) => {
      const keep = (report.paperIds || []).length > 0;
      if (!keep) removedReports.push(report);
      return keep;
    });

  await removeLocalAsset(paper.localMarkdownPath);
  await removeLocalAsset(paper.localPdfPath);
  await removeLocalAsset(paper.localFullTextPath);
  await Promise.all(removedReports.map((report) => removeLocalAsset(report.markdownPath)));
  await saveLibrary(library);
  return sendJson(response, 200, { deleted: id, library: serializeLibrary(library) });
}

async function handleFetchFullText(id, response) {
  const library = await readLibrary();
  const index = library.papers.findIndex((item) => item.id === id);
  if (index < 0) return sendJson(response, 404, { error: "PAPER_NOT_FOUND" });
  const paper = library.papers[index];
  if (paper.localPdfPath) {
    return sendJson(response, 200, { paper, library: serializeLibrary(library), reused: true });
  }
  const refreshed = await refreshPaperReadableAssets(paper);
  if (!refreshed.paper.localPdfPath && !refreshed.paper.localFullTextPath) {
    return sendJson(response, 404, {
      error: "FULL_TEXT_NOT_AVAILABLE",
      message: "已访问 DOI/来源页，但未发现可合法下载的 PDF 或足够长度的公开正文",
    });
  }
  library.papers[index] = refreshed.paper;
  await saveLibrary(library);
  return sendJson(response, 200, {
    paper: library.papers[index],
    library: serializeLibrary(library),
    reused: false,
    method: refreshed.method,
  });
}

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const relative = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const distRoot = path.join(__dirname, "dist");
  const target = path.resolve(distRoot, relative);
  if (!target.startsWith(distRoot)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  try {
    const content = await readFile(target);
    const ext = path.extname(target);
    const type =
      ext === ".js"
        ? "text/javascript"
        : ext === ".css"
          ? "text/css"
          : ext === ".html"
            ? "text/html; charset=utf-8"
            : "application/octet-stream";
    response.writeHead(200, { "Content-Type": type });
    response.end(content);
  } catch {
    const fallback = await readFile(path.join(distRoot, "index.html"));
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(fallback);
  }
}

async function serveLocalData(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const relative = decodeURIComponent(url.pathname.replace(/^\/local-data\//, ""));
  const target = path.resolve(dataDir, relative);
  if (!target.startsWith(dataDir)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  try {
    const content = await readFile(target);
    const ext = path.extname(target).toLowerCase();
    const type =
      ext === ".pdf"
        ? "application/pdf"
        : ext === ".md"
          ? "text/markdown; charset=utf-8"
          : "application/octet-stream";
    response.writeHead(200, {
      "Content-Type": type,
      "Content-Disposition": "inline",
    });
    response.end(content);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}

async function route(request, response) {
  if (request.method === "OPTIONS") return sendJson(response, 204, {});
  const url = new URL(request.url, `http://${request.headers.host}`);
  try {
    if (url.pathname === "/api/health") {
      return sendJson(response, 200, {
        ok: true,
        dataDir,
        ai: aiConfigured(),
        sources: ["OpenAlex", "Crossref"],
      });
    }
    if (url.pathname === "/api/library" && request.method === "GET") {
      return sendJson(response, 200, serializeLibrary(await readLibrary()));
    }
    if (url.pathname === "/api/scan" && request.method === "POST") {
      return await handleScan(request, response);
    }
    if (url.pathname.startsWith("/api/papers/") && request.method === "DELETE") {
      return await handleDeletePaper(decodeURIComponent(url.pathname.split("/").pop()), response);
    }
    if (url.pathname.startsWith("/api/papers/") && url.pathname.endsWith("/fetch-fulltext") && request.method === "POST") {
      const id = decodeURIComponent(url.pathname.split("/").at(-2));
      return await handleFetchFullText(id, response);
    }
    if (url.pathname === "/api/analyze" && request.method === "POST") {
      return await handleAnalyze(request, response);
    }
    if (url.pathname === "/api/tasks" && request.method === "GET") {
      return await handleListTasks(response);
    }
    if (url.pathname === "/api/tasks" && request.method === "POST") {
      return await handleCreateTask(request, response);
    }
    if (url.pathname.startsWith("/api/tasks/") && request.method === "PUT") {
      return await handleUpdateTask(decodeURIComponent(url.pathname.split("/").pop()), request, response);
    }
    if (url.pathname.startsWith("/api/tasks/") && url.pathname.endsWith("/run") && request.method === "POST") {
      const id = decodeURIComponent(url.pathname.split("/").at(-2));
      return await handleRunTask(id, request, response);
    }
    if (url.pathname.startsWith("/api/tasks/") && request.method === "DELETE") {
      return await handleDeleteTask(decodeURIComponent(url.pathname.split("/").pop()), response);
    }
    if (url.pathname.startsWith("/api/reports/") && request.method === "GET") {
      const id = url.pathname.split("/").pop();
      const library = await readLibrary();
      const report = library.reports.find((item) => item.id === id);
      return report ? sendJson(response, 200, report) : sendJson(response, 404, { error: "REPORT_NOT_FOUND" });
    }
    if (url.pathname.startsWith("/local-data/") && request.method === "GET") {
      return await serveLocalData(request, response);
    }
    return await serveStatic(request, response);
  } catch (error) {
    return sendJson(response, 500, { error: "SERVER_ERROR", message: String(error.message || error) });
  }
}

await loadEnv();
await ensureDataDirs();
createServer(route).listen(port, "127.0.0.1", () => {
  console.log(`Literature reader running at http://127.0.0.1:${port}`);
  console.log(`Local data: ${dataDir}`);
});
