"""Runtime maintenance mode state."""
from datetime import datetime, timedelta, timezone
from app.config import settings

_state = {
    "maintenance_mode": bool(settings.maintenance_mode),
    "message": settings.maintenance_message,
    "duration_hours": None,
    "expected_end_at": None,
}


def _format_expected_end(expected_end_at: str | None) -> str | None:
    if not expected_end_at:
        return None
    try:
        parsed = datetime.fromisoformat(expected_end_at.replace("Z", "+00:00"))
        return parsed.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    except Exception:
        return None


def _build_effective_message(base_message: str, expected_end_at: str | None) -> str:
    expected_str = _format_expected_end(expected_end_at)
    if not expected_str:
        return base_message
    return f"{base_message} Estimated completion: {expected_str}."


def get_maintenance_state() -> dict:
    """Return current maintenance runtime state."""
    maintenance_mode = bool(_state.get("maintenance_mode", False))
    message = str(_state.get("message") or settings.maintenance_message)
    expected_end_at = _state.get("expected_end_at")
    duration_hours = _state.get("duration_hours")
    return {
        "maintenance_mode": maintenance_mode,
        "message": message,
        "effective_message": _build_effective_message(message, expected_end_at) if maintenance_mode else message,
        "duration_hours": duration_hours,
        "expected_end_at": expected_end_at,
    }


def set_maintenance_state(
    maintenance_mode: bool,
    message: str | None = None,
    duration_hours: float | None = None,
) -> dict:
    """Update runtime maintenance state for this backend process."""
    _state["maintenance_mode"] = bool(maintenance_mode)
    if message is not None:
        cleaned = str(message).strip()
        _state["message"] = cleaned or settings.maintenance_message
    if duration_hours is not None:
        clamped = max(0.0, min(168.0, float(duration_hours)))
        _state["duration_hours"] = clamped
    if _state["maintenance_mode"]:
        hours = _state.get("duration_hours")
        if isinstance(hours, (int, float)) and hours > 0:
            expected = datetime.now(timezone.utc) + timedelta(hours=float(hours))
            _state["expected_end_at"] = expected.isoformat().replace("+00:00", "Z")
        else:
            _state["expected_end_at"] = None
    else:
        _state["expected_end_at"] = None
    return get_maintenance_state()
