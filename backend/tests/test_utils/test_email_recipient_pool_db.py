"""Tests for email recipient pool DB helpers."""

import pytest
from unittest.mock import MagicMock

from app.utils.email_recipient_pool_db import fetch_pool_rows


class TestEmailRecipientPoolDb:
    @pytest.mark.unit
    def test_fetch_pool_rows_returns_normalized_rows(self):
        db = MagicMock()
        table = db.table.return_value
        select = table.select.return_value
        ordered = select.order.return_value
        ordered.execute.return_value = MagicMock(
            data=[
                {
                    "id": "1",
                    "email": "user@example.com",
                    "display_name": "User",
                }
            ]
        )

        rows = fetch_pool_rows(db)
        assert rows == [
            {
                "id": "1",
                "email": "user@example.com",
                "display_name": "User",
            }
        ]
        # Shared directory: do not filter by user_id
        select.eq.assert_not_called()
