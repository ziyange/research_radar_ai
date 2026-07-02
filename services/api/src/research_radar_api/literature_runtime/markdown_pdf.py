from __future__ import annotations

import html
import re
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.platypus import (
    PageBreak,
    Paragraph,
    Preformatted,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


PDF_BODY_FONT = "STSong-Light"
PDF_MONO_FONT = "Courier"


def _register_fonts() -> None:
    try:
        pdfmetrics.getFont(PDF_BODY_FONT)
    except KeyError:
        pdfmetrics.registerFont(UnicodeCIDFont(PDF_BODY_FONT))
    pdfmetrics.registerFontFamily(
        PDF_BODY_FONT,
        normal=PDF_BODY_FONT,
        bold=PDF_BODY_FONT,
        italic=PDF_BODY_FONT,
        boldItalic=PDF_BODY_FONT,
    )


def _styles() -> dict[str, ParagraphStyle]:
    _register_fonts()
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "RRTitle",
            parent=base["Title"],
            fontName=PDF_BODY_FONT,
            fontSize=20,
            leading=27,
            textColor=colors.HexColor("#0F172A"),
            spaceAfter=11,
            alignment=TA_LEFT,
        ),
        "h1": ParagraphStyle(
            "RRH1",
            parent=base["Heading1"],
            fontName=PDF_BODY_FONT,
            fontSize=17,
            leading=23,
            textColor=colors.HexColor("#0B5F71"),
            spaceBefore=13,
            spaceAfter=8,
        ),
        "h2": ParagraphStyle(
            "RRH2",
            parent=base["Heading2"],
            fontName=PDF_BODY_FONT,
            fontSize=14,
            leading=20,
            textColor=colors.HexColor("#155E75"),
            spaceBefore=10,
            spaceAfter=6,
        ),
        "h3": ParagraphStyle(
            "RRH3",
            parent=base["Heading3"],
            fontName=PDF_BODY_FONT,
            fontSize=12,
            leading=18,
            textColor=colors.HexColor("#334155"),
            spaceBefore=8,
            spaceAfter=5,
        ),
        "body": ParagraphStyle(
            "RRBody",
            parent=base["BodyText"],
            fontName=PDF_BODY_FONT,
            fontSize=10.5,
            leading=16,
            textColor=colors.HexColor("#1F2937"),
            spaceAfter=6,
        ),
        "muted": ParagraphStyle(
            "RRMuted",
            parent=base["BodyText"],
            fontName=PDF_BODY_FONT,
            fontSize=9.5,
            leading=14,
            textColor=colors.HexColor("#64748B"),
            spaceAfter=5,
        ),
        "code": ParagraphStyle(
            "RRCode",
            parent=base["Code"],
            fontName=PDF_MONO_FONT,
            fontSize=8.8,
            leading=12,
            textColor=colors.HexColor("#334155"),
            backColor=colors.HexColor("#F8FAFC"),
            borderColor=colors.HexColor("#E2E8F0"),
            borderWidth=0.4,
            borderPadding=5,
            spaceBefore=5,
            spaceAfter=7,
        ),
        "cell": ParagraphStyle(
            "RRCell",
            parent=base["BodyText"],
            fontName=PDF_BODY_FONT,
            fontSize=8.6,
            leading=11.5,
            textColor=colors.HexColor("#1F2937"),
        ),
        "cell_header": ParagraphStyle(
            "RRCellHeader",
            parent=base["BodyText"],
            fontName=PDF_BODY_FONT,
            fontSize=8.8,
            leading=11.5,
            textColor=colors.HexColor("#0F172A"),
        ),
    }


def _inline_html(text: str) -> str:
    escaped = html.escape(text.strip())
    escaped = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", escaped)
    escaped = re.sub(r"`([^`]+)`", r'<font name="Courier">\1</font>', escaped)
    return escaped.replace("  ", "&nbsp;&nbsp;")


def _is_table_separator(line: str) -> bool:
    stripped = line.strip()
    if not stripped.startswith("|") or not stripped.endswith("|"):
        return False
    cells = [cell.strip() for cell in stripped.strip("|").split("|")]
    return bool(cells) and all(re.fullmatch(r":?-{3,}:?", cell or "") for cell in cells)


def _table_rows(lines: list[str], start: int) -> tuple[list[list[str]], int]:
    rows: list[list[str]] = []
    index = start
    while index < len(lines):
        line = lines[index].strip()
        if not (line.startswith("|") and line.endswith("|")):
            break
        if not _is_table_separator(line):
            rows.append([cell.strip() for cell in line.strip("|").split("|")])
        index += 1
    return rows, index


