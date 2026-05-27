"""Tests for EmailService class."""

import pytest
from unittest.mock import patch, MagicMock
from app.services.email_service import EmailService, _render_email_template


def _extract_subject_and_body(send_message_call) -> tuple[str, str]:
    """Pull the Subject header and plain-text body from a captured MIME message."""
    args, _ = send_message_call.call_args
    msg = args[0]
    subject = msg["Subject"]
    body_part = next(
        (
            part
            for part in msg.walk()
            if part.get_content_type() == "text/plain"
        ),
        None,
    )
    body = body_part.get_payload(decode=True).decode("utf-8") if body_part else ""
    return subject, body


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
        mock_server.login.assert_called_once_with(service._bare_from_address(), service.email_password)
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


class TestEmailTemplateRendering:
    """Unit tests for the email template helper and per-vendor wording."""

    @pytest.mark.unit
    def test_render_returns_none_for_blank_template(self):
        assert _render_email_template(None, {}) is None
        assert _render_email_template("", {}) is None
        assert _render_email_template("   \n\t", {}) is None

    @pytest.mark.unit
    def test_render_substitutes_known_tokens(self):
        result = _render_email_template(
            "Hi {vendor}, job={job_name}, total={total_upcs}",
            {"vendor": "DNK", "job_name": "Daily DNK", "total_upcs": 42},
        )
        assert result == "Hi DNK, job=Daily DNK, total=42"

    @pytest.mark.unit
    def test_render_leaves_unknown_tokens_as_is(self):
        result = _render_email_template(
            "Hello {nope} and {vendor}",
            {"vendor": "DNK"},
        )
        assert result == "Hello {nope} and DNK"

    @pytest.mark.unit
    def test_render_preserves_freeform_text_without_placeholders(self):
        body = "Team,\n\nPlease review.\nThanks"
        assert _render_email_template(body, {"vendor": "DNK"}) == body

    @pytest.mark.unit
    @patch("app.services.email_service.smtplib.SMTP")
    def test_send_csv_report_falls_back_to_default_when_no_templates(self, mock_smtp):
        """Without templates, the default subject/body must be used."""
        mock_server = MagicMock()
        mock_smtp.return_value.__enter__.return_value = mock_server

        service = EmailService()
        # Force a known recipient regardless of env config
        service.email_to = "recipient@example.com"

        result = service.send_csv_report(
            csv_bytes=b"col1,col2\n1,2\n",
            filename="report.csv",
            job_name="Daily DNK Off Price Report - 2026-05-27",
            total_upcs=10,
            alerts_count=3,
        )
        assert result is True

        subject, body = _extract_subject_and_body(mock_server.send_message)
        assert subject == "Keepa Off Price Report - Daily DNK Off Price Report - 2026-05-27"
        assert "Your Keepa Off Price report has been generated." in body
        assert "Total UPCs Processed: 10" in body

    @pytest.mark.unit
    @patch("app.services.email_service.smtplib.SMTP")
    def test_send_csv_report_uses_custom_subject_only(self, mock_smtp):
        """Custom subject overrides default, body stays default."""
        mock_server = MagicMock()
        mock_smtp.return_value.__enter__.return_value = mock_server

        service = EmailService()
        service.email_to = "recipient@example.com"

        service.send_csv_report(
            csv_bytes=b"x",
            filename="r.csv",
            job_name="Daily DNK",
            total_upcs=10,
            alerts_count=3,
            vendor="dnk",
            email_subject_template="{vendor} report - {run_date}",
            email_body_template=None,
        )
        subject, body = _extract_subject_and_body(mock_server.send_message)
        assert subject.startswith("DNK report - ")
        # default body still applied
        assert "Your Keepa Off Price report has been generated." in body

    @pytest.mark.unit
    @patch("app.services.email_service.smtplib.SMTP")
    def test_send_csv_report_uses_custom_body_only(self, mock_smtp):
        """Custom body overrides default, subject stays default."""
        mock_server = MagicMock()
        mock_smtp.return_value.__enter__.return_value = mock_server

        service = EmailService()
        service.email_to = "recipient@example.com"

        service.send_csv_report(
            csv_bytes=b"x",
            filename="r.csv",
            job_name="Daily CLK",
            total_upcs=99,
            alerts_count=7,
            vendor="clk",
            email_subject_template=None,
            email_body_template="Team,\n\nPlease see attached.",
        )
        subject, body = _extract_subject_and_body(mock_server.send_message)
        # default subject still applied
        assert subject == "Keepa Off Price Report - Daily CLK"
        assert body == "Team,\n\nPlease see attached."

    @pytest.mark.unit
    @patch("app.services.email_service.smtplib.SMTP")
    def test_send_csv_report_uses_both_custom_templates(self, mock_smtp):
        """Both custom subject and body are rendered with placeholders."""
        mock_server = MagicMock()
        mock_smtp.return_value.__enter__.return_value = mock_server

        service = EmailService()
        service.email_to = "recipient@example.com"

        service.send_csv_report(
            csv_bytes=b"x",
            filename="r.csv",
            job_name="Daily OBZ",
            total_upcs=120,
            alerts_count=5,
            vendor="obz",
            email_subject_template="{vendor} - {job_name}",
            email_body_template=(
                "Hello,\n"
                "Vendor: {vendor}\n"
                "Alerts: {alerts_count}/{total_upcs}\n"
                "Unknown left as-is: {nope}\n"
            ),
        )
        subject, body = _extract_subject_and_body(mock_server.send_message)
        assert subject == "OBZ - Daily OBZ"
        assert "Vendor: OBZ" in body
        assert "Alerts: 5/120" in body
        assert "{nope}" in body  # unknown token preserved

    @pytest.mark.unit
    @patch("app.services.email_service.smtplib.SMTP")
    def test_send_csv_report_blank_templates_fall_back_to_defaults(self, mock_smtp):
        """Empty/whitespace template strings must behave like None (use default)."""
        mock_server = MagicMock()
        mock_smtp.return_value.__enter__.return_value = mock_server

        service = EmailService()
        service.email_to = "recipient@example.com"

        service.send_csv_report(
            csv_bytes=b"x",
            filename="r.csv",
            job_name="Daily DNK",
            total_upcs=1,
            alerts_count=0,
            vendor="dnk",
            email_subject_template="   ",
            email_body_template="\n\n\t",
        )
        subject, body = _extract_subject_and_body(mock_server.send_message)
        assert subject == "Keepa Off Price Report - Daily DNK"
        assert "Your Keepa Off Price report has been generated." in body
