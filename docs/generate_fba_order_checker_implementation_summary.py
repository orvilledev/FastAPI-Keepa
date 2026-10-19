"""
Generate MSW Overwatch-style implementation summary PDF for FBA Order Checker.
Matches FBA Box Contents / Label Center / DNK Label Station format.

Run:  python docs/generate_fba_order_checker_implementation_summary.py
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
    KeepTogether,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

ROOT = Path(__file__).resolve().parent.parent
FONTS_DIR = Path(r"C:\Windows\Fonts")
OUTPUT = ROOT / "docs" / "FBA Order Checker - Implementation Summary _ MSW Overwatch.pdf"

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

BADGE_BOTTOM = 218.0


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
            c.drawString(M_L, PAGE_H - 54, "FBA Order Checker")

            c.setFont("SegoeUI", 11)
            c.setFillColor(C_SUBTITLE)
            c.drawString(M_L, PAGE_H - 73, "Implementation summary \u2014 MSW Overwatch")

            c.setFont("SegoeUI-Bold", 10)
            c.setFillColor(C_META_BOLD)
            c.drawRightString(PAGE_W - M_R, PAGE_H - 48, "MetroShoe Warehouse")

            c.setFont("SegoeUI", 9)
            c.setFillColor(C_SUBTITLE)
            c.drawRightString(PAGE_W - M_R, PAGE_H - 62, "October 2026 \u00b7 App v3.7.2")

            c.setFillColor(C_ACCENT_BAR)
            c.rect(M_L, PAGE_H - 86.25, C_W, 2.25, fill=1, stroke=0)

            badge_y_top = 97.125
            badge_h = BADGE_BOTTOM - badge_y_top

            c.setFillColor(colors.white)
            c.setStrokeColor(C_BADGE_STROKE)
            c.setLineWidth(0.75)
            c.roundRect(
                36.375,
                PAGE_H - BADGE_BOTTOM,
                PAGE_W - 2 * 36.375,
                badge_h,
                6,
                fill=1,
                stroke=1,
            )

            badge_frame = RLFrame(
                49,
                PAGE_H - BADGE_BOTTOM + 6,
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
                    "<b>FBA Order Checker</b> is a gated BC Tools page under "
                    "<b>BC Tools \u2192 FBA Order Checker</b>. Authorized users upload "
                    "the official Amazon FBA shipment <b>.tsv</b>. The tool keeps "
                    "<b>Shipment ID</b>, <b>Merchant SKU</b>, <b>external-id</b>, and "
                    "<b>Shipped</b>, then lets each person scan and count on their own. "
                    "Owners can lock or share a shipment, download an accounting report, "
                    "archive a finished count, or move a shipment to Trash.",
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
            "MSW Overwatch \u2014 FBA Order Checker \u00b7 FastAPI-Keepa-Dashboard",
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


def _flow_table(S: dict) -> Table:
    return _simple_table(
        S,
        ["Step", "What happens"],
        [
            [
                "1. Open tool",
                "Sidebar <b>BC Tools \u2192 FBA Order Checker</b> "
                "(allowlisted emails + superadmin only)",
            ],
            [
                "2. Upload",
                "Drop or browse the official Amazon shipment file "
                "(.tsv / .txt / .csv, max 15 MB) and choose <b>Store shipment</b>",
            ],
            [
                "3. Count",
                "Open <b>View</b>. Each scan of an external-id / UPC adds "
                "<b>1</b> to that person\u2019s <b>Counted</b>. <b>Shipped</b> stays the file quantity",
            ],
            [
                "4. Finish",
                "<b>Download</b> the accounting workbook at any time. "
                "<b>Archive</b> appears for the owner when every line is <b>All Accounted</b>",
            ],
            [
                "5. Remove",
                "<b>Remove</b> asks for confirmation, then moves the shipment to "
                "<b>Trash</b>. It stays there until <b>Delete</b> or <b>Empty trash</b>",
            ],
        ],
        col_fracs=[0.16, 0.84],
    )


def _views_table(S: dict) -> Table:
    return _simple_table(
        S,
        ["View", "What it shows"],
        [
            [
                "Active",
                "Uploads that are not archived and not in Trash. "
                "Default list. <b>All</b> or <b>Mine</b>, plus search by shipment, SKU, external-id, or name",
            ],
            [
                "Archive",
                "Completed shipments. Archive is allowed only after every official line "
                "is <b>All Accounted</b> for the owner",
            ],
            [
                "Trash",
                "Removed shipments. <b>Restore</b> puts one back. <b>Delete</b> removes one for good. "
                "<b>Empty trash</b> clears the bin after a second confirmation",
            ],
        ],
        col_fracs=[0.16, 0.84],
    )


def _fields_table(S: dict) -> Table:
    return _simple_table(
        S,
        ["Stored", "Rule"],
        [
            [
                "Shipment ID",
                "Taken from the preamble of the official TSV (for example <b>FBA19T3YGF07</b>). "
                "A new upload of the same id does not replace the earlier one",
            ],
            [
                "Merchant SKU",
                "Yellow column only. Title, ASIN, FNSKU, condition, prep, and label columns are ignored",
            ],
            [
                "external-id",
                "Stored and shown as the code only. A leading <b>UPC:</b> label is stripped "
                "(<b>UPC: 845028000003</b> becomes <b>845028000003</b>)",
            ],
            [
                "Shipped",
                "File quantity. It does not decrease when someone scans. "
                "<b>Missing</b> is the remainder while the count is still short",
            ],
            [
                "Uploaded by",
                "First name only. A profile name such as <b>Orville</b> is used. "
                "If no profile name is set, the first word of the email name is used",
            ],
        ],
        col_fracs=[0.2, 0.8],
    )


def _status_table(S: dict) -> Table:
    return _simple_table(
        S,
        ["Status", "When", "Highlight"],
        [
            ["Missing Items", "Counted is less than Shipped", "Amber row"],
            ["All Accounted", "Counted equals Shipped", "Green row"],
            ["Overage", "Counted is greater than Shipped", "Orange row"],
            [
                "Not in the list",
                "Scanned code is not on this shipment. It is still recorded",
                "Red row, plus an on-screen error",
            ],
        ],
        col_fracs=[0.22, 0.5, 0.28],
    )


def _access_table(S: dict) -> Table:
    return _simple_table(
        S,
        ["User", "Access"],
        [
            [
                "Allowlisted emails",
                "sunshine@, stephanie@, paolo@, paulo@, johnbernard@ (metroshoewarehouse.com)",
            ],
            [
                "Superadmin",
                "Sees locked shipments and can lock, archive, or remove others\u2019 uploads",
            ],
            [
                "All other users",
                "No sidebar link; route and API are blocked",
            ],
        ],
        col_fracs=[0.28, 0.72],
    )


def _sql_table(S: dict) -> Table:
    return _simple_table(
        S,
        ["Script", "Adds"],
        [
            ["create_fba_shipment_library.sql", "Uploads and yellow-field lines"],
            ["create_fba_shipment_counts.sql", "Per-user scan counts"],
            ["create_fba_shipment_unknown_scans.sql", "Barcodes not on the file"],
            ["add_fba_shipment_library_access.sql", "Lock, share, and archive"],
            ["add_fba_shipment_library_trash.sql", "Trash (trashed_at, trashed_by)"],
        ],
        col_fracs=[0.52, 0.48],
    )


def _rollout_table(S: dict) -> Table:
    left = [
        Paragraph(
            "Run the five SQL scripts in the Supabase SQL Editor "
            "before counting, locking, or using Trash",
            S["bullet"],
        ),
        Spacer(1, 5),
        Paragraph(
            "Confirm <b>FBA Order Checker</b> under BC Tools only for "
            "the allowlist and superadmin",
            S["bullet"],
        ),
        Spacer(1, 5),
        Paragraph(
            "Upload an official .tsv; confirm SKUs, external-id without "
            "<b>UPC:</b>, and Shipped totals",
            S["bullet"],
        ),
        Spacer(1, 5),
        Paragraph(
            "Scan one unit: Counted +1, Missing drops, status moves "
            "Missing Items \u2192 All Accounted \u2192 Overage",
            S["bullet"],
        ),
    ]
    right = [
        Paragraph(
            "Scan a code that is not on the file: red row, "
            "<b>Not in the list</b>, and the banner stays on screen",
            S["bullet"],
        ),
        Spacer(1, 5),
        Paragraph(
            "Lock hides the shipment from other workers. Share opens it again. "
            "Each person still has their own counts",
            S["bullet"],
        ),
        Spacer(1, 5),
        Paragraph(
            "<b>Download</b> works before the count is finished. "
            "<b>Archive</b> waits until every line is All Accounted",
            S["bullet"],
        ),
        Spacer(1, 5),
        Paragraph(
            "<b>Remove</b> asks first, then lands in <b>Trash</b>. "
            "Restore, Delete, and Empty trash behave as labeled",
            S["bullet"],
        ),
    ]
    return _two_col(left, right)


def build_pdf() -> Path:
    _reg_fonts()
    S = _make_styles()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)

    frame1 = Frame(
        M_L,
        M_B,
        C_W,
        PAGE_H - (BADGE_BOTTOM + 22) - M_B,
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
        title="FBA Order Checker \u2014 Implementation Summary",
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
            "FBA Order Checker keeps the yellow fields from the official "
            "Amazon FBA shipment file so a count can continue after someone "
            "leaves the page. Several people can see the same upload and "
            "work their own counts. A new upload never deletes an earlier one.",
            S["body"],
        ),
    ]
    right_bv = sec("BUSINESS VALUE") + [
        Paragraph("One shared list of official shipment files", S["bullet"]),
        Spacer(1, 4),
        Paragraph(
            "Each worker\u2019s scans stay separate, even on a shared shipment",
            S["bullet"],
        ),
        Spacer(1, 4),
        Paragraph(
            "Missing, complete, overage, and unknown barcodes are color-coded",
            S["bullet"],
        ),
        Spacer(1, 4),
        Paragraph(
            "Finished counts can be downloaded and archived; removals go to Trash first",
            S["bullet"],
        ),
    ]
    story.append(_two_col(left_what, right_bv))
    story.append(Spacer(1, 10))
    story.append(_divider(C_W))
    story.append(Spacer(1, 8))

    story.append(Paragraph("HOW A COUNT WORKS", S["section"]))
    story.append(_divider(C_W))
    story.append(Spacer(1, 6))
    story.append(_flow_table(S))
    story.append(Spacer(1, 8))
    story.append(_divider(C_W))
    story.append(Spacer(1, 8))

    story.append(Paragraph("LIST VIEWS", S["section"]))
    story.append(_divider(C_W))
    story.append(Spacer(1, 6))
    story.append(_views_table(S))

    story.append(NextPageTemplate("Later"))
    story.append(PageBreak())

    story.append(Paragraph("WHAT IS STORED", S["section"]))
    story.append(_divider(C_W))
    story.append(Spacer(1, 6))
    story.append(_fields_table(S))
    story.append(Spacer(1, 10))
    story.append(_divider(C_W))
    story.append(Spacer(1, 8))

    story.append(Paragraph("COUNT STATUSES", S["section"]))
    story.append(_divider(C_W))
    story.append(Spacer(1, 6))
    story.append(
        Paragraph(
            "Example: Shipped is <b>3</b>. One scan shows Counted <b>1</b>, Missing <b>2</b>, "
            "Missing Items. Three scans show All Accounted. A fourth scan shows Overage. "
            "If the same external-id is on more than one line, the scan fills the first line "
            "that is still short. Unknown scans do not block All Accounted.",
            S["body"],
        )
    )
    story.append(Spacer(1, 6))
    story.append(_status_table(S))
    story.append(Spacer(1, 10))
    story.append(_divider(C_W))
    story.append(Spacer(1, 8))

    story.append(Paragraph("LOCK, SHARE, REPORT, AND ARCHIVE", S["section"]))
    story.append(_divider(C_W))
    story.append(Spacer(1, 6))
    story.append(
        Paragraph(
            "A new upload is <b>Shared</b>. The owner can <b>Lock</b> it so other workers "
            "cannot open it, then <b>Share</b> it again when more than one person needs to count. "
            "<b>Download</b> is on every row and on the open shipment. The workbook is named "
            "<b>{Shipment ID} Accounting.xlsx</b> and uses the signed-in user\u2019s counts. "
            "<b>Archive</b> is on the open shipment only, and only for the owner after every "
            "official line is All Accounted. Archived shipments move to the Archive tab.",
            S["body"],
        )
    )
    story.append(Spacer(1, 10))
    story.append(_divider(C_W))
    story.append(Spacer(1, 8))

    story.append(Paragraph("TRASH", S["section"]))
    story.append(_divider(C_W))
    story.append(Spacer(1, 6))
    story.append(
        Paragraph(
            "<b>Remove</b> sits apart from <b>Lock</b> and opens a confirmation: "
            "\u201cAre you sure you want to remove this shipment?\u201d Confirming moves it to Trash. "
            "It leaves Active and Archive and stays in Trash until someone deletes that shipment "
            "or empties Trash. Both of those actions ask again. <b>Restore</b> returns an active "
            "shipment to the active list, or a completed one to Archive. Scanning is blocked while "
            "a shipment is in Trash.",
            S["body"],
        )
    )
    story.append(Spacer(1, 10))
    story.append(_divider(C_W))
    story.append(Spacer(1, 8))

    story.append(
        KeepTogether(
            [
                Paragraph("WHO CAN USE IT", S["section"]),
                _divider(C_W),
                Spacer(1, 6),
                _access_table(S),
            ]
        )
    )
    story.append(Spacer(1, 10))
    story.append(_divider(C_W))
    story.append(Spacer(1, 8))

    story.append(Paragraph("DATABASE SCRIPTS", S["section"]))
    story.append(_divider(C_W))
    story.append(Spacer(1, 6))
    story.append(
        Paragraph(
            "Run these in the Supabase SQL Editor, in this order. "
            "The API uses the service role. If a column is missing, the shipment list will not load.",
            S["body"],
        )
    )
    story.append(Spacer(1, 6))
    story.append(_sql_table(S))
    story.append(Spacer(1, 12))
    story.append(_divider(C_W))
    story.append(Spacer(1, 8))

    story.append(Paragraph("KEY RULES", S["section"]))
    story.append(_divider(C_W))
    story.append(Spacer(1, 6))
    story.append(
        Paragraph(
            "Shipped is the file quantity. Missing is what is still uncounted. "
            "A scan never rewrites Shipped",
            S["bullet"],
        )
    )
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            "Counts belong to the signed-in user. Sharing a shipment does not merge two people\u2019s counts",
            S["bullet"],
        )
    )
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            "Only the owner (or a superadmin) can lock, archive, or remove an upload",
            S["bullet"],
        )
    )
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            "Permanent delete is available only from Trash, or by emptying Trash",
            S["bullet"],
        )
    )
    story.append(Spacer(1, 12))
    story.append(_divider(C_W))
    story.append(Spacer(1, 8))

    story.append(
        KeepTogether(
            [
                Paragraph("ROLLOUT CHECKLIST", S["section"]),
                _divider(C_W),
                Spacer(1, 8),
                _rollout_table(S),
            ]
        )
    )
    story.append(Spacer(1, 8))
    story.append(_divider(C_W))
    story.append(Spacer(1, 6))

    story.append(Paragraph("NOTES FOR LEADERSHIP", S["section"]))
    story.append(_divider(C_W))
    story.append(Spacer(1, 6))
    story.append(Paragraph("Shipped on web / desktop app version <b>3.7.2</b>", S["bullet"]))
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            "Route <b>/fba-shipment-library</b> \u00b7 Sidebar <b>BC Tools \u2192 FBA Order Checker</b>",
            S["bullet"],
        )
    )
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            "Same allowlist as FBA Box Contents. Does not replace carton workbooks, "
            "Upload Compare, Keepa, Daily Runs, or Label Station",
            S["bullet"],
        )
    )

    doc.build(story)
    return OUTPUT


if __name__ == "__main__":
    out = build_pdf()
    print(f"Wrote: {out}")
