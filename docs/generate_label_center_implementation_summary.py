"""
Generate MSW Overwatch-style implementation summary PDF for Label Center.
Matches Testing Playground / DNK Label Station / Freight Class / FBA Box Contents format.

Run:  python docs/generate_label_center_implementation_summary.py
"""
from __future__ import annotations

from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    NextPageTemplate,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

ROOT = Path(__file__).resolve().parent.parent
FONTS_DIR = Path(r"C:\Windows\Fonts")
OUTPUT = ROOT / "docs" / "Label Center - Implementation Summary _ MSW Overwatch.pdf"

PAGE_W, PAGE_H = letter
M_L = 36
M_R = 36
M_B = 36
C_W = PAGE_W - M_L - M_R
HALF_W = C_W / 2 - 9

C_TITLE = colors.HexColor("#111827")
C_SUBTITLE = colors.HexColor("#4b5563")
C_META_BOLD = colors.HexColor("#1f2937")
C_STATUS = colors.HexColor("#9a3412")
C_INTRO = colors.HexColor("#7c2d12")
C_BODY = colors.HexColor("#1f2937")
C_SECTION = colors.HexColor("#ea580c")
C_ACCENT_BAR = colors.HexColor("#ea580c")
C_BADGE_STROKE = colors.HexColor("#fdba74")
C_TABLE_HEAD = colors.HexColor("#e8ecf1")
C_DIVIDER = colors.HexColor("#e5e7eb")
C_TABLE_BORDER = colors.HexColor("#d1d5db")
C_FOOTER = colors.HexColor("#6b7280")


def _reg_fonts() -> None:
    pdfmetrics.registerFont(TTFont("SegoeUI", str(FONTS_DIR / "segoeui.ttf")))
    pdfmetrics.registerFont(TTFont("SegoeUI-Bold", str(FONTS_DIR / "segoeuib.ttf")))
    pdfmetrics.registerFont(TTFont("SegoeUI-Semibold", str(FONTS_DIR / "segoeuib.ttf")))


def _make_styles() -> dict:
    def ps(name, fn, sz, col, lead, **kw):
        return ParagraphStyle(
            name, fontName=fn, fontSize=sz, textColor=col, leading=lead, **kw
        )

    R, B, S = "SegoeUI", "SegoeUI-Bold", "SegoeUI-Semibold"
    return {
        "section": ps("section", B, 10, C_SECTION, 13, spaceAfter=4),
        "body": ps("body", R, 10, C_BODY, 14),
        "body_b": ps("body_b", B, 10, C_BODY, 14),
        "bullet": ps("bullet", R, 10, C_BODY, 14),
        "step": ps("step", R, 10, C_BODY, 14, spaceAfter=3),
        "footer": ps("footer", R, 8.5, C_FOOTER, 11),
        "th": ps("th", S, 9.5, colors.HexColor("#374151"), 13),
        "td": ps("td", R, 9.5, C_BODY, 13),
        "td_b": ps("td_b", S, 9.5, C_BODY, 13),
    }


