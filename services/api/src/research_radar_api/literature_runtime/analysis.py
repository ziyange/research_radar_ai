from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

import httpx

from research_radar_api.settings import get_settings

from .repository import ROOT_DIR
from .retrieval import slug
from .state import repository, resolve_reader_file


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def call_ai_markdown(papers: list[dict[str, Any]], query: str) -> str:
    settings = get_settings()
    if settings.ai_provider == "openai" and settings.ai_configured:
        sections = []
        for index, paper in enumerate(papers, 1):
            fulltext = read_paper_fulltext(paper)
            prompt = "\n\n".join(
                [
                    "你是严谨、耐心、擅长教学的科研文献精读导师。读者是刚进入该方向的研究人员，不是审稿专家。请输出中文 Markdown，不要输出 JSON，不要寒暄。",
                    "这不是摘要生成任务，也不是靠堆字数完成的长文任务；这是一份“带读式文献助读报告”。你的目标是让读者读完后能回答：论文解决什么问题、为什么这个问题重要、作者如何设计研究、每个证据支持了什么结论、哪些内容能迁移到自己的课题、哪些地方不能轻信。",
                    "深度分析的判定标准：每个重要判断都必须包含“是什么 -> 为什么重要 -> 作者如何验证/论证 -> 读者应该如何理解 -> 对当前研究有什么用或有什么风险”。如果缺少证据，不要扩写成确定结论，而要明确写“全文片段未覆盖，需人工核验”。",
                    "必须按以下二级标题顺序输出，标题不得增删、不得合并、不得重复：阅读导览、文献身份、标题中文翻译、摘要完整中文翻译、研究背景与问题、研究目标与创新点、材料/对象/数据、方法与实验设计拆解、关键结果逐条精读、核心逻辑流程图、图表与数据阅读指南、机制解释与因果链、可借鉴的点、与当前研究方向的关系、局限与不可追溯点、小白精读路线、后续检索建议。",
                    "阅读导览：用 4-6 句话先告诉读者这篇文章到底在解决什么问题、为什么值得读、读的时候应抓住哪条主线。这里要像导师开场讲解，不要只给一句摘要。",
                    "文献身份必须用 Markdown 表格，包含题名、中文题名、作者、年份、期刊、DOI、研究主题、正文来源、全文证据范围。",
                    "标题中文翻译必须翻译成简体中文。摘要完整中文翻译必须将输入摘要完整翻译成简体中文；不得保留整段英文原文，除非是不可翻译的术语或缩写。如果摘要在全文中缺失，要明确写“全文片段未覆盖摘要”。",
                    "研究背景与问题：写成 3-5 个有解释性的段落。先讲领域痛点，再讲已有方法或认识的不足，最后讲作者为什么必须提出这项研究。必须用通俗语言解释专业术语，不能只搬运论文句子。",
                    "研究目标与创新点：列出 3-6 条。每条必须标注来源类型：作者明确目标 / AI 根据全文归纳 / 需人工核验。每条后面补一句“它解决了前面哪个问题”。",
                    "材料/对象/数据：用表格列出研究对象、实验材料或数据来源、关键变量、对照组、评价指标、应用场景、可能影响结果的条件；没有覆盖的字段写“全文片段未覆盖”。",
                    "方法与实验设计拆解：至少 6 个步骤，每一步都必须写 4 个点：做了什么、为什么要做、它服务于哪个研究问题、它会产生哪类证据。不能只列方法名，不能只给流程名。",
                    "关键结果逐条精读：至少 6 条，若全文不足则尽量完整覆盖。每条必须包含四行：结论、证据片段或段落线索、为什么这条证据重要、读者容易误解的点。不要编造图号或具体数值。",
                    "核心逻辑流程图必须输出 fenced mermaid 代码块，格式必须是 ```mermaid 开始、``` 结束，中间使用 flowchart TD。不要输出 1/2/3 编号，不要把图写成普通列表。为了前端可视化兼容，不要使用 subgraph、style、classDef、edge label；只使用 A[节点] --> B[节点]。要求 8-14 个节点，至少有一个分支和一个汇合，节点文本不超过 24 个中文字符。",
                    "核心逻辑流程图示例格式（只学习格式，不要照抄内容）：```mermaid\nflowchart TD\n  A[领域痛点] --> B[科学问题]\n  B --> C[实验设计]\n  C --> D[关键证据一]\n  C --> E[关键证据二]\n  D --> F[机制解释]\n  E --> F\n  F --> G[研究结论]\n  G --> H[可借鉴点]\n```",
                    "图表与数据阅读指南：至少 4 条，说明读者打开 PDF 后应该优先看哪些图、表、指标、对照、统计显著性或趋势；每条都要说“为什么要看它”。没有覆盖时写“全文片段未覆盖，需打开 PDF 核验”。",
                    "机制解释与因果链：至少 3 段，用通俗语言解释作者的逻辑链条：某材料/方法/变量如何影响某指标，指标如何支持结论。必须区分“原文事实”“AI 归纳”“AI 推测”。",
                    "可借鉴的点：至少 6 条，分别从研究选题、实验设计、变量/对照、指标体系、图表表达、论文写作、当前课题迁移风险等角度写。每条都要说明“为什么值得借鉴”和“照搬会有什么风险”。",
                    "与当前研究方向的关系：结合检索上下文判断这篇论文对当前方向是直接相关、方法迁移、背景补充还是低相关，并说明理由；要写清楚它能补哪类知识缺口。",
                    "局限与不可追溯点：必须明确 PDF 抽取可能丢失表格、图片、公式；所有未在输入中出现的图号、数据和机制都要标注需人工核验。",
                    "小白精读路线：给 7-10 步阅读顺序，每一步都告诉读者该读论文哪一部分、要找什么信息、读懂后能回答什么问题。",
                    "后续检索建议：给 6-10 个可直接复制的中英文检索词/组合，并说明每个检索词用于补哪类证据。",
                    "输出前自检：如果摘要翻译仍是英文，重写；如果任一核心小节只有 1-2 句，补充解释；如果流程图不是 mermaid 代码块，重写；如果只是罗列概念而没有说明为什么重要，补充教学式解释；如果出现输入中没有的 DOI、题名、作者或具体数据，删除。",
                    f"检索上下文: {query}",
                    f"论文序号: {index}",
                    f"本地论文元数据 JSON: {json.dumps(paper, ensure_ascii=False)}",
                    f"本地全文 Markdown 片段: {fulltext[:85000]}",
                ]
            )
            async with httpx.AsyncClient(timeout=settings.ai_request_timeout_seconds) as client:
                response = await client.post(
                    f"{settings.openai_base_url.rstrip('/')}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {settings.openai_api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": settings.openai_model,
                        "temperature": 0.2,
                        "max_tokens": 14000,
                        "enable_thinking": False,
                        "messages": [
                            {
                                "role": "system",
                                "content": (
                                    "你只输出中文 Markdown 深度精读报告。必须完整翻译标题和摘要，"
                                    "必须用证据约束结论，必须面向初学研究者解释论文。"
                                ),
                            },
                            {"role": "user", "content": prompt},
                        ],
                    },
                )
                response.raise_for_status()
            sections.append(response.json()["choices"][0]["message"]["content"])
        model = settings.openai_model
    else:
        model = "mock-literature-analysis"
        sections = [mock_markdown_section(paper, query, index) for index, paper in enumerate(papers, 1)]
    if len(papers) == 1:
        title = f"# {papers[0].get('title')} AI 阅读报告"
    else:
        title = f"# {query or '本地文献'} AI 阅读报告"
    return "\n".join(
        [
            title,
            "",
            f"- 生成时间: {now_iso()}",
            f"- 模型: {model}",
            "- 数据来源: 本地已保存论文资产",
            "",
            *sections,
        ]
    )


