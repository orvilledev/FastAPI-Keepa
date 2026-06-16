"""Tests for MFA-exempt full app access grants."""
import pytest
from unittest.mock import MagicMock, patch

from app.dependencies import (
    MFA_EXEMPT_ACCESS_GRANTS,
    ensure_mfa_exempt_profile_access,
    is_mfa_exempt_user,
)


class TestMfaExemptProfileAccess:
    @pytest.mark.unit
    @patch("app.dependencies.settings")
    def test_ensure_mfa_exempt_upgrades_missing_flags(self, mock_settings):
        mock_settings.mfa_exempt_emails_list = ["warehouse1@metroshoewarehouse.com"]
        user = {"id": "user-1", "email": "warehouse1@metroshoewarehouse.com"}
        profile = {
            "id": "user-1",
            "email": "warehouse1@metroshoewarehouse.com",
            "is_active": False,
            "has_keepa_access": False,
            "can_run_jobs": False,
        }

        db = MagicMock()
        updated_row = {**profile, **MFA_EXEMPT_ACCESS_GRANTS, "updated_at": "now"}
        db.table.return_value.update.return_value.eq.return_value.execute.return_value = MagicMock(
            data=[updated_row]
        )

        result = ensure_mfa_exempt_profile_access(db, user, profile)

        assert result["has_keepa_access"] is True
        assert result["is_active"] is True
        assert result["can_run_jobs"] is True
        db.table.return_value.update.assert_called_once()

    @pytest.mark.unit
    @patch("app.dependencies.settings")
    def test_ensure_mfa_exempt_noop_for_normal_user(self, mock_settings):
        mock_settings.mfa_exempt_emails_list = ["warehouse1@metroshoewarehouse.com"]
        user = {"id": "user-2", "email": "other@example.com"}
        profile = {"id": "user-2", "has_keepa_access": False}

        db = MagicMock()
        result = ensure_mfa_exempt_profile_access(db, user, profile)

        assert result is profile
        db.table.assert_not_called()

    @pytest.mark.unit
    @patch("app.dependencies.settings")
    def test_is_mfa_exempt_user(self, mock_settings):
        mock_settings.mfa_exempt_emails_list = ["warehouse1@metroshoewarehouse.com"]
        assert is_mfa_exempt_user({"email": "Warehouse1@MetroShoeWarehouse.com"}) is True
        assert is_mfa_exempt_user({"email": "other@example.com"}) is False
