"""
Generate MSW Overwatch-style implementation summary PDF for FBA Box Contents.
Matches Testing Playground / DNK Label Station / Freight Class reference format.

Run:  python docs/generate_fba_box_contents_implementation_summary.py
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
OUTPUT = ROOT / "docs" / "FBA Box Contents - Implementation Summary _ MSW Overwatch.pdf"

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
            c.drawString(M_L, PAGE_H - 54, "FBA Box Contents")

            c.setFont("SegoeUI", 11)
            c.setFillColor(C_SUBTITLE)
            c.drawString(M_L, PAGE_H - 73, "Implementation summary \u2014 MSW Overwatch")

            c.setFont("SegoeUI-Bold", 10)
            c.setFillColor(C_META_BOLD)
            c.drawRightString(PAGE_W - M_R, PAGE_H - 48, "MetroShoe Warehouse")

            c.setFont("SegoeUI", 9)
            c.setFillColor(C_SUBTITLE)
            c.drawRightString(PAGE_W - M_R, PAGE_H - 62, "September 2026 \u00b7 App v3.5.1")

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
                    "<b>FBA Box Contents</b> is a gated Tools converter under "
                    "<b>Tools \u2192 FBA Box Contents</b>. Authorized users upload "
                    "an Amazon FBA Carton Detail Excel dump and download a typed "
                    "workbook with Box Contents (plus quantity pivot) and Dimensions.",
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
            "MSW Overwatch \u2014 FBA Box Contents \u00b7 FastAPI-Keepa-Dashboard",
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


def _sheets_table(S: dict) -> Table:
    return _half_table(
        S,
        ["Sheet", "Contents"],
        [
            [
                "Box Contents",
                "UPC (text), Box #, QTY + Sum-of-QTY pivot from column G",
            ],
            [
                "Dimensions",
                "Box #, Weight (rounded up), Length, Width, Height",
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
                "Full FBA Box Contents access",
            ],
            [
                "All other users",
                "No sidebar link; route + API blocked",
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
                "Sidebar <b>Tools \u2192 FBA Box Contents</b> "
                "(allowlisted + superadmin only)",
            ],
            [
                "2. Upload",
                "Drop or browse an Amazon <b>FBA Carton Detail</b> "
                ".xls / .xlsx / .xlsm (max 15 MB)",
            ],
            [
                "3. Generate",
                "Server parses carton blocks (Carton# \u2192 lines \u2192 Total)",
            ],
            [
                "4. Download",
                "Receive <b>FBA Box Contents Output.xlsx</b> "
                "(or shipment-named file) with two sheets",
            ],
            [
                "5. Use",
                "UPCs stay text; box # / qty / dims are true Excel numbers "
                "for pivots and freight work",
            ],
        ],
        col_fracs=[0.18, 0.82],
    )


def _types_table(S: dict) -> Table:
    return _simple_table(
        S,
        ["Field", "Excel type"],
        [
            ["UPC", "Text (@) \u2014 leading zeros preserved"],
            ["Box # / QTY", "Number (General)"],
            ["Weight", "Number; item weights rounded <b>up</b> to 1 decimal"],
            ["Length / Width / Height", "Number from carton header"],
            [
                "Headers",
                "Bold + mauve fill <b>#E0B0FF</b> (data types unchanged)",
            ],
        ],
        col_fracs=[0.32, 0.68],
    )


def _rollout_table(S: dict) -> Table:
    left = [
        Paragraph(
            "Confirm <b>FBA Box Contents</b> appears under Tools only for "
            "allowlisted emails + superadmin",
            S["bullet"],
        ),
        Spacer(1, 5),
        Paragraph(
            "Upload a real Carton Detail export; Generate; open the workbook",
            S["bullet"],
        ),
        Spacer(1, 5),
        Paragraph(
            "Verify Box Contents UPC column is text; Box # / QTY are numbers",
            S["bullet"],
        ),
        Spacer(1, 5),
        Paragraph(
            "Confirm pivot block starts at column G and totals match QTY sum",
            S["bullet"],
        ),
    ]
    right = [
        Paragraph(
            "Check Dimensions sheet: one row per carton; weight rounded up",
            S["bullet"],
        ),
        Spacer(1, 5),
        Paragraph(
            "Reject a .csv or empty file; confirm clear error message",
            S["bullet"],
        ),
        Spacer(1, 5),
        Paragraph(
            "Non-allowlisted user: no sidebar entry; API returns restricted",
            S["bullet"],
        ),
        Spacer(1, 5),
        Paragraph(
            "Headers show bold mauve (#E0B0FF) without changing cell types",
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
        title="FBA Box Contents \u2014 Implementation Summary",
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
            "FBA Box Contents turns Amazon\u2019s Carton Detail report into a "
            "warehouse-ready Excel workbook. Staff stop re-keying UPC / box / "
            "qty pivots by hand and get consistent typed columns for packing "
            "checks and downstream freight or inventory work.",
            S["body"],
        ),
    ]
    right_bv = sec("BUSINESS VALUE") + [
        Paragraph(
            "Seconds instead of manual carton unpacking in Excel",
            S["bullet"],
        ),
        Spacer(1, 4),
        Paragraph(
            "UPCs as text keep leading zeros; numbers stay calculable",
            S["bullet"],
        ),
        Spacer(1, 4),
        Paragraph(
            "Built-in quantity pivot by UPC \u00d7 box",
            S["bullet"],
        ),
        Spacer(1, 4),
        Paragraph(
            "Gated to named warehouse / ops users + superadmin",
            S["bullet"],
        ),
    ]
    story.append(_two_col(left_what, right_bv))
    story.append(Spacer(1, 10))
    story.append(_divider(C_W))
    story.append(Spacer(1, 8))

    story.append(Paragraph("HOW A CONVERSION WORKS", S["section"]))
    story.append(_divider(C_W))
    story.append(Spacer(1, 6))
    story.append(_flow_table(S))
    story.append(Spacer(1, 8))
    story.append(_divider(C_W))
    story.append(Spacer(1, 8))

    left_sheets = sec("OUTPUT SHEETS") + [_sheets_table(S)]
    right_rules = sec("KEY RULES") + [
        Paragraph(
            "Input must be FBA Carton Detail Excel (.xls / .xlsx / .xlsm)",
            S["bullet"],
        ),
        Spacer(1, 4),
        Paragraph(
            "Max upload size <b>15 MB</b>",
            S["bullet"],
        ),
        Spacer(1, 4),
        Paragraph(
            "Repeating Carton# blocks drive box numbers and item lines",
            S["bullet"],
        ),
        Spacer(1, 4),
        Paragraph(
            "Audit: <b>fba_box_contents.generate</b> download events",
            S["bullet"],
        ),
    ]
    story.append(_two_col(left_sheets, right_rules))

    story.append(NextPageTemplate("Later"))
    story.append(PageBreak())

    story.append(Paragraph("COLUMN TYPES & STYLING", S["section"]))
    story.append(_divider(C_W))
    story.append(Spacer(1, 6))
    story.append(_types_table(S))
    story.append(Spacer(1, 10))
    story.append(_divider(C_W))
    story.append(Spacer(1, 8))

    left_access = sec("WHO HAS ACCESS") + [_access_table(S)]
    right_tech = sec("TECH NOTES") + [
        Paragraph(
            "API: <b>POST /api/v1/fba-box-contents/generate</b>",
            S["bullet"],
        ),
        Spacer(1, 4),
        Paragraph(
            "UI gate: <b>fbaBoxContentsAccess.ts</b>",
            S["bullet"],
        ),
        Spacer(1, 4),
        Paragraph(
            "Backend allowlist: "
            "<b>fba_box_contents_allowed_emails</b>",
            S["bullet"],
        ),
        Spacer(1, 4),
        Paragraph(
            "Keep frontend + backend allowlists in sync",
            S["bullet"],
        ),
        Spacer(1, 4),
        Paragraph(
            "Stateless convert \u2014 no DB table required",
            S["bullet"],
        ),
    ]
    story.append(_two_col(left_access, right_tech))
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
            "Shipped on web / desktop app version <b>3.5.0</b> "
            "(header styling follow-up in 3.5.x)",
            S["bullet"],
        )
    )
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            "Route: <b>/fba-box-contents</b> \u00b7 "
            "Sidebar: <b>Tools \u2192 FBA Box Contents</b>",
            S["bullet"],
        )
    )
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            "Allowlist lives in backend config + matching frontend "
            "<b>fbaBoxContentsAccess.ts</b> (keep in sync)",
            S["bullet"],
        )
    )
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            "Complements Shipment Manager (SKU compile) and FNSKU Pack Station "
            "(scan sheet) \u2014 does not replace them",
            S["bullet"],
        )
    )
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            "Does not touch Keepa jobs, Daily Runs, MAP, or Label Station catalog",
            S["bullet"],
        )
    )

    doc.build(story)
    return OUTPUT


if __name__ == "__main__":
    out = build_pdf()
    print(f"Wrote: {out}")
