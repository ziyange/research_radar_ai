# Literature Reader

独立文献阅读器原型，后续再与 Research Radar AI 主项目合并。

## 功能边界

这个工具把两个流程分开：

1. 文献采集与本地保存
   - 来源：OpenAlex、Crossref。
   - 参数：研究方向、篇数、起始年份、最低评分、来源选择、是否下载开放 PDF。
   - 去重：本地库内按 DOI 与题名归一化去重。
   - 落盘：论文元数据与摘要保存为 Markdown；开放 PDF 可下载到本地。

2. AI 本地分析
   - 输入：只读取本地已保存论文资产。
   - 输出：Markdown 分析报告。
   - 报告内容：中文标题翻译、摘要完整翻译、文献信息表、研究主题、核心逻辑流程图、方法与实验设计、关键结果与证据、局限与不可追溯点、可借鉴点、与当前研究方向的关系、精读问题、后续检索建议。

3. 任务自动化与邮箱推送
   - 每日自动执行：任务级开关，只在本地 `server.mjs` 运行时生效。
   - 邮箱推送：独立于自动执行，任务完成后逐条推送文献；勾选 AI 分析时推送逐篇 AI 分析报告，未勾选时推送完整文献卡片。
   - 邮箱绑定：前端“绑定邮箱”按钮会启动 Agent Mail OAuth 授权；绑定成功后才能在新增/编辑任务中开启“推送邮箱”。

## 本地数据目录

```text
apps/literature-reader/local-data/
  library.json
  papers/
  downloads/
  reports/
  mail-outbox/
```

`local-data/` 是运行产物，不是主项目正式业务数据库。

## 启动

从仓库根目录：

```powershell
npm run build:reader
npm run start:reader
```

默认服务地址：

```text
http://127.0.0.1:4177
```

如果端口冲突：

```powershell
$env:LITERATURE_READER_PORT=4188
npm run start:reader
```

## AI 配置

读取仓库根目录 `.env` 的 OpenAI-compatible 配置：

```text
OPENAI_BASE_URL=
OPENAI_MODEL=
OPENAI_API_KEY=
```

如果这些值齐全，独立工具会显示 `openai-compatible`。不需要修改主项目的 `AI_PROVIDER=mock`。

为提升阿里云百炼 Qwen3 系列响应速度，AI 请求会发送：

```json
{"enable_thinking": false}
```

## Agent Mail 配置

先按官方流程安装并授权：

```powershell
npm install -g @tencent-qqmail/agently-cli
npx skills add https://agent.qq.com --skill -g -y
agently-cli auth login
agently-cli +me
```

如果全局 npm 目录没有管理员权限，可以安装到用户 npm 前缀；服务会优先查找用户目录下的 `agently-cli.exe`。

相关环境变量：

```text
LITERATURE_READER_SCHEDULER_ENABLED=true
AGENT_MAIL_ENABLED=true
AGENT_MAIL_CLI=agently-cli
AGENT_MAIL_RECIPIENT=
```

`AGENT_MAIL_RECIPIENT` 为空时，默认使用 Agent Mail 授权的主邮箱。CLI 要求二次确认时，邮件会进入 `pending_confirmation` 状态，前端 outbox 会显示“确认发送”。

## 已验证

- `npm run build:reader`：通过。
- `/api/health`：通过，AI 显示 `openai-compatible / qwen3.6-plus`。
- `/api/scan`：用 `nanomaterials plant`，OpenAlex 与 Crossref 均成功，保存 5 篇，去重 2 篇，开放 PDF 已下载。
- `/api/analyze`：读取本地 5 篇论文生成 Markdown 报告，通过。

示例报告：

```text
apps/literature-reader/local-data/reports/nanomaterials-plant-5篇-ai-阅读报告-report_fff40b09-10f6-49f5-9f10-689ffb1152b0.md
```

## 合规限制

- 不抓取 X-MOL、知网网页搜索页。
- 不绕过 robots.txt、登录态、验证码、学校统一认证或数据库授权。
- 只下载来源返回的开放 PDF 链接；无法确认开放授权时仅保存 DOI/source URL 和元数据。
