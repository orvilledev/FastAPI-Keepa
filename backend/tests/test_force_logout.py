"""Force-logout cutoff: old tokens are rejected, the triggering superadmin is not."""
from app.force_logout import token_was_force_logged_out


def test_token_issued_before_cutoff_is_revoked():
    state = {"forced_at": 1_700_000_000, "exempt_user_id": "admin-1"}
    assert token_was_force_logged_out("user-2", 1_699_999_000, state) is True
    assert token_was_force_logged_out("user-2", 1_700_000_000, state) is True


def test_token_issued_after_cutoff_stays_valid():
    state = {"forced_at": 1_700_000_000, "exempt_user_id": "admin-1"}
    assert token_was_force_logged_out("user-2", 1_700_000_001, state) is False


def test_triggering_superadmin_is_exempt():
    state = {"forced_at": 1_700_000_000, "exempt_user_id": "admin-1"}
    assert token_was_force_logged_out("admin-1", 1_600_000_000, state) is False


def test_no_cutoff_leaves_tokens_alone():
    assert token_was_force_logged_out("user-2", 1, {"forced_at": None, "exempt_user_id": None}) is False
