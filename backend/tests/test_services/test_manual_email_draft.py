"""Tests for the manual-send email draft builder."""

from unittest.mock import MagicMock, patch
from urllib.parse import parse_qs, urlparse

import pytest

from app.services.email_service import build_report_email_content
from app.services.manual_email_draft import build_manual_email_draft

JOB_ID = "11111111-2222-3333-4444-555555555555"


def _make_db(settings_row=None):
    """Supabase double supporting the `table().select().eq().limit().execute()` chain."""
    db = MagicMock()
    db.table.return_value = db
    db.select.return_value = db
    db.eq.return_value = db
    db.limit.return_value = db
    db.execute.return_value = MagicMock(data=[settings_row] if settings_row else [])
    return db


def _make_job(**overrides):
    job = {
        "id": JOB_ID,
        "job_name": "Daily SFF Uploaded Report - 2026-09-04",
        "status": "completed",
        "map_vendor_type": "sff",
        "off_price_scope": "buybox_and_non_buybox_below_map",
        "email_recipients": "vendor@example.com, ops@example.com",
        "email_bcc_recipients": "audit@example.com",
    }
    job.update(overrides)
    return job


@pytest.fixture
def patched_services():
    """Stub report generation and the mailer's From address."""
    with patch("app.services.manual_email_draft.ReportService") as report_cls, patch(
        "app.services.manual_email_draft.EmailService"
    ) as email_cls:
        report = report_cls.return_value
        report.generate_csv_for_job.return_value = (
            b"xlsx-bytes",
            "MSW_Overwatch_MAP_Report_2026-09-04.xlsx",
            133,
        )
        report.get_total_upcs_for_job.return_value = 670

        mailer = email_cls.return_value
        mailer._bare_from_address.return_value = "overwatch@metroshoewarehouse.com"
        mailer.email_from_name = "MSW Overwatch"

        yield report, mailer


class TestManualEmailDraft:
    @pytest.mark.unit
    def test_draft_matches_daily_run_subject_and_body(self, patched_services):
        draft = build_manual_email_draft(_make_db(), _make_job())

        expected = build_report_email_content(
            job_name="Daily SFF Uploaded Report - 2026-09-04",
            total_upcs=670,
            alerts_count=133,
            vendor="sff",
        )
        assert draft["subject"] == expected.subject
        assert draft["body"] == expected.body

    @pytest.mark.unit
    def test_draft_fills_date_vendor_and_off_price_count(self, patched_services):
        draft = build_manual_email_draft(_make_db(), _make_job())

        assert draft["subject"] == "MSW Overwatch | MAP Pricing Exceptions — September 4, 2026"
        assert draft["report_date"] == "2026-09-04"
        assert draft["report_date_long"] == "September 4, 2026"
        assert draft["vendor"] == "SFF"
        assert draft["off_price_count"] == 133
        assert draft["total_upcs"] == 670
        assert "• 133 — MAP Pricing Exceptions" in draft["body"]
        assert "• September 4, 2026 — Report Date" in draft["body"]
        assert f"• {draft['brand']} — Brand" in draft["body"]
        assert draft["attachment_filename"] == "MSW_Overwatch_MAP_Report_2026-09-04.xlsx"

    @pytest.mark.unit
    def test_report_is_generated_with_the_job_vendor_and_scope(self, patched_services):
        report, _ = patched_services
        build_manual_email_draft(_make_db(), _make_job())

        kwargs = report.generate_csv_for_job.call_args.kwargs
        assert kwargs["map_vendor_type"] == "sff"
        assert kwargs["off_price_scope"] == "buybox_and_non_buybox_below_map"

    @pytest.mark.unit
    def test_uses_job_recipients_and_keeps_bcc_out_of_to(self, patched_services):
        draft = build_manual_email_draft(
            _make_db(),
            _make_job(email_recipients="vendor@example.com, audit@example.com"),
        )

        assert draft["to"] == ["vendor@example.com"]
        assert draft["bcc"] == ["audit@example.com"]
        assert draft["recipients_source"] == "job"

    @pytest.mark.unit
    def test_falls_back_to_scheduler_settings_recipients(self, patched_services):
        db = _make_db(
            {
                "category": "sff",
                "email_recipients": "fallback@example.com",
                "email_bcc_recipients": None,
                "email_subject_template": None,
                "email_body_template": None,
            }
        )
        draft = build_manual_email_draft(
            db, _make_job(email_recipients=None, email_bcc_recipients=None)
        )

        assert draft["to"] == ["fallback@example.com"]
        assert draft["recipients_source"] == "scheduler_settings"

    @pytest.mark.unit
    def test_reports_missing_recipients(self, patched_services):
        draft = build_manual_email_draft(
            _make_db(), _make_job(email_recipients=None, email_bcc_recipients=None)
        )

        assert draft["to"] == []
        assert draft["bcc"] == []
        assert draft["recipients_source"] == "none"

    @pytest.mark.unit
    def test_applies_vendor_custom_templates(self, patched_services):
        db = _make_db(
            {
                "category": "sff",
                "email_recipients": None,
                "email_bcc_recipients": None,
                "email_subject_template": "{vendor} exceptions {run_date_iso}",
                "email_body_template": "Alerts: {alerts_count}",
            }
        )
        draft = build_manual_email_draft(db, _make_job())

        assert draft["subject"] == "SFF exceptions 2026-09-04"
        assert draft["body"] == "Alerts: 133"
        assert draft["used_custom_subject"] is True
        assert draft["used_custom_body"] is True

    @pytest.mark.unit
    def test_compose_url_targets_the_overwatch_mailbox_with_prefilled_fields(
        self, patched_services
    ):
        draft = build_manual_email_draft(_make_db(), _make_job())

        parsed = urlparse(draft["compose_url"])
        assert parsed.scheme == "https"
        assert parsed.netloc == "outlook.office.com"
        assert parsed.path == (
            "/mail/overwatch@metroshoewarehouse.com/deeplink/compose"
        )

        params = parse_qs(parsed.query)
        assert params["to"] == ["vendor@example.com,ops@example.com"]
        assert params["bcc"] == ["audit@example.com"]
        assert params["subject"] == [draft["subject"]]
        assert params["body"][0] == draft["body"].replace("\n", "\r\n")

        assert urlparse(draft["compose_url_signed_in_mailbox"]).path == (
            "/mail/deeplink/compose"
        )

    @pytest.mark.unit
    def test_compose_url_encodes_spaces_as_percent_20(self, patched_services):
        draft = build_manual_email_draft(_make_db(), _make_job())

        # Outlook renders '+' literally, so spaces must not be plus-encoded.
        query = urlparse(draft["compose_url"]).query
        assert "%20" in query
        assert "+" not in query

    @pytest.mark.unit
    def test_mailto_url_includes_recipients_and_subject(self, patched_services):
        draft = build_manual_email_draft(_make_db(), _make_job())

        assert draft["mailto_url"].startswith(
            "mailto:vendor@example.com,ops@example.com?"
        )
        params = parse_qs(draft["mailto_url"].split("?", 1)[1])
        assert params["subject"] == [draft["subject"]]
        assert params["bcc"] == ["audit@example.com"]
