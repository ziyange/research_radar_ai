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
                    "你是严谨的科研文献分析助手。请输出 Markdown，不要输出 JSON。",
                    "必须按以下二级标题顺序输出，标题不得增删或重复：文献身份、中文标题翻译、摘要完整翻译、研究问题、方法与实验设计、关键结果与证据、核心逻辑流程图、局限与不可追溯点、可借鉴的点、与当前研究方向的关系、精读问题、后续检索建议。",
                    "文献身份必须用 Markdown 表格，核心逻辑流程图必须用 fenced mermaid flowchart。",
                    "所有关键结论必须来自输入的全文片段；如果全文片段没有覆盖某项信息，写“全文未覆盖，需人工核验”，不要编造。",
                    "摘要翻译要完整翻译输入摘要；如果摘要缺失，说明摘要缺失。",
                    f"检索上下文: {query}",
                    f"论文序号: {index}",
                    f"本地论文元数据 JSON: {json.dumps(paper, ensure_ascii=False)}",
                    f"本地全文 Markdown 片段: {fulltext[:55000]}",
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
                        "max_tokens": 5200,
                        "enable_thinking": False,
                        "messages": [
                            {"role": "system", "content": "你只输出 Markdown 小节正文，不输出解释。"},
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
| 作者 | {authors} |
| 年份 | {paper.get("year") or "未知"} |
| 期刊 | {paper.get("journal") or paper.get("source") or "未知"} |
| DOI | {paper.get("doi") or "未提供"} |
| 正文来源 | {paper.get("fullTextSource") or "未知"} |

## 中文标题翻译
{title}

## 摘要完整翻译
{abstract}

## 研究问题
第 {index} 篇文献围绕 {title} 展开，适合围绕“{query}”做候选精读。

## 核心逻辑流程图
```mermaid
flowchart TD
  A[背景/问题: 全文片段提示研究问题] --> B[目的: 判断与当前方向的关系]
  B --> C[方法: 提取实验设计和证据]
  C --> D[结果: 基于全文片段核验]
  D --> E[结论: 可作为候选精读]
  E --> F[可借鉴点: 提炼变量、指标和方法迁移]
```

## 方法与实验设计
- 全文证据：{evidence}

## 关键结果与证据
- 全文证据：{evidence}

## 局限与不可追溯点
- 当前没有完整正文时，不能声称已经阅读图表或补充材料。

## 可借鉴的点
- 研究问题拆解
- 关键词与检索式扩展
- 方法路线或评价指标参考

## 与当前研究方向的关系
- 当前方向：{query}
- 关系判断：需要结合全文进一步确认。

## 精读问题
- 是否有可下载 PDF？
- 方法、对照组和关键变量是否完整？
- 是否有可迁移到当前课题的指标？

## 后续检索建议
- 以 DOI 和关键词进行二次检索。
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



