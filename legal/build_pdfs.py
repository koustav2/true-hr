#!/usr/bin/env python3
"""
Regenerate the two legal PDFs from their markdown sources.

The originals were ReportLab/Helvetica, so this keeps the same look — the point
of regenerating is the contact address, not a redesign. Run it again whenever
the markdown changes; the PDFs are build output, not hand-edited files.

    python3 legal/build_pdfs.py
"""
import re
import sys
from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import ListFlowable, ListItem, Paragraph, SimpleDocTemplate, Spacer

HERE = Path(__file__).resolve().parent

DOCS = [
    ("PRIVACY_POLICY.md", "TrueHR-Privacy-Policy.pdf", "TrueHR — Privacy Policy"),
    ("TERMS_AND_CONDITIONS.md", "TrueHR-Terms-and-Conditions.pdf", "TrueHR — Terms and Conditions"),
]

styles = getSampleStyleSheet()
BODY = ParagraphStyle(
    "Body", parent=styles["Normal"], fontName="Helvetica",
    fontSize=9.5, leading=14, spaceAfter=7, alignment=4,   # justified
)
H1 = ParagraphStyle(
    "H1", parent=styles["Title"], fontName="Helvetica-Bold",
    fontSize=17, leading=21, spaceAfter=4, alignment=0,
)
H2 = ParagraphStyle(
    "H2", parent=styles["Heading2"], fontName="Helvetica-Bold",
    fontSize=11.5, leading=15, spaceBefore=12, spaceAfter=5,
)
META = ParagraphStyle(
    "Meta", parent=BODY, fontName="Helvetica-Bold",
    fontSize=9.5, spaceAfter=12, alignment=0,
)


def inline(md: str) -> str:
    """Markdown emphasis to ReportLab markup, with the XML escaped first."""
    out = md.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    out = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", out)
    out = re.sub(r"(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)", r"<i>\1</i>", out)
    out = re.sub(r"`(.+?)`", r"<font face='Courier'>\1</font>", out)
    return out


def build(md_path: Path, pdf_path: Path, title: str) -> int:
    lines = md_path.read_text(encoding="utf-8").split("\n")
    story, bullets = [], []

    def flush_bullets():
        if not bullets:
            return
        story.append(ListFlowable(
            [ListItem(Paragraph(inline(b), BODY), leftIndent=10) for b in bullets],
            bulletType="bullet", start="•", leftIndent=14, bulletFontSize=8,
        ))
        story.append(Spacer(1, 4))
        bullets.clear()

    for raw in lines:
        line = raw.rstrip()
        if line.startswith("- ") or line.startswith("* "):
            bullets.append(line[2:].strip())
            continue
        flush_bullets()
        if not line.strip():
            continue
        if line.startswith("# "):
            story.append(Paragraph(inline(line[2:].strip()), H1))
        elif line.startswith("## "):
            story.append(Paragraph(inline(line[3:].strip()), H2))
        elif line.startswith("### "):
            story.append(Paragraph(inline(line[4:].strip()), H2))
        elif line.startswith("---"):
            story.append(Spacer(1, 8))
        elif line.startswith("**Last updated"):
            story.append(Paragraph(inline(line), META))
        else:
            story.append(Paragraph(inline(line), BODY))
    flush_bullets()

    SimpleDocTemplate(
        str(pdf_path), pagesize=A4,
        leftMargin=20 * mm, rightMargin=20 * mm,
        topMargin=18 * mm, bottomMargin=18 * mm,
        title=title, author="L R Technology", subject=title,
    ).build(story)
    return pdf_path.stat().st_size


if __name__ == "__main__":
    for md, pdf, title in DOCS:
        src, dst = HERE / md, HERE / pdf
        if not src.exists():
            sys.exit(f"missing {src}")
        print(f"{pdf}: {build(src, dst, title):,} bytes")
