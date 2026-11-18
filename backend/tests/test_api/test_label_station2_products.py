"""Label Station II lookup endpoint behavior."""
import pytest
from fastapi import HTTPException

from app.api.label_station2_products import (
    _raise_if_missing_table,
    lookup_label_station2_product,
)
from app.main import app
from tests.test_repositories.test_label_station2_product_repository import _FakeDb, _ugg


def _db():
    return _FakeDb(
        {
            "label_station2_products": [_ugg()],
            "warehouse_products": [{"upc": "194715379404", "fnsku": "X0056D33KL"}],
        }
    )


def test_routes_registered():
    paths = {getattr(route, "path", "") for route in app.routes}
    assert "/api/v1/label-station-2/products/lookup" in paths
    assert "/api/v1/label-station-2/products/import" in paths
    assert "/api/v1/label-station-2/products/{upc}" in paths


def test_lookup_returns_label_fields_with_fnsku():
    result = lookup_label_station2_product(scan="X0056D33KL", current_user={}, db=_db())
    assert result.upc == "194715379404"
    assert result.fnsku == "X0056D33KL"
    assert result.vendor_name == "UGG"
    assert result.description == "M-ASCOT"
    assert result.color == "GREY SUEDE"
    assert result.size == "10 M"
    assert result.mpn == "1101110"


def test_lookup_unknown_is_404():
    with pytest.raises(HTTPException) as exc:
        lookup_label_station2_product(scan="X000NOPE00", current_user={}, db=_db())
    assert exc.value.status_code == 404


def test_missing_table_maps_to_503():
    with pytest.raises(HTTPException) as exc:
        _raise_if_missing_table(Exception('relation "label_station2_products" does not exist'))
    assert exc.value.status_code == 503
    _raise_if_missing_table(Exception("some other failure"))
