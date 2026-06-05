"""Tests for email recipient pool DB helpers."""

import pytest
from unittest.mock import MagicMock

from app.utils.email_recipient_pool_db import (
    fetch_pool_rows,
    pool_supports_is_bcc,
    _is_missing_is_bcc_column,
)


class TestEmailRecipientPoolDb:
    @pytest.mark.unit
    def test_detect_missing_is_bcc_column(self):
        exc = Exception("Could not find the 'is_bcc' column of 'email_recipient_pool' in the schema cache")
        assert _is_missing_is_bcc_column(exc) is True
        assert _is_missing_is_bcc_column(Exception("network down")) is False

    @pytest.mark.unit
    def test_fetch_pool_rows_falls_back_without_is_bcc(self):
        import app.utils.email_recipient_pool_db as pool_db

        pool_db._is_bcc_supported = None
        db = MagicMock()
        table = db.table.return_value
        select = table.select.return_value
        limit = select.limit.return_value
        eq = select.eq.return_value
        ordered = eq.order.return_value

        limit.execute.side_effect = Exception("PGRST204 Could not find the 'is_bcc' column")
        ordered.execute.return_value = MagicMock(
            data=[
                {
                    "id": "1",
                    "email": "user@example.com",
                    "display_name": "User",
                }
            ]
        )

        rows = fetch_pool_rows(db, "user-1")
        assert rows == [
            {
                "id": "1",
                "email": "user@example.com",
                "display_name": "User",
                "is_bcc": False,
            }
        ]
        assert pool_supports_is_bcc(db) is False

        pool_db._is_bcc_supported = None
