"""Tests for Supabase read-all pagination helper."""
from unittest.mock import MagicMock

import pytest

from app.repositories.supabase_read_all import read_all_paginated, PAGE_SIZE


@pytest.mark.unit
def test_read_all_paginated_single_page():
    fetch = MagicMock(
        return_value=MagicMock(data=[{"id": 1}, {"id": 2}]),
    )
    out = read_all_paginated(fetch, page_size=PAGE_SIZE)
    assert out == [{"id": 1}, {"id": 2}]
    fetch.assert_called_once_with(0, PAGE_SIZE - 1)


@pytest.mark.unit
def test_read_all_paginated_multiple_pages():
    full = [{"id": i} for i in range(PAGE_SIZE + 50)]

    def fetch(start, end):
        chunk = full[start : end + 1]
        return MagicMock(data=chunk)

    out = read_all_paginated(fetch, page_size=PAGE_SIZE)
    assert len(out) == PAGE_SIZE + 50
    assert out[0]["id"] == 0
    assert out[-1]["id"] == PAGE_SIZE + 49


@pytest.mark.unit
def test_read_all_paginated_empty():
    fetch = MagicMock(return_value=MagicMock(data=[]))
    assert read_all_paginated(fetch) == []