def _make_page_callback(page_num: int):
    def _draw(canvas, doc):
        from reportlab.platypus import Frame as RLFrame

        c = canvas
        c.saveState()

        c.setFillColor(colors.white)
        c.roundRect(
            32.25,
            M_B - 3.75,
            PAGE_W - 2 * 32.25 + 3.75,
            PAGE_H - 2 * (M_B - 3.75) - 36,
            6,
            fill=1,
            stroke=0,
        )

        if page_num == 1:
            c.setFont("SegoeUI-Bold", 22)
            c.setFillColor(C_TITLE)
            c.drawString(M_L, PAGE_H - 54, "Label Center")

            c.setFont("SegoeUI", 11)
            c.setFillColor(C_SUBTITLE)
            c.drawString(M_L, PAGE_H - 73, "Implementation summary \u2014 MSW Overwatch")

            c.setFont("SegoeUI-Bold", 10)
            c.setFillColor(C_META_BOLD)
            c.drawRightString(PAGE_W - M_R, PAGE_H - 48, "MetroShoe Warehouse")

            c.setFont("SegoeUI", 9)
            c.setFillColor(C_SUBTITLE)
            c.drawRightString(PAGE_W - M_R, PAGE_H - 62, "October 2026 \u00b7 App v3.6.7")

            c.setFillColor(C_ACCENT_BAR)
            c.rect(M_L, PAGE_H - 86.25, C_W, 2.25, fill=1, stroke=0)

            badge_y_top = 97.125
            badge_y_bottom = 205.0
            badge_h = badge_y_bottom - badge_y_top

            c.setFillColor(colors.white)
            c.setStrokeColor(C_BADGE_STROKE)
            c.setLineWidth(0.75)
            c.roundRect(
                36.375,
                PAGE_H - badge_y_bottom,
                PAGE_W - 2 * 36.375,
                badge_h,
                6,
                fill=1,
                stroke=1,
            )

            badge_frame = RLFrame(
                49,
                PAGE_H - badge_y_bottom + 6,
                C_W - 13,
                badge_h - 12,
                leftPadding=0,
                rightPadding=0,
                topPadding=0,
                bottomPadding=0,
            )
            s_status = ParagraphStyle(
                "bs",
                fontName="SegoeUI-Bold",
                fontSize=11,
                textColor=C_STATUS,
                leading=14,
            )
            s_intro = ParagraphStyle(
                "bi",
                fontName="SegoeUI",
                fontSize=10.5,
                textColor=C_INTRO,
                leading=14.5,
            )
            badge_content = [
                Paragraph("STATUS: SUCCESSFULLY IMPLEMENTED", s_status),
                Spacer(1, 6),
                Paragraph(
                    "<b>Label Center</b> prints carton labels in the browser. "
                    "Staff enter a <b>TO number</b> and the boxes to print "
                    "(one box, a range, or a list), or pick a <b>text label</b>. "
                    "Each label is <b>2.25 \u00d7 1.5 in</b>. On the desktop app, "
                    "everyone sees Label Center except <b>hello@warehouserepublic.com</b>.",
                    s_intro,
                ),
            ]
            badge_frame.addFromList(badge_content, c)
        else:
            c.setFillColor(C_ACCENT_BAR)
            c.rect(M_L, PAGE_H - 42, C_W, 2.25, fill=1, stroke=0)
            c.setFont("SegoeUI-Bold", 10)
            c.setFillColor(C_META_BOLD)
            c.drawRightString(PAGE_W - M_R, PAGE_H - 28, "MetroShoe Warehouse")

        c.setFont("SegoeUI", 8.5)
        c.setFillColor(C_FOOTER)
        c.drawString(
            M_L,
            24,
            "MSW Overwatch \u2014 Label Center \u00b7 FastAPI-Keepa-Dashboard",
        )
        c.drawRightString(PAGE_W - M_R, 24, "Print this page (Ctrl+P) \u2192 Save as PDF")
        c.restoreState()

    return _draw


def _divider(width: float = C_W):
    t = Table([[""]], colWidths=[width], rowHeights=[0.75])
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), C_DIVIDER),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ]
        )
    )
    return t


def _two_col(left: list, right: list) -> Table:
    t = Table([[left, right]], colWidths=[HALF_W, HALF_W])
    t.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (0, 0), 9),
                ("RIGHTPADDING", (1, 0), (1, 0), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ]
        )
    )
    return t


def _simple_table(S: dict, headers: list[str], rows: list[list[str]], col_fracs=None) -> Table:
    n = len(headers)
    if col_fracs is None:
        col_fracs = [1 / n] * n
    widths = [C_W * f for f in col_fracs]
    data = [[Paragraph(h, S["th"]) for h in headers]]
    for row in rows:
        data.append([Paragraph(cell, S["td"] if i else S["td_b"]) for i, cell in enumerate(row)])
    t = Table(data, colWidths=widths)
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), C_TABLE_HEAD),
                ("BOX", (0, 0), (-1, -1), 0.75, C_TABLE_BORDER),
                ("INNERGRID", (0, 0), (-1, -1), 0.75, C_TABLE_BORDER),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]
        )
    )
    return t


def _half_table(S: dict, headers: list[str], rows: list[list[str]], width: float) -> Table:
    n = len(headers)
    widths = [width / n] * n
    data = [[Paragraph(h, S["th"]) for h in headers]]
    for row in rows:
        data.append([Paragraph(cell, S["td"] if i else S["td_b"]) for i, cell in enumerate(row)])
    t = Table(data, colWidths=widths)
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), C_TABLE_HEAD),
                ("BOX", (0, 0), (-1, -1), 0.75, C_TABLE_BORDER),
                ("INNERGRID", (0, 0), (-1, -1), 0.75, C_TABLE_BORDER),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]
        )
    )
    return t


