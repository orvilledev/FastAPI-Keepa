"""
Generate MSW Overwatch-style implementation summary PDF for New Vendor (JFS).
Matches Manifest Generator / Pack List Formatter reference format.

Run:  python docs/generate_jfs_vendor_implementation_summary.py
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
OUTPUT = ROOT / "docs" / "New Vendor JFS - Implementation Summary _ MSW Overwatch.pdf"

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
            c.drawString(M_L, PAGE_H - 54, "New Vendor (JFS)")

            c.setFont("SegoeUI", 11)
            c.setFillColor(C_SUBTITLE)
            c.drawString(M_L, PAGE_H - 73, "Implementation summary \u2014 MSW Overwatch")

            c.setFont("SegoeUI-Bold", 10)
            c.setFillColor(C_META_BOLD)
            c.drawRightString(PAGE_W - M_R, PAGE_H - 48, "MetroShoe Warehouse")

            c.setFont("SegoeUI", 9)
            c.setFillColor(C_SUBTITLE)
            c.drawRightString(PAGE_W - M_R, PAGE_H - 62, "July 2026 \u00b7 App v3.0.0")

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
                    "<b>JFS (Josef Siebel)</b> is now a full vendor in MSW Overwatch "
                    "\u2014 alongside DNK, CLK, OBZ, and the other brands. Staff can "
                    "manage its <b>MAP</b> and <b>UPCs</b>, schedule its <b>Daily Run</b>, "
                    "run Express Jobs, and include it in Off-Price Analytics, using the "
                    "same workflows as every other vendor.",
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
            "MSW Overwatch \u2014 New Vendor (JFS / Josef Siebel) \u00b7 FastAPI-Keepa-Dashboard",
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


def _where_table(S: dict) -> Table:
    col1 = HALF_W * 0.40
    col2 = HALF_W * 0.60
    data = [
        [Paragraph("Area", S["th"]), Paragraph("Use for", S["th"])],
        [
            Paragraph("Daily Runs \u2192 JFS", S["td_b"]),
            Paragraph("Schedule, mode, Same Day Run, reminders", S["td"]),
        ],
        [
            Paragraph("Manage UPCs \u2192 JFS", S["td_b"]),
            Paragraph("Maintain the Josef Siebel UPC list", S["td"]),
        ],
        [
            Paragraph("Manage MAP", S["td_b"]),
            Paragraph("Load / edit MAP with vendor code <b>jfs</b>", S["td"]),
        ],
        [
            Paragraph("Express Jobs", S["td_b"]),
            Paragraph("On-demand Off-Price check for JFS", S["td"]),
        ],
        [
            Paragraph("Off-Price Analytics", S["td_b"]),
            Paragraph("Track JFS hits and sellers with other vendors", S["td"]),
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
    col1 = HALF_W * 0.32
    col2 = HALF_W * 0.68
    data = [
        [Paragraph("User", S["th"]), Paragraph("Access", S["th"])],
        [
            Paragraph("Keepa-access users", S["td_b"]),
            Paragraph(
                "Full JFS Daily Run, Manage UPCs, Manage MAP, Express Jobs, and Analytics",
                S["td"],
            ),
        ],
        [
            Paragraph("Without Keepa access", S["td_b"]),
            Paragraph(
                "Cannot open Daily Runs / MAP / UPCs / Express Jobs \u2014 unchanged",
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
        Paragraph("Confirm JFS appears on Dashboard / Daily Runs menu", S["bullet"]),
        Spacer(1, 5),
        Paragraph(
            "<b>Update Manage MAP</b> with Josef Siebel prices (vendor <b>jfs</b>)",
            S["bullet"],
        ),
        Spacer(1, 5),
        Paragraph(
            "<b>Update Manage UPCs</b> for JFS (category <b>jfs</b>)",
            S["bullet"],
        ),
        Spacer(1, 5),
        Paragraph(
            "Open Daily Runs \u2192 JFS and turn the scheduler <b>On</b>",
            S["bullet"],
        ),
        Spacer(1, 5),
        Paragraph("Set Daily Run time, days, and API / Import mode", S["bullet"]),
    ]
    right = [
        Paragraph("Save email recipients for JFS reports", S["bullet"]),
        Spacer(1, 5),
        Paragraph(
            "Run a short Express Job or Same Day Run to verify MAP + UPCs",
            S["bullet"],
        ),
        Spacer(1, 5),
        Paragraph("Confirm JFS shows in Off-Price Analytics (tracking on)", S["bullet"]),
        Spacer(1, 5),
        Paragraph('Optional: enable T-30 "Remind me" for JFS', S["bullet"]),
        Spacer(1, 5),
        Paragraph(
            "Brief the team that Josef Siebel uses code <b>jfs</b> everywhere",
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

    # Page 1 story starts below taller status badge
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
        title="New Vendor (JFS) \u2014 Implementation Summary",
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
            "Adding a new vendor wires Josef Siebel into the Keepa Off-Price system "
            "under the short code <b>jfs</b>. Once <b>MAP</b> prices and <b>UPCs</b> "
            "are loaded and the <b>Daily Run</b> schedule is set, the brand is monitored "
            "on the same cadence and screens as Dansko, Clarks, and the rest \u2014 "
            "without changing how those existing vendors work.",
            S["body"],
        ),
    ]
    right_bv = sec("BUSINESS VALUE") + [
        Paragraph(
            "Josef Siebel monitored with the same Off-Price process as other brands",
            S["bullet"],
        ),
        Spacer(1, 4),
        Paragraph(
            "One place for MAP, UPCs, Daily Run, Express Jobs, and Analytics",
            S["bullet"],
        ),
        Spacer(1, 4),
        Paragraph(
            "No disruption to DNK, CLK, or other existing vendor setups",
            S["bullet"],
        ),
        Spacer(1, 4),
        Paragraph(
            "Staff already trained on Daily Runs can operate JFS immediately",
            S["bullet"],
        ),
    ]
    story.append(_two_col(left_what, right_bv))
    story.append(Spacer(1, 10))
    story.append(_divider(C_W))
    story.append(Spacer(1, 8))

    story.append(Paragraph("REQUIRED BEFORE FIRST LIVE RUN", S["section"]))
    story.append(_divider(C_W))
    story.append(Spacer(1, 6))
    story.append(
        Paragraph(
            "<b>1. Update MAP</b> \u2014 Manage MAP with vendor code <b>jfs</b> "
            "(Josef Siebel minimum advertised prices).",
            S["step"],
        )
    )
    story.append(
        Paragraph(
            "<b>2. Update UPCs</b> \u2014 Manage UPCs \u2192 JFS (Josef Siebel) "
            "and add or import the product list.",
            S["step"],
        )
    )
    story.append(
        Paragraph(
            "<b>3. Set the Daily Run</b> \u2014 Daily Runs \u2192 JFS: turn schedule "
            "<b>On</b>, choose time / days, pick API or Import mode, and save recipients.",
            S["step"],
        )
    )
    story.append(Spacer(1, 8))
    story.append(_divider(C_W))
    story.append(Spacer(1, 8))

    left_must = sec("WHAT MUST BE UPDATED") + [
        Paragraph(
            "<b>MAP</b> \u2014 Josef Siebel prices tagged as vendor <b>jfs</b>",
            S["bullet"],
        ),
        Spacer(1, 4),
        Paragraph(
            "<b>UPCs</b> \u2014 product list under category <b>jfs</b> "
            "(defines what each run checks)",
            S["bullet"],
        ),
        Spacer(1, 4),
        Paragraph(
            "<b>Daily Run</b> \u2014 schedule, mode, and recipients must be "
            "configured before automated monitoring starts",
            S["bullet"],
        ),
    ]
    right_where = sec("WHERE IT APPEARS") + [_where_table(S)]
    story.append(_two_col(left_must, right_where))

    story.append(NextPageTemplate("Later"))
    story.append(PageBreak())

    left_access = sec("WHO HAS ACCESS") + [_access_table(S)]
    right_privacy = sec("PRIVACY & SPEED") + [
        Paragraph(
            "Uses the <b>same secure Keepa and database paths</b> as DNK, CLK, "
            "and other vendors",
            S["bullet"],
        ),
        Spacer(1, 4),
        Paragraph(
            "No separate login or tool \u2014 JFS lives inside MSW Overwatch",
            S["bullet"],
        ),
        Spacer(1, 4),
        Paragraph(
            "Adding JFS does <b>not</b> slow or change schedules for other brands",
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
            "Vendor short code: <b>jfs</b> \u00b7 Display name: <b>JFS (Josef Siebel)</b>",
            S["bullet"],
        )
    )
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            "Database seed: <b>seed_jfs_vendor.sql</b> "
            "(scheduler + analytics tracking rows)",
            S["bullet"],
        )
    )
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            "Until MAP and UPCs are loaded and Daily Run is set, automated "
            "Off-Price monitoring for JFS will not produce meaningful results",
            S["bullet"],
        )
    )
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            "Existing vendors (DNK, CLK, OBZ, REF, BOR, SFF, TEV, CHA) are unchanged",
            S["bullet"],
        )
    )

    doc.build(story)
    return OUTPUT


if __name__ == "__main__":
    out = build_pdf()
    print(f"Wrote: {out}")
