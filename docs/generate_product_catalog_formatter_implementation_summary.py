"""
Generate MSW Overwatch-style implementation summary PDF for Product Catalog Formatter.
Matches Testing Playground / FBA Box Contents / Freight Class / Shipment Manager format.

Focus: Shipment plan mode and WR SKU Update mode.

Run:  python docs/generate_product_catalog_formatter_implementation_summary.py
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
OUTPUT = (
    ROOT
    / "docs"
    / "Product Catalog Formatter - Implementation Summary _ MSW Overwatch.pdf"
)

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
            c.drawString(M_L, PAGE_H - 54, "Product Catalog Formatter")

            c.setFont("SegoeUI", 11)
            c.setFillColor(C_SUBTITLE)
            c.drawString(M_L, PAGE_H - 73, "Implementation summary \u2014 MSW Overwatch")

            c.setFont("SegoeUI-Bold", 10)
            c.setFillColor(C_META_BOLD)
            c.drawRightString(PAGE_W - M_R, PAGE_H - 48, "MetroShoe Warehouse")

            c.setFont("SegoeUI", 9)
            c.setFillColor(C_SUBTITLE)
            c.drawRightString(PAGE_W - M_R, PAGE_H - 62, "October 2026 \u00b7 App v3.6.2")

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
                    "<b>Product Catalog Formatter</b> is a BC Tools converter under "
                    "<b>BC Tools \u2192 Product Catalog Formatter</b>. Staff upload "
                    "Amazon <b>shipment-plan</b> files or a <b>WR SKU Update</b> "
                    "workbook and download one <b>PRODUCTS</b> catalog with unique "
                    "UPCs (UPC, SKU, fnsku, STYLE NAME, Condition).",
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
            "MSW Overwatch \u2014 Product Catalog Formatter \u00b7 FastAPI-Keepa-Dashboard",
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
                "Sidebar <b>BC Tools \u2192 Product Catalog Formatter</b> "
                "(BC Tools allowlist + superadmin)",
            ],
            [
                "2. Choose mode",
                "Use <b>Shipment plan</b> or <b>WR SKU Update</b> "
                "(separate uploads on the same page)",
            ],
            [
                "3. Upload",
                "Drop or browse one or more .xlsx / .xlsm / .xls / .csv "
                "(max 30 files, 15 MB each)",
            ],
            [
                "4. Format",
                "Server merges rows, extracts barcodes, and keeps the "
                "first row for each UPC",
            ],
            [
                "5. Download",
                "Receive <b>Product Catalog Formatter.xlsx</b> "
                "(sheet PRODUCTS); Clear to start over",
            ],
        ],
        col_fracs=[0.18, 0.82],
    )


def _modes_table(S: dict) -> Table:
    return _simple_table(
        S,
        ["Mode", "Input", "Mapping"],
        [
            [
                "Shipment plan",
                "Amazon shipment-plan export "
                "(SKU + UPC/EAN/ISBN/JAN/CODABAR)",
                "UPC from barcode column (label stripped); "
                "SKU / FNSKU / Title / Condition",
            ],
            [
                "WR SKU Update",
                "WR SKU Update workbook "
                "(exact SKU, UPC, FNSKU columns)",
                "UPC / SKU / FNSKU as-is; STYLE NAME from "
                "Description; Condition = <b>New</b>",
            ],
        ],
        col_fracs=[0.22, 0.36, 0.42],
    )


def _output_table(S: dict) -> Table:
    return _half_table(
        S,
        ["Column", "Source"],
        [
            ["UPC", "Barcode (shipment plan) or UPC column (WR)"],
            ["SKU", "SKU"],
            ["fnsku", "FNSKU"],
            ["STYLE NAME", "Title (plan) or Description (WR)"],
            ["Condition", "Condition (plan) or always New (WR)"],
        ],
        HALF_W,
    )


def _access_table(S: dict) -> Table:
    return _half_table(
        S,
        ["User", "Access"],
        [
            [
                "BC Tools allowlist",
                "sunshine@, stephanie@, paolo@, paulo@, johnbernard@ "
                "(metroshoewarehouse.com)",
            ],
            [
                "Superadmins",
                "Full Product Catalog Formatter access",
            ],
            [
                "All other users",
                "No sidebar link under BC Tools",
            ],
        ],
        HALF_W,
    )


def _shipment_detail_table(S: dict) -> Table:
    return _simple_table(
        S,
        ["Item", "Detail"],
        [
            [
                "API",
                "<b>POST /api/v1/product-catalog-formatter/format</b> "
                "(audit: <b>catalog_formatter.format</b>)",
            ],
            [
                "Required headers",
                "<b>SKU</b> + a UPC-like column "
                "(e.g. <b>UPC/EAN/ISBN/JAN/CODABAR</b>)",
            ],
            [
                "Barcode rules",
                "Prefer UPC over EAN/JAN/ISBN/CODABAR; strip "
                "<b>UPC:</b> / <b>EAN:</b> labels; reject scientific notation",
            ],
            [
                "Excel types",
                "UPC, SKU, and fnsku forced as text (<b>@</b>) "
                "so leading zeros stay intact",
            ],
            [
                "Skipped",
                "Shipment summary preamble, box-size footer, "
                "blank rows, rows with no usable UPC",
            ],
        ],
        col_fracs=[0.24, 0.76],
    )


def _wr_detail_table(S: dict) -> Table:
    return _simple_table(
        S,
        ["Item", "Detail"],
        [
            [
                "API",
                "<b>POST /api/v1/product-catalog-formatter/format-wr-sku</b> "
                "(audit: <b>catalog_formatter.format_wr_sku</b>)",
            ],
            [
                "Required headers",
                "Exact <b>SKU</b>, <b>UPC</b>, and <b>FNSKU</b> "
                "(shipment-plan barcode column is rejected here)",
            ],
            [
                "Style / condition",
                "STYLE NAME from <b>Description</b> (or STYLE NAME / Title); "
                "Condition always <b>New</b>",
            ],
            [
                "Excel types",
                "Plain digit UPCs without a leading zero as integers; "
                "leading-zero UPCs stay text",
            ],
            [
                "Left out",
                "Item and carton dimension columns from the WR sheet",
            ],
        ],
        col_fracs=[0.24, 0.76],
    )


def _rollout_table(S: dict) -> Table:
    left = [
        Paragraph(
            "Confirm <b>Product Catalog Formatter</b> under BC Tools for "
            "allowlisted emails + superadmin",
            S["bullet"],
        ),
        Spacer(1, 5),
        Paragraph(
            "Shipment plan: upload 2+ Amazon plan files; Download; "
            "open PRODUCTS sheet",
            S["bullet"],
        ),
        Spacer(1, 5),
        Paragraph(
            "Verify unique UPC count; duplicates removed; leading zeros kept",
            S["bullet"],
        ),
        Spacer(1, 5),
        Paragraph(
            "Confirm UPC:/EAN: labels stripped from barcode cells",
            S["bullet"],
        ),
    ]
    right = [
        Paragraph(
            "WR SKU Update: upload a WR workbook; confirm Condition = New "
            "and dimensions omitted",
            S["bullet"],
        ),
        Spacer(1, 5),
        Paragraph(
            "Reject a shipment-plan file on the WR upload (wrong headers)",
            S["bullet"],
        ),
        Spacer(1, 5),
        Paragraph(
            "Non-allowlisted user: no BC Tools sidebar entry",
            S["bullet"],
        ),
        Spacer(1, 5),
        Paragraph(
            "Audit log shows <b>catalog_formatter.format</b> / "
            "<b>format_wr_sku</b>",
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
        title="Product Catalog Formatter \u2014 Implementation Summary",
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

    # --- Page 1 ---
    left_what = sec("WHAT IT DOES") + [
        Paragraph(
            "Product Catalog Formatter merges Amazon shipment-plan exports "
            "or WR SKU Update workbooks into one warehouse-ready "
            "<b>PRODUCTS</b> catalog. Repeated UPCs collapse to a single "
            "row (first wins), so Label Station and catalog imports get a "
            "clean unique-UPC file without spreadsheet cleanup.",
            S["body"],
        ),
    ]
    right_bv = sec("BUSINESS VALUE") + [
        Paragraph(
            "One PRODUCTS workbook instead of hand-merging Amazon dumps",
            S["bullet"],
        ),
        Spacer(1, 4),
        Paragraph(
            "Unique UPCs \u2014 first row wins across multiple uploads",
            S["bullet"],
        ),
        Spacer(1, 4),
        Paragraph(
            "Works from raw shipment plans or Shipment Manager WR SKU Update",
            S["bullet"],
        ),
        Spacer(1, 4),
        Paragraph(
            "Columns match Label Station / catalog import expectations",
            S["bullet"],
        ),
    ]
    story.append(_two_col(left_what, right_bv))
    story.append(Spacer(1, 10))
    story.append(_divider(C_W))
    story.append(Spacer(1, 8))

    story.append(Paragraph("HOW A FORMAT WORKS", S["section"]))
    story.append(_divider(C_W))
    story.append(Spacer(1, 6))
    story.append(_flow_table(S))
    story.append(Spacer(1, 8))
    story.append(_divider(C_W))
    story.append(Spacer(1, 8))

    left_out = sec("OUTPUT SHEET") + [_output_table(S)]
    right_rules = sec("KEY RULES") + [
        Paragraph(
            "Max <b>30</b> files / request \u00b7 <b>15 MB</b> each \u00b7 "
            "<b>100,000</b> rows / file",
            S["bullet"],
        ),
        Spacer(1, 4),
        Paragraph(
            "Accepted: .xlsx / .xlsm / .xls / .csv",
            S["bullet"],
        ),
        Spacer(1, 4),
        Paragraph(
            "Dedupe by UPC (case-insensitive); later copies dropped",
            S["bullet"],
        ),
        Spacer(1, 4),
        Paragraph(
            "Shipment plan and WR modes stay separate \u2014 wrong headers fail",
            S["bullet"],
        ),
    ]
    story.append(_two_col(left_out, right_rules))

    story.append(NextPageTemplate("Later"))
    story.append(PageBreak())

    # --- Page 2 ---
    story.append(Paragraph("MODES AT A GLANCE", S["section"]))
    story.append(_divider(C_W))
    story.append(Spacer(1, 6))
    story.append(_modes_table(S))
    story.append(Spacer(1, 10))
    story.append(_divider(C_W))
    story.append(Spacer(1, 8))

    story.append(Paragraph("SHIPMENT PLAN MODE", S["section"]))
    story.append(_divider(C_W))
    story.append(Spacer(1, 6))
    story.append(
        Paragraph(
            "Amazon shipment-plan sheet with preamble, then a SKU table. "
            "Download filename: <b>Product Catalog Formatter.xlsx</b>.",
            S["body"],
        )
    )
    story.append(Spacer(1, 6))
    story.append(_shipment_detail_table(S))
    story.append(Spacer(1, 10))
    story.append(_divider(C_W))
    story.append(Spacer(1, 8))

    story.append(Paragraph("WR SKU UPDATE MODE", S["section"]))
    story.append(_divider(C_W))
    story.append(Spacer(1, 6))
    story.append(
        Paragraph(
            "Same PRODUCTS output from a WR SKU Update produced by "
            "Shipment Manager (or equivalent). Item / carton dimensions "
            "are not carried into the catalog.",
            S["body"],
        )
    )
    story.append(Spacer(1, 6))
    story.append(_wr_detail_table(S))

    story.append(PageBreak())

    # --- Page 3 ---
    left_access = sec("WHO HAS ACCESS") + [_access_table(S)]
    right_tech = sec("TECH NOTES") + [
        Paragraph(
            "UI: <b>ProductCatalogFormatter.tsx</b> "
            "(two independent upload sections)",
            S["bullet"],
        ),
        Spacer(1, 4),
        Paragraph(
            "Sidebar gate: <b>bcToolsAccess.ts</b>",
            S["bullet"],
        ),
        Spacer(1, 4),
        Paragraph(
            "API auth: signed-in <b>require_app_access</b> "
            "(no separate allowlist on the endpoint)",
            S["bullet"],
        ),
        Spacer(1, 4),
        Paragraph(
            "Stateless convert \u2014 no DB table required",
            S["bullet"],
        ),
        Spacer(1, 4),
        Paragraph(
            "Rate limit: <b>20 uploads / hour</b>",
            S["bullet"],
        ),
        Spacer(1, 4),
        Paragraph(
            "Response headers report file / row / duplicate / skip counts",
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
            "Shipped on web / desktop app version <b>3.6.2</b> "
            "(shipment-plan + WR SKU Update modes)",
            S["bullet"],
        )
    )
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            "Route: <b>/product-catalog-formatter</b> \u00b7 "
            "Sidebar: <b>BC Tools \u2192 Product Catalog Formatter</b>",
            S["bullet"],
        )
    )
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            "Complements <b>Shipment Manager</b> (WR SKU Update compile) "
            "\u2014 this tool turns those sheets into a PRODUCTS catalog",
            S["bullet"],
        )
    )
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            "Output columns align with Label Station / warehouse catalog imports",
            S["bullet"],
        )
    )
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            "Does not touch Keepa jobs, Daily Runs, MAP, or FBA Box Contents",
            S["bullet"],
        )
    )

    doc.build(story)
    return OUTPUT


if __name__ == "__main__":
    out = build_pdf()
    print(f"Wrote: {out}")
