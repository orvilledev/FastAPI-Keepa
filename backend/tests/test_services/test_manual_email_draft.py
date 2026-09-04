"""Tests for the manual-send email draft builder."""

from unittest.mock import MagicMock, patch
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi import HTTPException

from app.services.email_service import build_report_email_content
from app.services.manual_email_draft import (
    build_manual_email_draft,
    open_manual_email_draft,
)

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
    ) as email_cls, patch(
        "app.services.manual_email_draft.settings"
    ) as mock_settings:
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
        mock_settings.graph_email_configured = True

        yield report, mailer, mock_settings


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
        report, _, _ = patched_services
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
        assert draft["cc"] == []
        assert draft["recipients_source"] == "job"

    @pytest.mark.unit
    def test_includes_cc_and_keeps_buckets_disjoint(self, patched_services):
        draft = build_manual_email_draft(
            _make_db(),
            _make_job(
                email_recipients="to@example.com, also-cc@example.com",
                email_cc_recipients="also-cc@example.com, cc-only@example.com",
                email_bcc_recipients="bcc@example.com, also-cc@example.com",
            ),
        )

        assert draft["to"] == ["to@example.com"]
        assert draft["cc"] == ["cc-only@example.com"]
        assert draft["bcc"] == ["bcc@example.com", "also-cc@example.com"]

    @pytest.mark.unit
    def test_falls_back_to_scheduler_settings_recipients(self, patched_services):
        db = _make_db(
            {
                "category": "sff",
                "email_recipients": "fallback@example.com",
                "email_cc_recipients": "cc@example.com",
                "email_bcc_recipients": None,
                "email_subject_template": None,
                "email_body_template": None,
            }
        )
        draft = build_manual_email_draft(
            db,
            _make_job(
                email_recipients=None,
                email_cc_recipients=None,
                email_bcc_recipients=None,
            ),
        )

        assert draft["to"] == ["fallback@example.com"]
        assert draft["cc"] == ["cc@example.com"]
        assert draft["recipients_source"] == "scheduler_settings"

    @pytest.mark.unit
    def test_reports_missing_recipients(self, patched_services):
        draft = build_manual_email_draft(
            _make_db(),
            _make_job(
                email_recipients=None,
                email_cc_recipients=None,
                email_bcc_recipients=None,
            ),
        )

        assert draft["to"] == []
        assert draft["cc"] == []
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
    def test_compose_url_prioritizes_signed_in_mailbox(self, patched_services):
        draft = build_manual_email_draft(_make_db(), _make_job())

        parsed = urlparse(draft["compose_url"])
        assert parsed.path == "/mail/deeplink/compose"
        assert draft["compose_url"] == draft["compose_url_signed_in_mailbox"]

        overwatch = urlparse(draft["compose_url_overwatch_mailbox"])
        assert overwatch.path == (
            "/mail/overwatch@metroshoewarehouse.com/deeplink/compose"
        )

        params = parse_qs(parsed.query)
        assert params["to"] == ["vendor@example.com,ops@example.com"]
        assert params["bcc"] == ["audit@example.com"]
        assert params["subject"] == [draft["subject"]]
        assert params["body"][0] == draft["body"].replace("\n", "\r\n")

    @pytest.mark.unit
    def test_compose_url_encodes_spaces_as_percent_20(self, patched_services):
        draft = build_manual_email_draft(_make_db(), _make_job())

        query = urlparse(draft["compose_url"]).query
        assert "%20" in query
        assert "+" not in query

    @pytest.mark.unit
    def test_mailto_url_includes_recipients_and_subject(self, patched_services):
        draft = build_manual_email_draft(
            _make_db(),
            _make_job(email_cc_recipients="cc@example.com"),
        )

        assert draft["mailto_url"].startswith(
            "mailto:vendor@example.com,ops@example.com?"
        )
        params = parse_qs(draft["mailto_url"].split("?", 1)[1])
        assert params["subject"] == [draft["subject"]]
        assert params["bcc"] == ["audit@example.com"]
        assert params["cc"] == ["cc@example.com"]


class TestOpenManualEmailDraft:
    @pytest.mark.unit
    def test_creates_graph_draft_with_to_cc_bcc_and_attachment(self, patched_services):
        _, mailer, mock_settings = patched_services
        mock_settings.graph_email_configured = True
        graph = MagicMock()
        graph.create_draft.return_value = {
            "id": "draft-123",
            "webLink": "https://outlook.office.com/mail/id/draft-123",
        }
        mailer._graph_client_or_none.return_value = graph

        result = open_manual_email_draft(
            _make_db(),
            _make_job(email_cc_recipients="cc@example.com"),
        )

        assert result["open_url"] == "https://outlook.office.com/mail/id/draft-123"
        assert result["draft_id"] == "draft-123"
        kwargs = graph.create_draft.call_args.kwargs
        assert kwargs["to_recipients"] == ["vendor@example.com", "ops@example.com"]
        assert kwargs["cc_recipients"] == ["cc@example.com"]
        assert kwargs["bcc_recipients"] == ["audit@example.com"]
        assert kwargs["attachments"][0][0] == "MSW_Overwatch_MAP_Report_2026-09-04.xlsx"
        assert kwargs["attachments"][0][1] == b"xlsx-bytes"

    @pytest.mark.unit
    def test_raises_when_graph_not_configured(self, patched_services):
        _, _, mock_settings = patched_services
        mock_settings.graph_email_configured = False

        with pytest.raises(HTTPException) as exc_info:
            open_manual_email_draft(_make_db(), _make_job())

        assert exc_info.value.status_code == 503