def _glance_table(S: dict) -> Table:
    return _simple_table(
        S,
        ["Label", "Input", "Output"],
        [
            [
                "TO / box labels",
                "TO number plus one box, a range (<b>1-10</b>), or a list (<b>1,2,8</b>)",
                "One <b>2.25 \u00d7 1.5 in</b> page per box; CODE128 of the TO number",
            ],
            [
                "Text label",
                "A preset message or custom text (up to 180 characters)",
                "One label; bold type grows until it fills the page",
            ],
        ],
        col_fracs=[0.22, 0.40, 0.38],
    )


def _flow_table(S: dict) -> Table:
    return _simple_table(
        S,
        ["Step", "What happens"],
        [
            [
                "1. Open tool",
                "Sidebar <b>Label Center</b> on the web and in the desktop app "
                "(hidden on desktop for hello@warehouserepublic.com)",
            ],
            [
                "2. Enter the job",
                "Type the TO number and the boxes, or pick / type a text message",
            ],
            [
                "3. Generate",
                "The browser builds the PDF locally and draws a preview of every page",
            ],
            [
                "4. Print or save",
                "<b>Print</b> opens the system print dialog; <b>Download PDF</b> saves the file",
            ],
        ],
        col_fracs=[0.18, 0.82],
    )


def _to_box_table(S: dict) -> Table:
    return _simple_table(
        S,
        ["Item", "Detail"],
        [
            [
                "Stock",
                "<b>2.25 in \u00d7 1.5 in</b> landscape (162 \u00d7 108 pt). "
                "Artwork scaled from the earlier 6 \u00d7 4 in layout.",
            ],
            [
                "TO number",
                "Letters, numbers, and hyphens; stored uppercase with spaces removed; max 32 characters",
            ],
            [
                "Boxes",
                "One number, an inclusive range, or a comma list in the order typed. "
                "Box numbers start at 1. At most <b>200 labels</b> per run.",
            ],
            [
                "Barcode",
                "<b>CODE128</b> of the TO number on every page (no human-readable digits under the bars)",
            ],
            [
                "Layout",
                "Rounded border, centered TO, barcode, then <b>Box</b> and the underlined box number",
            ],
            [
                "File name",
                "<b>TO123-box-4.pdf</b>, <b>TO123-boxes-1-10.pdf</b> for a range, "
                "or <b>TO123-boxes-1-2-8.pdf</b> for a short list",
            ],
        ],
        col_fracs=[0.22, 0.78],
    )


def _text_table(S: dict) -> Table:
    return _simple_table(
        S,
        ["Item", "Detail"],
        [
            [
                "Presets",
                "BARCODES NEED COVERED \u00b7 READY TO BAG BARCODES COVERED \u00b7 "
                "BAGGED READY TO LABEL \u00b7 LABELED READY TO RECEIVE",
            ],
            [
                "Custom text",
                "Any message up to 180 characters. Blank lines are collapsed. "
                "A line break starts a new line on the label.",
            ],
            [
                "Fit",
                "Bold Helvetica grows as large as it can while staying inside the border. "
                "A single paragraph is broken into the line split that fills the label best.",
            ],
            [
                "Stock",
                "Same <b>2.25 \u00d7 1.5 in</b> page and rounded border as the TO / box label",
            ],
            [
                "File name",
                "Lowercase slug of the message, such as <b>barcodes-need-covered.pdf</b>",
            ],
        ],
        col_fracs=[0.22, 0.78],
    )


def _access_table(S: dict) -> Table:
    return _half_table(
        S,
        ["User", "Access"],
        [
            [
                "Web",
                "Anyone who can open Label Station (Keepa access or a warehouse account)",
            ],
            [
                "Desktop",
                "Every signed-in desktop user sees Label Center",
            ],
            [
                "hello@warehouserepublic.com",
                "Hidden on the desktop app; /label-center opens Label Station",
            ],
        ],
        HALF_W,
    )


