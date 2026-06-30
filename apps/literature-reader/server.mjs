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
const mailOutboxDir = path.join(dataDir, "mail-outbox");
const libraryFile = path.join(dataDir, "library.json");
const tasksFile = path.join(dataDir, "tasks.json");
const port = Number(process.env.LITERATURE_READER_PORT || 4177);

const defaultLibrary = {
  papers: [],
  scanRuns: [],
  reports: [],
  mailDeliveries: [],
};

const defaultTasks = { tasks: [] };

const maxAiConcurrency = Number(process.env.LITERATURE_READER_AI_CONCURRENCY || 3);
let activeAiJobs = 0;
const pendingAiJobs = [];
const activeTaskRuns = new Set();
let mailAuthSession = null;

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
  await mkdir(mailOutboxDir, { recursive: true });
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
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  });
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

async function readBinary(request, maxBytes = 80 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) {
      const error = new Error("FILE_TOO_LARGE");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
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

function normalizeDoi(value) {
  return String(value || "")
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .trim()
    || null;
}

function doiUrl(value) {
  const doi = normalizeDoi(value);
  return doi ? `https://doi.org/${doi}` : "";
}

function isLikelyPdfUrl(value) {
  const url = String(value || "").toLowerCase();
  return Boolean(url) && !url.includes("doi.org/") && (url.includes(".pdf") || url.includes("/pdf") || url.includes("pdfdownload") || url.includes("pdfft"));
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
  const doi = normalizeDoi(work.doi);
  const locations = (work.locations || []).slice(0, 10);
  const pdfCandidates = uniqueStrings([
    primary.pdf_url,
    best.pdf_url,
    ...locations.map((item) => item.pdf_url),
  ].filter(isLikelyPdfUrl));
  const landingCandidates = uniqueStrings([
    primary.landing_page_url,
    best.landing_page_url,
    openAccess.oa_url,
    doiUrl(doi),
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
    landingPageUrl: landingCandidates[0] || doiUrl(doi) || work.id,
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
  const doi = normalizeDoi(item.DOI);
  const paper = {
    id: "",
    title,
    doi,
    year: parseYear(item.issued?.["date-parts"], item["published-print"], item["published-online"]),
    journal: item["container-title"]?.[0] || "Crossref",
    authors: (item.author || [])
      .slice(0, 10)
      .map((author) => [author.given, author.family].filter(Boolean).join(" "))
      .filter(Boolean),
    abstract: stripHtml(item.abstract || ""),
    keywords: item.subject || [],
    source: "Crossref",
    sourceUrl: item.URL || doiUrl(doi),
    landingPageUrl: item.URL || doiUrl(doi),
    pdfUrl: pdfCandidates[0] || null,
    pdfCandidates,
    landingCandidates: uniqueStrings([item.URL, doiUrl(doi)]),
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
  const link = paper.landingPageUrl || paper.sourceUrl || doiUrl(paper.doi);
  return [
    `# ${paper.title}`,
    "",
    `- DOI: ${paper.doi || "未提供"}`,
    `- 年份: ${paper.year || "未知"}`,
    `- 期刊: ${paper.journal || "未知"}`,
    `- 来源: ${paper.source}`,
    `- 开放获取: ${paper.openAccess ? "是" : "否"}`,
    `- DOI/来源链接: ${link || "无"}`,
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

function cleanInlineText(value) {
  return decodeEntities(
    String(value || "")
      .replace(/<sup[\s\S]*?<\/sup>/gi, (match) => ` ${stripHtml(match)} `)
      .replace(/<sub[\s\S]*?<\/sub>/gi, (match) => stripHtml(match))
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t\r\f\v]+/g, " ")
      .replace(/\n\s+/g, "\n")
      .trim(),
  );
}

function markdownTableFromHtml(tableHtml) {
  if (/class=["'][^"']*\bdisp-formula\b/i.test(tableHtml)) {
    const formula = cleanInlineText(tableHtml.match(/<td[^>]+class=["'][^"']*\bformula\b[^"']*>\s*([\s\S]*?)<\/td>/i)?.[1] || "");
    const label = cleanInlineText(tableHtml.match(/<td[^>]+class=["'][^"']*\blabel\b[^"']*>\s*([\s\S]*?)<\/td>/i)?.[1] || "");
    return formula ? `> 公式${label ? ` ${label}` : ""}: ${formula}` : "";
  }
  const caption = cleanInlineText(tableHtml.match(/<caption[\s\S]*?<\/caption>/i)?.[0] || "");
  const rows = [...String(tableHtml || "").matchAll(/<tr[\s\S]*?<\/tr>/gi)]
    .map((rowMatch) =>
      [...rowMatch[0].matchAll(/<(th|td)[^>]*>([\s\S]*?)<\/\1>/gi)].map((cell) =>
        cleanInlineText(cell[2]).replace(/\|/g, "\\|"),
      ),
    )
    .filter((row) => row.length);
  if (!rows.length) return "";
  const width = Math.max(...rows.map((row) => row.length));
  const normalized = rows.map((row) => [...row, ...Array(Math.max(0, width - row.length)).fill("")]);
  const header = normalized[0];
  const body = normalized.slice(1);
  return [
    caption ? `**${caption}**` : "",
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...body.map((row) => `| ${row.join(" | ")} |`),
  ].filter(Boolean).join("\n");
}

function selectArticleContentHtml(html) {
  const source = String(html || "");
  const bodyMatch = source.match(/<section[^>]+class=["'][^"']*\bbody\b[^"']*\bmain-article-body\b[^"']*["'][^>]*>/i);
  if (bodyMatch?.index !== undefined) {
    const start = bodyMatch.index;
    const endMarkers = [
      source.indexOf('<section id="_ad', start),
      source.indexOf('<section class="associated-data', start),
      source.indexOf('<div class="actions', start),
      source.indexOf("</article>", start),
    ].filter((index) => index > start);
    const end = endMarkers.length ? Math.min(...endMarkers) : source.length;
    return source.slice(start, end);
  }
  const article = source.match(/<article[\s\S]*?<\/article>/i);
  if (article) return article[0];
  const main = source.match(/<main[\s\S]*?<\/main>/i);
  return main ? main[0] : source;
}

function figureMarkdownFromHtml(figureHtml, baseUrl) {
  const label = cleanInlineText(
    figureHtml.match(/<h[1-6][^>]+class=["'][^"']*\bobj_head\b[^"']*["'][^>]*>([\s\S]*?)<\/h[1-6]>/i)?.[1] ||
      figureHtml.match(/title=["']([^"']+)["']/i)?.[1] ||
      "",
  );
  const imgMatch = figureHtml.match(/<img[^>]+>/i)?.[0] || "";
  const src = absoluteUrl(imgMatch.match(/\ssrc=["']([^"']+)["']/i)?.[1] || "", baseUrl);
  const alt = cleanInlineText(imgMatch.match(/\salt=["']([^"']*)["']/i)?.[1] || label || "figure");
  const caption = cleanInlineText(
    figureHtml.match(/<figcaption[\s\S]*?<\/figcaption>/i)?.[0] ||
      figureHtml.match(/<div[^>]+class=["'][^"']*\bcaption\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[0] ||
      "",
  );
  return [
    label ? `**${label}**` : "",
    src ? `![${alt}](${src})` : "",
    caption ? `> 图表说明：${caption}` : "",
  ].filter(Boolean).join("\n");
}

function htmlToStructuredMarkdown(html, baseUrl) {
  const withoutNoise = String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<aside[\s\S]*?<\/aside>/gi, " ")
    .replace(/<button[\s\S]*?<\/button>/gi, " ");
  let source = selectArticleContentHtml(withoutNoise);
  const figureBlocks = [];
  source = source.replace(/<figure[\s\S]*?<\/figure>/gi, (match) => {
    const markdown = figureMarkdownFromHtml(match, baseUrl);
    if (!markdown) return " ";
    const token = `\n\n@@RR_FIGURE_${figureBlocks.length}@@\n\n`;
    figureBlocks.push(markdown);
    return token;
  });
  const tableBlocks = [];
  source = source.replace(/<table[\s\S]*?<\/table>/gi, (match) => {
    const markdown = markdownTableFromHtml(match);
    if (!markdown) return " ";
    const token = `\n\n@@RR_TABLE_${tableBlocks.length}@@\n\n`;
    tableBlocks.push(markdown);
    return token;
  });

  source = source
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, text) => `\n\n# ${cleanInlineText(text)}\n\n`)
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, text) => `\n\n## ${cleanInlineText(text)}\n\n`)
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, text) => `\n\n### ${cleanInlineText(text)}\n\n`)
    .replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (_, text) => `\n\n#### ${cleanInlineText(text)}\n\n`)
    .replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, (_, text) => `\n\n##### ${cleanInlineText(text)}\n\n`)
    .replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, (_, text) => `\n\n###### ${cleanInlineText(text)}\n\n`)
    .replace(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/gi, (_, text) => `\n\n> 图表说明：${cleanInlineText(text)}\n\n`)
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, text) => `\n- ${cleanInlineText(text)}\n`)
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, text) => `\n\n${cleanInlineText(text)}\n\n`)
    .replace(/<br\s*\/?>/gi, "\n");

  let markdown = decodeEntities(
    source
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );
  markdown = markdown.replace(/@@RR_FIGURE_(\d+)@@/g, (_, index) => figureBlocks[Number(index)] || "");
  markdown = markdown.replace(/@@RR_TABLE_(\d+)@@/g, (_, index) => tableBlocks[Number(index)] || "");
  markdown = markdown
    .replace(new RegExp(`\\(${baseUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)`, "g"), "")
    .split(/\r?\n/)
    .filter((line) => !/^(Open in a new tab|Find articles by|Author information|Article notes|Copyright and License information|PMC Copyright notice)$/i.test(line.trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return markdown;
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

function discoverPdfUrls(html, baseUrl) {
  const urls = [];
  const source = String(html || "");
  for (const match of source.matchAll(/href=["']([^"']*pdf[^"']*)["']/gi)) {
    urls.push(absoluteUrl(match[1], baseUrl));
  }
  for (const match of source.matchAll(/name=["']citation_pdf_url["'][^>]+content=["']([^"']+)["']/gi)) {
    urls.push(absoluteUrl(match[1], baseUrl));
  }
  return uniqueStrings(urls).filter(isLikelyPdfUrl);
}

function fullTextMarkdown(paper, text, url) {
  return [
    `# ${paper.title}`,
    "",
    `- DOI: ${paper.doi || "未提供"}`,
    `- 年份: ${paper.year || "未知"}`,
    `- 期刊: ${paper.journal || "未知"}`,
    `- 正文来源: ${url}`,
    `- 获取方式: 公开网页正文抽取 + 结构化 Markdown 转换`,
    "",
    "## Full Text",
    "",
    text,
    "",
  ].join("\n");
}

async function polishFullTextMarkdownLayout(markdown, paper) {
  if (!aiConfigured().configured || process.env.LITERATURE_READER_AI_POLISH_FULLTEXT === "false") return markdown;
  try {
    const chunks = splitMarkdownForAiPolish(markdown);
    const polished = [];
    for (const chunk of chunks) {
      const payload = await postOpenAiCompatibleJson({
        model: process.env.OPENAI_MODEL,
        temperature: 0,
        enable_thinking: false,
        max_tokens: 9000,
        messages: [
          {
            role: "system",
            content:
              "你是论文 HTML 转 Markdown 的版式清理器。只能整理标题层级、段落换行、列表、表格和图表说明。禁止总结、改写科研结论、删除正文事实、添加新内容。只输出清理后的 Markdown。",
          },
          {
            role: "user",
            content: `论文题名：${paper.title}\n\n下面是全文 Markdown 的一个连续分块。请只清理版式，保留原始内容、数据、公式、表格和引用编号：\n\n${chunk}`,
          },
        ],
      });
      const content = payload.choices?.[0]?.message?.content?.trim();
      polished.push(content && content.length > chunk.length * 0.55 ? content : chunk);
    }
    const result = polished.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
    return result.length > markdown.length * 0.65 ? result : markdown;
  } catch {
    return markdown;
  }
}

function splitMarkdownForAiPolish(markdown) {
  const chunks = [];
  let current = "";
  for (const line of String(markdown || "").split(/\r?\n/)) {
    const next = current ? `${current}\n${line}` : line;
    if (/^#{1,3}\s+/.test(line) && current.length > 5000) {
      chunks.push(current.trim());
      current = line;
    } else if (next.length > 11000) {
      chunks.push(current.trim());
      current = line;
    } else {
      current = next;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

function publicFileUrl(localPath) {
  return localPath ? `/local-data/${localPath.replace(/^local-data\//, "")}` : "";
}

function localPathFromReaderRoot(target) {
  return path.relative(__dirname, target).replace(/\\/g, "/");
}

function shortForMail(value, max = 72) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function agentMailCliPath() {
  if (process.env.AGENT_MAIL_CLI) return process.env.AGENT_MAIL_CLI;
  const appData = process.env.APPDATA;
  if (appData) {
    const bundled = path.join(
      appData,
      "npm",
      "node_modules",
      "@tencent-qqmail",
      "agently-cli-win32-x64",
      "bin",
      "agently-cli.exe"
    );
    if (existsSync(bundled)) return bundled;
  }
  return "agently-cli";
}

function agentMailEnabled() {
  return process.env.AGENT_MAIL_ENABLED !== "false";
}

function serializeLibrary(library) {
  return {
    ...library,
    papers: (library.papers || []).map((paper) => ({
      ...normalizeStoredPaper(paper),
      localMarkdownUrl: publicFileUrl(paper.localMarkdownPath),
      localPdfUrl: publicFileUrl(paper.localPdfPath),
      localFullTextUrl: publicFileUrl(paper.localFullTextPath),
    })),
    reports: (library.reports || []).map((report) => ({
      ...report,
      markdownUrl: publicFileUrl(report.markdownPath),
    })),
    mailDeliveries: (library.mailDeliveries || []).map((delivery) => ({
      ...delivery,
      markdownUrl: publicFileUrl(delivery.markdownPath),
      confirmationToken: delivery.confirmationToken ? "ctk_***" : "",
    })),
  };
}

function runAgentMailCli(args, options = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(agentMailCliPath(), args, {
        cwd: options.cwd || __dirname,
        env: { ...process.env },
        windowsHide: true,
      });
    } catch (error) {
      resolve({ code: -1, stdout: "", stderr: String(error.message || error) });
      return;
    }
    const stdout = [];
    const stderr = [];
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({ code: -1, stdout: Buffer.concat(stdout).toString("utf8"), stderr: "AGENT_MAIL_TIMEOUT" });
    }, options.timeoutMs || 30000);
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout: "", stderr: String(error.message || error) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

function parseCliJson(output) {
  const trimmed = String(output || "").trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function extractConfirmation(output) {
  const text = String(output || "");
  const json = parseCliJson(text);
  const token = text.match(/ctk_[A-Za-z0-9_-]+/)?.[0] || "";
  return {
    token:
      token ||
      json?.confirmation_token ||
      json?.confirmationToken ||
      json?.data?.confirmation_token ||
      json?.data?.confirmationToken ||
      "",
    summary: json?.summary || json?.data?.summary || text.slice(0, 1200),
  };
}

async function getAgentMailStatus() {
  const cli = agentMailCliPath();
  const installed = cli !== "agently-cli" ? existsSync(cli) : true;
  if (!installed) {
    return {
      enabled: agentMailEnabled(),
      installed: false,
      authorized: false,
      email: "",
      sendCapable: false,
      cli,
      message: "Agent Mail CLI 未安装",
    };
  }
  const result = await runAgentMailCli(["+me"], { timeoutMs: 12000 });
  const json = parseCliJson(result.stdout);
  const primary = json?.data?.aliases?.find((alias) => alias.is_primary) || json?.data?.aliases?.[0];
  return {
    enabled: agentMailEnabled(),
    installed: true,
    authorized: Boolean(result.code === 0 && primary?.email),
    email: primary?.email || "",
    sendCapable: Boolean(result.code === 0 && primary?.email),
    cli,
    message: result.code === 0 ? "ok" : (result.stderr || result.stdout || "Agent Mail 未授权"),
  };
}

function deliverySubject(kind, paper, task) {
  const prefix = kind === "analysis_report" ? "AI 分析" : kind === "paper_fulltext" ? "完整文献" : "测试邮件";
  return `[研知雷达] ${prefix} · ${shortForMail(paper?.title || task?.query || "Agent Mail")}`;
}

function buildPaperDeliveryMarkdown({ paper, task, run }) {
  return [
    `# ${paper.title}`,
    "",
    "| 字段 | 内容 |",
    "| --- | --- |",
    `| 研究方向 | ${task?.query || run?.query || ""} |`,
    `| DOI | ${paper.doi || "未提供"} |`,
    `| 年份 | ${paper.year || "未知"} |`,
    `| 期刊 | ${paper.journal || paper.source || "未知"} |`,
    `| 来源 | ${paper.source || "未知"} |`,
    `| 匹配评分 | ${Math.round(paper.rawScore || 0)} |`,
    `| 开放获取 | ${paper.openAccess ? "是" : "未知或受限"} |`,
    `| 本地 PDF | ${paper.localPdfPath || "未下载"} |`,
    `| 本地 Markdown | ${paper.localFullTextPath || paper.localMarkdownPath || "未保存"} |`,
    "",
    "## 作者",
    "",
    (paper.authors || []).length ? (paper.authors || []).map((author) => `- ${author}`).join("\n") : "未提供",
    "",
    "## 关键词",
    "",
    (paper.keywords || []).length ? (paper.keywords || []).map((keyword) => `- ${keyword}`).join("\n") : "未提供",
    "",
    "## 摘要",
    "",
    paper.abstract || "未提供摘要。",
    "",
    "## 文件与链接",
    "",
    `- DOI/来源链接: ${doiUrl(paper.doi) || paper.landingPageUrl || paper.sourceUrl || "未提供"}`,
    `- 在线 PDF: ${paper.pdfUrl || "未提供"}`,
    `- 本地 PDF: ${paper.localPdfPath || "未下载"}`,
    `- 本地 Markdown: ${paper.localFullTextPath || paper.localMarkdownPath || "未保存"}`,
  ].join("\n");
}

async function addMailDelivery({ kind, task, run, paper, report, markdown }) {
  const id = `mail_${randomUUID()}`;
  const subject = deliverySubject(kind, paper, task);
  const body = markdown || report?.markdown || buildPaperDeliveryMarkdown({ paper, task, run });
  const filePath = path.join(mailOutboxDir, `${slug(subject)}-${id}.md`);
  await writeFile(filePath, body, "utf8");
  const delivery = {
    id,
    kind,
    taskId: task?.id || run?.taskId || null,
    runId: run?.id || null,
    paperId: paper?.id || null,
    reportId: report?.id || null,
    recipient: "",
    subject,
    markdownPath: localPathFromReaderRoot(filePath),
    status: "queued",
    confirmationToken: "",
    confirmationSummary: "",
    error: agentMailEnabled() ? "" : "AGENT_MAIL_DISABLED",
    createdAt: new Date().toISOString(),
    sentAt: "",
  };
  let library = await readLibrary();
  library.mailDeliveries = [delivery, ...(library.mailDeliveries || [])].slice(0, 300);
  await saveLibrary(library);
  if (agentMailEnabled()) {
    library = await attemptMailDelivery(id);
  }
  return { delivery: (library.mailDeliveries || []).find((item) => item.id === id) || delivery, library };
}

async function attemptMailDelivery(id, confirmationToken = "") {
  const library = await readLibrary();
  const index = (library.mailDeliveries || []).findIndex((item) => item.id === id);
  if (index < 0) return library;
  const delivery = library.mailDeliveries[index];
  const status = await getAgentMailStatus();
  if (!status.enabled) {
    library.mailDeliveries[index] = { ...delivery, status: "queued", error: "AGENT_MAIL_DISABLED" };
    await saveLibrary(library);
    return library;
  }
  if (!status.installed || !status.authorized || !status.sendCapable) {
    library.mailDeliveries[index] = { ...delivery, status: "failed", error: status.message || "AGENT_MAIL_NOT_READY" };
    await saveLibrary(library);
    return library;
  }
  const recipient = process.env.AGENT_MAIL_RECIPIENT || status.email;
  const args = [
    "message",
    "+send",
    "--to",
    recipient,
    "--subject",
    delivery.subject,
    "--body-file",
    delivery.markdownPath,
  ];
  if (confirmationToken) args.push("--confirmation-token", confirmationToken);
  library.mailDeliveries[index] = { ...delivery, status: "sending", recipient, error: "" };
  await saveLibrary(library);
  const result = await runAgentMailCli(args, { timeoutMs: 45000 });
  const output = `${result.stdout}\n${result.stderr}`.trim();
  const confirmation = extractConfirmation(output);
  const json = parseCliJson(output);
  const updated = await readLibrary();
  const latestIndex = (updated.mailDeliveries || []).findIndex((item) => item.id === id);
  if (latestIndex < 0) return updated;
  const latest = updated.mailDeliveries[latestIndex];
  if (result.code === 0 && !confirmation.token) {
    updated.mailDeliveries[latestIndex] = {
      ...latest,
      status: "sent",
      recipient,
      sentAt: new Date().toISOString(),
      error: "",
      providerMessageId: json?.data?.message_id || json?.message_id || "",
    };
  } else if (confirmation.token) {
    updated.mailDeliveries[latestIndex] = {
      ...latest,
      status: "pending_confirmation",
      recipient,
      confirmationToken: confirmation.token,
      confirmationSummary: confirmation.summary,
      error: "AGENT_MAIL_CONFIRMATION_REQUIRED",
    };
  } else {
    updated.mailDeliveries[latestIndex] = {
      ...latest,
      status: "failed",
      recipient,
      error: output || `AGENT_MAIL_EXIT_${result.code}`,
    };
  }
  await saveLibrary(updated);
  return updated;
}

async function startAgentMailAuth() {
  if (mailAuthSession?.status === "running" && mailAuthSession.url) {
    return mailAuthSession;
  }
  const session = {
    id: `mail_auth_${randomUUID()}`,
    status: "running",
    url: "",
    output: "",
    error: "",
    startedAt: new Date().toISOString(),
    completedAt: "",
  };
  mailAuthSession = session;
  let child;
  try {
    child = spawn(agentMailCliPath(), ["auth", "login"], {
      cwd: __dirname,
      env: { ...process.env },
      windowsHide: true,
    });
  } catch (error) {
    session.status = "failed";
    session.error = String(error.message || error);
    session.completedAt = new Date().toISOString();
    return session;
  }
  const settleFromText = (chunk) => {
    session.output += chunk;
    const url = session.output.match(/https?:\/\/\S+/)?.[0] || "";
    if (url && !session.url) session.url = url;
  };
  child.stdout.on("data", (chunk) => settleFromText(chunk.toString("utf8")));
  child.stderr.on("data", (chunk) => settleFromText(chunk.toString("utf8")));
  child.on("error", (error) => {
    session.status = "failed";
    session.error = String(error.message || error);
    session.completedAt = new Date().toISOString();
  });
  child.on("close", (code) => {
    session.status = code === 0 ? "completed" : "failed";
    session.error = code === 0 ? "" : session.output || `AGENT_MAIL_AUTH_EXIT_${code}`;
    session.completedAt = new Date().toISOString();
  });
  const started = Date.now();
  while (!session.url && session.status === "running" && Date.now() - started < 15000) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!session.url && session.status === "running") {
    session.error = "AGENT_MAIL_AUTH_URL_TIMEOUT";
  }
  return session;
}

async function handleMailStatus(response) {
  const status = await getAgentMailStatus();
  sendJson(response, 200, { ...status, authSession: mailAuthSession });
}

async function handleMailAuthStart(response) {
  const session = await startAgentMailAuth();
  if (!session.url) {
    return sendJson(response, 503, {
      error: "AGENT_MAIL_AUTH_URL_MISSING",
      message: session.error || session.output || "未获取到授权链接",
      session,
    });
  }
  sendJson(response, 200, {
    authUrl: session.url,
    session,
  });
}

async function handleMailOutbox(response) {
  const library = await readLibrary();
  sendJson(response, 200, { deliveries: serializeLibrary(library).mailDeliveries || [] });
}

async function handleMailTest(response) {
  const paper = {
    id: "mail_test",
    title: "Agent Mail 测试邮件",
    abstract: "这是一封由本地文献阅读器生成的 Agent Mail 测试邮件。",
    source: "local",
  };
  const { library } = await addMailDelivery({
    kind: "mail_test",
    task: { query: "Agent Mail 测试" },
    paper,
    markdown: "# Agent Mail 测试邮件\n\n如果你看到这封邮件，说明本地 outbox 已经成功生成并尝试通过 Agent Mail CLI 投递。",
  });
  sendJson(response, 200, { library: serializeLibrary(library) });
}

async function handleMailConfirm(id, response) {
  const library = await readLibrary();
  const delivery = (library.mailDeliveries || []).find((item) => item.id === id);
  if (!delivery) return sendJson(response, 404, { error: "MAIL_DELIVERY_NOT_FOUND" });
  if (!delivery.confirmationToken) {
    return sendJson(response, 400, { error: "MAIL_CONFIRMATION_TOKEN_MISSING" });
  }
  const updated = await attemptMailDelivery(id, delivery.confirmationToken);
  sendJson(response, 200, { library: serializeLibrary(updated) });
}

function normalizeStoredPaper(paper) {
  const doi = normalizeDoi(paper.doi);
  const pdfCandidates = uniqueStrings([paper.pdfUrl, ...(paper.pdfCandidates || [])].filter(isLikelyPdfUrl));
  const landingCandidates = uniqueStrings([
    paper.landingPageUrl,
    paper.sourceUrl,
    doiUrl(doi),
    ...(paper.landingCandidates || []),
    paper.pdfUrl && !isLikelyPdfUrl(paper.pdfUrl) ? paper.pdfUrl : "",
  ]);
  return {
    ...paper,
    doi,
    pdfUrl: pdfCandidates[0] || null,
    pdfCandidates,
    landingPageUrl: landingCandidates[0] || doiUrl(doi) || paper.landingPageUrl || paper.sourceUrl || "",
    landingCandidates,
  };
}

async function downloadPdf(paper) {
  if (!paper.pdfUrl) return null;
  return downloadPdfFromUrl(paper, paper.pdfUrl);
}

async function downloadPdfFromUrl(paper, pdfUrl, attempts = []) {
  if (!pdfUrl) return null;
  try {
    const response = await fetch(pdfUrl, {
      redirect: "follow",
      headers: { "User-Agent": "ResearchRadarAI-LiteratureReader/0.1" },
    });
    if (!response.ok) {
      attempts.push({ type: "pdf", url: pdfUrl, status: response.status, ok: false, reason: "HTTP_ERROR" });
      return null;
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const isPdf = buffer.subarray(0, 4).toString("utf8") === "%PDF";
    if (!isPdf) {
      attempts.push({ type: "pdf", url: pdfUrl, status: response.status, ok: false, reason: "NOT_PDF" });
      return null;
    }
    const fileName = `${paper.id}.pdf`;
    const target = path.join(downloadsDir, fileName);
    await writeFile(target, buffer);
    attempts.push({ type: "pdf", url: pdfUrl, status: response.status, ok: true, bytes: buffer.length });
    return path.relative(__dirname, target).replace(/\\/g, "/");
  } catch {
    attempts.push({ type: "pdf", url: pdfUrl, ok: false, reason: "FETCH_FAILED" });
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

async function fetchOpenAlexWorkByDoi(doi) {
  const url = doiUrl(doi);
  if (!url) return {};
  try {
    const response = await fetch(`https://api.openalex.org/works/${url}`, {
      headers: { "User-Agent": "ResearchRadarAI-LiteratureReader/0.1" },
    });
    if (!response.ok) return {};
    return normalizeOpenAlex(await response.json());
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
    const pdfCandidates = uniqueStrings(locations.map((location) => location.url_for_pdf).filter(isLikelyPdfUrl));
    const landingCandidates = uniqueStrings(
      locations
        .flatMap((location) => [location.url, isLikelyPdfUrl(location.url_for_pdf) ? "" : location.url_for_pdf])
        .concat(item.doi_url, doiUrl(item.doi)),
    );
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
  ].filter(isLikelyPdfUrl));
  const landingCandidates = uniqueStrings([
    paper.landingPageUrl,
    paper.sourceUrl,
    doiUrl(paper.doi),
    ...(paper.landingCandidates || []),
    ...sources.flatMap((source) => [
      source.landingPageUrl,
      source.sourceUrl,
      doiUrl(source.doi),
      ...(source.landingCandidates || []),
      source.pdfUrl && !isLikelyPdfUrl(source.pdfUrl) ? source.pdfUrl : "",
    ]),
  ]);
  return {
    ...paper,
    pdfUrl: pdfCandidates[0] || null,
    pdfCandidates,
    landingPageUrl: landingCandidates[0] || paper.landingPageUrl || paper.sourceUrl || "",
    landingCandidates,
    openAccess: Boolean(paper.openAccess || sources.some((source) => source.openAccess) || pdfCandidates.length),
  };
}

async function refreshOpenAccessLinks(paper) {
  const [crossref, openalex, unpaywall] = await Promise.all([
    fetchCrossrefWorkByDoi(paper.doi),
    fetchOpenAlexWorkByDoi(paper.doi),
    fetchUnpaywallByDoi(paper.doi),
  ]);
  return mergePaperLinks(paper, crossref, openalex, unpaywall);
}

async function downloadBestAvailablePdf(paper, attempts = []) {
  const candidates = uniqueStrings([paper.pdfUrl, ...(paper.pdfCandidates || [])].filter(isLikelyPdfUrl));
  for (const url of candidates) {
    const localPath = await downloadPdfFromUrl(paper, url, attempts);
    if (localPath) return { localPath, url };
  }
  return { localPath: null, url: "" };
}

async function fetchOpenFullText(paper, attempts = []) {
  const queue = uniqueStrings([
    doiUrl(paper.doi),
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
      if (!response.ok) {
        attempts.push({ type: "html", url, status: response.status, ok: false, reason: "HTTP_ERROR" });
        continue;
      }
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("html")) continue;
      const html = await response.text();
      for (const discovered of discoverRedirectUrls(html, url)) {
        if (!visited.has(discovered)) queue.push(discovered);
      }
      if (isBlockedOrErrorPage(html)) {
        attempts.push({ type: "html", url, status: response.status, ok: false, reason: "BLOCKED_OR_ERROR_PAGE" });
        continue;
      }
      for (const pdfUrl of discoverPdfUrls(html, url)) {
        const localPdfPath = await downloadPdfFromUrl(paper, pdfUrl, attempts);
        if (localPdfPath) return { localPdfPath, pdfUrl, localFullTextPath: null };
      }
      const text = await polishFullTextMarkdownLayout(htmlToStructuredMarkdown(html, url), paper);
      if (text.length < 3000) {
        attempts.push({ type: "html", url, status: response.status, ok: false, reason: "TOO_SHORT", chars: text.length });
        continue;
      }
      const target = path.join(papersDir, `${slug(paper.title || paper.id)}-${paper.id}-fulltext.md`);
      await writeFile(target, fullTextMarkdown(paper, text, url), "utf8");
      attempts.push({ type: "html", url, status: response.status, ok: true, chars: text.length });
      return { localFullTextPath: path.relative(__dirname, target).replace(/\\/g, "/"), localPdfPath: null, pdfUrl: "" };
    } catch {
      attempts.push({ type: "html", url, ok: false, reason: "FETCH_FAILED" });
      // Public full text extraction is opportunistic.
    }
  }
  return { localFullTextPath: null, localPdfPath: null, pdfUrl: "" };
}

async function refreshPaperReadableAssets(paper) {
  const attempts = [];
  const linked = await refreshOpenAccessLinks(paper);
  const pdf = await downloadBestAvailablePdf(linked, attempts);
  if (pdf.localPath) {
    return {
      paper: { ...linked, pdfUrl: pdf.url || linked.pdfUrl, localPdfPath: pdf.localPath },
      method: "pdf",
      retrieval: { method: "pdf", attempts },
    };
  }
  const textOrPdf = await fetchOpenFullText(linked, attempts);
  if (textOrPdf.localPdfPath) {
    return {
      paper: { ...linked, pdfUrl: textOrPdf.pdfUrl || linked.pdfUrl, localPdfPath: textOrPdf.localPdfPath },
      method: "pdf",
      retrieval: { method: "pdf", attempts },
    };
  }
  if (textOrPdf.localFullTextPath) {
    return {
      paper: { ...linked, localFullTextPath: textOrPdf.localFullTextPath },
      method: "html-fulltext",
      retrieval: { method: "html-fulltext", attempts },
    };
  }
  return { paper: linked, method: "", retrieval: { method: "", attempts } };
}

async function savePaperAsset(paper, downloadOpenPdf) {
  const enriched = { ...paper };
  if (downloadOpenPdf && paper.openAccess) {
    const refreshed = await refreshPaperReadableAssets(enriched);
    Object.assign(enriched, refreshed.paper);
  }
  if (!enriched.localPdfPath && paper.openAccess) {
    const textOrPdf = await fetchOpenFullText(enriched);
    if (textOrPdf.localPdfPath) {
      enriched.localPdfPath = textOrPdf.localPdfPath;
      enriched.pdfUrl = textOrPdf.pdfUrl || enriched.pdfUrl;
    }
    if (textOrPdf.localFullTextPath) enriched.localFullTextPath = textOrPdf.localFullTextPath;
  }
  const markdownName = `${slug(enriched.title || enriched.id)}-${enriched.id}.md`;
  const markdownPath = path.join(papersDir, markdownName);
  await writeFile(markdownPath, paperMarkdown(enriched), "utf8");
  enriched.localMarkdownPath = path.relative(__dirname, markdownPath).replace(/\\/g, "/");
  enriched.savedAt = new Date().toISOString();
  return enriched;
}

async function performScan(body, taskId = null, trigger = "manual") {
  const query = String(body.query || "").trim();
  const count = Math.max(1, Math.min(20, Number(body.count || 5)));
  const yearFrom = body.yearFrom ? Number(body.yearFrom) : null;
  const minScore = body.minScore ? Number(body.minScore) : 0;
  const sources = Array.isArray(body.sources) && body.sources.length ? body.sources : ["openalex", "crossref"];
  if (!query) {
    const error = new Error("QUERY_REQUIRED");
    error.status = 400;
    error.code = "QUERY_REQUIRED";
    throw error;
  }

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
    trigger,
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
  return { run, papers: saved, duplicates, library: serializeLibrary(library) };
}

async function handleScan(request, response) {
  const body = request._body || await readJson(request);
  try {
    const result = await performScan(body, request._taskId || body.taskId || null, request._trigger || "manual");
    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, error.status || 500, {
      error: error.code || "SCAN_FAILED",
      message: String(error.message || error),
    });
  }
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
  if (isSinglePaper) {
    return [
      `# ${papers[0].title} AI 阅读报告`,
      "",
      `- 生成时间: ${new Date().toISOString()}`,
      `- 模型: ${process.env.OPENAI_MODEL}`,
      `- 数据来源: 本地已保存论文资产`,
      "",
      ...sections,
    ].join("\n");
  }
  return [
    `# ${scanContext.query || "本地文献"} AI 阅读报告`,
    "",
    `- 生成时间: ${new Date().toISOString()}`,
    `- 模型: ${process.env.OPENAI_MODEL}`,
    `- 文献数量: ${papers.length}`,
    `- 数据来源: 本地已保存 Markdown/元数据`,
    "",
    "## 阅读顺序建议",
    "",
    ...papers.map(
      (paper, index) =>
        `${index + 1}. ${paper.title} (${paper.year || "未知年份"}, ${paper.journal || paper.source})`
    ),
    "",
    ...sections,
  ].join("\n");
}

async function callAiForSinglePaperMarkdown(paper, scanContext, index) {
  const prompt = [
    "你是严谨的科研文献分析助手。请输出 Markdown，不要输出 JSON。",
    "任务：基于本地已保存的单篇论文资产，生成该论文的中文科研阅读分析。",
    "必须只包含这些二级标题，且不要重复标题：中文标题翻译、摘要完整翻译、文献信息总表、研究主题、核心逻辑流程图、方法与实验设计、关键结果与证据、局限与不可追溯点、可借鉴的点、与当前研究方向的关系、精读问题、后续检索建议。",
    "文献信息总表必须用 Markdown 表格呈现，至少包含：标题、作者、年份、期刊、研究背景、研究目的、研究方法、研究结论、证据范围。",
    "核心逻辑流程图必须用 Mermaid flowchart 代码块呈现，格式为 ```mermaid 开头，展示 背景/问题 -> 目的 -> 方法 -> 结果 -> 结论 -> 可借鉴点；如果证据不足，用“待原文核验”节点标出。",
    "方法与实验设计至少覆盖：研究问题、材料/对象、方法路线、关键变量、评价指标、主要发现、机制解释、创新点、可复用方法、潜在风险。",
    "精读问题至少覆盖：是否值得下载全文、哪些图表/实验条件最值得核验、与当前方向的直接相关性、可迁移方法、可能补充的对照实验。",
    "如果没有全文或本地 PDF，只能说明基于摘要/元数据，不得声称阅读了正文、图表、实验数据、统计结果或补充材料；不得用常识补全作者没有提供的实验细节。",
    "所有结论必须标明证据范围：摘要可追溯、元数据可追溯、需回到原文核验、AI 推测。证据不足时宁可写“不足以判断”。",
    "与当前研究方向的关系要按：研究对象/材料、方法/技术路线、指标/结果、机制、应用场景、发表时间、证据类型、开放全文可得性、排除条件冲突、研究空白/方法迁移价值。",
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

async function createAnalysisReport(papers, options = {}) {
  const markdown = await enqueueAiJob(() => callAiForMarkdown(papers, {
    query: options.query || "",
    generatedFrom: options.generatedFrom || "local-library",
    paperCount: papers.length,
  }));
  const report = {
    id: `report_${randomUUID()}`,
    title: options.title || `${options.query || "本地文献"} AI 阅读报告`,
    paperIds: papers.map((paper) => paper.id),
    model: process.env.OPENAI_MODEL,
    createdAt: new Date().toISOString(),
    markdownPath: "",
    markdown,
  };
  const reportPath = path.join(reportsDir, `${slug(report.title)}-${report.id}.md`);
  await writeFile(reportPath, markdown, "utf8");
  report.markdownPath = localPathFromReaderRoot(reportPath);
  const latestLibrary = await readLibrary();
  latestLibrary.reports = [report, ...(latestLibrary.reports || [])].slice(0, 100);
  await saveLibrary(latestLibrary);
  return {
    report: { ...report, markdownUrl: publicFileUrl(report.markdownPath) },
    library: latestLibrary,
  };
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
    const { report, library: latestLibrary } = await createAnalysisReport(papers, {
      query: body.query || library.scanRuns?.[0]?.query || "",
      title: body.title || `${body.query || "本地文献"} AI 阅读报告`,
      generatedFrom: "local-library",
    });
    sendJson(response, 200, {
      report,
      library: serializeLibrary(latestLibrary),
    });
  } catch (error) {
    sendJson(response, 503, { error: "AI_ANALYSIS_FAILED", message: String(error.message || error) });
  }
}

function localDateKey(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function minutesOfDay(time) {
  const match = String(time || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return 9 * 60;
  return Math.min(23, Math.max(0, Number(match[1]))) * 60 + Math.min(59, Math.max(0, Number(match[2])));
}

function scheduledIsoForDate(date, time) {
  const [hour, minute] = String(time || "09:00").split(":").map((item) => Number(item));
  const next = new Date(date);
  next.setHours(Number.isFinite(hour) ? hour : 9, Number.isFinite(minute) ? minute : 0, 0, 0);
  return next.toISOString();
}

function computeNextScheduledRunAt(task, from = new Date()) {
  if (!task.dailyEnabled) return "";
  const today = new Date(from);
  const todayMinutes = from.getHours() * 60 + from.getMinutes();
  const scheduledMinutes = minutesOfDay(task.dailyTime);
  const targetDate = todayMinutes < scheduledMinutes ? today : new Date(today.getTime() + 24 * 60 * 60 * 1000);
  return scheduledIsoForDate(targetDate, task.dailyTime);
}

function normalizeTaskPayload(body, existing = {}) {
  const query = String(body.query ?? existing.query ?? "").trim();
  if (!query) return null;
  const dailyEnabled = body.dailyEnabled !== undefined ? Boolean(body.dailyEnabled) : Boolean(existing.dailyEnabled);
  const dailyTime = String(body.dailyTime || existing.dailyTime || "09:00").match(/^\d{1,2}:\d{2}$/)
    ? String(body.dailyTime || existing.dailyTime || "09:00").padStart(5, "0")
    : "09:00";
  return {
    query,
    count: body.count !== undefined ? Math.max(1, Math.min(20, Number(body.count))) : (existing.count || 5),
    yearFrom: body.yearFrom !== undefined ? (body.yearFrom ? Number(body.yearFrom) : null) : (existing.yearFrom ?? null),
    minScore: body.minScore !== undefined ? (body.minScore ? Number(body.minScore) : 0) : (existing.minScore || 0),
    sources: Array.isArray(body.sources) && body.sources.length ? body.sources : (existing.sources || ["openalex", "crossref"]),
    downloadOpenPdf: body.downloadOpenPdf !== undefined ? body.downloadOpenPdf !== false : existing.downloadOpenPdf !== false,
    autoAnalyze: body.autoAnalyze !== undefined ? Boolean(body.autoAnalyze) : Boolean(existing.autoAnalyze),
    dailyEnabled,
    dailyTime,
    dailyTimezone: body.dailyTimezone || existing.dailyTimezone || "Asia/Shanghai",
    notifyAfterRun: body.notifyAfterRun !== undefined ? Boolean(body.notifyAfterRun) : existing.notifyAfterRun !== false,
  };
}

async function handleListTasks(response) {
  const tasks = await readTasks();
  sendJson(response, 200, tasks);
}

async function handleCreateTask(request, response) {
  const body = await readJson(request);
  const payload = normalizeTaskPayload(body);
  if (!payload) return sendJson(response, 400, { error: "QUERY_REQUIRED" });
  const now = new Date().toISOString();
  const task = {
    id: `task_${randomUUID()}`,
    ...payload,
    lastScheduledRunDate: "",
    lastScheduledRunAt: "",
    nextScheduledRunAt: computeNextScheduledRunAt(payload),
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
  const payload = normalizeTaskPayload(body, tasks.tasks[index]);
  if (!payload) return sendJson(response, 400, { error: "QUERY_REQUIRED" });
  tasks.tasks[index] = {
    ...tasks.tasks[index],
    ...payload,
    nextScheduledRunAt: computeNextScheduledRunAt(payload),
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

async function createTaskNotifications(task, run, papers) {
  if (!task.notifyAfterRun || !papers.length) return [];
  const deliveries = [];
  if (task.autoAnalyze) {
    for (const paper of papers) {
      try {
        const { report, library } = await createAnalysisReport([paper], {
          query: task.query || paper.title,
          title: `${paper.title} AI 阅读报告`,
          generatedFrom: "task-auto-analysis",
        });
        const deliveryResult = await addMailDelivery({
          kind: "analysis_report",
          task,
          run,
          paper,
          report,
          markdown: report.markdown,
        });
        deliveries.push(deliveryResult.delivery);
        if (library?.reports) {
          // Report persistence is handled by createAnalysisReport; this keeps the loop explicit.
        }
      } catch (error) {
        const deliveryResult = await addMailDelivery({
          kind: "analysis_report",
          task,
          run,
          paper,
          markdown: [
            `# ${paper.title} AI 分析失败`,
            "",
            `- 错误: ${String(error.message || error)}`,
            "- 说明: 文献已采集入库，但 AI 分析或邮件准备失败，请回到本地文献库重新生成。",
          ].join("\n"),
        });
        deliveries.push({ ...deliveryResult.delivery, error: String(error.message || error) });
      }
    }
  } else {
    for (const paper of papers) {
      const deliveryResult = await addMailDelivery({
        kind: "paper_fulltext",
        task,
        run,
        paper,
      });
      deliveries.push(deliveryResult.delivery);
    }
  }
  return deliveries;
}

async function updateScheduledTaskAfterRun(taskId, now = new Date()) {
  const tasks = await readTasks();
  const index = tasks.tasks.findIndex((item) => item.id === taskId);
  if (index < 0) return;
  const task = tasks.tasks[index];
  tasks.tasks[index] = {
    ...task,
    lastScheduledRunDate: localDateKey(now),
    lastScheduledRunAt: now.toISOString(),
    nextScheduledRunAt: computeNextScheduledRunAt(task, now),
    updatedAt: new Date().toISOString(),
  };
  await saveTasks(tasks);
}

function isTaskDue(task, now = new Date()) {
  if (!task.dailyEnabled) return false;
  const today = localDateKey(now);
  if (task.lastScheduledRunDate === today) return false;
  return now.getHours() * 60 + now.getMinutes() >= minutesOfDay(task.dailyTime);
}

async function recordScheduledFailure(task, error) {
  const library = await readLibrary();
  const run = {
    id: `scan_failed_${randomUUID()}`,
    taskId: task.id,
    query: task.query,
    trigger: "scheduled",
    count: task.count,
    createdAt: new Date().toISOString(),
    savedCount: 0,
    candidateCount: 0,
    uniqueCount: 0,
    duplicateCount: 0,
    savedPaperIds: [],
    sourceStatuses: [],
    queryPlan: [],
    duplicateTitles: [],
    _failed: true,
    _errorMessage: String(error.message || error),
    targetMet: false,
    exhaustedReason: String(error.message || error),
  };
  library.scanRuns = [run, ...(library.scanRuns || [])].slice(0, 30);
  await saveLibrary(library);
}

async function schedulerTick() {
  if (process.env.LITERATURE_READER_SCHEDULER_ENABLED === "false") return;
  const now = new Date();
  const tasks = await readTasks();
  for (const task of tasks.tasks || []) {
    if (!isTaskDue(task, now) || activeTaskRuns.has(task.id)) continue;
    try {
      await runTaskById(task.id, {}, "scheduled");
    } catch (error) {
      await recordScheduledFailure(task, error);
    } finally {
      await updateScheduledTaskAfterRun(task.id, now);
    }
  }
}

function startScheduler() {
  if (process.env.LITERATURE_READER_SCHEDULER_ENABLED === "false") return;
  setInterval(() => {
    schedulerTick().catch((error) => {
      console.error("scheduler tick failed", error);
    });
  }, 60 * 1000);
  schedulerTick().catch((error) => {
    console.error("initial scheduler tick failed", error);
  });
}

async function runTaskById(id, overrides = {}, trigger = "manual") {
  const lockKey = id;
  if (activeTaskRuns.has(lockKey)) {
    const error = new Error("TASK_ALREADY_RUNNING");
    error.status = 409;
    error.code = "TASK_ALREADY_RUNNING";
    throw error;
  }
  activeTaskRuns.add(lockKey);
  try {
    const tasks = await readTasks();
    const task = tasks.tasks.find((t) => t.id === id);
    if (!task) {
      const error = new Error("TASK_NOT_FOUND");
      error.status = 404;
      error.code = "TASK_NOT_FOUND";
      throw error;
    }
    const merged = { ...task, ...normalizeTaskPayload({ ...task, ...overrides }, task) };
    const result = await performScan(merged, task.id, trigger);
    const mailDeliveries = await createTaskNotifications(merged, result.run, result.papers);
    const latestLibrary = await readLibrary();
    return {
      ...result,
      mailDeliveries,
      library: serializeLibrary(latestLibrary),
    };
  } finally {
    activeTaskRuns.delete(lockKey);
  }
}

async function handleRunTask(id, request, response) {
  const body = await readJson(request);
  try {
    const result = await runTaskById(id, body, "manual");
    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, error.status || 500, {
      error: error.code || "TASK_RUN_FAILED",
      message: String(error.message || error),
    });
  }
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
      retrieval: refreshed.retrieval,
    });
  }
  library.papers[index] = refreshed.paper;
  await saveLibrary(library);
  return sendJson(response, 200, {
    paper: library.papers[index],
    library: serializeLibrary(library),
    reused: false,
    method: refreshed.method,
    retrieval: refreshed.retrieval,
  });
}

async function handleUploadPaperPdf(id, request, response) {
  const library = await readLibrary();
  const index = library.papers.findIndex((item) => item.id === id);
  if (index < 0) return sendJson(response, 404, { error: "PAPER_NOT_FOUND" });

  const contentType = String(request.headers["content-type"] || "").toLowerCase();
  if (!contentType.includes("application/pdf")) {
    return sendJson(response, 415, { error: "PDF_REQUIRED", message: "请上传 PDF 文件" });
  }

  try {
    const file = await readBinary(request);
    if (!file.subarray(0, 5).toString("utf8").startsWith("%PDF-")) {
      return sendJson(response, 400, { error: "INVALID_PDF", message: "上传文件不是有效 PDF" });
    }

    const paper = library.papers[index];
    const filename = `${slug(paper.title || paper.id)}-${paper.id}-uploaded.pdf`;
    const target = path.join(papersDir, filename);
    await removeLocalAsset(paper.localPdfPath);
    await writeFile(target, file);

    library.papers[index] = {
      ...paper,
      localPdfPath: path.relative(__dirname, target).replace(/\\/g, "/"),
      manualPdfUploadedAt: new Date().toISOString(),
    };
    await saveLibrary(library);
    return sendJson(response, 200, {
      paper: library.papers[index],
      library: serializeLibrary(library),
      method: "manual-upload",
    });
  } catch (error) {
    if (error.status === 413) {
      return sendJson(response, 413, { error: "FILE_TOO_LARGE", message: "PDF 文件超过 80MB" });
    }
    throw error;
  }
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
    if (url.pathname.startsWith("/api/papers/") && url.pathname.endsWith("/upload-pdf") && request.method === "POST") {
      const id = decodeURIComponent(url.pathname.split("/").at(-2));
      return await handleUploadPaperPdf(id, request, response);
    }
    if (url.pathname === "/api/analyze" && request.method === "POST") {
      return await handleAnalyze(request, response);
    }
    if (url.pathname === "/api/mail/status" && request.method === "GET") {
      return await handleMailStatus(response);
    }
    if (url.pathname === "/api/mail/auth/start" && request.method === "POST") {
      return await handleMailAuthStart(response);
    }
    if (url.pathname === "/api/mail/outbox" && request.method === "GET") {
      return await handleMailOutbox(response);
    }
    if (url.pathname === "/api/mail/test" && request.method === "POST") {
      return await handleMailTest(response);
    }
    if (url.pathname.startsWith("/api/mail/deliveries/") && url.pathname.endsWith("/confirm") && request.method === "POST") {
      const id = decodeURIComponent(url.pathname.split("/").at(-2));
      return await handleMailConfirm(id, response);
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
startScheduler();
createServer(route).listen(port, "127.0.0.1", () => {
  console.log(`Literature reader running at http://127.0.0.1:${port}`);
  console.log(`Local data: ${dataDir}`);
});