def _make_table(rows: list[list[str]], styles: dict[str, ParagraphStyle], content_width: float) -> Table:
    width = max(len(row) for row in rows)
    normalized = [row + [""] * (width - len(row)) for row in rows]
    data = []
    for row_index, row in enumerate(normalized):
        style = styles["cell_header"] if row_index == 0 else styles["cell"]
        data.append([Paragraph(_inline_html(cell), style) for cell in row])
    table = Table(data, colWidths=[content_width / width] * width, repeatRows=1, hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E0F2FE")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#0F172A")),
                ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#CBD5E1")),
                ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#94A3B8")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F8FAFC")]),
            ]
        )
    )
    return table


def _page_footer(canvas, doc) -> None:  # noqa: ANN001
    canvas.saveState()
    canvas.setFont(PDF_BODY_FONT, 8)
    canvas.setFillColor(colors.HexColor("#94A3B8"))
    canvas.drawRightString(doc.pagesize[0] - 18 * mm, 11 * mm, f"{doc.page}")
    canvas.restoreState()


def markdown_to_pdf(markdown: str, pdf_path: Path, title: str = "") -> Path:
    styles = _styles()
    pdf_path.parent.mkdir(parents=True, exist_ok=True)
    doc = SimpleDocTemplate(
        str(pdf_path),
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=18 * mm,
        bottomMargin=16 * mm,
        title=title or "Research Radar Document",
    )
    content_width = A4[0] - doc.leftMargin - doc.rightMargin
    flowables = []
    if title:
        flowables.extend([Paragraph(_inline_html(title), styles["title"]), Spacer(1, 4)])

    lines = markdown.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    index = 0
    paragraph_buffer: list[str] = []

    def flush_paragraph() -> None:
        if not paragraph_buffer:
            return
        text = " ".join(item.strip() for item in paragraph_buffer if item.strip())
        paragraph_buffer.clear()
        if text:
            flowables.append(Paragraph(_inline_html(text), styles["body"]))

    while index < len(lines):
        line = lines[index]
        stripped = line.strip()
        if not stripped:
            flush_paragraph()
            flowables.append(Spacer(1, 3))
            index += 1
            continue
        if stripped.startswith("```"):
            flush_paragraph()
            fence = stripped[3:].strip()
            index += 1
            block: list[str] = []
            while index < len(lines) and not lines[index].strip().startswith("```"):
                block.append(lines[index])
                index += 1
            if index < len(lines):
                index += 1
            label = f"{fence}\n" if fence else ""
            flowables.append(Preformatted(label + "\n".join(block), styles["code"]))
            continue
        if stripped.startswith("|") and stripped.endswith("|"):
            rows, next_index = _table_rows(lines, index)
            if len(rows) >= 2:
                flush_paragraph()
                flowables.append(_make_table(rows, styles, content_width))
                flowables.append(Spacer(1, 8))
                index = next_index
                continue
        heading = re.match(r"^(#{1,4})\s+(.+)$", stripped)
        if heading:
            flush_paragraph()
            level = len(heading.group(1))
            style_name = "h1" if level == 1 else "h2" if level == 2 else "h3"
            flowables.append(Paragraph(_inline_html(heading.group(2)), styles[style_name]))
            index += 1
            continue
        if stripped == "---":
            flush_paragraph()
            flowables.append(Spacer(1, 6))
            index += 1
            continue
        if stripped == "\\pagebreak":
            flush_paragraph()
            flowables.append(PageBreak())
            index += 1
            continue
        bullet = re.match(r"^([-*+]|\d+\.)\s+(.+)$", stripped)
        if bullet:
            flush_paragraph()
            flowables.append(Paragraph(f"• {_inline_html(bullet.group(2))}", styles["body"]))
            index += 1
            continue
        paragraph_buffer.append(line)
        index += 1
    flush_paragraph()
    if not flowables:
        flowables.append(Paragraph("空文档", styles["body"]))
    doc.build(flowables, onFirstPage=_page_footer, onLaterPages=_page_footer)
    return pdf_path


def markdown_file_to_pdf(markdown_path: Path, pdf_path: Path, title: str = "") -> Path:
    markdown = markdown_path.read_text(encoding="utf-8", errors="ignore")
    return markdown_to_pdf(markdown, pdf_path, title=title)


def markdown_to_plain_text(markdown: str, max_chars: int = 9000) -> str:
    text = markdown.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"```[\s\S]*?```", lambda match: match.group(0).strip("`"), text)
    text = re.sub(r"^#{1,6}\s*", "", text, flags=re.MULTILINE)
    text = re.sub(r"\*\*(.+?)\*\*", r"\1", text)
    text = re.sub(r"`([^`]+)`", r"\1", text)
    text = re.sub(r"^\s*\|(.+)\|\s*$", lambda match: "  ".join(cell.strip() for cell in match.group(1).split("|")), text, flags=re.MULTILINE)
    text = re.sub(r"^\s*:?-{3,}:?(?:\s+\s*:?-{3,}:?)*\s*$", "", text, flags=re.MULTILINE)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    if len(text) > max_chars:
        return f"{text[:max_chars].rstrip()}\n\n正文已截断，完整内容请查看附件 PDF。"
    return text
