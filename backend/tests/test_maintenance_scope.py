"""Client-scoped maintenance (web / electron / both)."""
from datetime import datetime, timedelta, timezone

import app.maintenance as maintenance


def _reset_state(**overrides):
    maintenance._state.clear()
    maintenance._state.update(
        {
            "maintenance_web": False,
            "maintenance_electron": False,
            "scope": "both",
            "message": "Under maintenance",
            "duration_hours": None,
            "expected_end_at": None,
            "scheduled_start_at": None,
            "schedule_timezone": "America/Chicago",
        }
    )
    maintenance._state.update(overrides)


def test_enable_web_only_blocks_web_not_electron():
    _reset_state()
    state = maintenance.set_maintenance_state(True, scope="web")
    assert state["maintenance_mode"] is True
    assert state["maintenance_web"] is True
    assert state["maintenance_electron"] is False
    assert state["scope"] == "web"
    assert maintenance.is_maintenance_active_for_client("web") is True
    assert maintenance.is_maintenance_active_for_client("electron") is False
    assert maintenance.get_maintenance_state(for_client="web")["maintenance_mode"] is True
    assert maintenance.get_maintenance_state(for_client="electron")["maintenance_mode"] is False


def test_enable_electron_only_blocks_electron_not_web():
    _reset_state()
    state = maintenance.set_maintenance_state(True, scope="electron")
    assert state["scope"] == "electron"
    assert maintenance.is_maintenance_active_for_client("electron") is True
    assert maintenance.is_maintenance_active_for_client("web") is False


def test_enable_both_blocks_all_clients():
    _reset_state()
    state = maintenance.set_maintenance_state(True, scope="both")
    assert state["maintenance_web"] is True
    assert state["maintenance_electron"] is True
    assert maintenance.is_maintenance_active_for_client("web") is True
    assert maintenance.is_maintenance_active_for_client("electron") is True


def test_disable_clears_flags_but_keeps_scope_preference():
    _reset_state()
    maintenance.set_maintenance_state(True, scope="electron")
    state = maintenance.set_maintenance_state(False, scope="electron")
    assert state["maintenance_mode"] is False
    assert state["maintenance_web"] is False
    assert state["maintenance_electron"] is False
    assert state["scope"] == "electron"


def test_schedule_hides_from_unaffected_client():
    _reset_state()
    start = datetime.now(timezone.utc) + timedelta(hours=2)
    end = start + timedelta(hours=1)
    maintenance.set_maintenance_state(
        False,
        scope="electron",
        scheduled_start_at=start.isoformat().replace("+00:00", "Z"),
        scheduled_end_at=end.isoformat().replace("+00:00", "Z"),
        update_schedule=True,
    )
    web_view = maintenance.get_maintenance_state(for_client="web")
    electron_view = maintenance.get_maintenance_state(for_client="electron")
    assert web_view["scheduled_start_at"] is None
    assert web_view["maintenance_mode"] is False
    assert electron_view["scheduled_start_at"] is not None
    assert electron_view["scope"] == "electron"


def test_scheduled_activation_applies_scope():
    _reset_state(
        scope="web",
        scheduled_start_at=(datetime.now(timezone.utc) - timedelta(minutes=1))
        .isoformat()
        .replace("+00:00", "Z"),
        duration_hours=1.0,
    )
    state = maintenance.get_maintenance_state()
    assert state["maintenance_web"] is True
    assert state["maintenance_electron"] is False
    assert state["scheduled_start_at"] is None
    assert maintenance.is_maintenance_active_for_client("web") is True
    assert maintenance.is_maintenance_active_for_client("electron") is False
