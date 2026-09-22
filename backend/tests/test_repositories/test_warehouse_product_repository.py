from app.repositories.warehouse_product_repository import (
    apply_warehouse_product_search,
    build_warehouse_product_search_filter,
    merchant_sku_from_catalog_row,
    sku_digit_count,
    uses_sku_for_scan,
)


def test_sku_digit_count_counts_only_numbers():
    assert sku_digit_count("SW001") == 3
    assert sku_digit_count("1234567") == 7
    assert sku_digit_count("12345678") == 8


def test_uses_sku_for_scan_short_vs_long():
    assert uses_sku_for_scan("SW001") is True
    assert uses_sku_for_scan("1234567") is True
    assert uses_sku_for_scan("12345678") is False
    assert uses_sku_for_scan("") is False
    assert uses_sku_for_scan("   ") is False


def test_merchant_sku_from_catalog_row_short_sku_and_upc():
    assert merchant_sku_from_catalog_row({"sku": "9990318", "upc": "198269695379"}) == "9990318-FNSKU"
    assert merchant_sku_from_catalog_row({"sku": "", "upc": "198269695379"}) == "198269695379-FNSKU"
    assert merchant_sku_from_catalog_row({"sku": "198269695379-FNSKU", "upc": "198269695379"}) == "198269695379-FNSKU"
    assert merchant_sku_from_catalog_row(None) == ""
    assert merchant_sku_from_catalog_row({}) == ""


def test_lookup_by_fnskus_batches_and_keeps_first_match():
    from unittest.mock import MagicMock

    from app.repositories.warehouse_product_repository import WarehouseProductRepository

    first = {"upc": "111", "sku": "9990001", "fnsku": "XA"}
    second = {"upc": "222", "sku": "", "fnsku": "XB"}
    duplicate = {"upc": "333", "sku": "9990003", "fnsku": "XA"}

    db = MagicMock()
    chain = MagicMock()
    chain.select.return_value = chain
    chain.in_.return_value = chain
    chain.execute.return_value = MagicMock(data=[first, second, duplicate])
    db.table.return_value = chain

    repo = WarehouseProductRepository(db)
    found = repo.lookup_by_fnskus([" XA ", "XB", "XA", ""])
    assert found == {"XA": first, "XB": second}
    chain.in_.assert_called_once_with("fnsku", ["XA", "XB"])



def test_lookup_by_upc_returns_short_sku_product():
    from unittest.mock import MagicMock

    from app.repositories.warehouse_product_repository import WarehouseProductRepository

    short_sku_row = {
        "upc": "198269695492",
        "sku": "9990357",
        "fnsku": "X0052JFNEN",
        "style_name": "Sample",
        "condition": "New",
    }

    db = MagicMock()

    def table_side_effect(name):
        assert name == "warehouse_products"
        chain = MagicMock()
        chain.select.return_value = chain
        chain.eq.return_value = chain
        chain.limit.return_value = chain
        chain.execute.return_value = MagicMock(data=[short_sku_row])
        return chain

    db.table.side_effect = table_side_effect
    repo = WarehouseProductRepository(db)
    row = repo.lookup("198269695492")
    assert row == short_sku_row


def test_build_search_filter_quotes_dots_in_upc():
    result = build_warehouse_product_search_filter("amzn.gr.190038644080")
    assert result is not None
    assert 'upc.ilike."%amzn.gr.190038644080%"' in result
    assert 'sku.ilike."%amzn.gr.190038644080%"' in result
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


def test_lookup_by_identifiers_queries_sku_upc_and_fnsku():
    from unittest.mock import MagicMock

    from app.repositories.warehouse_product_repository import WarehouseProductRepository

    row = {
        "upc": "UPC1",
        "sku": "SKU1",
        "fnsku": "FN1",
        "style_name": "Style",
        "condition": "New",
    }

    db = MagicMock()
    columns_seen: list[str] = []

    def table_side_effect(_name):
        chain = MagicMock()
        chain.select.return_value = chain

        def in_side_effect(column, _values):
            columns_seen.append(column)
            chain.execute.return_value = MagicMock(data=[row] if column == "upc" else [])
            return chain

        chain.in_.side_effect = in_side_effect
        return chain

    db.table.side_effect = table_side_effect
    repo = WarehouseProductRepository(db)
    found = repo.lookup_by_identifiers(["UPC1", "MISSING"])
    assert columns_seen == ["sku", "upc", "fnsku"]
    assert found == {"UPC1": [row]}
