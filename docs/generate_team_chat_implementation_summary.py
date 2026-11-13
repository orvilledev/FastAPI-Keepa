"""
Generate MSW Overwatch-style implementation summary PDF for Team Chat.
Matches FBA Order Checker / Label Center / DNK Label Station format.

Run:  python docs/generate_team_chat_implementation_summary.py
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
OUTPUT = ROOT / "docs" / "Team Chat - Implementation Summary _ MSW Overwatch.pdf"

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
            c.drawString(M_L, PAGE_H - 54, "Team Chat")

            c.setFont("SegoeUI", 11)
            c.setFillColor(C_SUBTITLE)
            c.drawString(M_L, PAGE_H - 73, "Implementation summary \u2014 MSW Overwatch")

            c.setFont("SegoeUI-Bold", 10)
            c.setFillColor(C_META_BOLD)
            c.drawRightString(PAGE_W - M_R, PAGE_H - 48, "MetroShoe Warehouse")

            c.setFont("SegoeUI", 9)
            c.setFillColor(C_SUBTITLE)
            c.drawRightString(PAGE_W - M_R, PAGE_H - 62, "November 2026 \u00b7 App v4.0.2")

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
                    "<b>Team Chat</b> is a gated in-app messenger under the sidebar "
                    "label <b>Team Chat</b> (route <b>/chat</b>). Allowlisted users and "
                    "superadmins can start <b>1:1</b> or <b>group</b> threads, send text "
                    "and files, see unread badges and read receipts, and get live updates "
                    "through Supabase Realtime. This is staff messaging\u2014not the AI "
                    "<b>CLI Chat</b> assistant.",
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
            "MSW Overwatch \u2014 Team Chat \u00b7 FastAPI-Keepa-Dashboard",
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


def _flow_table(S: dict) -> Table:
    return _simple_table(
        S,
        ["Step", "What happens"],
        [
            [
                "1. Open chat",
                "Sidebar <b>Team Chat</b> (allowlisted emails + superadmin only). "
                "Orange badge shows unread up to <b>99+</b>",
            ],
            [
                "2. Start a thread",
                "<b>New message</b> opens the directory. Pick one person for a 1:1, "
                "or several for a group (optional title)",
            ],
            [
                "3. Send",
                "Type up to <b>4,000</b> characters, attach up to <b>10</b> files "
                "(<b>2 GB</b> each), or both. Enter sends; Shift+Enter is a new line",
            ],
            [
                "4. Stay in sync",
                "New messages, unsends, and read receipts arrive live. Typing shows "
                "while someone is composing. Online status uses app presence heartbeats",
            ],
            [
                "5. Clean up",
                "Sender can <b>Unsend</b> their own message. Group members can "
                "<b>Leave</b>. Direct chats cannot be left; each pair keeps one thread",
            ],
        ],
        col_fracs=[0.16, 0.84],
    )


def _features_table(S: dict) -> Table:
    return _simple_table(
        S,
        ["Feature", "Behavior"],
        [
            [
                "1:1 chats",
                "One thread per pair via a unique <b>direct_key</b>. Creating again "
                "reopens the same conversation",
            ],
            [
                "Groups",
                "Two or more other people, optional title (80 characters). "
                "Up to <b>50</b> members total. Leave removes membership",
            ],
            [
                "Unread &amp; Seen",
                "Per-conversation and sidebar totals. Opening a thread marks it read. "
                "Own last message shows Seen / Seen by \u2026 when others catch up",
            ],
            [
                "Attachments",
                "One file per message row. Images and short videos preview inline "
                "when small enough; larger files show a download card",
            ],
            [
                "Unsend",
                "Clears the body, sets deleted, removes the file from storage, "
                "and updates the conversation preview",
            ],
        ],
        col_fracs=[0.22, 0.78],
    )


def _limits_table(S: dict) -> Table:
    return _simple_table(
        S,
        ["Limit", "Value"],
        [
            ["Message body", "4,000 characters"],
            ["Group title", "80 characters"],
            ["Group size", "50 members (including you)"],
            ["File size", "2 GB per file (private team-chat-files bucket)"],
            ["Files per send", "10 at a time in the composer"],
            ["Message page size", "50 by default (API allows 1\u2013100)"],
            ["Signed preview / download", "1 hour preview \u00b7 5 minutes download"],
        ],
        col_fracs=[0.32, 0.68],
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
                "Full Team Chat access; appears in the directory for others who can chat",
            ],
            [
                "All other users",
                "No sidebar link; route and API return blocked / redirect",
            ],
        ],
        col_fracs=[0.28, 0.72],
    )


def _api_table(S: dict) -> Table:
    return _simple_table(
        S,
        ["Area", "API (under /api/v1/messenger)"],
        [
            [
                "Directory &amp; unread",
                "<b>GET /users</b> \u00b7 <b>GET /unread-count</b>",
            ],
            [
                "Conversations",
                "<b>GET/POST /conversations</b> \u00b7 <b>GET /conversations/{id}</b> "
                "\u00b7 leave &amp; mark-read",
            ],
            [
                "Messages",
                "List with before/after paging \u00b7 send text/attachment \u00b7 "
                "<b>DELETE /messages/{id}</b> (unsend)",
            ],
            [
                "Files",
                "Mint signed upload \u00b7 discard failed upload \u00b7 signed "
                "view/download for members only",
            ],
        ],
        col_fracs=[0.28, 0.72],
    )


def _sql_table(S: dict) -> Table:
    return _simple_table(
        S,
        ["Script", "Adds"],
        [
            [
                "create_messenger_chat.sql",
                "Conversations, members, messages, attachment columns, "
                "private <b>team-chat-files</b> bucket, RLS, Realtime publication",
            ],
        ],
        col_fracs=[0.42, 0.58],
    )


def _rollout_table(S: dict) -> Table:
    left = [
        Paragraph(
            "Run <b>create_messenger_chat.sql</b> in the Supabase SQL Editor. "
            "Confirm the private <b>team-chat-files</b> bucket and a project "
            "upload limit of at least <b>2 GB</b>",
            S["bullet"],
        ),
        Spacer(1, 5),
        Paragraph(
            "Confirm <b>Team Chat</b> appears in the sidebar only for the "
            "allowlist and superadmin",
            S["bullet"],
        ),
        Spacer(1, 5),
        Paragraph(
            "Start a 1:1: send text, confirm the other user\u2019s unread badge "
            "and live delivery",
            S["bullet"],
        ),
        Spacer(1, 5),
        Paragraph(
            "Open the thread: mark-read clears unread; Seen appears on the "
            "sender\u2019s last message",
            S["bullet"],
        ),
    ]
    right = [
        Paragraph(
            "Create a group with a title, send a file under 2 GB, preview "
            "or download as a member, confirm an outsider cannot open it",
            S["bullet"],
        ),
        Spacer(1, 5),
        Paragraph(
            "Unsend a message with an attachment: body clears, file is removed, "
            "preview becomes Message unsent",
            S["bullet"],
        ),
        Spacer(1, 5),
        Paragraph(
            "Leave a group (membership gone). Confirm a direct chat cannot be left",
            S["bullet"],
        ),
        Spacer(1, 5),
        Paragraph(
            "Optional: set <b>TEAM_CHAT_ALLOWED_EMAILS</b> on the API. "
            "Empty string opens the API to all active users\u2014update the "
            "frontend allowlist separately for UI parity",
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
        title="Team Chat \u2014 Implementation Summary",
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
            "Team Chat gives MetroShoe staff a private messenger inside MSW "
            "Overwatch. People start 1:1 or group threads, exchange text and "
            "files, and see unread counts, typing, and online status without "
            "leaving the app. Writes go through FastAPI; browsers only read "
            "conversations they belong to so Realtime can push updates safely.",
            S["body"],
        ),
    ]
    right_bv = sec("BUSINESS VALUE") + [
        Paragraph("Fast internal coordination without a separate chat app", S["bullet"]),
        Spacer(1, 4),
        Paragraph(
            "Gated rollout: only the allowlist and superadmin see the feature",
            S["bullet"],
        ),
        Spacer(1, 4),
        Paragraph(
            "Live delivery for messages, unsends, and read receipts",
            S["bullet"],
        ),
        Spacer(1, 4),
        Paragraph(
            "Files stay in a private bucket; only conversation members get links",
            S["bullet"],
        ),
    ]
    story.append(_two_col(left_what, right_bv))
    story.append(Spacer(1, 10))
    story.append(_divider(C_W))
    story.append(Spacer(1, 8))

    story.append(Paragraph("HOW A CHAT WORKS", S["section"]))
    story.append(_divider(C_W))
    story.append(Spacer(1, 6))
    story.append(_flow_table(S))
    story.append(Spacer(1, 8))
    story.append(_divider(C_W))
    story.append(Spacer(1, 8))

    story.append(Paragraph("CORE FEATURES", S["section"]))
    story.append(_divider(C_W))
    story.append(Spacer(1, 6))
    story.append(_features_table(S))

    story.append(NextPageTemplate("Later"))
    story.append(PageBreak())

    story.append(Paragraph("LIMITS", S["section"]))
    story.append(_divider(C_W))
    story.append(Spacer(1, 6))
    story.append(_limits_table(S))
    story.append(Spacer(1, 10))
    story.append(_divider(C_W))
    story.append(Spacer(1, 8))

    story.append(Paragraph("API SURFACE", S["section"]))
    story.append(_divider(C_W))
    story.append(Spacer(1, 6))
    story.append(
        Paragraph(
            "All routes require app access plus Team Chat eligibility. "
            "Missing tables return <b>503</b> with a hint to run the migration. "
            "Create, leave, and unsend are audited; routine send and mark-read "
            "traffic is not.",
            S["body"],
        )
    )
    story.append(Spacer(1, 6))
    story.append(_api_table(S))
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

    story.append(Paragraph("DATABASE SCRIPT", S["section"]))
    story.append(_divider(C_W))
    story.append(Spacer(1, 6))
    story.append(
        Paragraph(
            "Run this once in the Supabase SQL Editor. The API uses the service "
            "role for writes. Authenticated browsers get <b>SELECT</b> only on "
            "threads they belong to (via <b>messenger_is_member</b>), which is "
            "what Realtime needs. Anon has no access.",
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
            "Only allowlisted users and superadmins can open Team Chat or appear "
            "in the new-message directory",
            S["bullet"],
        )
    )
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            "Each pair of people shares one direct thread; groups are separate "
            "and can be left",
            S["bullet"],
        )
    )
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            "Browsers never write chat tables directly\u2014FastAPI owns creates, "
            "sends, reads, unsends, and leave",
            S["bullet"],
        )
    )
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            "Attachment links are short-lived and membership-checked; outsiders "
            "get 404",
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
    story.append(Paragraph("Shipped on web / desktop app version <b>4.0.2</b>", S["bullet"]))
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            "Route <b>/chat</b> \u00b7 Sidebar <b>Team Chat</b> \u00b7 API "
            "<b>/api/v1/messenger/*</b>",
            S["bullet"],
        )
    )
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            "Same allowlist pattern as FBA Order Checker / FBA Box Contents. "
            "Does not replace CLI Chat (AI assistant), email, or external messengers",
            S["bullet"],
        )
    )

    doc.build(story)
    return OUTPUT


if __name__ == "__main__":
    out = build_pdf()
    print(f"Wrote: {out}")