def mock_markdown_section(paper: dict[str, Any], query: str, index: int) -> str:
    title = paper.get("title") or "Untitled"
    abstract = paper.get("abstract") or "摘要缺失，需回到来源页面核验。"
    authors = ", ".join(paper.get("authors") or []) or "未提供"
    fulltext = read_paper_fulltext(paper)
    evidence = fulltext[:260] if fulltext else "全文未覆盖，需人工核验。"
    return f"""## 文献身份
| 字段 | 内容 |
| --- | --- |
| 标题 | {title} |
| 中文题名 | （mock 模式无法可靠翻译；请切换 AI_PROVIDER=openai 获取正式中文翻译） |
| 作者 | {authors} |
| 年份 | {paper.get("year") or "未知"} |
| 期刊 | {paper.get("journal") or paper.get("source") or "未知"} |
| DOI | {paper.get("doi") or "未提供"} |
| 正文来源 | {paper.get("fullTextSource") or "未知"} |
| 全文证据范围 | 本地 Markdown 片段 {len(fulltext)} 字符 |

## 标题中文翻译
mock 模式不做真实翻译。正式使用时请配置真实大模型，系统会要求模型把标题翻译为简体中文。

## 摘要完整中文翻译
mock 模式不做真实翻译。原始摘要如下，正式模型会翻译成简体中文：

{abstract}

## 一句话读懂
这篇文献是围绕“{query}”方向的候选精读材料；正式模型会基于全文提炼论文真正要解决的问题。

## 研究背景与问题
- 需要回答：作者为什么研究这个问题？
- 需要核验：研究对象、应用场景、已有方法的不足。

## 研究目标与假设
- 候选目标：判断这篇文章是否为“{query}”提供方法、材料、指标或机制证据。
- 证据状态：mock 模式仅能提示结构，不能替代真实 AI 精读。

## 材料/对象/数据
- 作者、材料、实验对象或数据来源需要从全文中核验。

## 方法与实验设计
- 第一步：识别研究对象、核心变量和对照组。
- 第二步：提取实验流程、测量指标和统计/评价方式。
- 第三步：把方法与结果对应起来，确认每个结果由哪个实验支持。
- 全文证据片段：{evidence}

## 关键结果与证据
- 结论 1：需要从全文中提取主要结果；证据：{evidence}
- 结论 2：需要核验指标、实验条件和对照；证据：全文片段未覆盖时需人工核验。
- 结论 3：需要判断结果是否支持作者结论；证据：全文片段未覆盖时需人工核验。

## 核心逻辑流程图
```mermaid
flowchart TD
  A[背景: 识别领域问题与已有不足] --> B[研究问题: 这篇论文想解决什么]
  B --> C[方法: 材料/对象/变量/对照/指标]
  C --> D[证据: 结果数据与图表线索]
  D --> E[解释: 结果如何支持机制或结论]
  E --> F[借鉴: 可迁移的方法、指标或实验设计]
```

## 图表与数据该怎么看
- 先找方法图或流程图，理解实验设计。
- 再看结果图，确认每个指标与研究问题的关系。
- 如果 PDF/HTML 未提供图表文本，需要打开原文 PDF 人工核验。

## 机制解释
- 正式模型会解释“为什么这些结果能支持作者结论”，并区分事实、归纳和推测。

## 可借鉴的点
- 变量设计：哪些实验变量可以迁移到当前课题。
- 指标体系：哪些表征/评价指标值得复用。
- 对照方式：是否有可参考的对照组设计。
- 写作结构：背景、问题、方法、结果、局限如何组织。

## 与当前研究方向的关系
- 当前方向：{query}
- 关系判断：需要结合完整全文进一步确认。

## 局限与不可追溯点
- mock 模式不能提供真实翻译和深度结论。
- 如果本地全文来自 PDF 抽取，表格、图片和公式可能不完整。
- 任何未出现在全文片段中的具体数值、图号和结论都需要回到原文核验。

## 小白精读路线
1. 先读标题和摘要，圈出研究对象、方法、指标。
2. 读引言最后两段，确认研究问题和创新点。
3. 读方法，画出材料/变量/对照/测量指标。
4. 对照结果图表，逐条判断结果是否支撑结论。
5. 读讨论和局限，找可迁移点与不能直接照搬的部分。

## 后续检索建议
- 以 DOI、核心材料/方法、关键指标做二次检索。
"""


def read_paper_fulltext(paper: dict[str, Any]) -> str:
    path = resolve_reader_file(str(paper.get("localFullTextPath") or ""))
    if not path:
        return ""
    return path.read_text(encoding="utf-8", errors="ignore")


async def create_report(papers: list[dict[str, Any]], query: str, title: str | None = None) -> dict[str, Any]:
    markdown = await call_ai_markdown(papers, query)
    report = {
        "id": f"report_{uuid4()}",
        "title": title or f"{query or '本地文献'} AI 阅读报告",
        "paperIds": [paper["id"] for paper in papers],
        "model": get_settings().openai_model if get_settings().ai_provider == "openai" else "mock-literature-analysis",
        "createdAt": now_iso(),
        "markdownPath": "",
        "markdown": markdown,
    }
    report_path = repository.reports_dir / f"{slug(report['title'])}-{report['id']}.md"
    report_path.write_text(markdown, encoding="utf-8")
    report["markdownPath"] = str(report_path.relative_to(ROOT_DIR)).replace("\\", "/")
    repository.library["reports"] = [report, *repository.library["reports"]][:300]
    repository.save_library()
    return repository.serialize_report(report)



