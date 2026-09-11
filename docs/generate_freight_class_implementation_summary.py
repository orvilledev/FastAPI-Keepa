"""
Generate MSW Overwatch-style implementation summary PDF for Freight Class Calculator.
Matches Testing Playground / DNK Label Station / New Vendor (JFS) reference format.

Run:  python docs/generate_freight_class_implementation_summary.py
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
OUTPUT = ROOT / "docs" / "Freight Class Calculator - Implementation Summary _ MSW Overwatch.pdf"

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
            c.drawString(M_L, PAGE_H - 54, "Freight Class Calculator")

            c.setFont("SegoeUI", 11)
            c.setFillColor(C_SUBTITLE)
            c.drawString(M_L, PAGE_H - 73, "Implementation summary \u2014 MSW Overwatch")

            c.setFont("SegoeUI-Bold", 10)
            c.setFillColor(C_META_BOLD)
            c.drawRightString(PAGE_W - M_R, PAGE_H - 48, "MetroShoe Warehouse")

            c.setFont("SegoeUI", 9)
            c.setFillColor(C_SUBTITLE)
            c.drawRightString(PAGE_W - M_R, PAGE_H - 62, "September 2026 \u00b7 App v3.4.0")

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
                    "<b>Freight Class Calculator</b> is a gated LTL tool under "
                    "<b>Tools \u2192 Freight Class</b>. Authorized users enter pallet "
                    "dims manually or bulk-upload Excel, get NMFC density class "
                    "(XPO-compatible, including the optional 75\u2033 height rule), "
                    "then copy or export a Summary workbook.",
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
            "MSW Overwatch \u2014 Freight Class Calculator \u00b7 FastAPI-Keepa-Dashboard",
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


def _modes_table(S: dict) -> Table:
    return _half_table(
        S,
        ["Mode", "Input \u2192 Output"],
        [
            [
                "Manual",
                "Pallet rows in UI \u2192 class + density on screen",
            ],
            [
                "Bulk upload",
                ".xlsx template \u2192 multi-shipment results",
            ],
            [
                "Export",
                "Results \u2192 <b>Freight Class Summary.xlsx</b>",
            ],
            [
                "Copy",
                "Tab-separated summary to clipboard",
            ],
        ],
        HALF_W,
    )


def _access_table(S: dict) -> Table:
    return _half_table(
        S,
        ["User", "Access"],
        [
            [
                "Allowlisted emails",
                "sunshine@, stephanie@, paolo@, paulo@, johnbernard@ "
                "(metroshoewarehouse.com)",
            ],
            [
                "Superadmins",
                "Full Freight Class access",
            ],
            [
                "All other users",
                "No sidebar link; route blocked by API + UI gate",
            ],
        ],
        HALF_W,
    )


def _flow_table(S: dict) -> Table:
    return _simple_table(
        S,
        ["Step", "What happens"],
        [
            [
                "1. Open tool",
                "Sidebar <b>Tools \u2192 Freight Class</b> "
                "(allowlisted + superadmin only)",
            ],
            [
                "2. Choose mode",
                "<b>Manual</b> entry or <b>Bulk upload</b> of the Excel template",
            ],
            [
                "3. Height rule",
                "Optional toggle: skip XPO <b>75\u201395\u2033 \u2192 96\u2033</b> bump "
                "before density",
            ],
            [
                "4. Calculate",
                "Rows grouped by Shipment ID; density (lb/ft\u00b3) maps to "
                "NMFC 13-sub class",
            ],
            [
                "5. Share",
                "Copy summary, or export Summary + Line Items workbook",
            ],
        ],
        col_fracs=[0.18, 0.82],
    )


def _columns_table(S: dict) -> Table:
    return _simple_table(
        S,
        ["Column", "Meaning"],
        [
            ["Shipment ID", "Groups pallet rows (blank rows inherit prior ID)"],
            [
                "Pallet Number",
                "Line label only (#1, #2, \u2026) \u2014 <b>not</b> used in math",
            ],
            [
                "Pallet Count",
                "How many identical pallets this row represents "
                "(volume multiplier)",
            ],
            ["Weight", "Total weight (lbs) for that row"],
            ["Length / Width / Height", "Inches; height may be adjusted by 75\u2033 rule"],
        ],
        col_fracs=[0.28, 0.72],
    )


def _nmfc_table(S: dict) -> Table:
    return _half_table(
        S,
        ["Density (lb/ft\u00b3)", "Class"],
        [
            ["50+", "50"],
            ["35 \u2013 50", "55"],
            ["30 \u2013 35", "60"],
            ["22.5 \u2013 30", "65"],
            ["15 \u2013 22.5", "70"],
            ["12 \u2013 15", "85"],
            ["10 \u2013 12", "92.5"],
            ["8 \u2013 10", "100"],
            ["6 \u2013 8", "125"],
            ["4 \u2013 6", "175"],
            ["2 \u2013 4", "250"],
            ["1 \u2013 2", "300"],
            ["&lt; 1", "400"],
        ],
        HALF_W,
    )


def _rollout_table(S: dict) -> Table:
    left = [
        Paragraph(
            "Confirm <b>Freight Class</b> appears under Tools only for allowlisted emails",
            S["bullet"],
        ),
        Spacer(1, 5),
        Paragraph(
            "Download template; verify headers: Shipment ID, "
            "<b>Pallet Number</b>, <b>Pallet Count</b>, Weight, L/W/H",
            S["bullet"],
        ),
        Spacer(1, 5),
        Paragraph(
            "Bulk-upload the sample rows; confirm two shipments and correct classes",
            S["bullet"],
        ),
        Spacer(1, 5),
        Paragraph(
            "Toggle <b>Skip 75\u2033 height rule</b> on a 80\u2033 pallet and compare density",
            S["bullet"],
        ),
    ]
    right = [
        Paragraph(
            "Manual mode: enter Pallet Count (not Number); Calculate; Copy summary",
            S["bullet"],
        ),
        Spacer(1, 5),
        Paragraph(
            "Export <b>Freight Class Summary.xlsx</b> "
            "(Summary + Line Items with #n labels)",
            S["bullet"],
        ),
        Spacer(1, 5),
        Paragraph(
            "Legacy file with old <b>Pallets</b> column still calculates",
            S["bullet"],
        ),
        Spacer(1, 5),
        Paragraph(
            "Non-allowlisted user: no sidebar entry; API returns restricted",
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
        title="Freight Class Calculator \u2014 Implementation Summary",
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
            "Freight Class Calculator turns pallet dimensions and weights into "
            "an <b>NMFC density-based LTL freight class</b> (13-sub scale, "
            "effective July 2025). Staff can calculate one shipment by hand or "
            "many shipments from Excel, then share results without leaving Overwatch.",
            S["body"],
        ),
    ]
    right_bv = sec("BUSINESS VALUE") + [
        Paragraph(
            "One consistent XPO-compatible class for warehouse / ops quotes",
            S["bullet"],
        ),
        Spacer(1, 4),
        Paragraph(
            "Bulk Excel avoids re-keying multi-pallet FBA / vendor shipments",
            S["bullet"],
        ),
        Spacer(1, 4),
        Paragraph(
            "Optional 75\u2033 rule matches carrier behavior when needed",
            S["bullet"],
        ),
        Spacer(1, 4),
        Paragraph(
            "Gated to named warehouse users + superadmin",
            S["bullet"],
        ),
    ]
    story.append(_two_col(left_what, right_bv))
    story.append(Spacer(1, 10))
    story.append(_divider(C_W))
    story.append(Spacer(1, 8))

    story.append(Paragraph("HOW A CALCULATION WORKS", S["section"]))
    story.append(_divider(C_W))
    story.append(Spacer(1, 6))
    story.append(_flow_table(S))
    story.append(Spacer(1, 8))
    story.append(_divider(C_W))
    story.append(Spacer(1, 8))

    left_modes = sec("MODES & OUTPUTS") + [_modes_table(S)]
    right_persist = sec("KEY RULES") + [
        Paragraph(
            "<b>Pallet Number</b> \u2260 <b>Pallet Count</b> \u2014 Number is a "
            "label; Count multiplies volume",
            S["bullet"],
        ),
        Spacer(1, 4),
        Paragraph(
            "Density = total weight \u00f7 total cubic feet (after height rule)",
            S["bullet"],
        ),
        Spacer(1, 4),
        Paragraph(
            "Legacy column name <b>Pallets</b> still maps to Pallet Count",
            S["bullet"],
        ),
        Spacer(1, 4),
        Paragraph(
            "Audit: calculate / export / template download events",
            S["bullet"],
        ),
    ]
    story.append(_two_col(left_modes, right_persist))

    story.append(NextPageTemplate("Later"))
    story.append(PageBreak())

    story.append(Paragraph("EXCEL TEMPLATE COLUMNS", S["section"]))
    story.append(_divider(C_W))
    story.append(Spacer(1, 6))
    story.append(
        Paragraph(
            "Sheet name: <b>Pallet Dims</b>. Download from the tool or API "
            "<b>/freight-class-calculator/template</b>.",
            S["body"],
        )
    )
    story.append(Spacer(1, 6))
    story.append(_columns_table(S))
    story.append(Spacer(1, 10))
    story.append(_divider(C_W))
    story.append(Spacer(1, 8))

    left_access = sec("WHO HAS ACCESS") + [_access_table(S)]
    right_nmfc = sec("NMFC DENSITY SCALE") + [_nmfc_table(S)]
    story.append(_two_col(left_access, right_nmfc))
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
            "Shipped on web app version <b>3.4.0</b> "
            "(backend service + React Tools page)",
            S["bullet"],
        )
    )
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            "Route: <b>/freight-class-calculator</b> \u00b7 "
            "Sidebar: <b>Tools \u2192 Freight Class</b>",
            S["bullet"],
        )
    )
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            "Allowlist lives in backend config + matching frontend "
            "<b>freightClassAccess.ts</b> (keep in sync)",
            S["bullet"],
        )
    )
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            "Does not touch Keepa jobs, Daily Runs, MAP, or warehouse catalog data",
            S["bullet"],
        )
    )
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            "Class is density-only guidance; carrier quotes may still apply "
            "additional NMFC item / packaging rules",
            S["bullet"],
        )
    )

    doc.build(story)
    return OUTPUT


if __name__ == "__main__":
    out = build_pdf()
    print(f"Wrote: {out}")
