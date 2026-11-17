"""Force-reload signal: open tabs reload; the triggering superadmin does not."""
from app.force_reload import client_should_force_reload


def test_tab_booted_before_cutoff_reloads():
    state = {"forced_at": 1_700_000_000, "exempt_user_id": "admin-1"}
    assert client_should_force_reload("user-2", 1_699_999_000, state) is True
    assert client_should_force_reload("user-2", 1_700_000_000, state) is True


def test_tab_booted_after_cutoff_stays():
    state = {"forced_at": 1_700_000_000, "exempt_user_id": "admin-1"}
    assert client_should_force_reload("user-2", 1_700_000_001, state) is False


def test_triggering_superadmin_is_exempt():
    state = {"forced_at": 1_700_000_000, "exempt_user_id": "admin-1"}
    assert client_should_force_reload("admin-1", 1_600_000_000, state) is False


def test_no_cutoff_leaves_tabs_alone():
    assert client_should_force_reload("user-2", 1, {"forced_at": None, "exempt_user_id": None}) is False
