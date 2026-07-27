"""Feedback identity checks (page is open to all authenticated users)."""


def feedback_blocked_for_identity(display_name: str, email: str) -> bool:
    """Formerly blocked selected identities; now always allows access."""
    _ = (display_name, email)
    return False
