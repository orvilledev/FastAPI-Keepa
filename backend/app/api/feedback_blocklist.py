"""Users who must not access Feedback UI or APIs (matched on profile display_name + email)."""

import re

_FEEDBACK_BLOCKED_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"john\s+bernard", re.IGNORECASE),
    re.compile(r"\bstephanie\b", re.IGNORECASE),
    re.compile(r"\bsunshine\b", re.IGNORECASE),
    re.compile(r"\bpaulo\b", re.IGNORECASE),
    re.compile(r"\bhezron\b", re.IGNORECASE),
)


def feedback_blocked_for_identity(display_name: str, email: str) -> bool:
    blob = f"{display_name or ''} {email or ''}".lower()
    return any(p.search(blob) for p in _FEEDBACK_BLOCKED_PATTERNS)
