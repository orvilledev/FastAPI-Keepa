"""
Weekly calendar PDF of active Daily Runs from scheduler_settings.

Active = enabled in the dashboard. Times are placed on a Central Time week.
Oboz stays labeled with its Asia/Taipei clock time.

Run:  python docs/generate_active_daily_runs_calendar.py
"""
from __future__ import annotations

from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter, landscape
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

ROOT = Path(__file__).resolve().parent.parent
FONTS_DIR = Path(r"C:\Windows\Fonts")
OUTPUT = ROOT / "docs" / "Active Daily Runs - Weekly Schedule _ MSW Overwatch.pdf"

# Pulled from scheduler_settings on 9 Oct 2026. Chicago is CDT (UTC-5); Taipei is UTC+8.
ACTIVE = [
    {
        "code": "DNK",
        "name": "Dansko",
        "days": ["mon", "tue", "wed", "thu", "fri"],
        "hour": 7,
        "minute": 15,
        "tz_label": "Central",
        "note": "",
        "color": "#1d4ed8",
    },
    {
        "code": "SFF",
        "name": "Sofft",
        "days": ["mon", "tue", "wed", "thu", "fri"],
        "hour": 8,
        "minute": 15,
        "tz_label": "Central",
        "note": "",
        "color": "#0369a1",
    },
    {
        "code": "OBZ",
        "name": "Oboz",
        "days": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
        # 9:00 PM Asia/Taipei = 8:00 AM Central the same calendar day.
        "hour": 8,
        "minute": 0,
        "tz_label": "Central",
        "note": "9:00 PM Taipei",
        "color": "#c2410c",
    },
    {
        "code": "TEV",
        "name": "Teva",
        "days": ["mon", "tue", "wed", "thu", "fri"],
        "hour": 10,
        "minute": 0,
        "tz_label": "Central",
        "note": "",
        "color": "#0f766e",
    },
    {
        "code": "CLK",
        "name": "Clarks",
        "days": ["tue", "thu", "sat"],
        "hour": 13,
        "minute": 0,
        "tz_label": "Central",
        "note": "",
        "color": "#6d28d9",
    },
    {
        "code": "JFS",
        "name": "Josef Siebel",
        "days": ["tue", "fri"],
        "hour": 13,
        "minute": 0,
        "tz_label": "Central",
        "note": "",
        "color": "#be123c",
    },
    {
        "code": "BOR",
        "name": "Born",
        "days": ["tue", "thu", "sat"],
        "hour": 14,
        "minute": 0,
        "tz_label": "Central",
        "note": "",
        "color": "#b45309",
    },
]

DAYS = [
    ("mon", "Monday"),
    ("tue", "Tuesday"),
    ("wed", "Wednesday"),
    ("thu", "Thursday"),
    ("fri", "Friday"),
    ("sat", "Saturday"),
    ("sun", "Sunday"),
]


def _clock(hour: int, minute: int) -> str:
    suffix = "AM" if hour < 12 else "PM"
    hour12 = hour % 12 or 12
    if minute:
        return f"{hour12}:{minute:02d} {suffix}"
    return f"{hour12}:00 {suffix}"


