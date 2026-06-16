"""Tests for MFA-exempt account handling."""
import pytest
from unittest.mock import patch

from app.dependencies import is_mfa_exempt_user


class TestMfaExemptUser:
    @pytest.mark.unit
    @patch("app.dependencies.settings")
    def test_exempt_email_matches_case_insensitively(self, mock_settings):
        mock_settings.mfa_exempt_emails_list = ["warehouse1@metroshoewarehouse.com"]
        user = {"email": "Warehouse1@MetroShoeWarehouse.com"}
        assert is_mfa_exempt_user(user) is True

    @pytest.mark.unit
    @patch("app.dependencies.settings")
    def test_non_exempt_email(self, mock_settings):
        mock_settings.mfa_exempt_emails_list = ["warehouse1@metroshoewarehouse.com"]
        user = {"email": "other@example.com"}
        assert is_mfa_exempt_user(user) is False
