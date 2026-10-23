"""QBOID M2 dimensioner: payload parsing, unit conversion, and the shared secret."""
import json
from datetime import datetime, timezone

import pytest

from app.services.dimensioner_scans import (
    DimensionerPayloadError,
    api_key_matches,
    grams_to_pounds,
    mm_to_inches,
    parse_scan_payload,
    present_scan,
)

# The example record from QBOID's Perceptor API documentation.
DOC_RECORD = {
    "timestamp": "2021/02/14 07:19:38",
    "l": 195,
    "w": 165,
    "h": 72,
    "weight": 7709,
    "barcode": "845973030506",
    "shape": "Cuboidal",
    "device": "FH0402211100001",
    "note": "",
    "attributes": {"hazmat": "true"},
    "image": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/4gIo",
}


def _body(record: dict) -> bytes:
    return json.dumps(record).encode("utf-8")


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------


def test_parses_the_documented_record():
    parsed = parse_scan_payload(_body(DOC_RECORD))

    assert parsed is not None
    assert (parsed.length_mm, parsed.width_mm, parsed.height_mm) == (195, 165, 72)
    assert parsed.weight_g == 7709
    assert parsed.barcode == "845973030506"
    assert parsed.shape == "Cuboidal"
    assert parsed.device == "FH0402211100001"
    assert parsed.attributes == {"hazmat": "true"}
    assert parsed.scanned_at == datetime(2021, 2, 14, 7, 19, 38, tzinfo=timezone.utc)


def test_device_escaped_slashes_and_newlines_parse():
    # The M2 escapes "/" as "\/" and wraps base64 images with "\n".
    raw = (
        b'{"timestamp":"2021\\/02\\/25 02:16:25","l":266,"w":203,"h":72,"weight":6807,'
        b'"barcode":"X001SS387V","shape":"Irregular","device":"FH0402211100001",'
        b'"note":"QWERTY","attributes":{"batt":"false","hazmat":"true"},'
        b'"image":"data:image\\/jpeg;base64,AAAA\\nBBBB"}'
    )

    parsed = parse_scan_payload(raw)

    assert parsed is not None
    assert parsed.scanned_at == datetime(2021, 2, 25, 2, 16, 25, tzinfo=timezone.utc)
    assert parsed.note == "QWERTY"
    assert parsed.attributes == {"batt": "false", "hazmat": "true"}


def test_images_are_not_part_of_the_row():
    row = parse_scan_payload(_body(DOC_RECORD)).to_row()

    assert "image" not in row
    assert "imagecolor" not in row
    assert "imageseg" not in row


def test_row_has_exactly_the_table_columns():
    row = parse_scan_payload(_body(DOC_RECORD)).to_row()

    assert set(row) == {
        "dedupe_key",
        "device",
        "barcode",
        "length_mm",
        "width_mm",
        "height_mm",
        "weight_g",
        "shape",
        "note",
        "attributes",
        "scanned_at",
    }
    assert row["scanned_at"] == "2021-02-14T07:19:38+00:00"


def test_minus_one_dimensions_mean_not_measured():
    # "Mandatory dimensioning" off: the device sends -1 for any missing dimension.
    record = {**DOC_RECORD, "l": -1, "w": -1, "h": -1, "shape": ""}

    parsed = parse_scan_payload(_body(record))

    assert parsed is not None
    assert (parsed.length_mm, parsed.width_mm, parsed.height_mm) == (None, None, None)
    assert parsed.weight_g == 7709
    assert parsed.barcode == "845973030506"


def test_missing_weight_is_none_not_zero():
    record = {k: v for k, v in DOC_RECORD.items() if k != "weight"}

    assert parse_scan_payload(_body(record)).weight_g is None


@pytest.mark.parametrize("bad", [0, -5, True, False, "abc", "nan", None, [], {}, 1e308, 10**9])
def test_unusable_numbers_become_none(bad):
    record = {**DOC_RECORD, "l": bad, "weight": bad}

    parsed = parse_scan_payload(_body(record))

    assert parsed.length_mm is None
    assert parsed.weight_g is None


def test_numeric_strings_and_floats_are_accepted():
    record = {**DOC_RECORD, "l": "195", "w": 165.4, "h": 71.6, "weight": "7709.0"}

    parsed = parse_scan_payload(_body(record))

    assert (parsed.length_mm, parsed.width_mm, parsed.height_mm) == (195, 165, 72)
    assert parsed.weight_g == 7709


def test_record_with_nothing_in_it_is_ignored():
    assert parse_scan_payload(_body({"device": "X", "note": "hi", "attributes": {}})) is None
    assert parse_scan_payload(_body({"l": -1, "w": -1, "h": -1})) is None


def test_barcode_alone_is_kept():
    parsed = parse_scan_payload(_body({"barcode": "ABC123", "l": -1}))

    assert parsed is not None
    assert parsed.barcode == "ABC123"


@pytest.mark.parametrize("raw", [b"", b"not json", b"[1, 2]", b'"text"', b"123", b"\xff\xfe\x00"])
def test_non_object_bodies_are_rejected(raw):
    with pytest.raises(DimensionerPayloadError):
        parse_scan_payload(raw)


def test_utf8_bom_is_tolerated():
    parsed = parse_scan_payload(b"\xef\xbb\xbf" + _body(DOC_RECORD))

    assert parsed is not None and parsed.length_mm == 195


def test_control_characters_and_nul_are_stripped():
    record = {**DOC_RECORD, "barcode": "AB\u0000C\u0007D  ", "note": "line1\nline2\u0000"}

    parsed = parse_scan_payload(_body(record))

    assert parsed.barcode == "ABCD"
    assert parsed.note == "line1\nline2"


