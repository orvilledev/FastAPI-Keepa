"""Tests for EmailService class."""

import pytest
import re
from datetime import datetime
from unittest.mock import patch, MagicMock
from app.services.email_service import (
    EmailService,
    EMAIL_DISCLAIMER,
    EMAIL_PREHEADER,
    EMAIL_WEBSITE,
    _build_html_body,
    _format_long_date,
    _format_mdyy_date,
    _render_email_template,
    _resolve_email_datetime,
)
from app.services.csv_generator import CSVGenerator


@pytest.fixture(autouse=True)
def default_smtp_transport(request):
    """Most email tests expect SMTP unless they patch Graph explicitly."""
    if request.node.get_closest_marker("graph_email"):
        yield
        return
    with patch("app.services.email_service.get_resolved_transport", return_value="smtp"):
        yield


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


def _extract_html_body(send_message_call) -> str:
    args, _ = send_message_call.call_args
    msg = args[0]
    html_part = next(
        (
            part
            for part in msg.walk()
            if part.get_content_type() == "text/html"
        ),
        None,
    )
    return html_part.get_payload(decode=True).decode("utf-8") if html_part else ""


def _extract_attachment_filename(send_message_call) -> str:
    args, _ = send_message_call.call_args
    msg = args[0]
    for part in msg.walk():
        disposition = part.get("Content-Disposition") or ""
        if "attachment" in disposition.lower():
            return part.get_filename() or ""
    return ""


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
        """Without templates, the branded MAP default subject/body/preheader must be used."""
        mock_server = MagicMock()
        mock_smtp.return_value.__enter__.return_value = mock_server

        service = EmailService()
        # Force a known recipient regardless of env config
        service.email_to = "recipient@example.com"
        service.email_from_name = "MSW Overwatch"

        result = service.send_csv_report(
            csv_bytes=b"col1,col2\n1,2\n",
            filename="MSW_Overwatch_MAP_Report_2026-05-27.xlsx",
            job_name="Daily DNK Off Price Report - 2026-05-27",
            total_upcs=10,
            alerts_count=3,
        )
        assert result is True

        subject, body = _extract_subject_and_body(mock_server.send_message)
        assert subject == "MSW Overwatch | MAP Pricing Exceptions — May 27, 2026"
        assert "Hello Dansko," in body
        assert "today's MAP Pricing review for Dansko." in body
        assert "• 3 — MAP Pricing Exceptions" in body
        assert "• May 27, 2026 — Report Date" in body
        assert "• Dansko — Brand" in body
        assert "overwatch@metroshoewarehouse.com" in body
        assert EMAIL_WEBSITE in body
        assert EMAIL_DISCLAIMER in body
        assert body.strip().endswith(EMAIL_DISCLAIMER)

        html = _extract_html_body(mock_server.send_message)
        assert EMAIL_PREHEADER in html
        assert "<strong>3</strong> — MAP Pricing Exceptions" in html
        assert "<strong>May 27, 2026</strong> — Report Date" in html
        assert "<strong>Dansko</strong> — Brand" in html
        assert "<li" in html and "</ul>" in html
        assert EMAIL_DISCLAIMER in html
        assert _extract_attachment_filename(mock_server.send_message) == (
            "MSW_Overwatch_MAP_Report_2026-05-27.xlsx"
        )
        args, _ = mock_server.send_message.call_args
        assert "MSW Overwatch" in args[0]["From"]

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
        assert "Hello Dansko," in body
        assert "• 3 — MAP Pricing Exceptions" in body

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
            job_name="Daily CLK Off Price Report - 2026-08-27",
            total_upcs=99,
            alerts_count=7,
            vendor="clk",
            email_subject_template=None,
            email_body_template="Team,\n\nPlease see attached.",
        )
        subject, body = _extract_subject_and_body(mock_server.send_message)
        # default subject still applied (branded MAP line with run date from job name)
        assert subject == "MSW Overwatch | MAP Pricing Exceptions — August 27, 2026"
        assert body == "Team,\n\nPlease see attached."
        assert EMAIL_PREHEADER in _extract_html_body(mock_server.send_message)

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
            job_name="Daily DNK Off Price Report - 2026-08-27",
            total_upcs=1,
            alerts_count=0,
            vendor="dnk",
            email_subject_template="   ",
            email_body_template="\n\n\t",
        )
        subject, body = _extract_subject_and_body(mock_server.send_message)
        assert subject == "MSW Overwatch | MAP Pricing Exceptions — August 27, 2026"
        assert "Hello Dansko," in body
        assert "• 0 — MAP Pricing Exceptions" in body
        assert "• Dansko — Brand" in body
        assert EMAIL_WEBSITE in body
        assert EMAIL_DISCLAIMER in body

    @pytest.mark.unit
    def test_format_mdyy_date_shape(self):
        """Date helper emits M.D.YY with no leading zeros for month/day."""
        text = _format_mdyy_date()
        assert re.fullmatch(r"\d{1,2}\.\d{1,2}\.\d{2}", text)

    @pytest.mark.unit
    def test_format_long_date_and_resolve_from_job_name(self):
        dt = _resolve_email_datetime("Daily SFF Off Price Report - 2026-08-27")
        assert _format_long_date(dt) == "August 27, 2026"
        assert _format_long_date(datetime(2026, 1, 5)) == "January 5, 2026"

    @pytest.mark.unit
    def test_map_report_filename_format(self):
        assert (
            CSVGenerator.generate_csv_filename(
                "Daily TEV Off Price Report - 2026-08-27", extension="xlsx"
            )
            == "MSW_Overwatch_MAP_Report_2026-08-27.xlsx"
        )

    @pytest.mark.unit
    def test_brand_name_for_vendor(self):
        from app.services.email_service import _brand_name_for_vendor

        assert _brand_name_for_vendor("dnk") == "Dansko"
        assert _brand_name_for_vendor("CLK") == "Clarks"
        assert _brand_name_for_vendor("jfs") == "Josef Siebel"

    @pytest.mark.unit
    def test_build_html_body_includes_preheader(self):
        html = _build_html_body("Hello\nWorld")
        assert EMAIL_PREHEADER in html
        assert "Hello<br>" in html
        assert "World<br>" in html

    @pytest.mark.unit
    def test_build_html_body_bolds_bullet_lines(self):
        html = _build_html_body(
            "Today's Report\n"
            "• 133 — MAP Pricing Exceptions\n"
            "• August 27, 2026 — Report Date\n"
            "• Chaco — Brand\n"
            "\n"
            f"{EMAIL_DISCLAIMER}"
        )
        assert "Today's Report" in html
        assert "text-transform:uppercase" in html
        assert "<strong>133</strong> — MAP Pricing Exceptions" in html
        assert "<strong>August 27, 2026</strong> — Report Date" in html
        assert "<strong>Chaco</strong> — Brand" in html
        assert html.count("<li") == 3
        assert EMAIL_DISCLAIMER in html
        assert "color:#666" in html

    @pytest.mark.unit
    @patch("app.services.email_service.smtplib.SMTP")
    def test_send_csv_report_skips_when_no_recipients_and_no_default(self, mock_smtp):
        service = EmailService()
        service.email_to = "default@example.com"

        result = service.send_csv_report(
            csv_bytes=b"x",
            filename="r.csv",
            job_name="Daily DNK Off Price Report - 2026-05-27",
            total_upcs=1,
            alerts_count=0,
            recipient_email=None,
            use_default_recipients=False,
        )

        assert result is False
        mock_smtp.assert_not_called()

    @pytest.mark.unit
    @patch("app.services.email_service.smtplib.SMTP")
    def test_send_csv_report_uses_bcc_header_for_marked_addresses(self, mock_smtp):
        mock_server = MagicMock()
        mock_smtp.return_value.__enter__.return_value = mock_server

        service = EmailService()
        service.email_to = "fallback@example.com"

        result = service.send_csv_report(
            csv_bytes=b"x",
            filename="r.csv",
            job_name="Daily DNK Off Price Report - 2026-05-27",
            total_upcs=1,
            alerts_count=0,
            recipient_email="visible@example.com, hidden@example.com",
            bcc_emails=["hidden@example.com"],
            use_default_recipients=False,
        )

        assert result is True
        args, _ = mock_server.send_message.call_args
        msg = args[0]
        assert msg["To"] == "visible@example.com"
        assert msg["Bcc"] == "hidden@example.com"
        assert mock_server.send_message.call_args.kwargs["to_addrs"] == [
            "visible@example.com",
            "hidden@example.com",
        ]

    @pytest.mark.unit
    @patch("app.services.email_service.smtplib.SMTP")
    def test_send_csv_report_bcc_addresses_not_in_to_list(self, mock_smtp):
        mock_server = MagicMock()
        mock_smtp.return_value.__enter__.return_value = mock_server

        service = EmailService()
        service.email_to = "fallback@example.com"

        result = service.send_csv_report(
            csv_bytes=b"x",
            filename="r.csv",
            job_name="Daily SFF Uploaded Report - 2026-06-05",
            total_upcs=1,
            alerts_count=0,
            recipient_email="primary@example.com",
            bcc_emails=[
                "bcc1@example.com",
                "bcc2@example.com",
            ],
            use_default_recipients=False,
        )

        assert result is True
        args, _ = mock_server.send_message.call_args
        msg = args[0]
        assert msg["To"] == "primary@example.com"
        assert msg["Bcc"] == "bcc1@example.com, bcc2@example.com"
        assert mock_server.send_message.call_args.kwargs["to_addrs"] == [
            "primary@example.com",
            "bcc1@example.com",
            "bcc2@example.com",
        ]

    @pytest.mark.unit
    @pytest.mark.graph_email
    @patch("app.services.email_service.GraphMailClient")
    @patch("app.services.email_service.settings")
    def test_send_csv_report_via_graph(self, mock_settings, mock_graph_cls):
        mock_settings.graph_email_configured = True
        mock_settings.azure_tenant_id = "tenant"
        mock_settings.azure_client_id = "client"
        mock_settings.azure_client_secret = "secret"
        mock_settings.effective_email_transport = "graph"

        mock_graph = MagicMock()
        mock_graph_cls.return_value = mock_graph

        service = EmailService()
        service.email_transport = "graph"
        service.email_password = ""

        result = service.send_csv_report(
            csv_bytes=b"xlsx-bytes",
            filename="MSW_Overwatch_MAP_Report_2026-06-05.xlsx",
            job_name="Daily DNK Uploaded Report - 2026-06-05",
            total_upcs=10,
            alerts_count=3,
            recipient_email="vendor@example.com",
            use_default_recipients=False,
        )

        assert result is True
        mock_graph.send_message.assert_called_once()
        kwargs = mock_graph.send_message.call_args.kwargs
        assert kwargs["to_recipients"] == ["vendor@example.com"]
        assert kwargs["attachments"][0][0] == "MSW_Overwatch_MAP_Report_2026-06-05.xlsx"
        assert "MSW Overwatch | MAP Pricing Exceptions" in kwargs["subject"]