def _rollout_table(S: dict) -> Table:
    left = [
        Paragraph(
            "Web: confirm <b>Label Center</b> in the sidebar for a Keepa user and a warehouse account",
            S["bullet"],
        ),
        Spacer(1, 5),
        Paragraph(
            "Desktop: sign in as any account other than hello@ and confirm the Label Center link",
            S["bullet"],
        ),
        Spacer(1, 5),
        Paragraph(
            "Desktop hello@warehouserepublic.com: no Label Center link; a direct /label-center URL lands on Label Station",
            S["bullet"],
        ),
        Spacer(1, 5),
        Paragraph(
            "TO <b>TO123456</b> with boxes <b>1-3</b>: three preview pages, barcode encodes TO123456",
            S["bullet"],
        ),
    ]
    right = [
        Paragraph(
            "Boxes <b>1,2,8</b>: three labels in that order, not boxes 3 through 7",
            S["bullet"],
        ),
        Spacer(1, 5),
        Paragraph(
            "Reject an empty TO, a reversed range such as 10-1, and a run over 200 boxes",
            S["bullet"],
        ),
        Spacer(1, 5),
        Paragraph(
            "Text preset <b>BAGGED READY TO LABEL</b> fills the 2.25 \u00d7 1.5 in page; Print and Download both work",
            S["bullet"],
        ),
        Spacer(1, 5),
        Paragraph(
            "Desktop 3.6.7 is the published GitHub release so installed apps can auto-update",
            S["bullet"],
        ),
    ]
    t = Table([[left, right]], colWidths=[HALF_W, HALF_W])
    t.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (0, 0), 9),
                ("RIGHTPADDING", (1, 0), (1, 0), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ]
        )
    )
    return t


