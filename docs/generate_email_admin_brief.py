"""
Generate MSW Overwatch admin brief PDF for outbound email / Security Defaults issue.

Run:  python docs/generate_email_admin_brief.py
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
OUTPUT = ROOT / "docs" / "MSW Overwatch - Email Admin Brief _ MSW Overwatch.pdf"

PAGE_W, PAGE_H = letter
M_L = 48
M_R = 48
M_B = 44
M_T_LATER = 52
FOOTER_H = 28
C_W = PAGE_W - M_L - M_R

# First-page badge ends ~218pt from top; content starts below it.
BADGE_BOTTOM_FROM_TOP = 228
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
        "step_body": ps("step_body", R, 10.5, C_BODY, 15, leftIndent=18, spaceAfter=6),
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
    canvas.drawString(M_L, 22, "MSW Overwatch — Email Admin Brief · MetroShoe Warehouse")
    canvas.drawRightString(PAGE_W - M_R, 22, f"Page {doc.page}")
    canvas.restoreState()


def _draw_first_page(canvas, doc):
    c = canvas
    c.saveState()

    c.setFillColor(colors.white)
    c.roundRect(M_L - 6, M_B - 6, C_W + 12, PAGE_H - M_B - M_T_LATER + 6, 6, fill=1, stroke=0)

    c.setFont("SegoeUI-Bold", 21)
    c.setFillColor(C_TITLE)
    c.drawString(M_L, PAGE_H - 50, "Outbound Email Failure")

    c.setFont("SegoeUI", 10.5)
    c.setFillColor(C_SUBTITLE)
    c.drawString(M_L, PAGE_H - 68, "Admin brief for Microsoft 365 / Entra ID administrators")

    c.setFont("SegoeUI-Bold", 9.5)
    c.setFillColor(C_META_BOLD)
    c.drawRightString(PAGE_W - M_R, PAGE_H - 46, "MetroShoe Warehouse")
    c.setFont("SegoeUI", 9)
    c.setFillColor(C_SUBTITLE)
    c.drawRightString(PAGE_W - M_R, PAGE_H - 60, "September 2026")

    c.setFillColor(C_ACCENT_BAR)
    c.rect(M_L, PAGE_H - 82, C_W, 2, fill=1, stroke=0)

    badge_top = PAGE_H - 96
    badge_h = 118
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
    s_status = ParagraphStyle("bs", fontName="SegoeUI-Bold", fontSize=10.5, textColor=C_STATUS, leading=14)
    s_intro = ParagraphStyle("bi", fontName="SegoeUI", fontSize=10, textColor=C_INTRO, leading=14)
    badge_frame.addFromList(
        [
            Paragraph("ISSUE: DAILY REPORT EMAILS NOT DELIVERED", s_status),
            Spacer(1, 8),
            Paragraph(
                "On <b>September 3, 2026</b>, MSW Overwatch daily runs completed in the app, "
                "but report emails were not delivered. Microsoft returns error "
                "<b>535 5.7.139</b> — <b>Security Defaults</b> is blocking SMTP password login "
                "for <b>overwatch@metroshoewarehouse.com</b>.",
                s_intro,
            ),
            Spacer(1, 6),
            Paragraph(
                "<b>Recommended fix:</b> Microsoft Graph <b>Mail.Send</b> (application permission).",
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
    c.drawRightString(PAGE_W - M_R, PAGE_H - 28, "MetroShoe Warehouse · Email Admin Brief")
    _draw_footer(c, doc)
    c.restoreState()


def _divider(width: float = C_W) -> Table:
    t = Table([[""]], colWidths=[width], rowHeights=[1])
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), C_DIVIDER)]))
    return t


def _section(title: str, S: dict) -> list:
    return [Paragraph(title, S["h2"]), _divider(), Spacer(1, 8)]


def _bullets(items: list[str], S: dict) -> list:
    out: list = []
    for item in items:
        out.append(Paragraph(f"• {item}", S["bullet"]))
    return out


def _numbered_steps(steps: list[tuple[str, list[str]]], S: dict) -> list:
    """Each step: (title, sub-bullets or empty)."""
    out: list = []
    for i, (title, subs) in enumerate(steps, 1):
        out.append(Paragraph(f"{i}. {title}", S["step_num"]))
        for sub in subs:
            out.append(Paragraph(f"• {sub}", S["step_body"]))
        out.append(Spacer(1, 4))
    return out


def _code_block(lines: list[str], S: dict, width: float = C_W) -> Table:
    """Wrapping code block using Paragraph (Preformatted overflows narrow columns)."""
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

    # --- Page 1 body (below badge) ---
    story.extend(_section("AT A GLANCE", S))
    story.append(
        _table(
            ["Field", "Value"],
            [
                ["Application", "MSW Overwatch (FastAPI backend on Render)"],
                ["Sender mailbox", "overwatch@metroshoewarehouse.com"],
                ["What failed", "SMTP login to smtp.office365.com:587"],
                ["Error code", "535 5.7.139 — Security Defaults policy"],
                ["App job status", "Completed (reports generated; email step failed)"],
                ["Recommended fix", "Microsoft Graph Mail.Send (application permission)"],
            ],
            S,
            [0.28, 0.72],
        )
    )
    story.append(Spacer(1, 12))

    story.extend(_section("WHAT THIS IS NOT", S))
    story.extend(
        _bullets(
            [
                "Not a missing-recipients problem — vendor To/BCC lists are configured.",
                "Not a report-generation failure — CSV/Excel files build successfully.",
                "Not an application crash — daily runs finish and show as completed.",
            ],
            S,
        )
    )
    story.append(
        Paragraph(
            "Microsoft rejects the <b>sign-in method</b> (SMTP username + password) "
            "before any message is sent.",
            S["body"],
        )
    )

    story.append(NextPageTemplate("Later"))
    story.append(PageBreak())

    # --- Page 2: Error + flow ---
    story.extend(_section("THE ERROR MESSAGE", S))
    story.append(
        _code_block(
            [
                "535 5.7.139 Authentication unsuccessful,",
                "user is locked by your organization's security defaults policy.",
                "Contact your administrator.",
            ],
            S,
        )
    )
    story.append(Spacer(1, 10))
    story.append(
        _table(
            ["Code", "Meaning"],
            [
                ["535", "SMTP authentication failed"],
                ["5.7.139", "Blocked by Security Defaults (legacy auth not allowed)"],
            ],
            S,
            [0.18, 0.82],
        )
    )
    story.append(Spacer(1, 14))

    story.extend(_section("WHERE IT FAILS IN THE PIPELINE", S))
    story.append(
        _code_block(
            [
                "1. Daily job completes ........................ OK",
                "2. MAP exception report generated .............. OK",
                "3. App connects to smtp.office365.com:587 ...... OK",
                "4. Login as overwatch@... + password ........... FAIL (535 5.7.139)",
                "5. Email delivery .............................. Never reached",
            ],
            S,
        )
    )
    story.append(Spacer(1, 8))
    story.append(
        Paragraph(
            "Emails succeeded on <b>September 2, 2026</b> for the same vendors. "
            "This suggests a recent tenant policy change or new enforcement on the mailbox.",
            S["body"],
        )
    )

    story.append(PageBreak())

    # --- Page 3: Verify ---
    story.extend(_section("HOW TO VERIFY (ADMIN CHECKLIST)", S))
    story.append(Paragraph("<b>Check 1 — Security Defaults</b>", S["body_b"]))
    story.extend(
        _bullets(
            [
                "Open Microsoft Entra admin center (entra.microsoft.com)",
                "Identity → Overview → Properties → Manage Security defaults",
                "Note whether Security Defaults are Enabled",
            ],
            S,
        )
    )
    story.append(Spacer(1, 8))
    story.append(Paragraph("<b>Check 2 — SMTP AUTH on the mailbox</b>", S["body_b"]))
    story.append(
        _code_block(
            [
                "Connect-ExchangeOnline",
                "Get-CASMailbox -Identity overwatch@metroshoewarehouse.com",
                "  | Format-List SmtpClientAuthenticationDisabled",
            ],
            S,
        )
    )
    story.append(
        Paragraph(
            "If <b>SmtpClientAuthenticationDisabled : True</b>, SMTP login is disabled for this mailbox.",
            S["body"],
        )
    )
    story.append(Spacer(1, 8))
    story.append(Paragraph("<b>Check 3 — Sign-in logs (optional)</b>", S["body_b"]))
    story.extend(
        _bullets(
            [
                "Entra → Monitoring → Sign-in logs",
                "Filter failed sign-ins for overwatch@metroshoewarehouse.com",
                "Look for blocks tied to Security Defaults or legacy authentication",
            ],
            S,
        )
    )

    story.append(PageBreak())

    # --- Page 4: Option A part 1 ---
    story.extend(_section("FIX OPTION A — MICROSOFT GRAPH (RECOMMENDED)", S))
    story.append(
        Paragraph(
            "Register an Entra application with <b>Mail.Send (application permission)</b>. "
            "The app sends mail via HTTPS Graph API — no mailbox password over SMTP.",
            S["body"],
        )
    )
    story.append(Spacer(1, 6))
    story.extend(
        _numbered_steps(
            [
                (
                    "Create app registration",
                    [
                        "Entra admin center → Applications → App registrations → New registration",
                        "Name: MSW Overwatch Graph Mail",
                        "Account type: Accounts in this organizational directory only",
                        "Save Application (client) ID and Directory (tenant) ID",
                    ],
                ),
                (
                    "Add API permissions",
                    [
                        "API permissions → Add permission → Microsoft Graph",
                        "Application permissions → Mail.Send",
                        "Grant admin consent for the organization",
                    ],
                ),
                (
                    "Create client secret",
                    [
                        "Certificates & secrets → New client secret",
                        "Copy the secret value immediately (shown once only)",
                    ],
                ),
            ],
            S,
        )
    )

    story.append(PageBreak())

    # --- Page 5: Option A part 2 ---
    story.extend(_section("OPTION A — RESTRICT, CONFIGURE, HAND OFF", S))
    story.append(Paragraph("<b>Step 4 — Restrict send to overwatch@ only (recommended)</b>", S["body_b"]))
    story.append(
        _code_block(
            [
                "Connect-ExchangeOnline",
                "",
                'New-ServicePrincipal -AppId "<AZURE_CLIENT_ID>" `',
                '  -ServiceId "<object-id-from-entra-app-overview>"',
                "",
                "New-ApplicationAccessPolicy `",
                '  -AppId "<AZURE_CLIENT_ID>" `',
                '  -PolicyScopeGroupId "overwatch@metroshoewarehouse.com" `',
                "  -AccessRight RestrictAccess `",
                '  -Description "MSW Overwatch Graph mail"',
                "",
                "Test-ApplicationAccessPolicy `",
                '  -Identity overwatch@metroshoewarehouse.com `',
                '  -AppId "<AZURE_CLIENT_ID>"',
            ],
            S,
        )
    )
    story.append(
        Paragraph(
            "Mailbox overwatch@metroshoewarehouse.com must exist and be licensed.",
            S["muted"],
        )
    )
    story.append(Spacer(1, 10))

    story.append(Paragraph("<b>Step 5 — Provide credentials to MSW Overwatch team</b>", S["body_b"]))
    story.append(Paragraph("Share via a secure channel (not plain email):", S["body"]))
    story.append(
        _table(
            ["Environment variable", "Description"],
            [
                ["AZURE_TENANT_ID", "Directory (tenant) ID from Entra"],
                ["AZURE_CLIENT_ID", "Application (client) ID from app registration"],
                ["AZURE_CLIENT_SECRET", "Client secret from Step 3"],
            ],
            S,
            [0.32, 0.68],
        )
    )
    story.append(Spacer(1, 10))

    story.append(Paragraph("<b>Step 6 — Production settings (Render metro-api service)</b>", S["body_b"]))
    story.append(
        _code_block(
            [
                "EMAIL_TRANSPORT=graph",
                "EMAIL_FROM=overwatch@metroshoewarehouse.com",
                "EMAIL_FROM_NAME=MSW Overwatch",
                "AZURE_TENANT_ID=<tenant-id>",
                "AZURE_CLIENT_ID=<client-id>",
                "AZURE_CLIENT_SECRET=<secret>",
            ],
            S,
        )
    )
    story.append(
        Paragraph(
            "EMAIL_PASSWORD is not required for Graph. Restart the API service after saving changes.",
            S["body"],
        )
    )

    story.append(PageBreak())

    # --- Page 6: Option B, troubleshooting, comparison ---
    story.extend(_section("FIX OPTION B — RE-ENABLE SMTP (NOT RECOMMENDED)", S))
    story.append(
        Paragraph(
            "Only if Graph cannot be used. May require tenant-wide policy changes and "
            "can break again when Microsoft tightens security.",
            S["body"],
        )
    )
    story.append(
        _code_block(
            [
                "Set-CASMailbox -Identity overwatch@metroshoewarehouse.com `",
                "  -SmtpClientAuthenticationDisabled $false",
            ],
            S,
        )
    )
    story.append(Spacer(1, 14))

    story.extend(_section("SMTP vs GRAPH COMPARISON", S))
    story.append(
        _table(
            ["", "SMTP (current, failing)", "Graph (recommended)"],
            [
                ["Authentication", "Mailbox password", "Entra app + client secret"],
                ["Protocol", "SMTP port 587", "HTTPS Microsoft Graph API"],
                ["Security Defaults", "Often blocked", "Supported"],
                ["Credential rotation", "Mailbox password", "Client secret (scheduled)"],
            ],
            S,
            [0.22, 0.39, 0.39],
        )
    )
    story.append(Spacer(1, 14))

    story.extend(_section("GRAPH TROUBLESHOOTING", S))
    story.append(
        _table(
            ["Error", "Likely cause"],
            [
                ["Token request 401", "Wrong tenant ID, client ID, or secret"],
                ["sendMail 403", "Admin consent missing, or access policy blocks mailbox"],
                ["sendMail 404", "EMAIL_FROM mailbox does not exist"],
                ["Still using SMTP", "Azure vars missing, or EMAIL_TRANSPORT=smtp"],
            ],
            S,
            [0.26, 0.74],
        )
    )

    story.append(PageBreak())

    # --- Page 7: Verification + affected runs + request ---
    story.extend(_section("VERIFICATION AFTER FIX", S))
    story.extend(
        _numbered_steps(
            [
                ("Restart Render API service", []),
                ("Run test email: POST /api/v1/reports/test-email", []),
                ('Confirm API response shows "transport": "graph"', []),
                ("Confirm message arrives from MSW Overwatch &lt;overwatch@...&gt;", []),
                ("Resend missed September 3, 2026 reports (DNK, OBZ, SFF)", []),
            ],
            S,
        )
    )
    story.append(Spacer(1, 10))

    story.extend(_section("AFFECTED RUNS — SEPTEMBER 3, 2026", S))
    story.append(
        _table(
            ["Vendor", "Job name", "App status", "Email sent"],
            [
                ["DNK", "Daily DNK Uploaded Report - 2026-09-03", "Completed", "No"],
                ["OBZ", "Daily OBZ Uploaded Report - 2026-09-03", "Completed", "No"],
                ["SFF", "Daily SFF Uploaded Report - 2026-09-03", "Completed", "No"],
            ],
            S,
            [0.08, 0.54, 0.2, 0.18],
        )
    )
    story.append(Spacer(1, 8))
    story.append(
        Paragraph(
            "Recipients were configured on each job. Failure occurred at Microsoft authentication only.",
            S["body"],
        )
    )
    story.append(Spacer(1, 14))

    story.extend(_section("REQUEST TO ADMINISTRATOR", S))
    story.append(
        KeepTogether(
            [
                Paragraph(
                    "Please implement <b>Option A (Microsoft Graph)</b> and provide "
                    "<b>AZURE_TENANT_ID</b>, <b>AZURE_CLIENT_ID</b>, and "
                    "<b>AZURE_CLIENT_SECRET</b> through a secure channel.",
                    S["body"],
                ),
                Spacer(1, 6),
                Paragraph(
                    "Detailed technical steps: <b>docs/microsoft-graph-email-setup.md</b> "
                    "in the MSW Overwatch repository.",
                    S["body"],
                ),
            ]
        )
    )

    doc.build(story)
    return OUTPUT


if __name__ == "__main__":
    out = build_pdf()
    print(f"Wrote: {out}")
