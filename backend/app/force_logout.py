"""Superadmin force-logout cutoff.

Access tokens stay valid until they expire, even after refresh tokens are
revoked. This cutoff makes the API reject tokens issued at or before the
click. The superadmin who triggered it is exempt.
"""
from __future__ import annotations

import json
import logging
import threading
import time
from pathlib import Path

logger = logging.getLogger(__name__)

SIGNED_OUT_BY_ADMIN_DETAIL = "You were signed out by an administrator."

_STATE_PATH = Path(__file__).resolve().parents[1] / ".force_logout_state.json"
_lock = threading.Lock()
_state: dict = {"forced_at": None, "exempt_user_id": None}
_loaded = False
_mtime: float | None = None


def _read_state_file() -> dict:
    try:
        data = json.loads(_STATE_PATH.read_text(encoding="utf-8"))
    except Exception as exc:
        logger.warning("Could not read force-logout state: %s", exc)
        return {"forced_at": None, "exempt_user_id": None}
    forced_at = data.get("forced_at")
    exempt = data.get("exempt_user_id")
    return {
        "forced_at": int(forced_at) if isinstance(forced_at, (int, float)) else None,
        "exempt_user_id": str(exempt) if exempt else None,
    }


def _load_locked() -> None:
    global _loaded, _mtime, _state
    try:
        mtime = _STATE_PATH.stat().st_mtime if _STATE_PATH.exists() else None
    except OSError:
        mtime = None
    if _loaded and mtime == _mtime:
        return
    _loaded = True
    _mtime = mtime
    if mtime is None:
        return
    _state = _read_state_file()


def get_force_logout_state() -> dict:
    """Return ``forced_at`` (unix seconds) and ``exempt_user_id``."""
    with _lock:
        _load_locked()
        return {"forced_at": _state.get("forced_at"), "exempt_user_id": _state.get("exempt_user_id")}


def set_force_logout(exempt_user_id: str, forced_at: int | None = None) -> dict:
    """Mark every token issued at or before ``forced_at`` as signed out, except one user."""
    global _loaded, _mtime, _state
    stamp = int(time.time()) if forced_at is None else int(forced_at)
    payload = {"forced_at": stamp, "exempt_user_id": str(exempt_user_id)}
    with _lock:
        _state = payload
        _STATE_PATH.write_text(json.dumps(payload), encoding="utf-8")
        _mtime = _STATE_PATH.stat().st_mtime
        _loaded = True
    return dict(payload)


def token_was_force_logged_out(user_id: str | None, issued_at: int | None, state: dict | None = None) -> bool:
    """True when this access token was issued before the latest force logout."""
    current = state if state is not None else get_force_logout_state()
    forced_at = current.get("forced_at")
    if not isinstance(forced_at, int) or issued_at is None:
        return False
    if user_id and user_id == current.get("exempt_user_id"):
        return False
    return int(issued_at) <= forced_at
