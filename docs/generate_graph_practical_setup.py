"""
Generate MSW Overwatch PDF: practical Microsoft Graph email setup path.

Easy checklist for IT (Entra) + operator (Render) + test.

Run:  python docs/generate_graph_practical_setup.py
"""
from __future__ import annotations

from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    KeepTogether,
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
    / "MSW Overwatch - Graph Practical Setup Path _ MSW Overwatch.pdf"
)

PAGE_W, PAGE_H = letter
M_L = 48
M_R = 48
M_B = 44
M_T_LATER = 52
FOOTER_H = 28
C_W = PAGE_W - M_L - M_R

BADGE_BOTTOM_FROM_TOP = 248
FIRST_CONTENT_TOP = PAGE_H - BADGE_BOTTOM_FROM_TOP - 8
FIRST_FRAME_H = FIRST_CONTENT_TOP - M_B - FOOTER_H

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
C_CODE_BG = colors.HexColor("#f3f4f6")
C_MUTED = colors.HexColor("#6b7280")


def _reg_fonts() -> None:
    pdfmetrics.registerFont(TTFont("SegoeUI", str(FONTS_DIR / "segoeui.ttf")))
    pdfmetrics.registerFont(TTFont("SegoeUI-Bold", str(FONTS_DIR / "segoeuib.ttf")))
    pdfmetrics.registerFont(TTFont("SegoeUI-Semibold", str(FONTS_DIR / "segoeuib.ttf")))
    pdfmetrics.registerFont(TTFont("Consolas", str(FONTS_DIR / "consola.ttf")))


def _make_styles() -> dict:
    def ps(name, fn, sz, col, lead, **kw):
        return ParagraphStyle(
            name,
            fontName=fn,
            fontSize=sz,
            textColor=col,
            leading=lead,
            alignment=TA_LEFT,
            **kw,
        )

    R, B, S = "SegoeUI", "SegoeUI-Bold", "SegoeUI-Semibold"
    return {
        "h2": ps("h2", B, 11, C_SECTION, 15, spaceBefore=14, spaceAfter=6),
        "body": ps("body", R, 10.5, C_BODY, 15, spaceAfter=6),
        "body_b": ps("body_b", B, 10.5, C_BODY, 15, spaceAfter=6),
        "muted": ps("muted", R, 9.5, C_MUTED, 13, spaceAfter=4),
        "bullet": ps("bullet", R, 10.5, C_BODY, 15, leftIndent=14, bulletIndent=0, spaceAfter=4),
        "step_num": ps("step_num", B, 10.5, C_BODY, 15, spaceAfter=4),
        "step_body": ps("step_body", R, 10.5, C_BODY, 15, leftIndent=18, spaceAfter=4),
        "code": ps(
            "code",
            "Consolas",
            8.5,
            C_BODY,
            12,
            leftIndent=8,
            rightIndent=8,
            spaceBefore=4,
            spaceAfter=4,
        ),
        "th": ps("th", S, 9.5, colors.HexColor("#374151"), 13),
        "td": ps("td", R, 9.5, C_BODY, 13),
    }


def _draw_footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("SegoeUI", 8.5)
    canvas.setFillColor(C_FOOTER)
    canvas.drawString(
        M_L, 22, "MSW Overwatch — Graph Practical Setup Path · MetroShoe Warehouse"
    )
    canvas.drawRightString(PAGE_W - M_R, 22, f"Page {doc.page}")
    canvas.restoreState()


