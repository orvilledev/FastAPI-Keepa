"""
Generate MSW Overwatch-style implementation summary PDF for Label Station
in-place Print ID mode (Amazon short SKU vs DNK UPC).

Run:  python docs/generate_label_station_print_id_mode_summary.py
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
    / "Label Station Print ID Mode - Implementation Summary _ MSW Overwatch.pdf"
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
            c.setFont("SegoeUI-Bold", 20)
            c.setFillColor(C_TITLE)
            c.drawString(M_L, PAGE_H - 54, "Label Station \u2014 Print ID Mode")

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
            badge_y_bottom = 212.0
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
                    "Extend the <b>existing Label Station</b> with an in-place "
                    "<b>Print ID</b> control: default <b>Short SKU (Amazon)</b> keeps "
                    "today\u2019s behavior; <b>UPC (DNK)</b> always prints the retail UPC "
                    "under the barcode so DNK can match cartons \u2014 no second station, "
                    "route, or catalog.",
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
            "MSW Overwatch \u2014 Label Station Print ID Mode \u00b7 FastAPI-Keepa-Dashboard",
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
        data.append(
            [Paragraph(cell, S["td"] if i else S["td_b"]) for i, cell in enumerate(row)]
        )
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

    story.append(Spacer(1, 138))

    story.append(Paragraph("Problem", S["section"]))
    story.append(
        Paragraph(
            "Label Station prints the <b>Amazon short SKU</b> under the barcode when catalog "
            "<b>sku</b> has \u22647 numeric digits. DNK needs the <b>retail UPC</b> that matches "
            "the carton. Staff download the PDF and manually replace short SKU text with UPC. "
            "A separate DNK station would work, but is unnecessary if the same tool can switch "
            "print ID while keeping the existing scan / catalog / Amazon workflow.",
            S["body"],
        )
    )
    story.append(Spacer(1, 10))
    story.append(_divider())
    story.append(Spacer(1, 10))

    left_goal = [
        Paragraph("Goal", S["section"]),
        Paragraph(
            "Add an in-place <b>Print ID</b> mode on the existing Label Station:",
            S["body"],
        ),
        Spacer(1, 4),
        Paragraph("\u2022 Default = today\u2019s short-SKU rule (Amazon)", S["bullet"]),
        Paragraph("\u2022 Optional = always print retail UPC (DNK)", S["bullet"]),
        Paragraph("\u2022 Same route, catalog, scan, import, FNSKU barcode", S["bullet"]),
        Paragraph("\u2022 End manual PDF edits for DNK", S["bullet"]),
    ]
    right_nongoal = [
        Paragraph("Non-goals (v1)", S["section"]),
        Paragraph("\u2022 No second route or nav item", S["bullet"]),
        Paragraph("\u2022 No duplicate Label Station page", S["bullet"]),
        Paragraph("\u2022 No schema / External ID column changes", S["bullet"]),
        Paragraph("\u2022 No Master Sheet / UPC-DIMS changes", S["bullet"]),
        Paragraph("\u2022 No UPC barcode encoding yet (Mode B later)", S["bullet"]),
    ]
    story.append(_two_col(left_goal, right_nongoal))
    story.append(Spacer(1, 12))
    story.append(_divider())
    story.append(Spacer(1, 10))

    story.append(Paragraph("Why in-place vs separate station", S["section"]))
    story.append(
        _simple_table(
            S,
            ["", "In-place Print ID mode", "Separate DNK station"],
            [
                ["Surface area", "<b>Smaller</b> \u2014 one UI", "Larger \u2014 route, nav, fork"],
                ["Amazon default", "Explicit default mode", "Separate app"],
                ["Wrong-tool risk", "Toggle mistake", "Wrong page"],
                ["Maintenance", "One shell", "Two shells to sync"],
                ["Catalog / access", "Unchanged", "Allowlist + duplicate wiring"],
            ],
            col_fracs=[0.22, 0.39, 0.39],
        )
    )
    story.append(Spacer(1, 8))
    story.append(
        Paragraph(
            "<b>Chosen approach:</b> in-place mode on <b>/label-station</b>.",
            S["body"],
        )
    )

    story.append(NextPageTemplate("later"))
    story.append(PageBreak())

    # ----- Page 2 -----
    story.append(Paragraph("Product decisions (v1)", S["section"]))
    story.append(
        _simple_table(
            S,
            ["Decision", "Choice"],
            [
                ["Route", "Existing <b>/label-station</b> only"],
                ["Control", "<b>Print ID:</b> Short SKU (Amazon) | UPC (DNK)"],
                ["Default mode", "<b>Short SKU / auto</b> \u2014 current short-SKU rule"],
                ["DNK mode", "Always print <b>product.upc</b> under barcode"],
                ["Barcode payload", "Still <b>FNSKU</b> in both modes (Mode A)"],
                ["Persistence", "localStorage <b>warehouse_label_id_mode</b>"],
                ["Catalog", "Unchanged <b>warehouse_products</b>"],
                ["Import / browse", "Unchanged on same page"],
                ["Access / warehouse-only", "Unchanged"],
            ],
            col_fracs=[0.30, 0.70],
        )
    )
    story.append(Spacer(1, 8))
    story.append(
        Paragraph(
            "<b>Optional:</b> reset to Short SKU on each page load so shared station PCs "
            "default to Amazon; or keep last choice via localStorage.",
            S["body"],
        )
    )
    story.append(Spacer(1, 12))
    story.append(_divider())
    story.append(Spacer(1, 10))

    story.append(Paragraph("Modes at a glance", S["section"]))
    story.append(
        _simple_table(
            S,
            ["Mode", "Under-barcode text", "Everything else"],
            [
                [
                    "Short SKU (Amazon) \u2014 default",
                    "Short SKU if \u22647 digits, else UPC",
                    "Unchanged process",
                ],
                [
                    "UPC (DNK)",
                    "<b>Always retail upc</b>",
                    "Same scan, catalog, FNSKU barcode, sizes, printer, import",
                ],
            ],
            col_fracs=[0.28, 0.36, 0.36],
        )
    )
    story.append(Spacer(1, 12))
    story.append(_divider())
    story.append(Spacer(1, 10))

    story.append(Paragraph("Data model (unchanged)", S["section"]))
    story.append(
        Paragraph(
            "<b>Prerequisite:</b> <b>upc</b> must hold the real retail UPC. Amazon short ID / "
            "External ID equivalent stays in <b>sku</b>. Rows where upc was overwritten with "
            "short SKU must be corrected in catalog data.",
            S["body"],
        )
    )
    story.append(Spacer(1, 6))
    story.append(
        _simple_table(
            S,
            ["Field", "Role"],
            [
                ["upc", "Scan key + printed under barcode in <b>UPC (DNK)</b> mode"],
                ["sku", "Printed under barcode in <b>Short SKU</b> mode when \u22647 digits"],
                ["fnsku", "Top text + barcode (both modes)"],
                ["style_name / condition", "Unchanged"],
            ],
            col_fracs=[0.28, 0.72],
        )
    )
    story.append(Spacer(1, 12))
    story.append(_divider())
    story.append(Spacer(1, 10))

    story.append(Paragraph("UX outline", S["section"]))
    for line in [
        "1. Keep existing Label Station title, scan row, quantity, Print / Clear / Preview PDF.",
        "2. Add <b>Print ID</b> control near label size or printer section "
        "(radio or segmented control).",
        "3. Labels: <b>Short SKU (Amazon)</b> | <b>UPC (DNK)</b> \u2014 default Short SKU.",
        "4. Live size previews and printed / PDF output follow the selected mode.",
        "5. Short helper text: \u201cUse UPC when labels go to DNK for carton match.\u201d",
        "6. Catalog import and Product Catalog table unchanged.",
    ]:
        story.append(Paragraph(line, S["step"]))

    story.append(NextPageTemplate("later"))
    story.append(PageBreak())

    # ----- Page 3 -----
    story.append(Paragraph("Technical design", S["section"]))
    story.append(Paragraph("<b>Core print helper</b>", S["body_b"]))
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            "Extend <b>getLabelScanLine</b> in <b>frontend/src/utils/warehouseLabel.ts</b> "
            "to accept a mode (e.g. <b>'auto' | 'upc'</b>):",
            S["body"],
        )
    )
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            "\u2022 <b>auto</b> \u2014 current short-SKU rule (default)",
            S["bullet"],
        )
    )
    story.append(
        Paragraph(
            "\u2022 <b>upc</b> \u2014 always return <b>product.upc</b>",
            S["bullet"],
        )
    )
    story.append(Spacer(1, 6))
    story.append(
        Paragraph(
            "Thread the mode through <b>renderWarehouseLabelCanvas</b>, "
            "<b>buildWarehouseLabelZpl</b>, and <b>buildWarehouseLabelPdfBlob</b>. "
            "Default parameter = <b>auto</b> so any caller without a mode keeps today\u2019s behavior.",
            S["body"],
        )
    )
    story.append(Spacer(1, 8))
    story.append(Paragraph("<b>UI + persistence</b>", S["body_b"]))
    story.append(
        Paragraph(
            "In <b>LabelStation.tsx</b>: state for print ID mode; "
            "<b>getSelectedLabelIdMode</b> / <b>saveSelectedLabelIdMode</b> with key "
            "<b>warehouse_label_id_mode</b> (same pattern as size / DPI / printer). "
            "Pass mode into preview, ZPL, and PDF paths. Include mode in audit metadata "
            "when useful (<b>label_station.print</b>).",
            S["body"],
        )
    )
    story.append(Spacer(1, 8))
    story.append(Paragraph("<b>Docs</b>", S["body_b"]))
    story.append(
        Paragraph(
            "Update Job Aids short-SKU FAQ and About Label Station blurb: when sending to DNK, "
            "select <b>UPC (DNK)</b>.",
            S["body"],
        )
    )
    story.append(Spacer(1, 8))
    story.append(Paragraph("<b>Backend</b>", S["body_b"]))
    story.append(
        Paragraph("<b>None required for v1.</b>", S["body"]),
    )
    story.append(Spacer(1, 12))
    story.append(_divider())
    story.append(Spacer(1, 10))

    story.append(Paragraph("Files to touch", S["section"]))
    story.append(
        _simple_table(
            S,
            ["File", "Change"],
            [
                [
                    "warehouseLabel.ts",
                    "Mode on getLabelScanLine + canvas / ZPL / PDF; localStorage helpers",
                ],
                ["LabelStation.tsx", "Print ID control; pass mode to preview / print / PDF"],
                ["JobAids.tsx / About.tsx", "Document Short SKU vs UPC (DNK) modes"],
                [
                    "Tests (optional)",
                    "Unit tests: auto prints short SKU; upc mode always prints UPC",
                ],
            ],
            col_fracs=[0.30, 0.70],
        )
    )
    story.append(Spacer(1, 12))
    story.append(_divider())
    story.append(Spacer(1, 10))

    story.append(Paragraph("Implementation steps", S["section"]))
    for line in [
        "1. Add LabelIdMode type + getLabelScanLine(mode) with default auto.",
        "2. Pass mode through render / ZPL / PDF helpers (default preserves callers).",
        "3. Add localStorage get/save for warehouse_label_id_mode.",
        "4. Wire Print ID UI + preview / print / PDF in LabelStation.tsx.",
        "5. Update Job Aids / About.",
        "6. Manual QA: Amazon default unchanged; DNK mode PDF shows UPC; Electron print OK.",
        "7. (Optional) Unit tests for both modes with a short-SKU catalog row.",
    ]:
        story.append(Paragraph(line, S["step"]))

    story.append(NextPageTemplate("later"))
    story.append(PageBreak())

    # ----- Page 4 -----
    story.append(Paragraph("Test plan", S["section"]))
    for line in [
        "\u2022 Default mode + short-SKU row \u2192 under-barcode shows <b>short SKU</b> (unchanged)",
        "\u2022 Switch to UPC (DNK) + same row \u2192 under-barcode shows <b>UPC</b>; barcode still FNSKU",
        "\u2022 Long / empty SKU in auto mode still prints UPC (existing rule)",
        "\u2022 Scan \u2192 Enter auto-print works in both modes (Electron)",
        "\u2022 Browser Preview PDF matches selected mode (no hand edit for DNK)",
        "\u2022 Size previews update when mode changes",
        "\u2022 Mode persists across refresh (if using localStorage) or resets if session-default chosen",
        "\u2022 Catalog import / browse / access unchanged",
        "\u2022 Warehouse-only and Keepa access paths unchanged",
    ]:
        story.append(Paragraph(line, S["bullet"]))

    story.append(Spacer(1, 12))
    story.append(_divider())
    story.append(Spacer(1, 10))

    left_risk = [
        Paragraph("Risks", S["section"]),
        Paragraph(
            "\u2022 Staff leave UPC mode on for Amazon jobs \u2192 clear labels; optional session reset to Short SKU",
            S["bullet"],
        ),
        Spacer(1, 3),
        Paragraph(
            "\u2022 upc column holds short SKU on some rows \u2192 data cleanup",
            S["bullet"],
        ),
        Spacer(1, 3),
        Paragraph(
            "\u2022 Mode A insufficient if DNK must <b>scan</b> UPC \u2192 Mode B (barcode = UPC) later",
            S["bullet"],
        ),
        Spacer(1, 3),
        Paragraph(
            "\u2022 Shared PC localStorage surprise \u2192 document + visible mode indicator",
            S["bullet"],
        ),
    ]
    right_success = [
        Paragraph("Success criteria", S["section"]),
        Paragraph(
            "\u2022 DNK labels show retail UPC without PDF editing",
            S["bullet"],
        ),
        Spacer(1, 3),
        Paragraph(
            "\u2022 Default Amazon / short-SKU process unchanged",
            S["bullet"],
        ),
        Spacer(1, 3),
        Paragraph(
            "\u2022 No second station, route, or catalog",
            S["bullet"],
        ),
        Spacer(1, 10),
        Paragraph("Follow-ups", S["section"]),
        Paragraph("\u2022 Mode B: UPC barcode when Print ID = UPC", S["bullet"]),
        Paragraph("\u2022 Session vs persistent default preference", S["bullet"]),
        Paragraph("\u2022 Auto-map sheets External ID \u2192 sku", S["bullet"]),
    ]
    story.append(_two_col(left_risk, right_success))
    story.append(Spacer(1, 14))
    story.append(_divider())
    story.append(Spacer(1, 10))

    story.append(Paragraph("Relation to separate DNK station summary", S["section"]))
    story.append(
        Paragraph(
            "An earlier summary proposed a parallel <b>DNK Label Station</b> at "
            "<b>/dnk-label-station</b>. This document is the preferred <b>in-place</b> "
            "alternative: same DNK outcome (always print UPC text), lower product and "
            "maintenance cost, existing Label Station process preserved by default.",
            S["body"],
        )
    )

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
