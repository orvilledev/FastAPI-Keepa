"""
Generate MSW Overwatch-style implementation summary PDF for DNK Label Station.
Matches Testing Playground / New Vendor (JFS) reference format.

Run:  python docs/generate_dnk_label_station_implementation_summary.py
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
OUTPUT = ROOT / "docs" / "DNK Label Station - Implementation Summary _ MSW Overwatch.pdf"

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
            c.drawString(M_L, PAGE_H - 54, "DNK Label Station")

            c.setFont("SegoeUI", 11)
            c.setFillColor(C_SUBTITLE)
            c.drawString(M_L, PAGE_H - 73, "Implementation summary \u2014 MSW Overwatch")

            c.setFont("SegoeUI-Bold", 10)
            c.setFillColor(C_META_BOLD)
            c.drawRightString(PAGE_W - M_R, PAGE_H - 48, "MetroShoe Warehouse")

            c.setFont("SegoeUI", 9)
            c.setFillColor(C_SUBTITLE)
            c.drawRightString(PAGE_W - M_R, PAGE_H - 62, "August 2026 \u00b7 App v3.x")

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
                Paragraph("STATUS: READY FOR IMPLEMENTATION", s_status),
                Spacer(1, 6),
                Paragraph(
                    "<b>DNK Label Station</b> is a parallel scan-and-print tool under "
                    "<b>Tools</b>. It reuses the existing warehouse catalog but always "
                    "prints the <b>retail UPC</b> under the barcode so DNK can match "
                    "carton labels \u2014 without changing the current Label Station "
                    "short-SKU (Amazon) behavior.",
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
            "MSW Overwatch \u2014 DNK Label Station \u00b7 FastAPI-Keepa-Dashboard",
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


def build() -> None:
    _reg_fonts()
    S = _make_styles()

    story: list = []

    # ----- Page 1 body (below badge) -----
    story.append(Spacer(1, 132))

    story.append(Paragraph("Problem", S["section"]))
    story.append(
        Paragraph(
            "Warehouse Label Station prints the <b>Amazon short SKU</b> under the barcode when "
            "catalog <b>sku</b> has \u22647 numeric digits. That ID is correct for Amazon-facing "
            "labels, but <b>DNK matches cartons by retail UPC</b>. Staff currently download the "
            "PDF and manually replace the short SKU text with the UPC before sending labels to DNK.",
            S["body"],
        )
    )
    story.append(Spacer(1, 6))
    story.append(
        Paragraph(
            "Sheets use <b>External ID</b> for the same Amazon workaround; Label Station maps that "
            "idea to catalog <b>sku</b>, while <b>upc</b> remains the box barcode.",
            S["body"],
        )
    )
    story.append(Spacer(1, 10))
    story.append(_divider())
    story.append(Spacer(1, 10))

    left_goal = [
        Paragraph("Goal", S["section"]),
        Paragraph(
            "Add a <b>separate</b> DNK Label Station that:",
            S["body"],
        ),
        Spacer(1, 4),
        Paragraph("\u2022 Reuses existing <b>warehouse_products</b> catalog", S["bullet"]),
        Paragraph("\u2022 Always prints <b>retail UPC</b> under the barcode", S["bullet"]),
        Paragraph("\u2022 Does <b>not</b> change current Label Station short-SKU rule", S["bullet"]),
        Paragraph("\u2022 Removes the manual PDF edit step for DNK", S["bullet"]),
    ]
    right_nongoal = [
        Paragraph("Non-goals (v1)", S["section"]),
        Paragraph("\u2022 No new DB table or External ID column", S["bullet"]),
        Paragraph("\u2022 No Master Sheet / UPC-DIMS changes", S["bullet"]),
        Paragraph("\u2022 No change to FNSKU Labels tool", S["bullet"]),
        Paragraph("\u2022 No change to Amazon Label Station rules", S["bullet"]),
    ]
    story.append(_two_col(left_goal, right_nongoal))
    story.append(Spacer(1, 12))
    story.append(_divider())
    story.append(Spacer(1, 10))

    story.append(Paragraph("Product decisions (v1)", S["section"]))
    story.append(
        _simple_table(
            S,
            ["Decision", "Choice"],
            [
                ["Route", "<b>/dnk-label-station</b>"],
                ["Nav label", "<b>DNK Label Station</b> (Tools)"],
                ["Catalog", "Shared <b>warehouse_products</b> via existing API"],
                ["Scan key", "Scan / type <b>UPC</b> (same as today)"],
                ["Under-barcode text", "Always <b>product.upc</b> (ignore short-SKU rule)"],
                ["Barcode payload", "Still <b>FNSKU</b> (Mode A)"],
                ["Catalog import UI", "Only on original Label Station"],
                ["Access", "Same as Label Station (<b>requireLabelStationAccess</b>)"],
                ["Warehouse-only", "Add path to <b>WAREHOUSE_ALLOWED_PATHS</b>"],
            ],
            col_fracs=[0.32, 0.68],
        )
    )
    story.append(Spacer(1, 8))
    story.append(
        Paragraph(
            "<b>Optional later (Mode B):</b> encode UPC in the barcode if DNK must scan the "
            "label against the carton.",
            S["body"],
        )
    )

    story.append(NextPageTemplate("later"))
    story.append(PageBreak())

    # ----- Page 2 -----
    story.append(Paragraph("Data model (unchanged)", S["section"]))
    story.append(
        Paragraph(
            "<b>Prerequisite:</b> <b>upc</b> must hold the real retail UPC. Short / Amazon ID "
            "belongs in <b>sku</b> only. Rows where upc was overwritten with short SKU must be "
            "corrected in catalog data.",
            S["body"],
        )
    )
    story.append(Spacer(1, 6))
    story.append(
        _simple_table(
            S,
            ["Field", "Role for DNK station"],
            [
                ["upc", "Lookup key + <b>printed under barcode</b>"],
                ["sku", "Amazon short ID \u2014 <b>not printed</b> on DNK labels"],
                ["fnsku", "Top text + barcode"],
                ["style_name / condition", "Same as current labels"],
            ],
            col_fracs=[0.28, 0.72],
        )
    )
    story.append(Spacer(1, 12))
    story.append(_divider())
    story.append(Spacer(1, 10))

    story.append(Paragraph("Label layout comparison", S["section"]))
    story.append(
        Paragraph(
            "Same physical size (2.25&quot; \u00d7 1.25&quot;), sizes small / medium / large, "
            "same Zebra / PDF paths.",
            S["body"],
        )
    )
    story.append(Spacer(1, 6))
    story.append(
        _simple_table(
            S,
            ["Region", "Current Label Station", "DNK Label Station"],
            [
                ["Top", "FNSKU", "FNSKU"],
                ["Barcode", "FNSKU", "FNSKU"],
                [
                    "Under barcode",
                    "Short SKU if \u22647 digits, else UPC",
                    "<b>Always UPC</b>",
                ],
                ["Right", "Condition", "Condition"],
                ["Bottom", "Style name", "Style name"],
            ],
            col_fracs=[0.22, 0.39, 0.39],
        )
    )
    story.append(Spacer(1, 12))
    story.append(_divider())
    story.append(Spacer(1, 10))

    story.append(Paragraph("UX outline", S["section"]))
    for line in [
        "1. Title: <b>DNK Label Station</b>",
        "2. Subtitle: Scan UPC; label prints retail UPC for DNK carton match; same warehouse catalog.",
        "3. Scan row, quantity, Print / Clear / Preview PDF \u2014 Enter auto-prints (same model).",
        "4. Label size picker with live preview using DNK renderer.",
        "5. Zebra printer section (Electron) \u2014 same desktop print bridge.",
        "6. <b>No</b> import template / upload; note: manage catalog in Label Station.",
        "7. Shared <b>WarehouseProductCatalog</b> browse / select (fills scan with UPC).",
    ]:
        story.append(Paragraph(line, S["step"]))

    story.append(Spacer(1, 8))
    story.append(_divider())
    story.append(Spacer(1, 10))

    story.append(Paragraph("Technical design", S["section"]))
    story.append(Paragraph("<b>Print helpers</b> \u2014 do not mutate existing short-SKU API", S["body_b"]))
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            "In <b>frontend/src/utils/warehouseLabel.ts</b> (or a thin sibling module): add "
            "<b>getDnkLabelScanLine</b>, <b>renderDnkWarehouseLabelCanvas</b>, "
            "<b>buildDnkWarehouseLabelZpl</b>, <b>buildDnkWarehouseLabelPdfBlob</b>. Clone / adapt "
            "the existing canvas path so the under-barcode line always uses <b>product.upc</b>. "
            "Leave <b>getLabelScanLine</b> untouched.",
            S["body"],
        )
    )
    story.append(Spacer(1, 6))
    story.append(
        Paragraph(
            "Optional separate localStorage keys so prefs do not collide: "
            "<b>dnk_warehouse_label_size</b>, <b>dnk_warehouse_printer_name</b>, "
            "<b>dnk_warehouse_printer_dpi</b>.",
            S["body"],
        )
    )
    story.append(Spacer(1, 8))
    story.append(Paragraph("<b>New page</b>", S["body_b"]))
    story.append(
        Paragraph(
            "<b>frontend/src/components/scanner/DnkLabelStation.tsx</b> \u2014 forked from "
            "LabelStation scan/print shell; wire DNK builders; reuse WarehouseProductCatalog + "
            "warehouseProductsApi.lookup; audit events "
            "<b>dnk_label_station.print</b> / <b>dnk_label_station.download_pdf</b>.",
            S["body"],
        )
    )

    story.append(NextPageTemplate("later"))
    story.append(PageBreak())

    # ----- Page 3 -----
    story.append(Paragraph("Wiring checklist", S["section"]))
    story.append(
        _simple_table(
            S,
            ["File", "Change"],
            [
                ["App.tsx", "Lazy import + route + ProtectedRoute"],
                ["Sidebar.tsx", "Tools link next to Label Station"],
                ["NavbarSearch.tsx", "Search entry"],
                ["warehouseAccess.ts", "Allow /dnk-label-station for warehouse-only"],
                ["JobAids.tsx / About.tsx", "FAQ: DNK = always UPC; original keeps short-SKU"],
                ["Backend", "<b>None required for v1</b>"],
            ],
            col_fracs=[0.32, 0.68],
        )
    )
    story.append(Spacer(1, 12))
    story.append(_divider())
    story.append(Spacer(1, 10))

    story.append(Paragraph("Implementation steps", S["section"]))
    for line in [
        "1. Add DNK scan-line + canvas / ZPL / PDF helpers without changing getLabelScanLine.",
        "2. Build DnkLabelStation.tsx from Label Station (strip import UI; swap renderers / copy / audit).",
        "3. Register route, sidebar, search, warehouse allowlist.",
        "4. Add Job Aids / About blurbs.",
        "5. Manual QA on Electron ZPL + browser PDF.",
        "6. (Optional) Unit tests: getDnkLabelScanLine always returns UPC when short SKU is present.",
    ]:
        story.append(Paragraph(line, S["step"]))

    story.append(Spacer(1, 10))
    story.append(_divider())
    story.append(Spacer(1, 10))

    story.append(Paragraph("Test plan", S["section"]))
    for line in [
        "\u2022 Short-SKU row on <b>current</b> station still prints short SKU",
        "\u2022 Same row on DNK station \u2192 under-barcode shows <b>UPC</b>; barcode still FNSKU",
        "\u2022 Scan UPC \u2192 lookup \u2192 Enter auto-print (Electron)",
        "\u2022 Browser Preview PDF shows UPC text (no hand edit)",
        "\u2022 Catalog browse select fills scan and resolves",
        "\u2022 Warehouse-only user can open /dnk-label-station",
        "\u2022 User without Label Station access is blocked",
        "\u2022 Import only on original station; both see same product count after import",
        "\u2022 Size / DPI / printer prefs work; do not break original station",
    ]:
        story.append(Paragraph(line, S["bullet"]))

    story.append(Spacer(1, 12))
    story.append(_divider())
    story.append(Spacer(1, 10))

    left_risk = [
        Paragraph("Risks", S["section"]),
        Paragraph(
            "\u2022 <b>upc</b> holds short SKU on some rows \u2192 data cleanup; document field ownership",
            S["bullet"],
        ),
        Spacer(1, 3),
        Paragraph(
            "\u2022 Staff use wrong station \u2192 distinct title + sidebar naming",
            S["bullet"],
        ),
        Spacer(1, 3),
        Paragraph(
            "\u2022 Mode A insufficient if DNK must scan UPC \u2192 Mode B later",
            S["bullet"],
        ),
        Spacer(1, 3),
        Paragraph(
            "\u2022 Two large TSX files drift \u2192 keep shared logic in warehouseLabel.ts",
            S["bullet"],
        ),
    ]
    right_success = [
        Paragraph("Success criteria", S["section"]),
        Paragraph(
            "\u2022 DNK labels show retail UPC under barcode without PDF editing",
            S["bullet"],
        ),
        Spacer(1, 3),
        Paragraph(
            "\u2022 Amazon Label Station behavior unchanged",
            S["bullet"],
        ),
        Spacer(1, 3),
        Paragraph(
            "\u2022 One shared catalog powers both stations",
            S["bullet"],
        ),
        Spacer(1, 10),
        Paragraph("Follow-ups", S["section"]),
        Paragraph("\u2022 Mode B: UPC barcode encoding", S["bullet"]),
        Paragraph("\u2022 Auto-map sheets External ID \u2192 sku", S["bullet"]),
        Paragraph("\u2022 Vendor filter / DNK-only subset", S["bullet"]),
    ]
    story.append(_two_col(left_risk, right_success))

    # ----- Document templates -----
    doc = BaseDocTemplate(
        str(OUTPUT),
        pagesize=letter,
        leftMargin=M_L,
        rightMargin=M_R,
        topMargin=M_B,
        bottomMargin=M_B + 12,
    )

    frame1 = Frame(
        M_L,
        M_B + 12,
        C_W,
        PAGE_H - M_B - 12 - 90,
        id="p1",
        leftPadding=0,
        rightPadding=0,
        topPadding=0,
        bottomPadding=0,
    )
    frame_later = Frame(
        M_L,
        M_B + 12,
        C_W,
        PAGE_H - M_B - 12 - 52,
        id="later",
        leftPadding=0,
        rightPadding=0,
        topPadding=0,
        bottomPadding=0,
    )

    doc.addPageTemplates(
        [
            PageTemplate(id="first", frames=[frame1], onPage=_make_page_callback(1)),
            PageTemplate(id="later", frames=[frame_later], onPage=_make_page_callback(2)),
        ]
    )

    doc.build(story)
    print(f"Wrote {OUTPUT}")


if __name__ == "__main__":
    build()
