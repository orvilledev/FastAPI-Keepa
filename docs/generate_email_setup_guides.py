"""
Generate three separate MSW Overwatch outbound-email setup PDFs:

  1. Microsoft Graph API
  2. Postmark
  3. Amazon SES

Run:  python docs/generate_email_setup_guides.py
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Callable

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
DOCS = ROOT / "docs"

PAGE_W, PAGE_H = letter
M_L = 48
M_R = 48
M_B = 44
M_T_LATER = 52
FOOTER_H = 28
C_W = PAGE_W - M_L - M_R

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


@dataclass(frozen=True)
class Guide:
    filename: str
    title: str
    subtitle: str
    header_right: str
    footer: str
    later_header: str
    badge_status: str
    badge_intro: str
    badge_note: str
    story: Callable[[dict], list]


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
        "h2": ps("h2", B, 11, C_SECTION, 15, spaceBefore=14, spaceAfter=6, keepWithNext=True),
        "body": ps("body", R, 10.5, C_BODY, 15, spaceAfter=6),
        "body_b": ps("body_b", B, 10.5, C_BODY, 15, spaceAfter=6, keepWithNext=True),
        "muted": ps("muted", R, 9.5, C_MUTED, 13, spaceAfter=4),
        "bullet": ps("bullet", R, 10.5, C_BODY, 15, leftIndent=14, spaceAfter=4),
        "step_num": ps("step_num", B, 10.5, C_BODY, 15, spaceAfter=4, keepWithNext=True),
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


def _draw_footer(canvas, doc, footer: str) -> None:
    canvas.saveState()
    canvas.setFont("SegoeUI", 8.5)
    canvas.setFillColor(C_FOOTER)
    canvas.drawString(M_L, 22, footer)
    canvas.drawRightString(PAGE_W - M_R, 22, f"Page {doc.page}")
    canvas.restoreState()


def _make_page_drawers(guide: Guide):
    def first(canvas, doc):
        c = canvas
        c.saveState()
        c.setFillColor(colors.white)
        c.roundRect(M_L - 6, M_B - 6, C_W + 12, PAGE_H - M_B - M_T_LATER + 6, 6, fill=1, stroke=0)

        c.setFont("SegoeUI-Bold", 20)
        c.setFillColor(C_TITLE)
        c.drawString(M_L, PAGE_H - 50, guide.title)

        c.setFont("SegoeUI", 10.5)
        c.setFillColor(C_SUBTITLE)
        c.drawString(M_L, PAGE_H - 68, guide.subtitle)

        c.setFont("SegoeUI-Bold", 9.5)
        c.setFillColor(C_META_BOLD)
        c.drawRightString(PAGE_W - M_R, PAGE_H - 46, "MetroShoe Warehouse")
        c.setFont("SegoeUI", 9)
        c.setFillColor(C_SUBTITLE)
        c.drawRightString(PAGE_W - M_R, PAGE_H - 60, guide.header_right)

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
        s_status = ParagraphStyle(
            "bs", fontName="SegoeUI-Bold", fontSize=10.5, textColor=C_STATUS, leading=14
        )
        s_intro = ParagraphStyle(
            "bi", fontName="SegoeUI", fontSize=10, textColor=C_INTRO, leading=14
        )
        badge_frame.addFromList(
            [
                Paragraph(guide.badge_status, s_status),
                Spacer(1, 8),
                Paragraph(guide.badge_intro, s_intro),
                Spacer(1, 6),
                Paragraph(guide.badge_note, s_intro),
            ],
            c,
        )
        _draw_footer(c, doc, guide.footer)
        c.restoreState()

    def later(canvas, doc):
        c = canvas
        c.saveState()
        c.setFillColor(colors.white)
        c.roundRect(M_L - 6, M_B - 6, C_W + 12, PAGE_H - M_B - M_T_LATER + 6, 6, fill=1, stroke=0)
        c.setFillColor(C_ACCENT_BAR)
        c.rect(M_L, PAGE_H - 38, C_W, 2, fill=1, stroke=0)
        c.setFont("SegoeUI-Bold", 9.5)
        c.setFillColor(C_META_BOLD)
        c.drawRightString(PAGE_W - M_R, PAGE_H - 28, guide.later_header)
        _draw_footer(c, doc, guide.footer)
        c.restoreState()

    return first, later


def _divider(width: float = C_W) -> Table:
    t = Table([[""]], colWidths=[width], rowHeights=[1])
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), C_DIVIDER)]))
    return t


def _section(title: str, S: dict) -> list:
    return [Paragraph(title, S["h2"]), _divider(), Spacer(1, 8)]


def _bullets(items: list[str], S: dict) -> list:
    return [Paragraph(f"• {item}", S["bullet"]) for item in items]


def _numbered_steps(steps: list[tuple[str, list[str]]], S: dict) -> list:
    out: list = []
    for i, (title, subs) in enumerate(steps, 1):
        chunk: list = [Paragraph(f"{i}. {title}", S["step_num"])]
        for sub in subs:
            chunk.append(Paragraph(f"• {sub}", S["step_body"]))
        chunk.append(Spacer(1, 4))
        out.append(KeepTogether(chunk))
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


def story_graph(S: dict) -> list:
    story: list = []
    story.extend(_section("AT A GLANCE", S))
    story.append(
        _table(
            ["Field", "Value"],
            [
                ["Best for", "Stay on Microsoft 365 and the company mailbox"],
                ["From address", "overwatch@metroshoewarehouse.com"],
                ["Protocol", "HTTPS Microsoft Graph — not SMTP"],
                ["Who sets it up", "M365 / Entra admin, then Overwatch on Render"],
                ["App status", "Already built in MSW Overwatch"],
                ["Cost", "Included with existing Microsoft 365"],
            ],
            S,
            [0.28, 0.72],
        )
    )
    story.append(Spacer(1, 10))
    story.append(
        Paragraph(
            "This is the recommended Microsoft path. Daily MAP reports keep the familiar "
            "company From address, land in the Overwatch Outlook Sent folder, and the "
            "in-app <b>Email</b> action can still open a real Outlook draft.",
            S["body"],
        )
    )

    story.append(NextPageTemplate("Later"))
    story.append(PageBreak())

    story.extend(_section("WHO DOES WHAT", S))
    story.append(
        _table(
            ["Role", "Does this"],
            [
                ["M365 / Entra admin", "Register the app, grant consent, create the secret, optional mailbox lock-down"],
                ["Overwatch / Render", "Paste the three Azure values and set EMAIL_TRANSPORT=graph"],
                ["Anyone with Overwatch access", "Send a test email and confirm delivery"],
            ],
            S,
            [0.30, 0.70],
        )
    )

    story.extend(_section("PART A — ENTRA APP (IT)", S))
    story.append(Paragraph("<b>1. Create the app registration</b>", S["body_b"]))
    story.extend(
        _numbered_steps(
            [
                (
                    "Open Microsoft Entra admin center",
                    ["Go to entra.microsoft.com and sign in as an admin."],
                ),
                (
                    "Register a new application",
                    [
                        "Applications → App registrations → New registration.",
                        "Name: <b>MSW Overwatch Graph Mail</b>.",
                        "Supported accounts: <b>Accounts in this organizational directory only</b>.",
                        "Click Register.",
                    ],
                ),
                (
                    "Copy these two Overview values",
                    [
                        "<b>Directory (tenant) ID</b> → AZURE_TENANT_ID",
                        "<b>Application (client) ID</b> → AZURE_CLIENT_ID",
                        "Also copy <b>Object ID</b> if you will lock the app to one mailbox.",
                    ],
                ),
            ],
            S,
        )
    )

    story.append(Paragraph("<b>2. Add Graph permissions</b>", S["body_b"]))
    story.extend(
        _numbered_steps(
            [
                (
                    "Add application permissions (not Delegated)",
                    [
                        "API permissions → Add a permission → Microsoft Graph → Application permissions.",
                        "<b>Mail.Send</b> — automatic Daily Run emails.",
                        "<b>Mail.ReadWrite</b> — Open Overwatch draft in Outlook (To/Cc/Bcc + attachment).",
                    ],
                ),
                (
                    "Grant admin consent",
                    [
                        "Click <b>Grant admin consent for [your org]</b>.",
                        "Status must show <b>Granted</b>. A Global Admin must do this if the button is missing.",
                    ],
                ),
            ],
            S,
        )
    )

    story.append(Paragraph("<b>3. Create a client secret</b>", S["body_b"]))
    story.extend(
        _numbered_steps(
            [
                (
                    "Certificates &amp; secrets → New client secret",
                    [
                        "Description: Overwatch Render. Expiry: 12 or 24 months.",
                        "Copy the <b>Value</b> immediately (shown once). This is AZURE_CLIENT_SECRET — not Secret ID.",
                    ],
                ),
            ],
            S,
        )
    )

    story.extend(_section("PART A (CONTINUED) — LOCK TO ONE MAILBOX", S))
    story.append(
        KeepTogether(
            [
                Paragraph(
                    "Recommended. Without this, application Mail.Send can send as any mailbox in the tenant. "
                    "Run in Exchange Online PowerShell.",
                    S["body"],
                ),
                _code_block(
                    [
                        "Connect-ExchangeOnline",
                        "",
                        "New-ServicePrincipal -AppId \"&lt;AZURE_CLIENT_ID&gt;\" `",
                        "  -ServiceId \"&lt;OBJECT_ID_FROM_ENTRA_OVERVIEW&gt;\"",
                        "",
                        "New-ApplicationAccessPolicy `",
                        "  -AppId \"&lt;AZURE_CLIENT_ID&gt;\" `",
                        "  -PolicyScopeGroupId \"overwatch@metroshoewarehouse.com\" `",
                        "  -AccessRight RestrictAccess `",
                        "  -Description \"MSW Overwatch Graph mail — overwatch mailbox only\"",
                        "",
                        "Test-ApplicationAccessPolicy `",
                        "  -Identity overwatch@metroshoewarehouse.com `",
                        "  -AppId \"&lt;AZURE_CLIENT_ID&gt;\"",
                    ],
                    S,
                ),
                Spacer(1, 8),
                Paragraph(
                    "The test command should say the app <b>is allowed</b> for overwatch@. "
                    "The mailbox must exist (licensed user or shared mailbox).",
                    S["body"],
                ),
            ]
        )
    )

    story.extend(_section("PART B — RENDER (OVERWATCH API)", S))
    story.append(
        KeepTogether(
            [
                Paragraph(
                    "On the Keepa API / backend service, set these environment variables, then <b>restart</b>.",
                    S["body"],
                ),
                _code_block(
                    [
                        "EMAIL_TRANSPORT=graph",
                        "EMAIL_FROM=overwatch@metroshoewarehouse.com",
                        "EMAIL_FROM_NAME=MSW Overwatch",
                        "",
                        "AZURE_TENANT_ID=&lt;Directory tenant ID&gt;",
                        "AZURE_CLIENT_ID=&lt;Application client ID&gt;",
                        "AZURE_CLIENT_SECRET=&lt;secret Value from Part A&gt;",
                    ],
                    S,
                ),
                Spacer(1, 8),
                *_bullets(
                    [
                        "EMAIL_PASSWORD is not required for Graph.",
                        "Leave SMTP host as-is; Graph will not use it.",
                        "A superadmin can switch User Management → Outbound Email Transport to Graph API. That lasts until the next restart — Render EMAIL_TRANSPORT=graph is the lasting default.",
                    ],
                    S,
                ),
            ]
        )
    )

    story.extend(_section("PART C — TEST", S))
    story.extend(
        _numbered_steps(
            [
                ("Sign in to MSW Overwatch.", []),
                ("Send a test via POST /api/v1/reports/test-email (or the dashboard test control).", []),
                (
                    "Confirm the response includes \"transport\": \"graph\" and mail arrives from MSW Overwatch &lt;overwatch@metroshoewarehouse.com&gt;.",
                    [],
                ),
                ("Optional: on a completed Daily Run, use Email to open the Overwatch draft (needs Mail.ReadWrite).", []),
            ],
            S,
        )
    )

    story.extend(_section("IF IT FAILS", S))
    story.append(
        _table(
            ["Error", "Likely cause / fix"],
            [
                ["Token 401", "Wrong tenant ID, client ID, or secret (use Secret Value, not Secret ID)"],
                ["sendMail 403", "Admin consent not granted, or access policy blocks this mailbox"],
                ["sendMail 404", "EMAIL_FROM is not a real mailbox"],
                ["Still SMTP / 535 5.7.139", "Azure vars missing, or transport still smtp — restart after env change"],
                ["Drafts fail, send works", "Mail.ReadWrite missing or consent not granted"],
            ],
            S,
            [0.32, 0.68],
        )
    )

    story.extend(_section("ADMIN CHECKLIST", S))
    story.extend(
        _bullets(
            [
                "Register app MSW Overwatch Graph Mail",
                "Application permissions Mail.Send + Mail.ReadWrite + admin consent",
                "Create client secret and copy the Value",
                "Send Tenant ID, Client ID, and Secret to the Overwatch team",
                "Recommended: Application Access Policy for overwatch@ only",
            ],
            S,
        )
    )
    story.append(Spacer(1, 8))
    story.append(
        Paragraph(
            "Full technical notes: docs/microsoft-graph-email-setup.md in the MSW Overwatch repository.",
            S["muted"],
        )
    )
    return story


def story_postmark(S: dict) -> list:
    story: list = []
    story.extend(_section("AT A GLANCE", S))
    story.append(
        _table(
            ["Field", "Value"],
            [
                ["Best for", "Leave Microsoft sending; keep a branded From address"],
                ["From address", "send@mswoverwatch.com"],
                ["Protocol", "HTTPS Postmark API — not SMTP, not Graph"],
                ["Website domain", "mswoverwatch.com (already used for the app)"],
                ["App status", "Account + DNS first; a small Overwatch code change is still required"],
                ["Cost", "Free: 100 emails/month. Production: $15/month (10,000 emails)"],
            ],
            S,
            [0.28, 0.72],
        )
    )
    story.append(Spacer(1, 10))
    story.append(
        Paragraph(
            "Registering send@ does not send mail by itself. Postmark is the provider behind that address. "
            "Keep <b>Reply-To</b> as overwatch@metroshoewarehouse.com so vendor replies still reach the company mailbox.",
            S["body"],
        )
    )

    story.append(NextPageTemplate("Later"))
    story.append(PageBreak())

    story.extend(_section("BEFORE YOU START", S))
    story.extend(
        _bullets(
            [
                "You must control DNS for <b>mswoverwatch.com</b> (Cloudflare, GoDaddy, Namecheap, etc.).",
                "Do <b>not</b> create this address as a Microsoft 365 mailbox — that puts you back on SMTP or Graph.",
                "The website A/CNAME records for www must stay in place.",
                "The free Postmark plan is only for testing. Live Daily Runs need the paid plan.",
            ],
            S,
        )
    )

    story.extend(_section("PART A — POSTMARK ACCOUNT AND DOMAIN", S))
    story.append(Paragraph("<b>1. Create the account</b>", S["body_b"]))
    story.extend(
        _numbered_steps(
            [
                (
                    "Sign up at postmarkapp.com",
                    [
                        "Create a Server named <b>MSW Overwatch production</b>.",
                        "Open API Tokens and copy the <b>Server API token</b>. Store it like a password.",
                    ],
                ),
            ],
            S,
        )
    )
    story.append(Paragraph("<b>2. Add the sending domain</b>", S["body_b"]))
    story.extend(
        _numbered_steps(
            [
                (
                    "Sender Signatures → Add Domain (or Add Sender Signature)",
                    [
                        "Domain: <b>mswoverwatch.com</b>.",
                        "Sender: <b>send@mswoverwatch.com</b>.",
                        "You do not need an Outlook mailbox for this address.",
                    ],
                ),
            ],
            S,
        )
    )
    story.append(Paragraph("<b>3. Add DNS records</b>", S["body_b"]))
    story.append(
        Paragraph(
            "Postmark shows the exact names and values. Add them at your DNS host. Do not remove website records.",
            S["body"],
        )
    )
    story.append(
        _table(
            ["Type", "Purpose"],
            [
                ["CNAME (DKIM)", "Proves Postmark may send for the domain — add every DKIM CNAME Postmark shows"],
                [
                    "TXT (SPF)",
                    "v=spf1 include:spf.mtasv.net ~all — if SPF already exists, edit it; do not create a second SPF",
                ],
                [
                    "TXT (DMARC, recommended)",
                    "v=DMARC1; p=none; rua=mailto:overwatch@metroshoewarehouse.com",
                ],
                ["CNAME (Return-Path)", "Bounce subdomain, if Postmark shows one"],
            ],
            S,
            [0.32, 0.68],
        )
    )
    story.append(Spacer(1, 8))
    story.append(
        Paragraph(
            "Skip MX unless you want send@ to <b>receive</b> mail. Send-only does not need MX. "
            "On Cloudflare, DKIM CNAMEs must be <b>DNS only</b> (grey cloud), not proxied.",
            S["body"],
        )
    )
    story.append(Paragraph("<b>4. Verify</b>", S["body_b"]))
    story.extend(
        _numbered_steps(
            [
                (
                    "Click Verify in Postmark",
                    [
                        "Wait until DKIM/SPF show Verified (minutes to a few hours).",
                        "Send Postmark’s test message to your own inbox and confirm it is not in spam.",
                    ],
                ),
            ],
            S,
        )
    )

    story.append(PageBreak())
    story.extend(_section("PART B — POINT OVERWATCH AT POSTMARK", S))
    story.append(
        Paragraph(
            "Overwatch today only knows SMTP and Graph. After DNS is verified, add a Postmark transport in the API. "
            "Until that code exists, these env vars will not send.",
            S["body"],
        )
    )
    story.append(
        Paragraph("Set on the Render API service once the code is in place:", S["body"])
    )
    story.append(
        _code_block(
            [
                "EMAIL_TRANSPORT=postmark",
                "EMAIL_FROM=send@mswoverwatch.com",
                "EMAIL_FROM_NAME=MSW Overwatch",
                "POSTMARK_SERVER_TOKEN=&lt;Server API token&gt;",
            ],
            S,
        )
    )
    story.append(Spacer(1, 8))
    story.extend(
        _bullets(
            [
                "From: MSW Overwatch &lt;send@mswoverwatch.com&gt;",
                "Reply-To: overwatch@metroshoewarehouse.com (so replies are not lost)",
                "Azure Graph vars can stay if you still want Outlook drafts later.",
            ],
            S,
        )
    )

    story.extend(_section("PART C — TEST", S))
    story.extend(
        _numbered_steps(
            [
                ("Restart the API after env changes.", []),
                ("Call POST /api/v1/reports/test-email.", []),
                (
                    "Confirm",
                    [
                        "Message arrives.",
                        "From is send@mswoverwatch.com.",
                        "Reply goes to overwatch@metroshoewarehouse.com.",
                    ],
                ),
                ("Run one real Daily Run (or resend) for a vendor inbox you control.", []),
            ],
            S,
        )
    )

    story.extend(_section("TELL VENDORS", S))
    story.append(
        Paragraph(
            "Daily MAP reports will come from <b>send@mswoverwatch.com</b>. Please allowlist that address. "
            "Replies still go to <b>overwatch@metroshoewarehouse.com</b>.",
            S["body"],
        )
    )

    story.extend(_section("WHAT THIS WILL NOT DO", S))
    story.extend(
        _bullets(
            [
                "Mail will not appear in the Overwatch Outlook Sent folder.",
                "Open Overwatch draft still needs Graph, or you attach the file by hand.",
                "Creating send@ inside Microsoft 365 instead of Postmark puts you back on SMTP/Graph.",
            ],
            S,
        )
    )

    story.append(PageBreak())
    story.extend(_section("COST", S))
    story.append(
        _table(
            ["Plan", "Price", "Volume"],
            [
                ["Free (Developer)", "$0", "100 emails/month, then sending stops. Fine for DNS tests."],
                ["Basic", "$15 / month", "10,000 emails — needed for live Daily Runs"],
            ],
            S,
            [0.28, 0.22, 0.50],
        )
    )
    story.append(Spacer(1, 8))
    story.append(
        Paragraph(
            "One MAP email per vendor per day will exceed 100/month quickly. Use free for setup, paid for production. "
            "Pricing: postmarkapp.com/pricing",
            S["muted"],
        )
    )

    story.extend(_section("CHECKLIST", S))
    story.extend(
        _bullets(
            [
                "Postmark account + Server API token",
                "Add domain mswoverwatch.com and sender send@mswoverwatch.com",
                "Add DKIM + SPF (and DMARC); do not break the website",
                "Verify in Postmark and send a test",
                "Add Postmark transport in Overwatch + Render env",
                "Test-email, then one real vendor send",
            ],
            S,
        )
    )
    return story


def story_ses(S: dict) -> list:
    story: list = []
    story.extend(_section("AT A GLANCE", S))
    story.append(
        _table(
            ["Field", "Value"],
            [
                ["Best for", "Lowest cost at volume; leave Microsoft sending"],
                ["From address", "send@mswoverwatch.com"],
                ["Protocol", "HTTPS Amazon SES API — not SMTP, not Graph"],
                ["AWS region", "Stay in one region, e.g. US East (N. Virginia) us-east-1"],
                ["App status", "Account + DNS first; a small Overwatch code change is still required"],
                ["Cost", "Pay per email (fractions of a cent). No $15 monthly floor."],
            ],
            S,
            [0.28, 0.72],
        )
    )
    story.append(Spacer(1, 10))
    story.append(
        Paragraph(
            "Every new SES account starts in a <b>sandbox</b>: you can only mail verified addresses until AWS "
            "approves production. Vendor Daily Runs will fail until that request is approved. "
            "Keep <b>Reply-To</b> as overwatch@metroshoewarehouse.com.",
            S["body"],
        )
    )

    story.append(NextPageTemplate("Later"))
    story.append(PageBreak())

    story.extend(_section("PART A — AWS ACCOUNT AND DOMAIN", S))
    story.append(Paragraph("<b>1. Open SES in the right region</b>", S["body_b"]))
    story.extend(
        _numbered_steps(
            [
                (
                    "Sign in at console.aws.amazon.com",
                    [
                        "Region menu (top right) → <b>US East (N. Virginia) us-east-1</b>.",
                        "Search Amazon SES and open it. SES settings are per region — do not switch later.",
                    ],
                ),
            ],
            S,
        )
    )
    story.append(Paragraph("<b>2. Create the domain identity</b>", S["body_b"]))
    story.extend(
        _numbered_steps(
            [
                (
                    "Identities → Create identity",
                    [
                        "Identity type: <b>Domain</b>.",
                        "Domain: <b>mswoverwatch.com</b>.",
                        "Leave Easy DKIM on, 2048-bit.",
                        "Create identity, then copy the three CNAME records SES shows.",
                    ],
                ),
            ],
            S,
        )
    )
    story.append(Paragraph("<b>3. Add DNS records</b>", S["body_b"]))
    story.append(
        Paragraph(
            "Add the three DKIM CNAMEs at the DNS host for mswoverwatch.com. Do not remove website A/CNAME records.",
            S["body"],
        )
    )
    story.append(
        _table(
            ["Type", "Name / value"],
            [
                ["CNAME × 3", "Exact DKIM names and values from the SES console"],
                [
                    "TXT (SPF)",
                    "v=spf1 include:amazonses.com ~all — edit an existing SPF; do not add a second SPF",
                ],
                [
                    "TXT (DMARC, recommended)",
                    "_dmarc → v=DMARC1; p=none; rua=mailto:overwatch@metroshoewarehouse.com",
                ],
            ],
            S,
            [0.28, 0.72],
        )
    )
    story.append(Spacer(1, 8))
    story.append(
        Paragraph(
            "Wait until the SES identity status is <b>Verified</b>. On Cloudflare, DKIM CNAMEs must be "
            "<b>DNS only</b> (grey cloud), not proxied. Custom MAIL FROM (e.g. bounce.mswoverwatch.com) is optional.",
            S["body"],
        )
    )

    story.extend(_section("PART B — LEAVE THE SANDBOX", S))
    story.append(
        Paragraph(
            "In the sandbox you can only send to verified addresses, max 200/day. This is required for vendor mail.",
            S["body"],
        )
    )
    story.extend(
        _numbered_steps(
            [
                (
                    "SES → Account dashboard → Request production access",
                    [
                        "Mail type: <b>Transactional</b>.",
                        "Website: https://www.mswoverwatch.com",
                    ],
                ),
            ],
            S,
        )
    )
    story.append(
        KeepTogether(
            [
                Paragraph("<b>Paste this use-case text:</b>", S["body_b"]),
                _code_block(
                    [
                        "We send transactional MAP pricing exception reports after scheduled",
                        "jobs in MSW Overwatch (https://www.mswoverwatch.com). Recipients",
                        "are business vendor contacts who opted in through our app. Volume",
                        "is roughly one email per vendor per day, with an Excel attachment.",
                        "We will use SES bounce/complaint notifications and will not send",
                        "marketing or purchased lists.",
                    ],
                    S,
                ),
                Spacer(1, 8),
                Paragraph(
                    "AWS often replies within about a day. While waiting, verify your own email as an identity "
                    "so you can test in the sandbox.",
                    S["body"],
                ),
            ]
        )
    )

    story.extend(_section("PART C — CREDENTIALS FOR OVERWATCH", S))
    story.append(
        Paragraph(
            "Prefer the SES API (HTTPS), not SES SMTP.",
            S["body"],
        )
    )
    story.extend(
        _numbered_steps(
            [
                (
                    "IAM → Users → Create user (e.g. msw-overwatch-ses)",
                    ["Attach an inline policy with ses:SendEmail and ses:SendRawEmail."],
                ),
                (
                    "Create an access key",
                    [
                        "Use case: Application running outside AWS.",
                        "Save AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and region us-east-1.",
                    ],
                ),
            ],
            S,
        )
    )
    story.append(
        _code_block(
            [
                "{",
                "  \"Version\": \"2012-10-17\",",
                "  \"Statement\": [{",
                "    \"Effect\": \"Allow\",",
                "    \"Action\": [\"ses:SendEmail\", \"ses:SendRawEmail\"],",
                "    \"Resource\": \"*\"",
                "  }]",
                "}",
            ],
            S,
        )
    )

    story.extend(_section("PART D — BOUNCES (RECOMMENDED)", S))
    story.extend(
        _numbered_steps(
            [
                ("SNS → create topic ses-bounces.", []),
                (
                    "SES → Identities → mswoverwatch.com → Notifications",
                    ["Send bounce and complaint to that SNS topic. Subscribe your own email so you see failures."],
                ),
            ],
            S,
        )
    )

    story.extend(_section("PART E — POINT OVERWATCH AT SES", S))
    story.append(
        KeepTogether(
            [
                Paragraph(
                    "Overwatch today only knows SMTP and Graph. After SES is verified, add an SES transport in the API.",
                    S["body"],
                ),
                _code_block(
                    [
                        "EMAIL_TRANSPORT=ses",
                        "EMAIL_FROM=send@mswoverwatch.com",
                        "EMAIL_FROM_NAME=MSW Overwatch",
                        "AWS_REGION=us-east-1",
                        "AWS_ACCESS_KEY_ID=&lt;iam access key&gt;",
                        "AWS_SECRET_ACCESS_KEY=&lt;secret&gt;",
                    ],
                    S,
                ),
                Spacer(1, 8),
                *_bullets(
                    [
                        "From: MSW Overwatch &lt;send@mswoverwatch.com&gt;",
                        "Reply-To: overwatch@metroshoewarehouse.com",
                    ],
                    S,
                ),
            ]
        )
    )

    story.extend(_section("PART F — TEST", S))
    story.append(
        KeepTogether(
            [
                _table(
                    ["When", "What to do"],
                    [
                        [
                            "Sandbox",
                            "Send only to a verified personal address. Confirm From is send@mswoverwatch.com.",
                        ],
                        [
                            "After production access",
                            "POST /api/v1/reports/test-email to a real inbox you control, then one Daily Run.",
                        ],
                    ],
                    S,
                    [0.30, 0.70],
                ),
                Spacer(1, 8),
                Paragraph(
                    "Tell vendors: reports will come from <b>send@mswoverwatch.com</b>; replies go to "
                    "<b>overwatch@metroshoewarehouse.com</b>.",
                    S["body"],
                ),
            ]
        )
    )

    story.extend(_section("WHAT THIS WILL NOT DO", S))
    story.extend(
        _bullets(
            [
                "Mail will not appear in the Overwatch Outlook Sent folder.",
                "Open Overwatch draft still needs Graph if you keep that feature.",
                "Creating send@ as a Microsoft 365 mailbox puts you back on SMTP/Graph.",
            ],
            S,
        )
    )

    story.extend(_section("GOTCHAS", S))
    story.append(
        _table(
            ["Issue", "What it means"],
            [
                ["Sandbox", "Tests work; vendor mail fails until production access is approved"],
                ["Wrong region", "Identities and credentials are per region — stay on us-east-1"],
                ["Cloudflare orange cloud", "DKIM CNAMEs must be DNS only or verification never completes"],
                ["Second SPF record", "Breaks authentication — edit the existing TXT instead"],
            ],
            S,
            [0.28, 0.72],
        )
    )

    story.extend(_section("CHECKLIST", S))
    story.extend(
        _bullets(
            [
                "AWS account, region us-east-1",
                "SES domain identity mswoverwatch.com + Easy DKIM",
                "Three DKIM CNAMEs + SPF (do not break the website)",
                "Identity Verified",
                "Request production access",
                "IAM user with ses:SendEmail + ses:SendRawEmail",
                "Bounce/complaint SNS",
                "Add SES transport in Overwatch + Render env",
                "Test, then production send",
            ],
            S,
        )
    )
    return story


GUIDES = [
    Guide(
        filename="MSW Overwatch - Graph API Email Setup _ MSW Overwatch.pdf",
        title="Graph API Email Setup",
        subtitle="Setup guide for Microsoft 365 / Entra administrators",
        header_right="September 2026",
        footer="MSW Overwatch — Graph API Email Setup · MetroShoe Warehouse",
        later_header="MetroShoe Warehouse · Graph API Email Setup",
        badge_status="OPTION: MICROSOFT GRAPH (NO SMTP)",
        badge_intro=(
            "Use this when Security Defaults blocks SMTP password login for "
            "<b>overwatch@metroshoewarehouse.com</b>. Overwatch already supports Graph."
        ),
        badge_note=(
            "<b>Result:</b> Daily MAP reports send as the company mailbox over HTTPS. "
            "No mailbox password. Outlook Sent folder and drafts still work."
        ),
        story=story_graph,
    ),
    Guide(
        filename="MSW Overwatch - Postmark Email Setup _ MSW Overwatch.pdf",
        title="Postmark Email Setup",
        subtitle="Setup guide for send@mswoverwatch.com via Postmark",
        header_right="September 2026",
        footer="MSW Overwatch — Postmark Email Setup · MetroShoe Warehouse",
        later_header="MetroShoe Warehouse · Postmark Email Setup",
        badge_status="OPTION: POSTMARK (NOT SMTP, NOT GRAPH)",
        badge_intro=(
            "Send as <b>send@mswoverwatch.com</b> through Postmark’s HTTPS API. "
            "Microsoft 365 is not used to send."
        ),
        badge_note=(
            "<b>Note:</b> Free plan is 100 emails/month (testing only). "
            "Live Daily Runs need the $15/month plan. A small Overwatch code change is still required."
        ),
        story=story_postmark,
    ),
    Guide(
        filename="MSW Overwatch - Amazon SES Email Setup _ MSW Overwatch.pdf",
        title="Amazon SES Email Setup",
        subtitle="Setup guide for send@mswoverwatch.com via Amazon SES",
        header_right="September 2026",
        footer="MSW Overwatch — Amazon SES Email Setup · MetroShoe Warehouse",
        later_header="MetroShoe Warehouse · Amazon SES Email Setup",
        badge_status="OPTION: AMAZON SES (NOT SMTP, NOT GRAPH)",
        badge_intro=(
            "Send as <b>send@mswoverwatch.com</b> through the Amazon SES HTTPS API. "
            "Lowest cost at volume; more AWS setup than Postmark."
        ),
        badge_note=(
            "<b>Critical:</b> Leave the SES sandbox (request production access) before sending to vendors. "
            "A small Overwatch code change is still required."
        ),
        story=story_ses,
    ),
]


def build_pdf(guide: Guide, S: dict) -> Path:
    output = DOCS / guide.filename
    first_page, later_page = _make_page_drawers(guide)
    later_frame_h = PAGE_H - M_T_LATER - M_B - FOOTER_H

    doc = BaseDocTemplate(
        str(output),
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
                onPage=first_page,
            ),
            PageTemplate(
                id="Later",
                frames=[Frame(M_L, M_B + FOOTER_H, C_W, later_frame_h, id="later")],
                onPage=later_page,
            ),
        ]
    )
    doc.build(guide.story(S))
    return output


def main() -> None:
    _reg_fonts()
    S = _make_styles()
    for guide in GUIDES:
        path = build_pdf(guide, S)
        print(f"Wrote {path}")


if __name__ == "__main__":
    main()