def test_long_text_is_truncated():
    record = {
        **DOC_RECORD,
        "barcode": "9" * 500,
        "note": "n" * 5000,
        "device": "d" * 500,
        "attributes": {f"k{i}": "v" * 500 for i in range(100)},
    }

    parsed = parse_scan_payload(_body(record))

    assert len(parsed.barcode) == 128
    assert len(parsed.note) == 1000
    assert len(parsed.device) == 64
    assert len(parsed.attributes) == 25
    assert all(len(v) == 100 for v in parsed.attributes.values())


def test_attribute_values_of_any_type_become_text():
    record = {**DOC_RECORD, "attributes": {"qty": 3, "fragile": True, "x": None, "": "skip"}}

    parsed = parse_scan_payload(_body(record))

    assert parsed.attributes == {"qty": "3", "fragile": "true", "x": ""}


def test_attributes_that_are_not_an_object_are_ignored():
    assert parse_scan_payload(_body({**DOC_RECORD, "attributes": ["a"]})).attributes == {}


@pytest.mark.parametrize("stamp", ["", "yesterday", "2021-02-14 07:19:38", 12345, None])
def test_bad_timestamp_is_none(stamp):
    assert parse_scan_payload(_body({**DOC_RECORD, "timestamp": stamp})).scanned_at is None


# ---------------------------------------------------------------------------
# Duplicate protection (the device retries an upload whose reply it never got)
# ---------------------------------------------------------------------------


def test_same_record_sent_twice_has_the_same_key():
    first = parse_scan_payload(_body(DOC_RECORD))
    second = parse_scan_payload(_body(DOC_RECORD))

    assert first.dedupe_key == second.dedupe_key


def test_images_do_not_change_the_key():
    without_image = {k: v for k, v in DOC_RECORD.items() if k != "image"}

    assert (
        parse_scan_payload(_body(DOC_RECORD)).dedupe_key
        == parse_scan_payload(_body(without_image)).dedupe_key
    )


@pytest.mark.parametrize(
    "change",
    [
        {"timestamp": "2021/02/14 07:19:39"},
        {"barcode": "845973030507"},
        {"l": 196},
        {"w": 166},
        {"h": 73},
        {"weight": 7710},
        {"device": "FH0402211100002"},
    ],
)
def test_a_genuinely_different_scan_has_a_different_key(change):
    base = parse_scan_payload(_body(DOC_RECORD)).dedupe_key

    assert parse_scan_payload(_body({**DOC_RECORD, **change})).dedupe_key != base


def test_without_a_device_timestamp_nothing_is_deduplicated():
    record = {k: v for k, v in DOC_RECORD.items() if k != "timestamp"}

    assert (
        parse_scan_payload(_body(record)).dedupe_key
        != parse_scan_payload(_body(record)).dedupe_key
    )


# ---------------------------------------------------------------------------
# Units
# ---------------------------------------------------------------------------


def test_millimetres_to_inches():
    assert mm_to_inches(254) == 10.0
    assert mm_to_inches(1219) == 47.99
    assert mm_to_inches(1016) == 40.0
    assert mm_to_inches(None) is None


def test_grams_to_pounds():
    assert grams_to_pounds(453.59237) == 1.0
    assert grams_to_pounds(68039) == 150.0
    assert grams_to_pounds(None) is None


def test_present_scan_adds_inches_and_pounds_and_keeps_raw_values():
    shown = present_scan(
        {
            "id": "abc",
            "device": "D1",
            "barcode": "B1",
            "length_mm": 1219,
            "width_mm": 1016,
            "height_mm": 1524,
            "weight_g": 68039,
            "shape": "Cuboidal",
            "note": None,
            "attributes": None,
            "scanned_at": "2026-10-23T14:02:11+00:00",
            "received_at": "2026-10-23T14:02:12+00:00",
        }
    )

    assert (shown["length_in"], shown["width_in"], shown["height_in"]) == (47.99, 40.0, 60.0)
    assert shown["weight_lb"] == 150.0
    assert (shown["length_mm"], shown["weight_g"]) == (1219, 68039)
    assert shown["note"] == ""
    assert shown["attributes"] == {}


def test_present_scan_with_no_measurement_has_none_not_zero():
    shown = present_scan({"id": "abc", "barcode": "B1"})

    assert shown["length_in"] is None
    assert shown["weight_lb"] is None


# ---------------------------------------------------------------------------
# Shared secret
# ---------------------------------------------------------------------------


def test_key_matches_bare_and_bearer_forms():
    assert api_key_matches("s3cret-value", "s3cret-value")
    assert api_key_matches("Bearer s3cret-value", "s3cret-value")
    assert api_key_matches("bearer   s3cret-value  ", "s3cret-value")
    assert api_key_matches("  s3cret-value ", " s3cret-value ")


@pytest.mark.parametrize("header", [None, "", "wrong", "Bearer wrong", "Bearer ", "s3cret-valuE"])
def test_wrong_or_missing_key_is_rejected(header):
    assert not api_key_matches(header, "s3cret-value")


@pytest.mark.parametrize("configured", [None, "", "   "])
def test_unset_key_never_matches_even_an_empty_header(configured):
    assert not api_key_matches("", configured)
    assert not api_key_matches("Bearer ", configured)
    assert not api_key_matches("anything", configured)


def test_non_ascii_header_does_not_raise():
    assert not api_key_matches("Bearer pässwörd", "s3cret-value")
