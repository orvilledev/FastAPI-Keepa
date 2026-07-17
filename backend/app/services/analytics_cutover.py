"""Off-Price Analytics demo cutover (America/Chicago)."""
from __future__ import annotations

from datetime import datetime, timezone
from zoneinfo import ZoneInfo

# 2026-08-01 00:00 Central (CDT = UTC−5 in August)
ANALYTICS_DEMO_CUTOVER = datetime(2026, 8, 1, 0, 0, 0, tzinfo=ZoneInfo("America/Chicago"))
_CHICAGO = ZoneInfo("America/Chicago")


def has_analytics_demo_ended(now: datetime | None = None) -> bool:
    """True once Central time is on/after 2026-08-01 00:00."""
    current = now or datetime.now(_CHICAGO)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    return current.astimezone(_CHICAGO) >= ANALYTICS_DEMO_CUTOVER
