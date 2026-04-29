"""Runtime maintenance mode state."""
from app.config import settings

_state = {
    "maintenance_mode": bool(settings.maintenance_mode),
    "message": settings.maintenance_message,
}


def get_maintenance_state() -> dict:
    """Return current maintenance runtime state."""
    return {
        "maintenance_mode": bool(_state.get("maintenance_mode", False)),
        "message": str(_state.get("message") or settings.maintenance_message),
    }


def set_maintenance_state(maintenance_mode: bool, message: str | None = None) -> dict:
    """Update runtime maintenance state for this backend process."""
    _state["maintenance_mode"] = bool(maintenance_mode)
    if message is not None:
        cleaned = str(message).strip()
        _state["message"] = cleaned or settings.maintenance_message
    return get_maintenance_state()
