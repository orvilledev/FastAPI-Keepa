"""
Generate MSW Overwatch-style implementation summary PDF for Shipment Manager.
Matches Testing Playground / DNK Label Station / Freight Class reference format.

Run:  python docs/generate_shipment_manager_implementation_summary.py
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
OUTPUT = ROOT / "docs" / "Shipment Manager - Implementation Summary _ MSW Overwatch.pdf"

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
            c.drawString(M_L, PAGE_H - 54, "Shipment Manager")

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
                    "<b>Shipment Manager</b> is a team Tools workflow under "
                    "<b>Tools \u2192 Shipment Manager</b>. Staff register a shipment, "
                    "upload Amazon FBA exports together, then compile WR SKU Update, "
                    "PO Import, Order Import, and ledger sheets. Folders cluster "
                    "related groups; stars pin follows for quick access.",
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
            "MSW Overwatch \u2014 Shipment Manager \u00b7 FastAPI-Keepa-Dashboard",
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


def _outputs_table(S: dict) -> Table:
    return _half_table(
        S,
        ["Output", "Scope"],
        [
            [
                "WR SKU Update",
                "One shipment \u2014 one row per UPC",
            ],
            [
                "Clustered WR SKU Update",
                "Entire folder \u2014 UPCs deduped across members",
            ],
            [
                "PO Import",
                "Per upload (one PO / FBA id)",
            ],
            [
                "Order Import",
                "Per upload + ship-to catalog",
            ],
            [
                "Ledger",
                "Shipment summary + unique SKUs Excel",
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
                "Signed-in staff",
                "Full Shipment Manager (non-warehouse)",
            ],
            [
                "Warehouse-only stations",
                "No access (not on warehouse allowlist)",
            ],
            [
                "Shipment creator / admin",
                "Can delete; creator sets status",
            ],
            [
                "Superadmin",
                "Edit vendor checklist templates",
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
                "1. Register",
                "Create a shipment with name, vendor, optional notes",
            ],
            [
                "2. Upload",
                "Teammates add Amazon FBA Individual-units exports "
                "(.csv / .xlsx); each upload keeps its own rows",
            ],
            [
                "3. Compile",
                "<b>Generate WR SKU Update</b> merges uploads and drops "
                "duplicate UPCs",
            ],
            [
                "4. Folder (optional)",
                "Select related GRP shipments \u2192 create / move into a folder",
            ],
            [
                "5. Cluster",
                "Folder action <b>Generate Clustered WR SKU Update</b> "
                "(pink) merges every member, still one row per UPC",
            ],
            [
                "6. Follow",
                "Star a shipment or folder \u2192 appears in personal "
                "<b>Starred</b> section at the top",
            ],
        ],
        col_fracs=[0.18, 0.82],
    )


def _features_table(S: dict) -> Table:
    return _simple_table(
        S,
        ["Capability", "Detail"],
        [
            [
                "Folders",
                "Editable clusters; indent + tint for members; "
                "collapsed by default; up/down reorder",
            ],
            [
                "Stars",
                "Per-user follows (not shared); Starred section "
                "mirrors liked shipments and folders",
            ],
            [
                "Vendor checklist",
                "Per-vendor steps (e.g. NFA / SMW); who completed "
                "each step; superadmin edits templates",
            ],
            [
                "Status",
                "Open \u2192 In progress \u2192 Ready \u2192 Closed "
                "(creator / admin)",
            ],
            [
                "UPC dedupe",
                "Exact + numeric variants (leading zeros, dashes, "
                ".0) so Excel does not show the same UPC twice",
            ],
        ],
        col_fracs=[0.26, 0.74],
    )


def _rollout_table(S: dict) -> Table:
    left = [
        Paragraph(
            "Confirm <b>Shipment Manager</b> under Tools for a normal staff account",
            S["bullet"],
        ),
        Spacer(1, 5),
        Paragraph(
            "Register a test shipment; upload two FBA exports; "
            "Generate WR SKU Update",
            S["bullet"],
        ),
        Spacer(1, 5),
        Paragraph(
            "Confirm unique UPC count drops duplicates across uploads",
            S["bullet"],
        ),
        Spacer(1, 5),
        Paragraph(
            "Select GRP 1\u20133; Create folder; Generate Clustered WR SKU Update",
            S["bullet"],
        ),
    ]
    right = [
        Paragraph(
            "Star the folder; confirm it appears under <b>Starred</b> "
            "(personal only)",
            S["bullet"],
        ),
        Spacer(1, 5),
        Paragraph(
            "Download Ledger; build PO Import / Order Import for one upload",
            S["bullet"],
        ),
        Spacer(1, 5),
        Paragraph(
            "Run migrations: folders, sort_order, shipment_stars "
            "(Supabase SQL Editor)",
            S["bullet"],
        ),
        Spacer(1, 5),
        Paragraph(
            "Warehouse-only login: no Shipment Manager sidebar entry",
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
        title="Shipment Manager \u2014 Implementation Summary",
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
            "Shipment Manager is the shared place to collect Amazon FBA "
            "exports for a warehouse run, keep each contributor\u2019s file "
            "intact, and produce warehouse sheets without spreadsheet "
            "merge chaos. Related GRP shipments can be clustered into "
            "folders; each user can star what they need to follow.",
            S["body"],
        ),
    ]
    right_bv = sec("BUSINESS VALUE") + [
        Paragraph(
            "One WR SKU Update for the team instead of conflicting copies",
            S["bullet"],
        ),
        Spacer(1, 4),
        Paragraph(
            "Uploads stay removable without destroying other people\u2019s rows",
            S["bullet"],
        ),
        Spacer(1, 4),
        Paragraph(
            "Folder cluster compile for multi-GRP vendor runs in one click",
            S["bullet"],
        ),
        Spacer(1, 4),
        Paragraph(
            "Checklist + status keep handoff visible across ops",
            S["bullet"],
        ),
    ]
    story.append(_two_col(left_what, right_bv))
    story.append(Spacer(1, 10))
    story.append(_divider(C_W))
    story.append(Spacer(1, 8))

    story.append(Paragraph("HOW A SHIPMENT WORKS", S["section"]))
    story.append(_divider(C_W))
    story.append(Spacer(1, 6))
    story.append(_flow_table(S))
    story.append(Spacer(1, 8))
    story.append(_divider(C_W))
    story.append(Spacer(1, 8))

    left_out = sec("OUTPUTS") + [_outputs_table(S)]
    right_rules = sec("KEY RULES") + [
        Paragraph(
            "Duplicate UPCs collapse only at compile time "
            "(per shipment or clustered folder)",
            S["bullet"],
        ),
        Spacer(1, 4),
        Paragraph(
            "Stars are personal; folders and shipments stay shared",
            S["bullet"],
        ),
        Spacer(1, 4),
        Paragraph(
            "Deleting a folder ungroups members \u2014 shipments remain",
            S["bullet"],
        ),
        Spacer(1, 4),
        Paragraph(
            "PO / Order Import stay per-upload (one FBA shipment each)",
            S["bullet"],
        ),
    ]
    story.append(_two_col(left_out, right_rules))

    story.append(NextPageTemplate("Later"))
    story.append(PageBreak())

    story.append(Paragraph("CAPABILITIES", S["section"]))
    story.append(_divider(C_W))
    story.append(Spacer(1, 6))
    story.append(_features_table(S))
    story.append(Spacer(1, 10))
    story.append(_divider(C_W))
    story.append(Spacer(1, 8))

    left_access = sec("WHO HAS ACCESS") + [_access_table(S)]
    right_data = sec("DATA & MIGRATIONS") + [
        Paragraph(
            "<b>shipments</b>, uploads, sku_rows",
            S["bullet"],
        ),
        Spacer(1, 4),
        Paragraph(
            "<b>shipment_folders</b> + <b>sort_order</b>",
            S["bullet"],
        ),
        Spacer(1, 4),
        Paragraph(
            "<b>shipment_stars</b> (per-user)",
            S["bullet"],
        ),
        Spacer(1, 4),
        Paragraph(
            "Vendor checklist templates (DB overrides)",
            S["bullet"],
        ),
        Spacer(1, 4),
        Paragraph(
            "Audit: upload, generate, folder, star actions",
            S["bullet"],
        ),
    ]
    story.append(_two_col(left_access, right_data))
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
            "Shipped on web / desktop app version <b>3.5.1</b> "
            "(folders, stars, clustered generate landed with 3.5.x)",
            S["bullet"],
        )
    )
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            "Route: <b>/shipment-manager</b> \u00b7 "
            "Sidebar: <b>Tools \u2192 Shipment Manager</b>",
            S["bullet"],
        )
    )
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            "Requires Supabase migrations for folders / sort_order / stars "
            "before those UI features work in production",
            S["bullet"],
        )
    )
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            "Does not replace FBA Box Contents (carton detail \u2192 box workbook) "
            "or Freight Class",
            S["bullet"],
        )
    )
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            "Does not touch Keepa jobs, Daily Runs, MAP, or warehouse Label Station",
            S["bullet"],
        )
    )

    doc.build(story)
    return OUTPUT


if __name__ == "__main__":
    out = build_pdf()
    print(f"Wrote: {out}")
