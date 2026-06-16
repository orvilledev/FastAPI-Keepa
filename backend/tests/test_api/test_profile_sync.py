"""Tests for syncing profiles from Supabase Auth users."""
import pytest
from unittest.mock import MagicMock, patch

from app.api.auth import _sync_missing_profiles_from_auth


class TestSyncMissingProfilesFromAuth:
    @pytest.mark.unit
    def test_creates_profile_for_auth_user_without_row(self):
        db = MagicMock()
        db.table.return_value.select.return_value.execute.return_value = MagicMock(data=[])

        auth_user = MagicMock()
        auth_user.id = "auth-user-1"
        auth_user.email = "warehouse1@metroshoewarehouse.com"
        db.auth.admin.list_users.return_value = [auth_user]

        insert_execute = MagicMock(
            data=[{"id": "auth-user-1", "email": "warehouse1@metroshoewarehouse.com"}]
        )
        db.table.return_value.insert.return_value.execute.return_value = insert_execute

        created = _sync_missing_profiles_from_auth(db)

        assert created == 1
        db.table.return_value.insert.assert_called_once()
        payload = db.table.return_value.insert.call_args[0][0]
        assert payload["email"] == "warehouse1@metroshoewarehouse.com"
        assert payload["is_active"] is False

    @pytest.mark.unit
    def test_skips_users_that_already_have_profiles(self):
        db = MagicMock()
        db.table.return_value.select.return_value.execute.return_value = MagicMock(
            data=[{"id": "auth-user-1"}]
        )

        auth_user = MagicMock()
        auth_user.id = "auth-user-1"
        auth_user.email = "warehouse1@metroshoewarehouse.com"
        db.auth.admin.list_users.return_value = [auth_user]

        created = _sync_missing_profiles_from_auth(db)

        assert created == 0
        db.table.return_value.insert.assert_not_called()
