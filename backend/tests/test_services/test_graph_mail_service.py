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
def test_send_message_graph_error(mock_client_cls):
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
