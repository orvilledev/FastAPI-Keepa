"""Superadmin force-reload signal for open browsers.

Open clients poll the public status and reload when ``forced_at`` is newer
than when that tab booted. The superadmin who clicked is exempt.
"""
from __future__ import annotations

import json
import logging
import threading
import time
from pathlib import Path

logger = logging.getLogger(__name__)

_STATE_PATH = Path(__file__).resolve().parents[1] / ".force_reload_state.json"
_lock = threading.Lock()
_state: dict = {"forced_at": None, "exempt_user_id": None}
_loaded = False
_mtime: float | None = None


def _read_state_file() -> dict:
    try:
        data = json.loads(_STATE_PATH.read_text(encoding="utf-8"))
    except Exception as exc:
        logger.warning("Could not read force-reload state: %s", exc)
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


def get_force_reload_state() -> dict:
    """Return ``forced_at`` (unix seconds) and ``exempt_user_id``."""
    with _lock:
        _load_locked()
        return {"forced_at": _state.get("forced_at"), "exempt_user_id": _state.get("exempt_user_id")}


def set_force_reload(exempt_user_id: str, forced_at: int | None = None) -> dict:
    """Ask every open client to reload, except the triggering superadmin."""
    global _loaded, _mtime, _state
    stamp = int(time.time()) if forced_at is None else int(forced_at)
    payload = {"forced_at": stamp, "exempt_user_id": str(exempt_user_id)}
    with _lock:
        _state = payload
        _STATE_PATH.write_text(json.dumps(payload), encoding="utf-8")
        _mtime = _STATE_PATH.stat().st_mtime
        _loaded = True
    return dict(payload)


def client_should_force_reload(
    user_id: str | None,
    page_boot_at: int | None,
    state: dict | None = None,
) -> bool:
    """True when this tab booted before the latest force-reload click."""
    current = state if state is not None else get_force_reload_state()
    forced_at = current.get("forced_at")
    if not isinstance(forced_at, int) or page_boot_at is None:
        return False
    if user_id and user_id == current.get("exempt_user_id"):
        return False
    return int(page_boot_at) <= forced_at
