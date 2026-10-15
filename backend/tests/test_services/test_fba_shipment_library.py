"""Parser tests for the official FBA shipment TSV yellow fields."""
from pathlib import Path

import pytest

from uuid import uuid4

from app.models.fba_shipment_library import FbaShipmentLineResponse
from app.services.fba_shipment_library import (
    FbaShipmentParseError,
    STATUS_ACCOUNTED,
    STATUS_MISSING,
    STATUS_NOT_IN_LIST,
    STATUS_OVERAGE,
    choose_line_for_scan,
    count_progress,
    parse_fba_shipment_tsv,
)

SAMPLE = Path(r"c:\Users\Administrator\Downloads\FBA19T3YGF07.tsv")

OFFICIAL = (
    "Shipment ID\tFBA19T3YGF07\n"
    "Name\tTO192902\n"
    "Plan ID\t\n"
    "Ship To\tMQY2\n"
    "Total SKUs\t2\n"
    "Total Units\t7\n"
    "\n"
    "Merchant SKU\tTitle\tASIN\tFNSKU\texternal-id \tCondition\tWho will prep?\tPrep Type\tWho will label?\tShipped\n"
    "845028000003\t\"Sockwell, Black\"\tB004WKAH0M\tB004WKAH0M\tUPC: 845028000003\tNew\tMerchant\tPolybagging\tNo prep required\t3\n"
    "845028000010\tSockwell Black\tB003YKTLGM\tB003YKTLGM\tUPC: 845028000010\tNew\tMerchant\tPolybagging\tNo prep required\t4\n"
)


def test_parser_keeps_only_yellow_fields():
    parsed = parse_fba_shipment_tsv(OFFICIAL.encode("utf-8"))

    assert parsed.shipment_id == "FBA19T3YGF07"
    assert parsed.total_shipped == 7
    assert [(line.merchant_sku, line.external_id, line.shipped) for line in parsed.lines] == [
        ("845028000003", "845028000003", 3),
        ("845028000010", "845028000010", 4),
    ]


def test_count_progress_missing_accounted_and_overage():
    assert count_progress(3, 1) == (2, STATUS_MISSING)
    assert count_progress(3, 2) == (1, STATUS_MISSING)
    assert count_progress(3, 3) == (0, STATUS_ACCOUNTED)
    assert count_progress(3, 4) == (0, STATUS_OVERAGE)


def test_unknown_barcode_is_marked_not_in_the_list():
    row = FbaShipmentLineResponse(
        id=uuid4(),
        line_number=0,
        merchant_sku="",
        external_id="UPC: 999000",
        shipped=0,
        counted=2,
        not_in_list=True,
    )
    assert row.external_id == "999000"
    assert row.status == STATUS_NOT_IN_LIST
    assert row.counted == 2


def test_scan_fills_the_line_that_still_has_units_left():
    first = {"id": "a", "line_number": 1, "shipped": 3, "counted": 3}
    second = {"id": "b", "line_number": 2, "shipped": 2, "counted": 0}
    assert choose_line_for_scan([second, first])["id"] == "b"
    assert choose_line_for_scan([{"id": "a", "line_number": 1, "shipped": 3, "counted": 3}])["id"] == "a"


def test_parser_rejects_a_file_without_the_item_header():
    with pytest.raises(FbaShipmentParseError, match="Merchant SKU"):
        parse_fba_shipment_tsv(b"Shipment ID\tFBA1\nName\tTO1\n")


@pytest.mark.skipif(not SAMPLE.is_file(), reason="sample TSV is not on this machine")
def test_official_sample_file():
    parsed = parse_fba_shipment_tsv(SAMPLE.read_bytes())

    assert parsed.shipment_id == "FBA19T3YGF07"
    assert parsed.lines[0].merchant_sku == "845028000003"
    assert parsed.lines[0].external_id == "845028000003"
    assert parsed.lines[0].shipped == 3
    assert parsed.lines[1].shipped == 3
    assert len(parsed.lines) == 287
    assert parsed.total_shipped == 1512
