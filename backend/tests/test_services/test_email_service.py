"""Tests for EmailService class."""

import pytest
from unittest.mock import patch, MagicMock
from app.services.email_service import EmailService


class TestEmailService:
    """Unit tests for EmailService."""

    @pytest.mark.unit
    @patch("app.services.email_service.smtplib.SMTP")
    def test_send_email_success(self, mock_smtp):
        """Test that EmailService can send emails successfully."""
        # Setup mock SMTP server
        mock_server = MagicMock()
        mock_smtp.return_value.__enter__.return_value = mock_server

        service = EmailService()

        # Call the method
        result = service.send_email(
            to_email="test@example.com",
            subject="Test Email",
            body="Test body content"
        )

        # Assertions
        assert result is True
        mock_server.starttls.assert_called_once()
        mock_server.login.assert_called_once_with(service.email_from, service.email_password)
        mock_server.send_message.assert_called_once()

    @pytest.mark.unit
    @patch("app.services.email_service.smtplib.SMTP")
    def test_send_email_handles_errors(self, mock_smtp):
        """Test that EmailService handles SMTP errors gracefully."""
        # Setup mock to raise an exception on connection
        mock_smtp.side_effect = Exception("SMTP connection failed")

        service = EmailService()

        # Call the method and expect False on exception
        result = service.send_email(
            to_email="test@example.com",
            subject="Test Email",
            body="Test body content"
        )

        # Assertions
        assert result is False