def build_pdf() -> Path:
    pdfmetrics.registerFont(TTFont("SegoeUI", str(FONTS_DIR / "segoeui.ttf")))
    pdfmetrics.registerFont(TTFont("SegoeUI-Bold", str(FONTS_DIR / "segoeuib.ttf")))

    page_w, page_h = landscape(letter)
    c = canvas.Canvas(str(OUTPUT), pagesize=landscape(letter))
    c.setTitle("Active Daily Runs — Weekly Schedule")

    margin = 28
    c.setFillColor(colors.white)
    c.rect(0, 0, page_w, page_h, fill=1, stroke=0)

    c.setFillColor(colors.HexColor("#111827"))
    c.setFont("SegoeUI-Bold", 18)
    c.drawString(margin, page_h - 36, "Active Daily Runs")
    c.setFillColor(colors.HexColor("#4b5563"))
    c.setFont("SegoeUI", 10)
    c.drawString(margin, page_h - 52, "Weekly schedule \u2014 MSW Overwatch")

    c.setFillColor(colors.HexColor("#1f2937"))
    c.setFont("SegoeUI-Bold", 10)
    c.drawRightString(page_w - margin, page_h - 32, "MetroShoe Warehouse")
    c.setFillColor(colors.HexColor("#4b5563"))
    c.setFont("SegoeUI", 9)
    c.drawRightString(page_w - margin, page_h - 46, "9 October 2026 \u00b7 Central Time")

    c.setFillColor(colors.HexColor("#ea580c"))
    c.rect(margin, page_h - 62, page_w - 2 * margin, 2, fill=1, stroke=0)

    c.setFillColor(colors.HexColor("#374151"))
    c.setFont("SegoeUI", 8.5)
    c.drawString(
        margin,
        page_h - 76,
        "Seven enabled Daily Runs. Columns are a repeating week. Oboz is configured at 9:00 PM Asia/Taipei (8:00 AM Central, same day). "
        "CHA and REF are turned off and are not on this calendar.",
    )

    top = page_h - 90
    bottom = 36
    gap = 6
    col_w = (page_w - 2 * margin - gap * 6) / 7
    header_h = 22

    by_day: dict[str, list[dict]] = {key: [] for key, _ in DAYS}
    for run in ACTIVE:
        for day in run["days"]:
            by_day[day].append(run)
    for day in by_day:
        by_day[day].sort(key=lambda run: (run["hour"], run["minute"], run["code"]))

    for index, (key, label) in enumerate(DAYS):
        x = margin + index * (col_w + gap)
        c.setFillColor(colors.HexColor("#111827"))
        c.roundRect(x, top - header_h, col_w, header_h, 3, fill=1, stroke=0)
        c.setFillColor(colors.white)
        c.setFont("SegoeUI-Bold", 9)
        c.drawCentredString(x + col_w / 2, top - 15, label)

        events = by_day[key]
        body_top = top - header_h - 4
        body_h = body_top - bottom
        c.setFillColor(colors.HexColor("#f9fafb"))
        c.setStrokeColor(colors.HexColor("#e5e7eb"))
        c.setLineWidth(0.6)
        c.roundRect(x, bottom, col_w, body_h, 4, fill=1, stroke=1)
        if not events:
            c.setFillColor(colors.HexColor("#6b7280"))
            c.setFont("SegoeUI", 8)
            c.drawCentredString(x + col_w / 2, bottom + body_h / 2, "No run")
            continue

        card_gap = 4
        card_h = 56
        inset = 4
        card_x = x + 3
        card_w = col_w - 6
        for event_index, run in enumerate(events):
            y = body_top - inset - (event_index + 1) * card_h - event_index * card_gap
            c.setFillColor(colors.HexColor(run["color"]))
            c.roundRect(card_x, y, card_w, card_h, 4, fill=1, stroke=0)
            c.setFillColor(colors.white)
            text_y = y + card_h - 13
            c.setFont("SegoeUI-Bold", 9)
            c.drawString(card_x + 5, text_y, _clock(run["hour"], run["minute"]))
            text_y -= 12
            c.setFont("SegoeUI-Bold", 8)
            c.drawString(card_x + 5, text_y, f"{run['code']}  {run['name']}")
            if run["note"]:
                text_y -= 11
                c.setFont("SegoeUI", 7)
                c.drawString(card_x + 5, text_y, run["note"])

    c.setFillColor(colors.HexColor("#6b7280"))
    c.setFont("SegoeUI", 8)
    c.drawString(margin, 18, "MSW Overwatch \u2014 Active Daily Runs \u00b7 scheduler_settings")
    c.drawRightString(page_w - margin, 18, "Times shown in Central")

    c.save()
    return OUTPUT


if __name__ == "__main__":
    print(f"Wrote: {build_pdf()}")