def _draw_first_page(canvas, doc):
    c = canvas
    c.saveState()

    c.setFillColor(colors.white)
    c.roundRect(M_L - 6, M_B - 6, C_W + 12, PAGE_H - M_B - M_T_LATER + 6, 6, fill=1, stroke=0)

    c.setFont("SegoeUI-Bold", 20)
    c.setFillColor(C_TITLE)
    c.drawString(M_L, PAGE_H - 50, "Graph Practical Setup Path")

    c.setFont("SegoeUI", 10.5)
    c.setFillColor(C_SUBTITLE)
    c.drawString(M_L, PAGE_H - 68, "Easy checklist: Entra admin → Render → test email")

    c.setFont("SegoeUI-Bold", 9.5)
    c.setFillColor(C_META_BOLD)
    c.drawRightString(PAGE_W - M_R, PAGE_H - 46, "MetroShoe Warehouse")
    c.setFont("SegoeUI", 9)
    c.setFillColor(C_SUBTITLE)
    c.drawRightString(PAGE_W - M_R, PAGE_H - 60, "September 2026")

    c.setFillColor(C_ACCENT_BAR)
    c.rect(M_L, PAGE_H - 82, C_W, 2, fill=1, stroke=0)

    badge_top = PAGE_H - 96
    badge_h = 138
    c.setFillColor(colors.white)
    c.setStrokeColor(C_BADGE_STROKE)
    c.setLineWidth(0.75)
    c.roundRect(M_L, badge_top - badge_h, C_W, badge_h, 6, fill=1, stroke=1)

    badge_frame = Frame(
        M_L + 12,
        badge_top - badge_h + 10,
        C_W - 24,
        badge_h - 20,
        leftPadding=0,
        rightPadding=0,
        topPadding=0,
        bottomPadding=0,
    )
    s_status = ParagraphStyle(
        "bs", fontName="SegoeUI-Bold", fontSize=10.5, textColor=C_STATUS, leading=14
    )
    s_intro = ParagraphStyle(
        "bi", fontName="SegoeUI", fontSize=10, textColor=C_INTRO, leading=14
    )
    badge_frame.addFromList(
        [
            Paragraph("BEST FIX FOR THE SMTP BLOCK: MICROSOFT GRAPH", s_status),
            Spacer(1, 8),
            Paragraph(
                "Use your <b>company Microsoft 365 / Entra tenant</b> "
                "(not a personal free Azure account). An admin registers one app; "
                "you paste three IDs on Render; Overwatch sends as "
                "<b>overwatch@metroshoewarehouse.com</b> with no SMTP password.",
                s_intro,
            ),
            Spacer(1, 6),
            Paragraph(
                "<b>Collect three values:</b> Tenant ID · Client ID · Client secret",
                s_intro,
            ),
        ],
        c,
    )

    _draw_footer(c, doc)
    c.restoreState()


def _draw_later_page(canvas, doc):
    c = canvas
    c.saveState()
    c.setFillColor(colors.white)
    c.roundRect(M_L - 6, M_B - 6, C_W + 12, PAGE_H - M_B - M_T_LATER + 6, 6, fill=1, stroke=0)
    c.setFillColor(C_ACCENT_BAR)
    c.rect(M_L, PAGE_H - 38, C_W, 2, fill=1, stroke=0)
    c.setFont("SegoeUI-Bold", 9.5)
    c.setFillColor(C_META_BOLD)
    c.drawRightString(PAGE_W - M_R, PAGE_H - 28, "MetroShoe Warehouse · Graph Practical Setup")
    _draw_footer(c, doc)
    c.restoreState()


def _divider(width: float = C_W) -> Table:
    t = Table([[""]], colWidths=[width], rowHeights=[1])
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), C_DIVIDER)]))
    return t


def _section(title: str, S: dict) -> list:
    return [Paragraph(title, S["h2"]), _divider(), Spacer(1, 8)]


def _bullets(items: list[str], S: dict) -> list:
    return [Paragraph(f"• {item}", S["bullet"]) for item in items]


def _numbered(title: str, steps: list[str], S: dict) -> list:
    out: list = [Paragraph(title, S["body_b"])]
    for i, step in enumerate(steps, 1):
        out.append(Paragraph(f"{i}. {step}", S["step_body"]))
    out.append(Spacer(1, 6))
    return out


def _code_block(lines: list[str], S: dict, width: float = C_W) -> Table:
    body = "<br/>".join(lines)
    para = Paragraph(body, S["code"])
    t = Table([[para]], colWidths=[width])
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), C_CODE_BG),
                ("BOX", (0, 0), (-1, -1), 0.5, C_TABLE_BORDER),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
                ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]
        )
    )
    return t


