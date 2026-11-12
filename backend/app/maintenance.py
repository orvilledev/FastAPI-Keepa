"""Runtime maintenance mode state (web / Electron / both)."""
from datetime import datetime, timedelta, timezone
from typing import Literal, Optional

from app.config import settings

_DEFAULT_SCHEDULE_TIMEZONE = "America/Chicago"
MaintenanceScope = Literal["web", "electron", "both"]
_VALID_SCOPES = frozenset({"web", "electron", "both"})


def _initial_flags() -> tuple[bool, bool]:
    """Boot flags from env. Legacy MAINTENANCE_MODE=true turns both clients on."""
    web = bool(getattr(settings, "maintenance_web", False))
    electron = bool(getattr(settings, "maintenance_electron", False))
    if bool(settings.maintenance_mode) and not web and not electron:
        return True, True
    return web, electron


def _scope_from_flags(web: bool, electron: bool) -> MaintenanceScope:
    if web and electron:
        return "both"
    if electron and not web:
        return "electron"
    if web and not electron:
        return "web"
    return "both"


def _normalize_scope(value: str | None, fallback: MaintenanceScope = "both") -> MaintenanceScope:
    cleaned = str(value or "").strip().lower()
    if cleaned in _VALID_SCOPES:
        return cleaned  # type: ignore[return-value]
    return fallback


def _flags_for_scope(scope: MaintenanceScope) -> tuple[bool, bool]:
    if scope == "web":
        return True, False
    if scope == "electron":
        return False, True
    return True, True


def _scope_includes(scope: MaintenanceScope, client_type: str) -> bool:
    client = (client_type or "web").strip().lower()
    if client == "electron":
        return scope in ("electron", "both")
    return scope in ("web", "both")


_web0, _electron0 = _initial_flags()
_state = {
    "maintenance_web": _web0,
    "maintenance_electron": _electron0,
    "scope": _scope_from_flags(_web0, _electron0),
    "message": settings.maintenance_message,
    "duration_hours": None,
    "expected_end_at": None,
    "scheduled_start_at": None,
    "schedule_timezone": _DEFAULT_SCHEDULE_TIMEZONE,
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


def _normalize_timezone(value: str | None) -> str:
    cleaned = str(value or "").strip()
    return cleaned or _DEFAULT_SCHEDULE_TIMEZONE


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


def _apply_scope_flags(scope: MaintenanceScope, *, active: bool) -> None:
    if not active:
        _state["maintenance_web"] = False
        _state["maintenance_electron"] = False
        return
    web, electron = _flags_for_scope(scope)
    _state["maintenance_web"] = web
    _state["maintenance_electron"] = electron


def _maybe_activate_scheduled() -> None:
    """Activate maintenance when a future schedule reaches its start time."""
    if _state.get("maintenance_web") or _state.get("maintenance_electron"):
        return
    start = _parse_iso_utc(_state.get("scheduled_start_at"))
    if not start:
        return
    now = datetime.now(timezone.utc)
    if now < start:
        return
    scope = _normalize_scope(_state.get("scope"), "both")
    _state["scope"] = scope
    _apply_scope_flags(scope, active=True)
    # Keep an explicit scheduled end when present; otherwise derive from duration.
    if not _state.get("expected_end_at"):
        hours = _state.get("duration_hours")
        _state["expected_end_at"] = _compute_expected_end(
            start, hours if isinstance(hours, (int, float)) else None
        )
    _state["scheduled_start_at"] = None


def is_maintenance_active_for_client(client_type: str | None) -> bool:
    """True when maintenance blocks this client (web or electron)."""
    _maybe_activate_scheduled()
    client = (client_type or "web").strip().lower()
    if client == "electron":
        return bool(_state.get("maintenance_electron"))
    return bool(_state.get("maintenance_web"))


def get_maintenance_state(*, for_client: Optional[str] = None) -> dict:
    """Return current maintenance runtime state.

    When ``for_client`` is ``web`` or ``electron``, ``maintenance_mode`` and
    schedule fields are scoped to that client. Admin UIs should omit
    ``for_client`` to see the full unfiltered state.

    Background jobs (Daily Run / Keepa Import off-price processing and emails)
    do not consult this gate and keep running during maintenance.
    """
    _maybe_activate_scheduled()
    web = bool(_state.get("maintenance_web", False))
    electron = bool(_state.get("maintenance_electron", False))
    scope = _normalize_scope(_state.get("scope"), _scope_from_flags(web, electron) if (web or electron) else "both")
    message = str(_state.get("message") or settings.maintenance_message)
    expected_end_at = _state.get("expected_end_at")
    duration_hours = _state.get("duration_hours")
    scheduled_start_at = _state.get("scheduled_start_at")
    schedule_timezone = _normalize_timezone(_state.get("schedule_timezone"))
    any_on = web or electron

    if for_client:
        client = (for_client or "web").strip().lower()
        if client not in ("web", "electron"):
            client = "web"
        effective = electron if client == "electron" else web
        # Hide upcoming schedules that will not affect this client.
        if not any_on and scheduled_start_at and not _scope_includes(scope, client):
            scheduled_start_at = None
            expected_end_at = None
        maintenance_mode = effective
    else:
        maintenance_mode = any_on

    return {
        "maintenance_mode": maintenance_mode,
        "maintenance_web": web,
        "maintenance_electron": electron,
        "scope": scope,
        "message": message,
        "effective_message": (
            _build_effective_message(message, expected_end_at) if maintenance_mode else message
        ),
        "duration_hours": duration_hours,
        "expected_end_at": expected_end_at,
        "scheduled_start_at": scheduled_start_at,
        "schedule_timezone": schedule_timezone,
    }


def set_maintenance_state(
    maintenance_mode: bool,
    message: str | None = None,
    duration_hours: float | None = None,
    scheduled_start_at: str | None = None,
    scheduled_end_at: str | None = None,
    schedule_timezone: str | None = None,
    scope: str | None = None,
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
    if schedule_timezone is not None:
        _state["schedule_timezone"] = _normalize_timezone(schedule_timezone)
    if scope is not None:
        _state["scope"] = _normalize_scope(scope, _normalize_scope(_state.get("scope"), "both"))

    hours = _state.get("duration_hours")
    hours_val = float(hours) if isinstance(hours, (int, float)) else None
    active_scope = _normalize_scope(_state.get("scope"), "both")

    if bool(maintenance_mode):
        # Immediate enable: clear any pending schedule and start now for the chosen scope.
        _state["scope"] = active_scope
        _apply_scope_flags(active_scope, active=True)
        _state["scheduled_start_at"] = None
        now = datetime.now(timezone.utc)
        explicit_end = _parse_iso_utc(scheduled_end_at) if update_schedule else None
        if explicit_end and explicit_end > now:
            _state["expected_end_at"] = _to_iso_z(explicit_end)
            _state["duration_hours"] = _duration_hours_between(now, explicit_end)
        else:
            _state["expected_end_at"] = _compute_expected_end(now, hours_val)
        return get_maintenance_state()

    # Disable immediate maintenance for all clients.
    _apply_scope_flags(active_scope, active=False)

    if update_schedule:
        start = _parse_iso_utc(scheduled_start_at)
        end = _parse_iso_utc(scheduled_end_at)
        now = datetime.now(timezone.utc)
        if start and start > now:
            _state["scheduled_start_at"] = _to_iso_z(start)
            _state["scope"] = active_scope
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
