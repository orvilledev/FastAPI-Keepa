"""Tests for runtime email transport selection."""

import pytest
from unittest.mock import patch

from app.email_transport import (
    get_email_transport_state,
    get_resolved_transport,
    resolve_effective_transport,
    set_email_transport,
)


@pytest.mark.unit
def test_resolve_effective_transport_modes():
    with patch("app.email_transport.settings") as mock_settings:
        mock_settings.graph_email_configured = True
        assert resolve_effective_transport("graph") == "graph"
        assert resolve_effective_transport("smtp") == "smtp"
        assert resolve_effective_transport("auto") == "graph"

        mock_settings.graph_email_configured = False
        assert resolve_effective_transport("auto") == "smtp"


@pytest.mark.unit
def test_set_email_transport_runtime():
    with patch("app.email_transport.settings") as mock_settings:
        mock_settings.email_transport = "auto"
        mock_settings.email_password = "secret"
        mock_settings.email_from = "overwatch@metroshoewarehouse.com"
        mock_settings.graph_email_configured = True
        mock_settings.email_smtp_host = "smtp.office365.com"

        set_email_transport("smtp")
        state = get_email_transport_state()
        assert state["transport"] == "smtp"
        assert state["effective_transport"] == "smtp"
        assert get_resolved_transport() == "smtp"

        set_email_transport("graph")
        state = get_email_transport_state()
        assert state["transport"] == "graph"
        assert state["effective_transport"] == "graph"
        assert get_resolved_transport() == "graph"