def _table(headers: list[str], rows: list[list[str]], S: dict, col_fracs: list[float]) -> Table:
    widths = [C_W * f for f in col_fracs]
    data = [[Paragraph(h, S["th"]) for h in headers]]
    for row in rows:
        data.append([Paragraph(cell, S["td"]) for cell in row])
    t = Table(data, colWidths=widths, repeatRows=1)
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), C_TABLE_HEAD),
                ("GRID", (0, 0), (-1, -1), 0.5, C_TABLE_BORDER),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    return t


def build_pdf() -> Path:
    _reg_fonts()
    S = _make_styles()

    later_frame_h = PAGE_H - M_T_LATER - M_B - FOOTER_H

    doc = BaseDocTemplate(
        str(OUTPUT),
        pagesize=letter,
        leftMargin=M_L,
        rightMargin=M_R,
        topMargin=M_T_LATER,
        bottomMargin=M_B + FOOTER_H,
    )
    doc.addPageTemplates(
        [
            PageTemplate(
                id="First",
                frames=[Frame(M_L, M_B + FOOTER_H, C_W, FIRST_FRAME_H, id="first")],
                onPage=_draw_first_page,
            ),
            PageTemplate(
                id="Later",
                frames=[Frame(M_L, M_B + FOOTER_H, C_W, later_frame_h, id="later")],
                onPage=_draw_later_page,
            ),
        ]
    )

    story: list = []

    story.extend(_section("BEFORE YOU START", S))
    story.append(
        _table(
            ["Need", "Detail"],
            [
                [
                    "Who",
                    "An M365 / Entra <b>admin</b> for metroshoewarehouse.com "
                    "(not a personal free Azure account)",
                ],
                [
                    "Mailbox",
                    "overwatch@metroshoewarehouse.com already works in Outlook",
                ],
                [
                    "Where to configure",
                    "Render → Keepa API / backend environment variables",
                ],
                [
                    "What to collect",
                    "1) Tenant ID  2) Client ID  3) Client secret Value",
                ],
            ],
            S,
            [0.28, 0.72],
        )
    )
    story.append(Spacer(1, 6))
    story.append(
        Paragraph(
            "<b>One-line summary:</b> Admin creates Entra app + grants Mail.Send / "
            "Mail.ReadWrite → you paste the three IDs on Render with "
            "EMAIL_TRANSPORT=graph → restart → test email.",
            S["body_b"],
        )
    )

    story.append(NextPageTemplate("Later"))
    story.append(PageBreak())

    # --- Part A ---
    story.extend(_section("PART A — ADMIN CREATES THE APP (ENTRA)", S))

    story.extend(
        _numbered(
            "A1. Open Entra",
            [
                "Go to <b>https://entra.microsoft.com</b>",
                "Sign in with a <b>company admin</b> account",
            ],
            S,
        )
    )
    story.extend(
        _numbered(
            "A2. Register the app",
            [
                "Left menu: <b>Applications</b> → <b>App registrations</b>",
                "Click <b>New registration</b>",
                "Name: <b>MSW Overwatch Graph Mail</b>",
                "Supported account types: <b>Accounts in this organizational directory only</b>",
                "Click <b>Register</b>",
            ],
            S,
        )
    )
    story.extend(
        _numbered(
            "A3. Copy the two IDs (Overview page)",
            [
                "Copy <b>Directory (tenant) ID</b> → save as AZURE_TENANT_ID",
                "Copy <b>Application (client) ID</b> → save as AZURE_CLIENT_ID",
            ],
            S,
        )
    )
    story.append(
        _table(
            ["On screen", "Save as"],
            [
                ["Directory (tenant) ID", "AZURE_TENANT_ID"],
                ["Application (client) ID", "AZURE_CLIENT_ID"],
            ],
            S,
            [0.5, 0.5],
        )
    )
    story.append(Spacer(1, 8))

    story.extend(
        _numbered(
            "A4. Add Graph permissions",
            [
                "Left: <b>API permissions</b> → <b>Add a permission</b>",
                "Choose <b>Microsoft Graph</b>",
                "Choose <b>Application permissions</b> (not Delegated)",
                "Search and add: <b>Mail.Send</b> and <b>Mail.ReadWrite</b>",
                "Click <b>Add permissions</b>",
                "Click <b>Grant admin consent for …</b> → confirm (green Granted)",
            ],
            S,
        )
    )
    story.extend(
        _bullets(
            [
                "<b>Mail.Send</b> — automatic Daily Run / report emails",
                "<b>Mail.ReadWrite</b> — manual “Open Overwatch draft” "
                "(To/Cc/Bcc + attachment)",
            ],
            S,
        )
    )
    story.append(Spacer(1, 6))

    story.extend(
        _numbered(
            "A5. Create a client secret",
            [
                "Left: <b>Certificates &amp; secrets</b>",
                "Click <b>New client secret</b>",
                "Description: Overwatch production",
                "Expiry: whatever IT allows (e.g. 12–24 months)",
                "Click <b>Add</b>",
                "Copy the <b>Value</b> immediately (shown once) → AZURE_CLIENT_SECRET",
                "Do <b>not</b> copy Secret ID — only the Value",
            ],
            S,
        )
    )
    story.append(
        Paragraph(
            "Admin is done. Hand the three values to the Overwatch operator securely.",
            S["body_b"],
        )
    )

    story.append(PageBreak())

    # --- Part B ---
    story.extend(_section("PART B — PUT THEM ON RENDER (OVERWATCH API)", S))
    story.append(
        Paragraph(
            "On the <b>backend / Keepa API</b> service in Render → <b>Environment</b>, "
            "set:",
            S["body"],
        )
    )
    story.append(
        KeepTogether(
            [
                _code_block(
                    [
                        "EMAIL_TRANSPORT=graph",
                        "EMAIL_FROM=overwatch@metroshoewarehouse.com",
                        "EMAIL_FROM_NAME=MSW Overwatch",
                        "",
                        "AZURE_TENANT_ID=&lt;paste tenant ID&gt;",
                        "AZURE_CLIENT_ID=&lt;paste client ID&gt;",
                        "AZURE_CLIENT_SECRET=&lt;paste secret Value&gt;",
                    ],
                    S,
                )
            ]
        )
    )
    story.append(Spacer(1, 8))
    story.extend(
        _bullets(
            [
                "<b>EMAIL_PASSWORD</b> is not needed for Graph",
                "Save / redeploy so the API restarts",
                "Optional (superadmin): User Management → Outbound Email Transport "
                "→ <b>Graph API</b> (helps until restart; Render env is the lasting default)",
            ],
            S,
        )
    )

    # --- Part C ---
    story.extend(_section("PART C — TEST", S))
    story.extend(
        _numbered(
            "Verify Graph is working",
            [
                "Open MSW Overwatch (web) and sign in",
                "Send a <b>test email</b> (reports test control, or "
                "POST /api/v1/reports/test-email)",
                "Success response should include <b>\"transport\": \"graph\"</b>",
                "Confirm the message arrives from <b>MSW Overwatch</b> "
                "&lt;overwatch@metroshoewarehouse.com&gt;",
            ],
            S,
        )
    )

    # --- Troubleshooting ---
    story.extend(_section("IF IT FAILS", S))
    story.append(
        _table(
            ["What you see", "Likely fix"],
            [
                [
                    "Token / 401",
                    "Wrong tenant ID, client ID, or secret Value",
                ],
                [
                    "403",
                    "Admin consent not granted, or mailbox blocked by policy",
                ],
                [
                    "404",
                    "EMAIL_FROM mailbox does not exist",
                ],
                [
                    "Still using SMTP",
                    "Azure vars missing, or transport still set to SMTP",
                ],
            ],
            S,
            [0.32, 0.68],
        )
    )

    story.append(Spacer(1, 10))
    story.extend(_section("OPTIONAL LATER (IT)", S))
    story.append(
        Paragraph(
            "After mail works, IT can restrict the app so it can only send as "
            "<b>overwatch@…</b> (Exchange Application Access Policy). Not required "
            "for first success. Full PowerShell steps: "
            "<b>docs/microsoft-graph-email-setup.md</b>.",
            S["body"],
        )
    )

    story.append(Spacer(1, 12))
    story.append(
        Paragraph(
            "Document prepared for MetroShoe Warehouse · MSW Overwatch · September 2026",
            S["muted"],
        )
    )

    doc.build(story)
    return OUTPUT


if __name__ == "__main__":
    path = build_pdf()
    print(f"Wrote: {path}")
