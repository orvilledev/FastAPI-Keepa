"""
Generate MSW Overwatch PDF: SMTP investigation findings.

Emphasizes org-level SMTP AUTH / Security Defaults as the primary blocker,
even when the Overwatch mailbox has Authenticated SMTP enabled.

Run:  python docs/generate_smtp_investigation_brief.py
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
OUTPUT = ROOT / "docs" / "MSW Overwatch - SMTP Investigation Findings _ MSW Overwatch.pdf"

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
C_OK = colors.HexColor("#166534")
C_FAIL = colors.HexColor("#991b1b")


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
        "td_ok": ps("td_ok", B, 9.5, C_OK, 13),
        "td_fail": ps("td_fail", B, 9.5, C_FAIL, 13),
    }


def _draw_footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("SegoeUI", 8.5)
    canvas.setFillColor(C_FOOTER)
    canvas.drawString(M_L, 22, "MSW Overwatch — SMTP Investigation Findings · MetroShoe Warehouse")
    canvas.drawRightString(PAGE_W - M_R, 22, f"Page {doc.page}")
    canvas.restoreState()


def _draw_first_page(canvas, doc):
    c = canvas
    c.saveState()

    c.setFillColor(colors.white)
    c.roundRect(M_L - 6, M_B - 6, C_W + 12, PAGE_H - M_B - M_T_LATER + 6, 6, fill=1, stroke=0)

    c.setFont("SegoeUI-Bold", 21)
    c.setFillColor(C_TITLE)
    c.drawString(M_L, PAGE_H - 50, "SMTP Investigation Findings")

    c.setFont("SegoeUI", 10.5)
    c.setFillColor(C_SUBTITLE)
    c.drawString(M_L, PAGE_H - 68, "Why Microsoft SMTP fails for MSW Overwatch")

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
    s_status = ParagraphStyle("bs", fontName="SegoeUI-Bold", fontSize=10.5, textColor=C_STATUS, leading=14)
    s_intro = ParagraphStyle("bi", fontName="SegoeUI", fontSize=10, textColor=C_INTRO, leading=14)
    badge_frame.addFromList(
        [
            Paragraph("ROOT CAUSE: ORGANIZATION-LEVEL SMTP AUTH IS BLOCKED", s_status),
            Spacer(1, 8),
            Paragraph(
                "The Overwatch mailbox has <b>Authenticated SMTP enabled</b> at the user level "
                "(Manage email apps). That setting is <b>not enough</b>. Microsoft still rejects "
                "SMTP login because <b>organization-level SMTP AUTH / Security Defaults</b> "
                "blocks basic authentication for the tenant.",
                s_intro,
            ),
            Spacer(1, 6),
            Paragraph(
                "<b>Primary finding:</b> Org-level SMTP off (or Security Defaults) is the main reason "
                "emails fail — not recipients, report generation, or the mailbox app toggle.",
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
    c.drawRightString(PAGE_W - M_R, PAGE_H - 28, "MetroShoe Warehouse · SMTP Investigation")
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


def _table(headers: list[str], rows: list[list], S: dict, col_fracs: list[float]) -> Table:
    widths = [C_W * f for f in col_fracs]
    data = [[Paragraph(h, S["th"]) for h in headers]]
    for row in rows:
        cells = []
        for cell in row:
            if isinstance(cell, tuple):
                text, style_key = cell
                cells.append(Paragraph(text, S[style_key]))
            else:
                cells.append(Paragraph(cell, S["td"]))
        data.append(cells)
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

    story.extend(_section("AT A GLANCE", S))
    story.append(
        _table(
            ["Field", "Value"],
            [
                ["Application", "MSW Overwatch (FastAPI backend on Render)"],
                ["Sender mailbox", "overwatch@metroshoewarehouse.com"],
                ["SMTP endpoint", "smtp.office365.com:587 (STARTTLS + login)"],
                ["Mailbox Authenticated SMTP", ("Enabled (Manage email apps)", "td_ok")],
                ["Org-level SMTP AUTH / Security Defaults", ("Blocked / rejecting login", "td_fail")],
                ["Observed error", "535 5.7.139 — Authentication unsuccessful"],
                ["Main conclusion", "Org-level SMTP block is the primary cause"],
            ],
            S,
            [0.36, 0.64],
        )
    )

    story.append(Spacer(1, 6))
    story.append(
        Paragraph(
            "<b>Bottom line:</b> Turning on Authenticated SMTP for the Overwatch user does not "
            "override a tenant policy that disables SMTP AUTH organization-wide. The mailbox "
            "checkbox can be ON and SMTP still fails.",
            S["body_b"],
        )
    )

    story.append(NextPageTemplate("Later"))
    story.append(PageBreak())

    # --- Page 2 ---
    story.extend(_section("1. WHAT WE CHECKED", S))
    story.append(
        Paragraph(
            "Investigation covered both the application path and Microsoft 365 mailbox settings.",
            S["body"],
        )
    )
    story.extend(
        _bullets(
            [
                "<b>Application:</b> Daily / report jobs complete; CSV/Excel reports generate; "
                "recipients are configured. Failure happens at SMTP login, before any message is accepted.",
                "<b>Mailbox setting (screenshot):</b> Microsoft 365 → Manage email apps for "
                "<b>Overwatch MetroShoe Warehouse</b> shows <b>Authenticated SMTP checked (ON)</b>, "
                "along with Outlook, IMAP, POP, etc.",
                "<b>Live SMTP test:</b> Login to <b>smtp.office365.com:587</b> as "
                "<b>overwatch@metroshoewarehouse.com</b> is rejected by Microsoft.",
            ],
            S,
        )
    )

    story.extend(_section("2. WHY THE MAILBOX TOGGLE IS NOT THE FIX", S))
    story.append(
        Paragraph(
            "Microsoft evaluates SMTP AUTH in layers. The user “Authenticated SMTP” toggle is only "
            "one layer. A higher (organization) policy can still deny the connection.",
            S["body"],
        )
    )
    story.append(
        _table(
            ["Layer", "What we observed", "Effect"],
            [
                [
                    "1. Mailbox — Authenticated SMTP",
                    "Enabled in Manage email apps",
                    ("Necessary, but not sufficient", "td_ok"),
                ],
                [
                    "2. Organization — SMTP AUTH / Security Defaults",
                    "Tenant still blocks basic SMTP login",
                    ("Primary blocker — MAIN REASON", "td_fail"),
                ],
                [
                    "3. Credentials",
                    "Password present in app config",
                    "Irrelevant until org allows SMTP AUTH",
                ],
            ],
            S,
            [0.32, 0.38, 0.30],
        )
    )
    story.append(Spacer(1, 8))
    story.append(
        Paragraph(
            "So the screenshot proving Authenticated SMTP is ON for Overwatch <b>does not contradict</b> "
            "the finding that SMTP is failing. It confirms the mailbox is not the missing piece — "
            "<b>org-level SMTP being off (or Security Defaults enforcing the same block) is</b>.",
            S["body_b"],
        )
    )

    story.extend(_section("3. ERROR EVIDENCE", S))
    story.append(
        Paragraph(
            "Microsoft returns an SMTP authentication failure consistent with tenant policy, not a "
            "wrong-recipient or application composition bug:",
            S["body"],
        )
    )
    story.append(
        KeepTogether(
            [
                _code_block(
                    [
                        "535 5.7.139 Authentication unsuccessful, user is locked by your",
                        "organization's security defaults policy. Contact your administrator.",
                    ],
                    S,
                )
            ]
        )
    )
    story.append(Spacer(1, 6))
    story.append(
        _table(
            ["Code", "Meaning"],
            [
                ["535", "SMTP authentication failed"],
                [
                    "5.7.139",
                    "Blocked by Security Defaults / org policy (SmtpClientAuthentication disabled path)",
                ],
                [
                    "Result",
                    "No email is accepted or delivered — login never succeeds",
                ],
            ],
            S,
            [0.18, 0.82],
        )
    )

    story.append(PageBreak())

    # --- Page 3 ---
    story.extend(_section("4. MAIN CONCLUSION (EMPHASIZED)", S))
    story.append(
        Paragraph(
            "The main reason SMTP fails for MSW Overwatch is that <b>organization-level SMTP AUTH "
            "is turned off</b> (commonly via Microsoft 365 Security Defaults or Exchange Online "
            "tenant SMTP AUTH settings).",
            S["body_b"],
        )
    )
    story.extend(
        _bullets(
            [
                "Mailbox Authenticated SMTP = <b>ON</b> → does not unlock SMTP by itself.",
                "Org / Security Defaults blocking SMTP AUTH → <b>this is the blocker</b>.",
                "App recipients, report files, and From address are <b>not</b> the cause of this failure.",
            ],
            S,
        )
    )

    story.extend(_section("5. HOW IT CAN VERIFY (ADMIN)", S))
    story.append(Paragraph("<b>5.1 Security Defaults</b>", S["body_b"]))
    story.extend(
        _bullets(
            [
                "Entra admin center → Identity → Overview → Properties → Manage Security defaults",
                "If Enabled, legacy SMTP username/password login is typically blocked",
            ],
            S,
        )
    )
    story.append(Paragraph("<b>5.2 Organization SMTP AUTH</b>", S["body_b"]))
    story.append(
        KeepTogether(
            [
                _code_block(
                    [
                        "Connect-ExchangeOnline",
                        "Get-TransportConfig | Format-List SmtpClientAuthenticationDisabled",
                        "# True  = org blocks SMTP AUTH (matches our main finding)",
                        "# False = org allows SMTP AUTH (then check per-mailbox + CA policies)",
                    ],
                    S,
                )
            ]
        )
    )
    story.append(Spacer(1, 6))
    story.append(Paragraph("<b>5.3 Mailbox SMTP AUTH (already checked in UI)</b>", S["body_b"]))
    story.append(
        KeepTogether(
            [
                _code_block(
                    [
                        "Get-CASMailbox -Identity overwatch@metroshoewarehouse.com |",
                        "  Format-List SmtpClientAuthenticationDisabled",
                        "# False / UI “Authenticated SMTP” checked = mailbox allows SMTP",
                        "# (still fails if org layer blocks)",
                    ],
                    S,
                )
            ]
        )
    )

    story.extend(_section("6. RECOMMENDED PATHS", S))
    story.append(
        _table(
            ["Option", "Description", "Notes"],
            [
                [
                    "A — Microsoft Graph (recommended)",
                    "App registration + Mail.Send; HTTPS send as overwatch@…",
                    "No SMTP AUTH; already supported in Overwatch",
                ],
                [
                    "B — Re-enable org SMTP AUTH",
                    "IT disables Security Defaults / enables tenant SMTP AUTH",
                    "May conflict with org security posture",
                ],
                [
                    "C — Third-party HTTPS mail",
                    "Postmark / Amazon SES / similar",
                    "Leaves Microsoft SMTP entirely",
                ],
            ],
            S,
            [0.28, 0.40, 0.32],
        )
    )

    story.append(Spacer(1, 12))
    story.extend(_section("7. SUMMARY FOR STAKEHOLDERS", S))
    story.append(
        Paragraph(
            "We confirmed Authenticated SMTP is enabled on the Overwatch mailbox. Despite that, "
            "SMTP login to Office 365 still fails with <b>535 5.7.139</b>. "
            "<b>The decisive cause is organization-level SMTP AUTH being off "
            "(Security Defaults / tenant policy)</b>, which overrides the mailbox setting. "
            "Until the org allows SMTP AUTH or Overwatch uses Graph (or another non-SMTP path), "
            "automated report emails cannot send via Microsoft SMTP.",
            S["body"],
        )
    )
    story.append(Spacer(1, 8))
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
