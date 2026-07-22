"""Off-Price Analytics is live-only; demo cutover is retired."""
from __future__ import annotations

from datetime import datetime


def has_analytics_demo_ended(now: datetime | None = None) -> bool:
    """Always True — fabricated demo analytics are no longer served."""
    return True
