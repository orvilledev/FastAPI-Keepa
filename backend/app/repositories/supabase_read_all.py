"""Read entire result sets from Supabase/PostgREST past the default ~1000 row cap."""

from typing import Any, Callable, List

PAGE_SIZE = 1000


def read_all_paginated(
    fetch_page: Callable[[int, int], Any],
    page_size: int = PAGE_SIZE,
) -> List[dict]:
    """
    Repeatedly call fetch_page(start, end) with inclusive range until a short page or empty.

    fetch_page must return a Supabase response-like object with a .data list (or None).
    """
    out: List[dict] = []
    offset = 0
    while True:
        resp = fetch_page(offset, offset + page_size - 1)
        rows = resp.data if resp and resp.data is not None else []
        if not rows:
            break
        out.extend(rows)
        if len(rows) < page_size:
            break
        offset += page_size
    return out
