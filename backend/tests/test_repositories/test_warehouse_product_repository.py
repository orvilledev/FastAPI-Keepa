from app.repositories.warehouse_product_repository import (
    apply_warehouse_product_search,
    build_warehouse_product_search_filter,
)


def test_build_search_filter_quotes_dots_in_upc():
    result = build_warehouse_product_search_filter("amzn.gr.190038644080")
    assert result is not None
    assert 'upc.ilike."%amzn.gr.190038644080%"' in result
    assert 'fnsku.ilike."%amzn.gr.190038644080%"' in result
    assert 'style_name.ilike."%amzn.gr.190038644080%"' in result
    assert 'condition.ilike."%amzn.gr.190038644080%"' in result


def test_build_search_filter_escapes_like_wildcards():
    result = build_warehouse_product_search_filter("50%_off")
    assert result is not None
    assert '50\\%\\_off' in result


def test_build_search_filter_empty_returns_none():
    assert build_warehouse_product_search_filter(None) is None
    assert build_warehouse_product_search_filter("   ") is None


def test_apply_search_adds_or_query_param():
    class FakeQuery:
        def __init__(self):
            from httpx import QueryParams
            self.params = QueryParams()

    query = apply_warehouse_product_search(FakeQuery(), "190038644151")
    assert "or" in str(query.params)
    assert "190038644151" in str(query.params)
