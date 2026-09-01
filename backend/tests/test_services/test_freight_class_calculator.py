"""Tests for freight class calculator service."""
from io import BytesIO

import openpyxl
import pytest

from app.services.freight_class_calculator import (
    FreightClassCalculatorError,
    apply_height_rule,
    calculate_from_excel,
    calculate_manual,
    density_to_freight_class,
    parse_excel_shipments,
)


def test_density_to_freight_class_nmfc_13_sub():
    assert density_to_freight_class(50.0) == 50
    assert density_to_freight_class(12.5) == 85
    assert density_to_freight_class(12.0) == 85
    assert density_to_freight_class(11.99) == 92.5
    assert density_to_freight_class(6.5) == 125
    assert density_to_freight_class(0.5) == 400


def test_height_rule_bumps_75_to_95():
    height, applied = apply_height_rule(80, skip_seventy_five_inch_rule=False)
    assert height == 96
    assert applied is True


def test_height_rule_skipped():
    height, applied = apply_height_rule(80, skip_seventy_five_inch_rule=True)
    assert height == 80
    assert applied is False


def test_manual_single_pallet_class_85():
    result = calculate_manual(
        [{"pallets": 1, "weight": 500, "length": 48, "width": 40, "height": 36}],
    )
    shipment = result.shipments[0]
    assert shipment.total_cubic_feet == pytest.approx(40.0, rel=1e-3)
    assert shipment.density_pcf == pytest.approx(12.5, rel=1e-3)
    assert shipment.freight_class == 85


def test_sample_excel_grouped_shipments():
    path = r"c:\Users\Administrator\Desktop\Pallet Dims Tester.xlsx"
    with open(path, "rb") as fh:
        raw = fh.read()
    grouped = parse_excel_shipments(raw)
    assert set(grouped) == {"FBA19MFPGJV2", "FBA19MJIRJUY"}
    assert len(grouped["FBA19MFPGJV2"]) == 3
    assert len(grouped["FBA19MJIRJUY"]) == 2

    result = calculate_from_excel(raw)
    by_id = {s.shipment_id: s for s in result.shipments}
    assert by_id["FBA19MJIRJUY"].freight_class == 175
    assert by_id["FBA19MJIRJUY"].density_pcf == pytest.approx(5.51, rel=1e-2)
    assert by_id["FBA19MFPGJV2"].freight_class == 250


def test_parse_excel_missing_shipment_id_raises():
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["Shipment ID", "Pallets", "Weight", "Length", "Width", "Height"])
    ws.append([None, 1, 100, 48, 40, 40])
    buf = BytesIO()
    wb.save(buf)
    with pytest.raises(FreightClassCalculatorError, match="Shipment ID"):
        parse_excel_shipments(buf.getvalue())
