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
   - 报告内容：中文标题翻译、摘要完整翻译、论文重点内容深度分析、文献匹配方向、研究人员阅读关注点、事实 claims 与证据、阅读顺序、下一步检索建议。

## 本地数据目录

```text
apps/literature-reader/local-data/
  library.json
  papers/
  downloads/
  reports/
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
