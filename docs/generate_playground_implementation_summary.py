"""
Generate MSW Overwatch-style implementation summary PDF for Testing Playground.
Matches New Vendor (JFS) / Manifest Generator reference format.

Run:  python docs/generate_playground_implementation_summary.py
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
OUTPUT = ROOT / "docs" / "Testing Playground - Implementation Summary _ MSW Overwatch.pdf"

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
            c.drawString(M_L, PAGE_H - 54, "Testing Playground")

            c.setFont("SegoeUI", 11)
            c.setFillColor(C_SUBTITLE)
            c.drawString(M_L, PAGE_H - 73, "Implementation summary \u2014 MSW Overwatch")

            c.setFont("SegoeUI-Bold", 10)
            c.setFillColor(C_META_BOLD)
            c.drawRightString(PAGE_W - M_R, PAGE_H - 48, "MetroShoe Warehouse")

            c.setFont("SegoeUI", 9)
            c.setFillColor(C_SUBTITLE)
            c.drawRightString(PAGE_W - M_R, PAGE_H - 62, "July 2026 \u00b7 App v3.1.1")

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
                    "<b>Testing Playground</b> is a gated sandbox under "
                    "<b>Tools \u2192 Playground</b>. Allowed testers upload the same "
                    "file types as live tools, run a snapshot test, and download the "
                    "expected output(s) \u2014 without changing Daily Runs, MAP, "
                    "warehouse data, or the live FNSKU / Tracking Extractor apps.",
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
            "MSW Overwatch \u2014 Testing Playground \u00b7 FastAPI-Keepa-Dashboard",
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


def _tools_table(S: dict) -> Table:
    col1 = HALF_W * 0.42
    col2 = HALF_W * 0.58
    data = [
        [Paragraph("Tool", S["th"]), Paragraph("Input \u2192 Output", S["th"])],
        [
            Paragraph("FNSKU Labels", S["td_b"]),
            Paragraph(
                "CSV / XLSX / ZIP \u2192 <b>Excel (.xlsx)</b> + <b>PDF</b>",
                S["td"],
            ),
        ],
        [
            Paragraph("Tracking Extractor", S["td_b"]),
            Paragraph("PDF / ZIP \u2192 <b>Excel (.xlsx)</b>", S["td"]),
        ],
    ]
    t = Table(data, colWidths=[col1, col2])
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


def _access_table(S: dict) -> Table:
    col1 = HALF_W * 0.38
    col2 = HALF_W * 0.62
    data = [
        [Paragraph("User", S["th"]), Paragraph("Access", S["th"])],
        [
            Paragraph("Allowlisted emails", S["td_b"]),
            Paragraph(
                "stephanie@, sunshine@, remote@ (metroshoewarehouse.com), "
                "orvillebarba@gmail.com",
                S["td"],
            ),
        ],
        [
            Paragraph("Superadmins", S["td_b"]),
            Paragraph("Full Playground access", S["td"]),
        ],
        [
            Paragraph("All other users", S["td_b"]),
            Paragraph(
                "No sidebar link; /playground redirects to Dashboard",
                S["td"],
            ),
        ],
    ]
    t = Table(data, colWidths=[col1, col2])
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


def _flow_table(S: dict) -> Table:
    col1 = C_W * 0.18
    col2 = C_W * 0.82
    data = [
        [Paragraph("Step", S["th"]), Paragraph("What happens", S["th"])],
        [
            Paragraph("1. Add tool", S["td_b"]),
            Paragraph(
                "Dropdown lists FNSKU Labels and Tracking Extractor; "
                "<b>Add tool</b> places a card in your personal test set",
                S["td"],
            ),
        ],
        [
            Paragraph("2. Upload", S["td_b"]),
            Paragraph(
                "Same file types as the live app. File is pinned for that user "
                "until <b>Replace</b> or <b>Remove</b> (survives refresh)",
                S["td"],
            ),
        ],
        [
            Paragraph("3. Run test", S["td_b"]),
            Paragraph(
                "Runs the live pipeline in sandbox mode. Shows "
                "<b>Testing successful</b> / failed with a date-time snapshot",
                S["td"],
            ),
        ],
        [
            Paragraph("4. Download", S["td_b"]),
            Paragraph(
                "One button per expected type (Excel and/or PDF). "
                "Outputs clear on refresh \u2014 click Run test again",
                S["td"],
            ),
        ],
    ]
    t = Table(data, colWidths=[col1, col2])
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


def _rollout_table(S: dict) -> Table:
    left = [
        Paragraph(
            "Confirm Playground appears under <b>Tools</b> for allowed emails only",
            S["bullet"],
        ),
        Spacer(1, 5),
        Paragraph(
            "Sign in as Stephanie / Sunshine / Orville and confirm personal header "
            "shows the correct account",
            S["bullet"],
        ),
        Spacer(1, 5),
        Paragraph(
            "Add <b>FNSKU Labels</b>, upload a shipment CSV/XLSX/ZIP, Run test",
            S["bullet"],
        ),
        Spacer(1, 5),
        Paragraph(
            "Download both <b>Excel</b> and <b>PDF</b>; compare to live FNSKU Labels",
            S["bullet"],
        ),
    ]
    right = [
        Paragraph(
            "Add <b>Tracking Extractor</b>, upload a PDF/ZIP, Run test "
            "(may take longer for OCR)",
            S["bullet"],
        ),
        Spacer(1, 5),
        Paragraph(
            "Download <b>Excel</b>; confirm live Tracking Extractor history was "
            "<b>not</b> written",
            S["bullet"],
        ),
        Spacer(1, 5),
        Paragraph(
            "Refresh the page: uploaded file remains; outputs gone \u2014 "
            "Run test again",
            S["bullet"],
        ),
        Spacer(1, 5),
        Paragraph(
            "Brief testers that Playground is sandbox-only and does not affect "
            "production runs",
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
        title="Testing Playground \u2014 Implementation Summary",
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
            "Testing Playground lets selected staff verify Tools apps with real "
            "sample files in a <b>personal sandbox</b>. Each tool uses the same "
            "input types and pipelines as production, then returns a success/fail "
            "report and downloadable output(s) for that moment in time \u2014 "
            "without writing live history or touching Keepa / Daily Run data.",
            S["body"],
        ),
    ]
    right_bv = sec("BUSINESS VALUE") + [
        Paragraph(
            "QA can prove FNSKU and Tracking Extractor still produce expected files",
            S["bullet"],
        ),
        Spacer(1, 4),
        Paragraph(
            "Each tester (Stephanie, Sunshine, Orville, \u2026) works independently",
            S["bullet"],
        ),
        Spacer(1, 4),
        Paragraph(
            "No risk to Daily Runs, MAP, warehouse catalog, or live tool history",
            S["bullet"],
        ),
        Spacer(1, 4),
        Paragraph(
            "Shared pattern for adding more Tools to test later",
            S["bullet"],
        ),
    ]
    story.append(_two_col(left_what, right_bv))
    story.append(Spacer(1, 10))
    story.append(_divider(C_W))
    story.append(Spacer(1, 8))

    story.append(Paragraph("HOW A TEST WORKS", S["section"]))
    story.append(_divider(C_W))
    story.append(Spacer(1, 6))
    story.append(_flow_table(S))
    story.append(Spacer(1, 8))
    story.append(_divider(C_W))
    story.append(Spacer(1, 8))

    left_tools = sec("TOOLS AVAILABLE NOW") + [_tools_table(S)]
    right_persist = sec("WHAT PERSISTS") + [
        Paragraph(
            "<b>Uploaded file</b> \u2014 stays across refresh until replaced/removed "
            "(per user email)",
            S["bullet"],
        ),
        Spacer(1, 4),
        Paragraph(
            "<b>Tool list</b> \u2014 which tools you added to your personal set",
            S["bullet"],
        ),
        Spacer(1, 4),
        Paragraph(
            "<b>Run outputs</b> \u2014 session-only; clear on refresh so each Run "
            "test is a fresh snapshot",
            S["bullet"],
        ),
    ]
    story.append(_two_col(left_tools, right_persist))

    story.append(NextPageTemplate("Later"))
    story.append(PageBreak())

    left_access = sec("WHO HAS ACCESS") + [_access_table(S)]
    right_privacy = sec("ISOLATION & SAFETY") + [
        Paragraph(
            "Fixtures and selections are keyed by <b>signed-in email</b>",
            S["bullet"],
        ),
        Spacer(1, 4),
        Paragraph(
            "FNSKU runner does <b>not</b> write label history",
            S["bullet"],
        ),
        Spacer(1, 4),
        Paragraph(
            "Tracking runner does <b>not</b> save scan history to the server",
            S["bullet"],
        ),
        Spacer(1, 4),
        Paragraph(
            "Live Tools pages remain unchanged for all users",
            S["bullet"],
        ),
    ]
    story.append(_two_col(left_access, right_privacy))
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
            "Shipped on web app version <b>3.1.1</b> (no separate Electron bump "
            "required for this feature)",
            S["bullet"],
        )
    )
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            "Route: <b>/playground</b> \u00b7 Sidebar: <b>Tools \u2192 Playground</b>",
            S["bullet"],
        )
    )
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            "Future tools register a runner (same upload \u2192 run \u2192 typed "
            "download card) without changing production Tool pages",
            S["bullet"],
        )
    )
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            "Micro Tools, Keepa Import, and Label Station are not in the picker yet",
            S["bullet"],
        )
    )

    doc.build(story)
    return OUTPUT


if __name__ == "__main__":
    out = build_pdf()
    print(f"Wrote: {out}")
