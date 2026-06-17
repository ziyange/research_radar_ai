# RR-DEV-008 交付报告

日期：2026-06-17  
状态：已完成  
范围：Hydration 修复、真实 AI 接入边界、去硬编码、检索数据源面板、阶段差距审计

## 1. 完成内容

- 修复根节点 hydration warning：`apps/web/app/layout.tsx` 的 `<html>` 增加 `suppressHydrationWarning`，并补充 `icon.svg`，避免浏览器默认 favicon 404。
- 工作台去业务默认值：新增项目、研究方向、知识库查询均为空初始态，只保留 placeholder。
- 工作台新增“检索数据源”面板：展示 retrieval provider、AI 配置状态、检索任务、`source_statuses`、SourceRecord 数量和来源记录弹窗。
- 后端新增 `GET /api/v1/tasks/{task_id}`，供前端读取任务状态和 `source_statuses`。
- 后端真实 AI 接入走 OpenAI-compatible：`AI_PROVIDER=openai` + `OPENAI_BASE_URL` + `OPENAI_MODEL` + `OPENAI_API_KEY`。
- `AI_PROVIDER=openai` 缺配置时返回 `AI_PROVIDER_CONFIG_MISSING`，不静默回退 mock。
- 画像生成、快速分析、标准研读均支持 OpenAI-compatible JSON 输出校验；失败不写正式画像/分析。
- `DEMO_SEED_ENABLED=false` 作为真实业务默认值；live 检索没有 SourceRecord 时不从 seed/fallback 造推荐。
- 检索规划从固定竹材 query 改为基于 `ResearchProfile` 的对象、方法、材料、指标、关键词动态生成。
- 新增阶段差距审计：[RR-DEV-008-gap-audit.md](./RR-DEV-008-gap-audit.md)。

## 2. 验收结果

| 项目 | 结果 |
| --- | --- |
| `.\.venv\Scripts\python.exe -m pytest` | 19 passed, 2 skipped |
| `.\.venv\Scripts\ruff.exe check services/api` | passed |
| `npm run lint:web` | passed |
| `npx tsc --noEmit --project apps/web/tsconfig.json` | passed |
| `npm run build` | 用户 PowerShell 补跑通过，Next build 成功 |
| 推荐评测 | Top N hit rate 0.9，irrelevant ratio 0.0，explanation coverage 1.0 |
| AI 安全评测 | hallucinated DOI 0，事实/推测混淆 0 |

## 3. 浏览器验收

环境：

- URL: `http://localhost:3000`
- API: `http://127.0.0.1:8010/api/v1`
- Viewport: `1366x768`
- Browser: 本机 Chrome via Playwright Node REPL
- Provider: `AI_PROVIDER=mock`、`RETRIEVAL_PROVIDER=mock`、`DEMO_SEED_ENABLED=true`

结果：

- 页面加载无 hydration warning、React error、Next runtime overlay。
- 模拟外部脚本向 `<html>` 注入 `tongyi-design-pc`、`data-theme`、`color-scheme` 后，仍无 hydration 报错。
- 新增项目表单默认无业务值。
- 一句话画像输入默认空。
- 创建项目 -> 生成画像 -> 确认画像 -> 生成检索 -> 查看检索数据源 -> 打开来源记录 -> 加入知识库 跑通。
- “加入知识库”显示绿色 toast：`论文已加入知识库。`
- 检索数据源面板显示 `mock`、`openalex`、`crossref`、SourceRecord 数量和 paper 关联信息。
- 快速 console 复验：`consoleEvents=[]`、`pageErrors=[]`、`overlayVisible=0`。

截图：

- `E:\Programs\research_radar_ai\output\playwright\rr-dev-008-browser-smoke-clean.png`

## 4. 仍未进入本轮范围

- 真实邮件投递、邮件重试、定时调度器。
- 全文 PDF 深度解析和章节/图表级证据定位。
- Semantic Scholar/arXiv 适配。
- 生产登录、权限、审计和多用户隔离。
- 后台成本 UI、人工标注评测扩展。
- 中文数据库、自定义来源、机构权限和移动端能力。
