"""Tests for GraphMailClient."""

import pytest
from unittest.mock import MagicMock, patch

from app.services.graph_mail_service import GraphMailClient, GraphMailError


@pytest.mark.unit
@patch("app.services.graph_mail_service.httpx.Client")
def test_send_message_success(mock_client_cls):
    mock_client = MagicMock()
    mock_client_cls.return_value.__enter__.return_value = mock_client

    token_response = MagicMock()
    token_response.status_code = 200
    token_response.json.return_value = {
        "access_token": "test-token",
        "expires_in": 3600,
    }

    send_response = MagicMock()
    send_response.status_code = 202
    send_response.text = ""

    mock_client.post.side_effect = [token_response, send_response]

    client = GraphMailClient(
        tenant_id="tenant-id",
        client_id="client-id",
        client_secret="secret",
        from_address="overwatch@metroshoewarehouse.com",
        from_display_name="MSW Overwatch",
    )
    client.send_message(
        subject="Test",
        plain_body="Hello",
        html_body="<p>Hello</p>",
        to_recipients=["recipient@example.com"],
        attachments=[("report.xlsx", b"data", "application/octet-stream")],
    )

    assert mock_client.post.call_count == 2
    send_call = mock_client.post.call_args_list[1]
    assert "sendMail" in send_call.args[0]
    payload = send_call.kwargs["json"]
    assert payload["message"]["subject"] == "Test"
    assert payload["message"]["toRecipients"][0]["emailAddress"]["address"] == "recipient@example.com"
    assert len(payload["message"]["attachments"]) == 1


@pytest.mark.unit
@patch("app.services.graph_mail_service.httpx.Client")
def test_create_draft_includes_cc_bcc_and_returns_web_link(mock_client_cls):
    mock_client = MagicMock()
    mock_client_cls.return_value.__enter__.return_value = mock_client

    token_response = MagicMock()
    token_response.status_code = 200
    token_response.json.return_value = {
        "access_token": "test-token",
        "expires_in": 3600,
    }

    create_response = MagicMock()
    create_response.status_code = 201
    create_response.json.return_value = {
        "id": "draft-abc",
        "webLink": "https://outlook.office.com/mail/id/draft-abc",
    }
    create_response.text = ""

    mock_client.post.side_effect = [token_response, create_response]

    client = GraphMailClient(
        tenant_id="tenant-id",
        client_id="client-id",
        client_secret="secret",
        from_address="overwatch@metroshoewarehouse.com",
        from_display_name="MSW Overwatch",
    )
    created = client.create_draft(
        subject="Test",
        plain_body="Hello",
        html_body="<p>Hello</p>",
        to_recipients=["to@example.com"],
        cc_recipients=["cc@example.com"],
        bcc_recipients=["bcc@example.com"],
        attachments=[("report.xlsx", b"data", "application/octet-stream")],
    )

    assert created["webLink"].endswith("draft-abc")
    create_call = mock_client.post.call_args_list[1]
    assert create_call.args[0].endswith("/messages")
    payload = create_call.kwargs["json"]
    assert payload["toRecipients"][0]["emailAddress"]["address"] == "to@example.com"
    assert payload["ccRecipients"][0]["emailAddress"]["address"] == "cc@example.com"
    assert payload["bccRecipients"][0]["emailAddress"]["address"] == "bcc@example.com"
    assert len(payload["attachments"]) == 1

    mock_client = MagicMock()
    mock_client_cls.return_value.__enter__.return_value = mock_client

    token_response = MagicMock()
    token_response.status_code = 200
    token_response.json.return_value = {
        "access_token": "test-token",
        "expires_in": 3600,
    }

    send_response = MagicMock()
    send_response.status_code = 403
    send_response.text = "Access denied"

    mock_client.post.side_effect = [token_response, send_response]

    client = GraphMailClient(
        tenant_id="tenant-id",
        client_id="client-id",
        client_secret="secret",
        from_address="overwatch@metroshoewarehouse.com",
    )

    with pytest.raises(GraphMailError, match="403"):
        client.send_message(
            subject="Test",
            plain_body="Hello",
            html_body="<p>Hello</p>",
            to_recipients=["recipient@example.com"],
        )
