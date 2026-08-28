"""Runtime email transport selection (SMTP vs Microsoft Graph)."""
from __future__ import annotations

from app.config import settings

_VALID_TRANSPORTS = frozenset({"auto", "graph", "smtp"})

_state = {
    "transport": (settings.email_transport or "auto").strip().lower(),
}


def _normalize_transport(mode: str | None) -> str:
    cleaned = (mode or "auto").strip().lower()
    return cleaned if cleaned in _VALID_TRANSPORTS else "auto"


def resolve_effective_transport(mode: str | None) -> str:
    """Map auto/graph/smtp to the concrete sender: graph or smtp."""
    normalized = _normalize_transport(mode)
    if normalized == "graph":
        return "graph"
    if normalized == "smtp":
        return "smtp"
    return "graph" if settings.graph_email_configured else "smtp"


def get_resolved_transport() -> str:
    """Concrete transport used by EmailService for the current process."""
    return resolve_effective_transport(_state["transport"])


def get_email_transport_state() -> dict:
    """Return runtime transport selection and configuration status."""
    transport = _normalize_transport(_state["transport"])
    effective = resolve_effective_transport(transport)
    return {
        "transport": transport,
        "effective_transport": effective,
        "env_transport": _normalize_transport(settings.email_transport),
        "smtp_configured": bool((settings.email_password or "").strip() and (settings.email_from or "").strip()),
        "graph_configured": settings.graph_email_configured,
        "email_from": (settings.email_from or "").strip(),
        "smtp_host": settings.email_smtp_host,
    }


def set_email_transport(transport: str) -> dict:
    """Update runtime transport for this backend process (superadmin API)."""
    _state["transport"] = _normalize_transport(transport)
    return get_email_transport_state()