def build_pdf() -> Path:
    _reg_fonts()
    S = _make_styles()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)

    frame1 = Frame(
        M_L,
        M_B,
        C_W,
        PAGE_H - 230 - M_B,
        id="p1",
        leftPadding=0,
        rightPadding=0,
        topPadding=0,
        bottomPadding=0,
    )
    frame2 = Frame(
        M_L,
        M_B,
        C_W,
        PAGE_H - 52 - M_B,
        id="p2",
        leftPadding=0,
        rightPadding=0,
        topPadding=0,
        bottomPadding=0,
    )

    doc = BaseDocTemplate(
        str(OUTPUT),
        pagesize=letter,
        leftMargin=M_L,
        rightMargin=M_R,
        topMargin=M_B,
        bottomMargin=M_B,
        title="Label Center \u2014 Implementation Summary",
    )
    doc.addPageTemplates(
        [
            PageTemplate(id="First", frames=frame1, onPage=_make_page_callback(1)),
            PageTemplate(id="Later", frames=frame2, onPage=_make_page_callback(2)),
        ]
    )

    def sec(title, divider_width=HALF_W):
        return [
            Paragraph(title, S["section"]),
            _divider(divider_width),
            Spacer(1, 6),
        ]

    story = []

    left_what = sec("WHAT IT DOES") + [
        Paragraph(
            "Label Center prints carton labels without a catalog lookup. "
            "One section builds a page for each box on a transfer order. "
            "The other prints a short floor message, such as a ready-to-bag "
            "or ready-to-receive notice, sized to fill the same stock.",
            S["body"],
        ),
    ]
    right_bv = sec("BUSINESS VALUE") + [
        Paragraph(
            "One TO number, many box labels, generated in the browser",
            S["bullet"],
        ),
        Spacer(1, 4),
        Paragraph(
            "Ranges and lists print only the boxes that were typed",
            S["bullet"],
        ),
        Spacer(1, 4),
        Paragraph(
            "Floor messages use the same 2.25 \u00d7 1.5 in label",
            S["bullet"],
        ),
        Spacer(1, 4),
        Paragraph(
            "Desktop users can print Label Center in the app, except hello@",
            S["bullet"],
        ),
    ]
    story.append(_two_col(left_what, right_bv))
    story.append(Spacer(1, 10))
    story.append(_divider(C_W))
    story.append(Spacer(1, 8))

    story.append(Paragraph("HOW A PRINT RUN WORKS", S["section"]))
    story.append(_divider(C_W))
    story.append(Spacer(1, 6))
    story.append(_flow_table(S))
    story.append(Spacer(1, 8))
    story.append(_divider(C_W))
    story.append(Spacer(1, 8))

    story.append(Paragraph("LABELS AT A GLANCE", S["section"]))
    story.append(_divider(C_W))
    story.append(Spacer(1, 6))
    story.append(_glance_table(S))

    story.append(NextPageTemplate("Later"))
    story.append(PageBreak())

    story.append(Paragraph("TO AND BOX LABELS", S["section"]))
    story.append(_divider(C_W))
    story.append(Spacer(1, 6))
    story.append(
        Paragraph(
            "Each box is its own PDF page. The barcode is the TO number, "
            "so every carton in the run scans to the same transfer order. "
            "The box number is printed and underlined on the right.",
            S["body"],
        )
    )
    story.append(Spacer(1, 6))
    story.append(_to_box_table(S))
    story.append(Spacer(1, 10))
    story.append(_divider(C_W))
    story.append(Spacer(1, 8))

    story.append(Paragraph("TEXT LABEL", S["section"]))
    story.append(_divider(C_W))
    story.append(Spacer(1, 6))
    story.append(
        Paragraph(
            "Four floor messages are one click. Custom text uses the same "
            "fit: the largest bold type that still sits inside the border.",
            S["body"],
        )
    )
    story.append(Spacer(1, 6))
    story.append(_text_table(S))

    story.append(PageBreak())

    left_access = sec("WHO HAS ACCESS") + [_access_table(S)]
    right_tech = sec("TECH NOTES") + [
        Paragraph(
            "UI: <b>LabelCenter.tsx</b> \u00b7 route <b>/label-center</b>",
            S["bullet"],
        ),
        Spacer(1, 4),
        Paragraph(
            "TO / box PDF: <b>toBoxLabel.ts</b> (jsPDF + JsBarcode)",
            S["bullet"],
        ),
        Spacer(1, 4),
        Paragraph(
            "Text PDF: <b>textLabel.ts</b> (same page size)",
            S["bullet"],
        ),
        Spacer(1, 4),
        Paragraph(
            "Desktop gate: <b>isLabelCenterAvailable</b> in <b>privatePath.ts</b>",
            S["bullet"],
        ),
        Spacer(1, 4),
        Paragraph(
            "Built in the browser \u2014 no API and no database table",
            S["bullet"],
        ),
        Spacer(1, 4),
        Paragraph(
            "Preview renders each PDF page with PDF.js",
            S["bullet"],
        ),
    ]
    story.append(_two_col(left_access, right_tech))
    story.append(Spacer(1, 12))
    story.append(_divider(C_W))
    story.append(Spacer(1, 8))

    story.append(Paragraph("KEY RULES", S["section"]))
    story.append(_divider(C_W))
    story.append(Spacer(1, 6))
    story.append(
        Paragraph(
            "Both label types print on <b>2.25 \u00d7 1.5 in</b> stock",
            S["bullet"],
        )
    )
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            "A comma list prints only those boxes, in the order typed \u2014 it does not fill the gaps",
            S["bullet"],
        )
    )
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            "Changing the TO or the box field clears the current preview until Generate is clicked again",
            S["bullet"],
        )
    )
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            "Label Center does not look up the warehouse catalog and does not replace Label Station or FNSKU Labels",
            S["bullet"],
        )
    )
    story.append(Spacer(1, 12))
    story.append(_divider(C_W))
    story.append(Spacer(1, 8))

    story.append(Paragraph("ROLLOUT CHECKLIST", S["section"]))
    story.append(_divider(C_W))
    story.append(Spacer(1, 8))
    story.append(_rollout_table(S))
    story.append(Spacer(1, 12))
    story.append(_divider(C_W))
    story.append(Spacer(1, 8))

    story.append(Paragraph("NOTES FOR LEADERSHIP", S["section"]))
    story.append(_divider(C_W))
    story.append(Spacer(1, 6))
    story.append(
        Paragraph(
            "Shipped on web / desktop app version <b>3.6.7</b> "
            "(TO / box labels and text labels on 2.25 \u00d7 1.5 in stock)",
            S["bullet"],
        )
    )
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            "Route: <b>/label-center</b> \u00b7 Sidebar: <b>Label Center</b>",
            S["bullet"],
        )
    )
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            "On the desktop app, Label Center is shown to every account except "
            "<b>hello@warehouserepublic.com</b>. The web stays open for Label Station users.",
            S["bullet"],
        )
    )
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            "Windows desktop auto-update is GitHub release <b>v3.6.7</b>",
            S["bullet"],
        )
    )
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            "Does not touch Keepa jobs, Daily Runs, MAP, or the Label Station product catalog",
            S["bullet"],
        )
    )

    doc.build(story)
    return OUTPUT


if __name__ == "__main__":
    out = build_pdf()
    print(f"Wrote: {out}")
