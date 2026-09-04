"""Runtime maintenance mode state."""
from datetime import datetime, timedelta, timezone
from app.config import settings

_state = {
    "maintenance_mode": bool(settings.maintenance_mode),
    "message": settings.maintenance_message,
    "duration_hours": None,
    "expected_end_at": None,
    "scheduled_start_at": None,
}


def _parse_iso_utc(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).astimezone(timezone.utc)
    except Exception:
        return None


def _to_iso_z(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


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


def _compute_expected_end(start: datetime, duration_hours: float | None) -> str | None:
    if isinstance(duration_hours, (int, float)) and float(duration_hours) > 0:
        return _to_iso_z(start + timedelta(hours=float(duration_hours)))
    return None


def _duration_hours_between(start: datetime, end: datetime) -> float:
    hours = (end - start).total_seconds() / 3600.0
    return max(0.0, min(168.0, round(hours * 2) / 2))


def _maybe_activate_scheduled() -> None:
    """Activate maintenance when a future schedule reaches its start time."""
    if _state.get("maintenance_mode"):
        return
    start = _parse_iso_utc(_state.get("scheduled_start_at"))
    if not start:
        return
    now = datetime.now(timezone.utc)
    if now < start:
        return
    _state["maintenance_mode"] = True
    # Keep an explicit scheduled end when present; otherwise derive from duration.
    if not _state.get("expected_end_at"):
        hours = _state.get("duration_hours")
        _state["expected_end_at"] = _compute_expected_end(
            start, hours if isinstance(hours, (int, float)) else None
        )
    _state["scheduled_start_at"] = None


def get_maintenance_state() -> dict:
    """Return current maintenance runtime state."""
    _maybe_activate_scheduled()
    maintenance_mode = bool(_state.get("maintenance_mode", False))
    message = str(_state.get("message") or settings.maintenance_message)
    expected_end_at = _state.get("expected_end_at")
    duration_hours = _state.get("duration_hours")
    scheduled_start_at = _state.get("scheduled_start_at")
    return {
        "maintenance_mode": maintenance_mode,
        "message": message,
        "effective_message": _build_effective_message(message, expected_end_at) if maintenance_mode else message,
        "duration_hours": duration_hours,
        "expected_end_at": expected_end_at,
        "scheduled_start_at": scheduled_start_at,
    }


def set_maintenance_state(
    maintenance_mode: bool,
    message: str | None = None,
    duration_hours: float | None = None,
    scheduled_start_at: str | None = None,
    scheduled_end_at: str | None = None,
    *,
    update_schedule: bool = False,
) -> dict:
    """Update runtime maintenance state for this backend process."""
    if message is not None:
        cleaned = str(message).strip()
        _state["message"] = cleaned or settings.maintenance_message
    if duration_hours is not None:
        clamped = max(0.0, min(168.0, float(duration_hours)))
        _state["duration_hours"] = clamped

    hours = _state.get("duration_hours")
    hours_val = float(hours) if isinstance(hours, (int, float)) else None

    if bool(maintenance_mode):
        # Immediate enable: clear any pending schedule and start now.
        _state["maintenance_mode"] = True
        _state["scheduled_start_at"] = None
        now = datetime.now(timezone.utc)
        explicit_end = _parse_iso_utc(scheduled_end_at) if update_schedule else None
        if explicit_end and explicit_end > now:
            _state["expected_end_at"] = _to_iso_z(explicit_end)
            _state["duration_hours"] = _duration_hours_between(now, explicit_end)
        else:
            _state["expected_end_at"] = _compute_expected_end(now, hours_val)
        return get_maintenance_state()

    # Disable immediate maintenance.
    _state["maintenance_mode"] = False

    if update_schedule:
        start = _parse_iso_utc(scheduled_start_at)
        end = _parse_iso_utc(scheduled_end_at)
        now = datetime.now(timezone.utc)
        if start and start > now:
            _state["scheduled_start_at"] = _to_iso_z(start)
            if end and end > start:
                _state["expected_end_at"] = _to_iso_z(end)
                _state["duration_hours"] = _duration_hours_between(start, end)
            else:
                _state["expected_end_at"] = _compute_expected_end(start, hours_val)
        else:
            # Empty, invalid, or past datetime clears the schedule.
            _state["scheduled_start_at"] = None
            _state["expected_end_at"] = None
    else:
        # Disabling without an explicit schedule update clears pending schedule.
        _state["scheduled_start_at"] = None
        _state["expected_end_at"] = None

    return get_maintenance_state()
