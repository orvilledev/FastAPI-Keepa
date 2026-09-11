"""
Generate a one-pager-style PDF of five API-mode Keepa freshness prototypes.

Run:  python docs/generate_keepa_api_mode_prototypes.py
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
    Flowable,
    Frame,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

ROOT = Path(__file__).resolve().parent.parent
FONTS_DIR = Path(r"C:\Windows\Fonts")
OUTPUT = ROOT / "docs" / "Keepa API Mode Prototypes _ MSW Overwatch.pdf"

PAGE_W, PAGE_H = letter
M_L = 36
M_R = 36
M_B = 40
C_W = PAGE_W - M_L - M_R

C_TITLE = colors.HexColor("#111827")
C_SUBTITLE = colors.HexColor("#4b5563")
C_META = colors.HexColor("#1f2937")
C_BODY = colors.HexColor("#1f2937")
C_SECTION = colors.HexColor("#ea580c")
C_ACCENT = colors.HexColor("#ea580c")
C_BADGE = colors.HexColor("#fdba74")
C_INTRO = colors.HexColor("#7c2d12")
C_FOOTER = colors.HexColor("#6b7280")
C_BOX = colors.HexColor("#fff7ed")
C_BOX_STROKE = colors.HexColor("#fb923c")
C_KEEP = colors.HexColor("#eff6ff")
C_KEEP_STROKE = colors.HexColor("#3b82f6")
C_AMZ = colors.HexColor("#ecfdf5")
C_AMZ_STROKE = colors.HexColor("#059669")
C_OUT = colors.HexColor("#f5f3ff")
C_OUT_STROKE = colors.HexColor("#7c3aed")
C_TABLE_HEAD = colors.HexColor("#e8ecf1")
C_TABLE_BORDER = colors.HexColor("#d1d5db")
C_DIVIDER = colors.HexColor("#e5e7eb")


def _reg_fonts() -> None:
    pdfmetrics.registerFont(TTFont("SegoeUI", str(FONTS_DIR / "segoeui.ttf")))
    pdfmetrics.registerFont(TTFont("SegoeUI-Bold", str(FONTS_DIR / "segoeuib.ttf")))


def _ps(name, fn, sz, col, lead, **kw):
    return ParagraphStyle(
        name, fontName=fn, fontSize=sz, textColor=col, leading=lead, **kw
    )


def _styles() -> dict:
    R, B = "SegoeUI", "SegoeUI-Bold"
    return {
        "h": _ps("h", B, 13, C_SECTION, 16, spaceBefore=4, spaceAfter=6),
        "body": _ps("body", R, 9.5, C_BODY, 13),
        "small": _ps("small", R, 8.5, C_SUBTITLE, 12),
        "td": _ps("td", R, 8.5, C_BODY, 11.5),
        "td_b": _ps("td_b", B, 8.5, C_BODY, 11.5),
        "th": _ps("th", B, 8.5, colors.HexColor("#374151"), 11.5),
        "caption": _ps("caption", R, 8, C_FOOTER, 11, alignment=1),
    }


class ArrowFlow(Flowable):
    """Horizontal row of labeled boxes with arrows. Optional Amazon branch."""

    def __init__(self, boxes: list[tuple[str, str]], amazon: str | None = None, height: float = 78):
        super().__init__()
        self.boxes = boxes
        self.amazon = amazon
        self._h = height
        self.width = C_W
        self.height = height + (36 if amazon else 0)

    def wrap(self, availWidth, availHeight):
        self.width = min(C_W, availWidth)
        return self.width, self.height

    def draw(self):
        c = self.canv
        n = len(self.boxes)
        gap = 14
        box_w = (self.width - gap * (n - 1)) / n
        box_h = 52
        y = self.height - box_h - 4
        fills = {
            "msw": (C_BOX, C_BOX_STROKE),
            "keepa": (C_KEEP, C_KEEP_STROKE),
            "out": (C_OUT, C_OUT_STROKE),
            "amz": (C_AMZ, C_AMZ_STROKE),
        }
        centers = []
        for i, (kind, label) in enumerate(self.boxes):
            x = i * (box_w + gap)
            fill, stroke = fills.get(kind, (C_BOX, C_BOX_STROKE))
            c.setFillColor(fill)
            c.setStrokeColor(stroke)
            c.setLineWidth(1)
            c.roundRect(x, y, box_w, box_h, 6, fill=1, stroke=1)
            self._label(c, label, x + 4, y + 6, box_w - 8, box_h - 12)
            centers.append(x + box_w / 2)
            if i < n - 1:
                ax0 = x + box_w + 1
                ax1 = x + box_w + gap - 1
                mid = y + box_h / 2
                c.setStrokeColor(C_SUBTITLE)
                c.setFillColor(C_SUBTITLE)
                c.setLineWidth(1.1)
                c.line(ax0, mid, ax1 - 5, mid)
                c.drawRightString(ax1 + 1, mid - 3, ">")
        if self.amazon:
            keepa_i = next((i for i, (k, _) in enumerate(self.boxes) if k == "keepa"), 1)
            kx = keepa_i * (box_w + gap) + box_w / 2
            amz_w = min(160, box_w)
            amz_x = kx - amz_w / 2
            amz_y = 4
            c.setStrokeColor(C_AMZ_STROKE)
            c.setFillColor(C_AMZ)
            c.setDash(2, 2)
            c.setLineWidth(1)
            c.line(kx, y, kx, amz_y + 28)
            c.setDash()
            c.roundRect(amz_x, amz_y, amz_w, 28, 5, fill=1, stroke=1)
            self._label(c, self.amazon, amz_x + 3, amz_y + 3, amz_w - 6, 22)

    def _label(self, c, text: str, x, y, w, h):
        style = ParagraphStyle(
            "boxlab",
            fontName="SegoeUI",
            fontSize=7.5,
            leading=9.5,
            textColor=C_META,
            alignment=1,
        )
        p = Paragraph(text.replace("\n", "<br/>"), style)
        pw, ph = p.wrap(w, h)
        p.drawOn(c, x, y + max(0, (h - ph) / 2))


def _header_footer(canvas, doc):
    c = canvas
    c.saveState()
    page = doc.page
    if page == 1:
        c.setFont("SegoeUI-Bold", 20)
        c.setFillColor(C_TITLE)
        c.drawString(M_L, PAGE_H - 50, "Keepa API Mode Prototypes")
        c.setFont("SegoeUI", 11)
        c.setFillColor(C_SUBTITLE)
        c.drawString(M_L, PAGE_H - 68, "Five ways MSW Overwatch can request Amazon data through Keepa")
        c.setFont("SegoeUI-Bold", 10)
        c.setFillColor(C_META)
        c.drawRightString(PAGE_W - M_R, PAGE_H - 46, "MetroShoe Warehouse")
        c.setFont("SegoeUI", 9)
        c.setFillColor(C_SUBTITLE)
        c.drawRightString(PAGE_W - M_R, PAGE_H - 60, "August 2026")
        c.setFillColor(C_ACCENT)
        c.rect(M_L, PAGE_H - 80, C_W, 2.25, fill=1, stroke=0)
    else:
        c.setFillColor(C_ACCENT)
        c.rect(M_L, PAGE_H - 36, C_W, 2.25, fill=1, stroke=0)
        c.setFont("SegoeUI-Bold", 10)
        c.setFillColor(C_META)
        c.drawString(M_L, PAGE_H - 26, "Keepa API Mode Prototypes")
        c.drawRightString(PAGE_W - M_R, PAGE_H - 26, "MetroShoe Warehouse")
    c.setFont("SegoeUI", 8)
    c.setFillColor(C_FOOTER)
    c.drawString(M_L, 22, "MSW Overwatch  ·  Overwatch never scrapes Amazon — Keepa crawls, then Overwatch filters + MAP")
    c.drawRightString(PAGE_W - M_R, 22, f"{page}")
    c.restoreState()


def _table(header, rows, col_widths, S):
    data = [[Paragraph(h, S["th"]) for h in header]]
    for row in rows:
        data.append([Paragraph(c, S["td_b"] if i == 0 else S["td"]) for i, c in enumerate(row)])
    t = Table(data, colWidths=col_widths, repeatRows=1)
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), C_TABLE_HEAD),
                ("GRID", (0, 0), (-1, -1), 0.4, C_TABLE_BORDER),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    return t


def build() -> Path:
    _reg_fonts()
    S = _styles()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)

    frame1 = Frame(M_L, M_B, C_W, PAGE_H - M_B - 96, id="cover")
    frame_n = Frame(M_L, M_B, C_W, PAGE_H - M_B - 52, id="body")
    doc = BaseDocTemplate(
        str(OUTPUT),
        pagesize=letter,
        leftMargin=M_L,
        rightMargin=M_R,
        title="Keepa API Mode Prototypes — MSW Overwatch",
        author="MetroShoe Warehouse",
    )
    doc.addPageTemplates(
        [
            PageTemplate(id="cover", frames=[frame1], onPage=_header_footer),
            PageTemplate(id="body", frames=[frame_n], onPage=_header_footer),
        ]
    )

    story = []
    story.append(
        Paragraph(
            "<b>STATUS:</b> Prototypes for discussion. Items 1–4 exist in the app today (API mode). "
            "Item 5 needs a code change (Keepa <b>update=1</b>). "
            "<b>Trigger Import Run Now is not API mode</b> — it uses an uploaded Keepa Excel file "
            "and does not crawl Amazon.",
            _ps("intro", "SegoeUI", 10, C_INTRO, 14),
        )
    )
    story.append(Spacer(1, 10))
    story.append(Paragraph("How a request works", S["h"]))
    story.append(
        Paragraph(
            "MSW Overwatch never talks to Amazon. In API mode it asks Keepa’s Product API "
            "(UPC, US domain, offers, buy box). Keepa returns cache if it is fresh enough "
            "(typically within about 1 hour). If the cache is older, Keepa crawls Amazon, "
            "stores a new snapshot, then replies. Overwatch then drops stale/used/OOS/scam "
            "offers (lastSeen older than 48 hours) and compares remaining prices to MAP.",
            S["body"],
        )
    )
    story.append(Spacer(1, 8))
    story.append(
        ArrowFlow(
            [
                ("msw", "MSW Overwatch\nAPI request"),
                ("keepa", "Keepa cache\nor live crawl"),
                ("out", "Filter + MAP\nemail / report"),
            ],
            amazon="Amazon — crawled only if Keepa cache is stale",
        )
    )
    story.append(Spacer(1, 12))
    story.append(Paragraph("Prototype comparison", S["h"]))
    story.append(
        _table(
            ["#", "Prototype", "When to use", "Freshness", "Analytics"],
            [
                ["1", "Morning Daily Run", "Normal ops", "Once/day at 6:00 AM Chicago", "1 Daily Run"],
                ["2", "Same Day Run", "Second full-vendor pull same day", "Two Keepa asks that day", "1 day, 2 emails"],
                ["3", "Express Job", "Spot-check a UPC subset now", "Now, those UPCs only", "Not a Daily Run"],
                ["4", "Buy-box only", "Save tokens; featured offer only", "Same crawl rules", "Depends on job type"],
                ["5", "Live-leaning (proposed)", "Force Keepa live-pull if &gt;1h old", "Best per request; more tokens", "Same as 1–3"],
            ],
            [28, 118, 150, 148, 96],
            S,
        )
    )

    story.append(PageBreak())
    story.append(Paragraph("1 — Morning Daily Run (current default)", S["h"]))
    story.append(
        Paragraph(
            "One scheduled API pull per vendor. Cheapest full-catalog snapshot. "
            "Data is “what Keepa had at 6:00 AM Chicago.” Stay on "
            "<b>buy box + other sellers below MAP</b> and offers ≈ 50.",
            S["body"],
        )
    )
    story.append(Spacer(1, 8))
    story.append(
        ArrowFlow(
            [
                ("msw", "6:00 AM Chicago\nrecurring schedule"),
                ("msw", "All Manage UPCs\nAPI mode"),
                ("keepa", "Product API\noffers=50, buybox"),
                ("out", "48h lastSeen\nMAP + 1 email"),
            ],
            amazon="Amazon crawl if cache older than ~1 hour",
        )
    )
    story.append(Paragraph("Use when daily monitoring is enough. Analytics: 1 run.", S["small"]))
    story.append(Spacer(1, 16))

    story.append(Paragraph("2 — Same Day Run (second API pull)", S["h"]))
    story.append(
        Paragraph(
            "Keeps the 6am schedule. Adds a one-off later the same calendar day "
            "(countdown). Uses current scheduler <b>API mode</b>, not an uploaded file. "
            "Does not change tomorrow’s cron. Analytics still counts one day; both jobs can email.",
            S["body"],
        )
    )
    story.append(Spacer(1, 8))
    story.append(
        ArrowFlow(
            [
                ("msw", "6:00 AM\nDaily Run + email 1"),
                ("msw", "You set delay\nSame Day Run"),
                ("keepa", "Full UPC list\nasked again"),
                ("out", "Afternoon snapshot\n+ email 2"),
            ],
            amazon="Keepa crawls Amazon if morning cache is now stale",
        )
    )
    story.append(
        Paragraph(
            "Use when MAP changed, Amazon moved, or the morning pull missed something.",
            S["small"],
        )
    )

    story.append(PageBreak())
    story.append(Paragraph("3 — Express Job (on-demand subset)", S["h"]))
    story.append(
        Paragraph(
            "Create an Express Job: pick UPCs, vendor, offers limit (20–100+), and "
            "buy-box only vs all sellers. Fastest way to refresh <i>some</i> listings "
            "without waiting for the vendor Daily Run. Express Jobs are not counted in "
            "Off-Price Analytics Daily Runs.",
            S["body"],
        )
    )
    story.append(Spacer(1, 8))
    story.append(
        ArrowFlow(
            [
                ("msw", "Create Express Job\nUPC list + vendor"),
                ("keepa", "Keepa Product API\nnow"),
                ("out", "Job report\noptional email"),
            ],
            amazon="Amazon crawl if those ASINs are stale in Keepa",
        )
    )
    story.append(Paragraph("Use for one brand, a short list, or a higher offers cap than Daily Run.", S["small"]))
    story.append(Spacer(1, 16))

    story.append(Paragraph("4 — Buy-box-only API (cheaper, less complete)", S["h"]))
    story.append(
        Paragraph(
            "Same API mode, but <b>off_price_scope = buybox_only</b>. Fewer tokens and faster, "
            "because Keepa can omit the marketplace offer list. Hidden 3P sellers below MAP "
            "will not show. Prototypes 1–3 should stay on all sellers if you want the full picture.",
            S["body"],
        )
    )
    story.append(Spacer(1, 8))
    story.append(
        ArrowFlow(
            [
                ("msw", "Daily Run or Express\nbuybox_only"),
                ("keepa", "Product API\nbuybox=1, no offers list"),
                ("out", "Alert only if buy box\nis below MAP"),
            ],
            amazon="Same Keepa crawl rules — coverage is narrower",
        )
    )
    story.append(Paragraph("Use only if you accept missing competing marketplace sellers.", S["small"]))

    story.append(PageBreak())
    story.append(Paragraph("5 — Live-leaning API (proposed — needs code)", S["h"]))
    story.append(
        Paragraph(
            "Today Overwatch does <b>not</b> send Keepa’s <b>update</b> flag. This prototype would "
            "send <b>update=1</b> so Keepa live-pulls Amazon when its cache is older than 1 hour. "
            "You would still use Daily Run, Same Day Run, and Express Job as the triggers. "
            "<b>update=0</b> (always live) is usually too expensive for a full vendor list.",
            S["body"],
        )
    )
    story.append(Spacer(1, 8))
    story.append(
        ArrowFlow(
            [
                ("msw", "Daily / Same Day\n/ Express Job"),
                ("keepa", "code + offers=50\n+ buybox + update=1"),
                ("out", "48h lastSeen\nMAP + email"),
            ],
            amazon="Crawl Amazon now if last Keepa crawl is older than 1 hour",
        )
    )
    story.append(Paragraph("Not built yet. More Keepa tokens per request; best freshness per ask.", S["small"]))
    story.append(Spacer(1, 16))
    story.append(Paragraph("Recommended mix", S["h"]))
    story.append(
        _table(
            ["Goal", "Use"],
            [
                ["Normal ops", "Prototype 1 — morning Daily Run, all sellers, API mode"],
                ["Same-day full vendor refresh", "Prototype 2 — Same Day Run (still API mode)"],
                ["Spot-check a few UPCs now", "Prototype 3 — Express Job"],
                ["Save tokens", "Prototype 4 — only if buy-box-only is enough"],
                ["Max freshness per request", "Prototype 5 (code) + still use 1 and 2"],
            ],
            [180, C_W - 180],
            S,
        )
    )
    story.append(Spacer(1, 12))
    story.append(
        Paragraph(
            "<b>Stay in API mode</b> on the vendor Daily Run page. Uploaded Excel + "
            "Trigger Import is a different data source and will not crawl Amazon.",
            S["body"],
        )
    )

    doc.build(story)
    return OUTPUT


if __name__ == "__main__":
    path = build()
    print(path)
