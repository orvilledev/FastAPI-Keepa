"""
Generate MSW Overwatch-style implementation summary PDF for the NFA and SMW Tool
inside FBA Box Contents.
Matches Label Center / FBA Box Contents / Freight Class format.

Run:  python docs/generate_nfa_smw_tool_implementation_summary.py
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
OUTPUT = ROOT / "docs" / "NFA and SMW Tool - Implementation Summary _ MSW Overwatch.pdf"

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
        "bullet": ps("bullet", R, 10, C_BODY, 14),
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
            c.drawString(M_L, PAGE_H - 54, "NFA and SMW Tool")

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
            badge_y_bottom = 214.0
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
            badge_frame.addFromList(
                [
                    Paragraph("STATUS: SUCCESSFULLY IMPLEMENTED", s_status),
                    Spacer(1, 6),
                    Paragraph(
                        "<b>NFA and SMW Tool</b> lives inside <b>FBA Box Contents</b>. "
                        "It turns a North Face or Smartwool carton dump into a "
                        "<b>Box Contents</b> and <b>Dimensions</b> workbook, "
                        "corrects that Output against the Amazon manifest, "
                        "and builds a <b>Carton Numbers</b> workbook from several "
                        "carton files or one zip. Allowlisted users and superadmins only.",
                        s_intro,
                    ),
                ],
                c,
            )
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
            "MSW Overwatch \u2014 NFA and SMW Tool \u00b7 FastAPI-Keepa-Dashboard",
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
    widths = [width / len(headers)] * len(headers)
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
        ["Job", "Input", "Output"],
        [
            [
                "Output workbook",
                "Spaced-column carton dump starting with <b>PO#:</b>",
                "<b>Box Contents</b> + <b>Dimensions</b> "
                "(Weight from the Total row as text)",
            ],
            [
                "Manifest Compare",
                "That Output file plus Seller Central "
                "<b>Box packing information</b>",
                "Corrected workbook. Shortfalls go on the last box, in yellow.",
            ],
            [
                "Carton Numbers",
                "Several carton files, or one <b>.zip</b> of them",
                "One workbook. One sheet per shipment, with Box Number 1, 2, 3\u2026",
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
                "Sidebar <b>BC Tools \u2192 FBA Box Contents</b>, then expand "
                "<b>NFA and SMW Tool</b> (allowlisted + superadmin only)",
            ],
            [
                "2. Build the Output",
                "Upload the carton dump. The server numbers each <b>Carton#:</b> "
                "as Box Number 1, 2, 3\u2026 and downloads <b>{filename} Output.xlsx</b>",
            ],
            [
                "3. Compare",
                "Upload that Output and the Amazon manifest. Old SKUs are remapped. "
                "Missing units are added to the last box.",
            ],
            [
                "4. Carton Numbers",
                "Upload the same carton files, or a zip. Each shipment becomes its own sheet.",
            ],
        ],
        col_fracs=[0.18, 0.82],
    )


def _output_table(S: dict) -> Table:
    return _simple_table(
        S,
        ["Item", "Detail"],
        [
            [
                "API",
                "<b>POST /api/v1/fba-box-contents/generate-tool2</b> "
                "(audit: <b>fba_box_contents.generate_tool2</b>)",
            ],
            [
                "Input",
                "First row <b>PO#:</b> and the shipment id. Blank spacer columns sit between "
                "Sku, UPC, Qty, Weight, and carton dimensions. Each carton is "
                "<b>Carton#:</b>, then item lines, then a Total row.",
            ],
            [
                "Box Contents",
                "UPC as text, <b>Box Number</b> and QTY as numbers, and a Sum of QTY pivot. "
                "No Total QTY footer.",
            ],
            [
                "Dimensions",
                "Weight copied from the Total row as text (often with a leading space), "
                "then Length, Width, Height. <b>No Box # column.</b>",
            ],
            [
                "Download",
                "<b>{filename} Output.xlsx</b>, for example <b>FBA19PLBV097 Output.xlsx</b>",
            ],
        ],
        col_fracs=[0.22, 0.78],
    )


def _compare_table(S: dict) -> Table:
    return _simple_table(
        S,
        ["Item", "Detail"],
        [
            [
                "API",
                "<b>POST /api/v1/fba-box-contents/compare-tool2</b> "
                "(audit: <b>fba_box_contents.compare_tool2</b>)",
            ],
            [
                "Files",
                "1. NFA and SMW Output.xlsx (Box Contents + Dimensions). "
                "2. Seller Central Box packing information.xlsx. The manifest is the source of truth.",
            ],
            [
                "Old SKUs",
                "Output UPCs and Amazon ids are looked up in the Old SKUs catalog so a remapped "
                "UPC still matches the manifest.",
            ],
            [
                "Corrections",
                "Missing quantity is added to the <b>last box</b> and highlighted yellow. "
                "Extra quantity can be removed. The download name ends in <b>corrected</b>.",
            ],
        ],
        col_fracs=[0.22, 0.78],
    )


def _carton_table(S: dict) -> Table:
    return _simple_table(
        S,
        ["Item", "Detail"],
        [
            [
                "API",
                "<b>POST /api/v1/fba-box-contents/generate-carton-numbers</b>",
            ],
            [
                "Upload",
                ".xls, .xlsx, or .zip. Up to <b>100</b> files. A zip may be up to <b>50 MB</b>; "
                "a single Excel file follows the 15 MB upload limit. Other files inside a zip are skipped.",
            ],
            [
                "Sheets",
                "One sheet per shipment, named by its FBA id, in the order the files were uploaded. "
                "Each shipment can be uploaded once.",
            ],
            [
                "Columns",
                "<b>Original Carton</b> (the Carton#: barcode, kept as text) and <b>Box Number</b> "
                "1, 2, 3\u2026 in the order the cartons appear. The box count must match the file's "
                "<b>Total Ctns</b> footer.",
            ],
            [
                "Download",
                "<b>Carton Numbers.xlsx</b>. It sits below Manifest Compare and Correct on the page.",
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
                "Allowlisted emails",
                "sunshine@, stephanie@, paolo@, paulo@, johnbernard@ (metroshoewarehouse.com)",
            ],
            ["Superadmins", "Full FBA Box Contents access, including this tool"],
            ["All other users", "No sidebar link. The page and the API are blocked."],
        ],
        HALF_W,
    )


def _rollout_table(S: dict) -> Table:
    left = [
        Paragraph(
            "Confirm <b>FBA Box Contents</b> under BC Tools only for allowlisted emails and a superadmin",
            S["bullet"],
        ),
        Spacer(1, 5),
        Paragraph(
            "Output: upload a <b>PO#:</b> spaced dump. Check Box Number, the pivot, and Dimensions weight as text",
            S["bullet"],
        ),
        Spacer(1, 5),
        Paragraph(
            "Compare: Output plus the Seller Central manifest. Confirm an Old SKU remap and a yellow last-box add",
            S["bullet"],
        ),
    ]
    right = [
        Paragraph(
            "Carton Numbers: several carton files, then one zip of the same files. One sheet per FBA id",
            S["bullet"],
        ),
        Spacer(1, 5),
        Paragraph(
            "Reject a .csv and an empty file. The page shows the server's error instead of a blank download",
            S["bullet"],
        ),
        Spacer(1, 5),
        Paragraph(
            "A user who is not allowlisted has no sidebar entry, and the API returns restricted",
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
        M_L, M_B, C_W, PAGE_H - 240 - M_B,
        id="p1", leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0,
    )
    frame2 = Frame(
        M_L, M_B, C_W, PAGE_H - 52 - M_B,
        id="p2", leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0,
    )
    doc = BaseDocTemplate(
        str(OUTPUT),
        pagesize=letter,
        leftMargin=M_L,
        rightMargin=M_R,
        topMargin=M_B,
        bottomMargin=M_B,
        title="NFA and SMW Tool \u2014 Implementation Summary",
    )
    doc.addPageTemplates(
        [
            PageTemplate(id="First", frames=frame1, onPage=_make_page_callback(1)),
            PageTemplate(id="Later", frames=frame2, onPage=_make_page_callback(2)),
        ]
    )

    def sec(title, divider_width=HALF_W):
        return [Paragraph(title, S["section"]), _divider(divider_width), Spacer(1, 6)]

    story = []
    left_what = sec("WHAT IT DOES") + [
        Paragraph(
            "One panel for North Face and Smartwool carton files. "
            "Staff download the Box Contents workbook, correct it against "
            "the Amazon manifest, and number every carton without re-keying.",
            S["body"],
        ),
    ]
    right_bv = sec("BUSINESS VALUE") + [
        Paragraph("NFA and SMW share one converter instead of two spreadsheets", S["bullet"]),
        Spacer(1, 4),
        Paragraph("UPCs stay text so Excel does not turn them into scientific notation", S["bullet"]),
        Spacer(1, 4),
        Paragraph("Manifest Compare makes Output quantities match Amazon", S["bullet"]),
        Spacer(1, 4),
        Paragraph("A zip of carton files becomes one Carton Numbers workbook", S["bullet"]),
    ]
    story.append(_two_col(left_what, right_bv))
    story.append(Spacer(1, 10))
    story.append(_divider(C_W))
    story.append(Spacer(1, 8))
    story.append(Paragraph("HOW A RUN WORKS", S["section"]))
    story.append(_divider(C_W))
    story.append(Spacer(1, 6))
    story.append(_flow_table(S))
    story.append(Spacer(1, 8))
    story.append(_divider(C_W))
    story.append(Spacer(1, 8))
    story.append(Paragraph("JOBS AT A GLANCE", S["section"]))
    story.append(_divider(C_W))
    story.append(Spacer(1, 6))
    story.append(_glance_table(S))
    story.append(NextPageTemplate("Later"))
    story.append(PageBreak())

    story.append(Paragraph("OUTPUT WORKBOOK", S["section"]))
    story.append(_divider(C_W))
    story.append(Spacer(1, 6))
    story.append(
        Paragraph(
            "The shared converter for a spaced-column carton dump. "
            "Internally this is Tool #2. OBZ and DNK stay on their own panels.",
            S["body"],
        )
    )
    story.append(Spacer(1, 6))
    story.append(_output_table(S))
    story.append(Spacer(1, 10))
    story.append(_divider(C_W))
    story.append(Spacer(1, 8))

    story.append(Paragraph("MANIFEST COMPARE AND CORRECT", S["section"]))
    story.append(_divider(C_W))
    story.append(Spacer(1, 6))
    story.append(
        Paragraph(
            "Sits on the same panel, above Carton Numbers. "
            "The Amazon file decides the quantities. The Output is adjusted to match.",
            S["body"],
        )
    )
    story.append(Spacer(1, 6))
    story.append(_compare_table(S))

    story.append(PageBreak())
    story.append(Paragraph("CARTON NUMBERS", S["section"]))
    story.append(_divider(C_W))
    story.append(Spacer(1, 6))
    story.append(
        Paragraph(
            "Uses the same carton files as the Output. "
            "Several files, or one zip, become a single workbook of box numbers.",
            S["body"],
        )
    )
    story.append(Spacer(1, 6))
    story.append(_carton_table(S))
    story.append(Spacer(1, 12))
    story.append(_divider(C_W))
    story.append(Spacer(1, 8))

    left_access = sec("WHO HAS ACCESS") + [_access_table(S)]
    right_tech = sec("TECH NOTES") + [
        Paragraph("UI: <b>FbaBoxContents.tsx</b> \u00b7 route under FBA Box Contents", S["bullet"]),
        Spacer(1, 4),
        Paragraph("Output and compare: <b>fba_box_contents.py</b>", S["bullet"]),
        Spacer(1, 4),
        Paragraph("Carton Numbers: <b>fba_carton_numbers.py</b>", S["bullet"]),
        Spacer(1, 4),
        Paragraph("Old SKU remap reads the catalog during Manifest Compare", S["bullet"]),
        Spacer(1, 4),
        Paragraph("Tool #1 (generic FBA Carton Detail) stays in code and is hidden", S["bullet"]),
    ]
    story.append(_two_col(left_access, right_tech))
    story.append(Spacer(1, 12))
    story.append(_divider(C_W))
    story.append(Spacer(1, 8))

    story.append(Paragraph("KEY RULES", S["section"]))
    story.append(_divider(C_W))
    story.append(Spacer(1, 6))
    story.append(Paragraph("Do not run an NFA or SMW file through the OBZ or DNK panels", S["bullet"]))
    story.append(Spacer(1, 4))
    story.append(Paragraph("Dimensions weight is text copied from the Total row, not a rounded number", S["bullet"]))
    story.append(Spacer(1, 4))
    story.append(Paragraph("Manifest Compare adds missing units to the last box only", S["bullet"]))
    story.append(Spacer(1, 4))
    story.append(Paragraph("Carton Numbers rejects a second upload of the same shipment", S["bullet"]))
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
            "Current app version <b>3.7.2</b>. The tool is part of FBA Box Contents, "
            "not a separate sidebar item.",
            S["bullet"],
        )
    )
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            "Path: <b>BC Tools \u2192 FBA Box Contents \u2192 NFA and SMW Tool</b>",
            S["bullet"],
        )
    )
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            "Three downloads: the Output workbook, the corrected compare file, and Carton Numbers.xlsx",
            S["bullet"],
        )
    )
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            "Does not print labels. Carton labels are a separate job in Label Center.",
            S["bullet"],
        )
    )

    doc.build(story)
    return OUTPUT


if __name__ == "__main__":
    out = build_pdf()
    print(f"Wrote: {out}")
