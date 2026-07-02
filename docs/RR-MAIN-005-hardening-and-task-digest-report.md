# RR-MAIN-005 去硬编码、PDF 全文分析与任务级邮件汇总报告

日期：2026-07-01
状态：实施中验收基线

## 1. 本轮目标

本轮处理三个主问题：

1. 生产运行路径不得自动加载 demo/seed 业务数据，也不得在代码中内置具体研究方向、固定论文或固定 DOI。
2. 明确 PDF 分析能力边界：系统不直接把 PDF 交给 AI，而是先抽取可复制文本，保存为本地全文 Markdown，再进行 AI 分析。
3. 邮箱推送从“每篇文献一封邮件”改为“每次任务执行完成后一封任务汇总邮件”，附件使用 ZIP 打包全文和 AI 报告。

## 2. 当前行为

- 空文献库启动时保持空库，不再从 `storage/literature/imported-local-data` 自动导入历史样例。
- 测试/评测中的样例数据仍允许存在，但不得被运行时代码自动加载。
- PDF 上传或自动获取后会尝试用 `pypdf` 抽取文本：
  - 可抽取文本且字符数足够时，生成 `localFullTextPath` Markdown，并允许 AI 分析。
  - 扫描版、图片型、加密或文本不足 PDF 会标记 `fullTextStatus=extract_failed`，并阻止 AI 报告生成。
- 任务开启邮箱推送后，执行完成只生成一条 `task_digest` 邮件记录：
  - 邮件主题：`[研知雷达] {任务名称或研究方向} · {执行时间}`
  - 正文：纯文本任务摘要，包含任务参数、来源状态、保存/去重结果、文献列表、AI 分析状态和附件说明；不直接发送 Markdown，避免手机邮箱显示格式符号。
  - 附件：`fulltexts-*.zip`、`analysis-reports-*.zip`、`task-summary-*.pdf`，总数不超过 3。
  - Markdown 仍作为系统内部存档保留；发送前会转换为 PDF，表格、标题和加粗以 PDF 形式呈现。

## 3. 仍需后续优化

- 当前 PDF 抽取不做 OCR，不还原复杂表格、图片和扫描页。
- “任务 AI 分析总结”本轮先作为占位小节，后续应接跨文献总结模型。
- 旧 Phase 1 兼容接口仍存在；测试夹具会补旧样例数据，生产主线不依赖这些样例。
- 正式关系模型和迁移脚本仍未替代 `rr_entities` JSONB。

## 4. 验收标准

- 空库 `GET /api/v1/literature/library` 返回空任务和空文献，不自动出现历史样例。
- `services/api/src` 和 `apps/web` 生产代码中不出现领域 seed 论文、固定 DOI 或测试用研究方向样例。
- 文本型 PDF 上传后可生成 `localFullTextPath` 并可执行 AI 分析。
- 扫描/空文本 PDF 上传后不能执行 AI 分析，返回 `FULLTEXT_REQUIRED`。
- 执行开启邮箱推送的采集任务时只生成一条 `task_digest` 邮件，不再生成每篇 `paper_fulltext` 或 `analysis_report` 邮件。
- 任务邮件正文使用纯文本 `body_file`，不把 Markdown 直接作为邮件正文。
- 任务邮件附件不超过 3 个，全文和报告先转换为 PDF，再使用 ZIP 打包；任务摘要以 PDF 附件发送。
