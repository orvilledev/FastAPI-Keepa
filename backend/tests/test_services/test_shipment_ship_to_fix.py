"""Tests for the Shipment Manager Ship to correction tool."""
import base64
import csv
import io
import json
from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import shipments
from app.database import get_supabase
from app.dependencies import get_current_user
from app.middleware.rate_limiter import limiter
from app.services.shipment_manager import parse_fba_export, ship_to_code
from app.services.shipment_ship_to_fix import (
    STATUS_ALREADY_CORRECT,
    STATUS_CORRECTED,
    STATUS_ERROR,
    STATUS_UNMATCHED,
    ShipToEntry,
    ShipToFixError,
    correct_exports,
    id_distance,
    match_files_to_entries,
    output_filename,
    parse_entries,
)

BOM = b"\xef\xbb\xbf"


def _export(
    shipment_id: str = "FBA19VYRQ498",
    ship_to: str = "Florence, NJ",
    *,
    name: str = "  FBASMW APPACC 2 11.2.26  2 of 5",
) -> bytes:
    """An FBA 'Individual units' export the way Amazon writes it: every cell quoted."""
    lines = [
        '"Workflow name","wf93ded0aa-a7be-4127-98d3-67997be472c9"',
        f'"Shipment ID","{shipment_id}"',
        f'"Shipment name","{name}"',
        f'"Ship to","{ship_to}"',
        '"Boxes","2"',
        '"SKUs","2"',
        '"Units","14"',
        "",
        "",
        "",
        '"Individual units (2 boxes)"',
        '"SKU","Title","ASIN","FNSKU","Condition","Prep type","Total units","Box 1 units","Box 2 units"',
        '"605284108079-FNSKU","SmartWool Merino Sport 250 Beanie - Cuffed Wool Hat","B000OCJKS2","X0058RO4RB","New","No prep needed","9","4","5"',
        '"198268467281-FNSKU","Smartwool, Unisex, Neck Gaiter, One Size","B0FY81YFDC","X0059SDP9H","New","Ships in Product Packaging","5","","5"',
        "",
        '"","","","","","","Box ID","FBA19VYRQ498U000001","FBA19VYRQ498U000002"',
    ]
    return BOM + "\n".join(lines).encode("utf-8")


def _cells(content: bytes) -> list[list[str]]:
    return list(csv.reader(io.StringIO(content.decode("utf-8-sig"), newline="")))


ENTRY = ShipToEntry(shipment_id="FBA19VYRQ498", ship_to="ABE8")


# --- the rewrite itself ---------------------------------------------------


def test_replaces_only_the_ship_to_cell():
    original = _export()
    [outcome] = correct_exports([("FBA19VYRQ498.csv", original)], [ENTRY])

    assert outcome.status == STATUS_CORRECTED
    assert outcome.old_ship_to == "Florence, NJ"
    assert outcome.new_ship_to == "ABE8"
    assert outcome.match_kind == "exact"

    before = _cells(original)
    after = _cells(outcome.content)
    assert len(before) == len(after)
    changed = []
    for row_index, (old_row, new_row) in enumerate(zip(before, after)):
        width = max(len(old_row), len(new_row))
        old_padded = old_row + [""] * (width - len(old_row))
        new_padded = new_row + [""] * (width - len(new_row))
        for column, (old_cell, new_cell) in enumerate(zip(old_padded, new_padded)):
            if old_cell != new_cell:
                changed.append((row_index, column, old_cell, new_cell))
    assert changed == [(3, 1, "Florence, NJ", "ABE8")]


def test_output_is_written_the_way_excel_saves_a_csv():
    [outcome] = correct_exports([("FBA19VYRQ498.csv", _export())], [ENTRY])
    content = outcome.content

    assert content.startswith(BOM)
    text = content[len(BOM):].decode("utf-8")
    assert "\r\n" in text
    assert "\n" not in text.replace("\r\n", "")
    assert text.endswith("\r\n")
    lines = text.split("\r\n")[:-1]
    # Quotes only where a cell needs them, and every row padded to the full width.
    # The export is nine columns wide, so every row carries eight separators.
    assert lines[1] == "Shipment ID,FBA19VYRQ498,,,,,,,"
    assert lines[2] == "Shipment name,  FBASMW APPACC 2 11.2.26  2 of 5,,,,,,,"
    assert lines[3] == "Ship to,ABE8,,,,,,,"
    assert lines[7] == ",,,,,,,,"
    assert lines[13].startswith('198268467281-FNSKU,"Smartwool, Unisex, Neck Gaiter, One Size",')
    assert {len(row) for row in _cells(content)} == {9}


def test_corrected_file_still_uploads_to_a_shipment():
    [outcome] = correct_exports([("FBA19VYRQ498.csv", _export())], [ENTRY])
    parsed = parse_fba_export("FBA19VYRQ498-output.csv", outcome.content)

    assert parsed.shipment_id == "FBA19VYRQ498"
    assert parsed.ship_to == "ABE8"
    assert ship_to_code(parsed.ship_to) == "ABE8"
    assert parsed.sku_count == 2
    assert parsed.total_units == 14
    assert parsed.box_count == 2


def test_other_cells_keep_their_exact_text():
    [outcome] = correct_exports([("FBA19VYRQ498.csv", _export())], [ENTRY])
    rows = _cells(outcome.content)
    # Leading spaces in the shipment name survive.
    assert rows[2][1] == "  FBASMW APPACC 2 11.2.26  2 of 5"
    assert rows[12][1] == "SmartWool Merino Sport 250 Beanie - Cuffed Wool Hat"
    assert rows[12][0] == "605284108079-FNSKU"


def test_already_correct_ship_to_is_reported_and_still_returned():
    [outcome] = correct_exports([("a.csv", _export(ship_to="ABE8"))], [ENTRY])
    assert outcome.status == STATUS_ALREADY_CORRECT
    assert outcome.content
    assert _cells(outcome.content)[3][1] == "ABE8"


def test_code_followed_by_an_address_is_replaced_by_the_bare_code():
    [outcome] = correct_exports(
        [("a.csv", _export(ship_to="ABE8 - 401 Independence Road, Florence, NJ"))], [ENTRY]
    )
    assert outcome.status == STATUS_CORRECTED
    assert _cells(outcome.content)[3][1] == "ABE8"


def test_windows_1252_export_is_read_and_written_back_as_utf8():
    raw = _export(name="Smartwool® APPACC").decode("utf-8-sig").encode("cp1252")
    [outcome] = correct_exports([("a.csv", raw)], [ENTRY])
    assert outcome.status == STATUS_CORRECTED
    assert _cells(outcome.content)[2][1] == "Smartwool® APPACC"


# --- matching -------------------------------------------------------------


def test_each_file_gets_its_own_ship_to():
    entries = [
        ShipToEntry("FBA19VYS54V7", "MCC1"),
        ShipToEntry("FBA19VYRQ498", "ABE8"),
        ShipToEntry("FBA19VYXYY9P", "GYR3"),
    ]
    outcomes = correct_exports(
        [
            ("one.csv", _export("FBA19VYXYY9P", "PHOENIX, AZ")),
            ("two.csv", _export("FBA19VYS54V7", "RANCHO CORDOVA, CA")),
            ("three.csv", _export("FBA19VYRQ498", "Florence, NJ")),
        ],
        entries,
    )
    assert [item.new_ship_to for item in outcomes] == ["GYR3", "MCC1", "ABE8"]
    assert [_cells(item.content)[3][1] for item in outcomes] == ["GYR3", "MCC1", "ABE8"]
    assert [item.output_filename for item in outcomes] == [
        "one-output.csv",
        "two-output.csv",
        "three-output.csv",
    ]


def test_extra_screenshot_entries_are_simply_unused():
    entries = [ENTRY, ShipToEntry("FBA19VYS54V7", "MCC1")]
    outcomes = correct_exports([("a.csv", _export())], entries)
    assert [item.status for item in outcomes] == [STATUS_CORRECTED]


def test_file_with_no_matching_entry_is_left_unchanged_and_not_returned():
    [outcome] = correct_exports([("a.csv", _export("FBA19VZZZZZZ"))], [ENTRY])
    assert outcome.status == STATUS_UNMATCHED
    assert outcome.content == b""
    assert outcome.new_ship_to == ""


def test_ocr_misread_ids_still_match_the_right_files_one_to_one():
    """The IDs below are what OCR actually returned for a Seller Central screenshot."""
    truth = {
        "FBA19VYS54V7": "MCC1",
        "FBA19VYRQ498": "ABE8",
        "FBA19VYXYY9P": "GYR3",
        "FBA19VYSX1G9": "FWA4",
        "FBA19VYVQLDL": "IND9",
    }
    read_by_ocr = {
        "FBA19VYS54V7": "FBAI9VYSS4V7",
        "FBA19VYRQ498": "FBAT9VYRQ498",
        "FBA19VYXYY9P": "FBA1ISVYXYY9P",
        "FBA19VYSX1G9": "FBAT9VYSX1G9",
        "FBA19VYVQLDL": "FBAT9SVYVQLDL",
    }
    entries = [ShipToEntry(read_by_ocr[sid], code) for sid, code in truth.items()]
    files = [(f"{sid}.csv", _export(sid)) for sid in truth]
    outcomes = correct_exports(files, entries)

    assert [item.shipment_id for item in outcomes] == list(truth)
    assert [item.new_ship_to for item in outcomes] == list(truth.values())
    assert all(item.status == STATUS_CORRECTED for item in outcomes)
    assert all(item.match_kind == "fuzzy" for item in outcomes)
    assert [item.matched_shipment_id for item in outcomes] == list(read_by_ocr.values())
    assert all("check it is the right shipment" in item.message for item in outcomes)


def test_exact_ids_win_over_look_alike_ids():
    entries = [ShipToEntry("FBA19VYS54V7", "MCC1"), ShipToEntry("FBA19VYS54V1", "ABE8")]
    outcomes = correct_exports(
        [("a.csv", _export("FBA19VYS54V7")), ("b.csv", _export("FBA19VYS54V1"))], entries
    )
    assert [item.new_ship_to for item in outcomes] == ["MCC1", "ABE8"]
    assert [item.match_kind for item in outcomes] == ["exact", "exact"]


def test_a_close_but_ambiguous_id_is_not_guessed():
    # Two Seller Central entries are one character away from the file's ID.
    entries = [ShipToEntry("FBA19VYS54V7", "MCC1"), ShipToEntry("FBA19VYS54V9", "ABE8")]
    [outcome] = correct_exports([("a.csv", _export("FBA19VYS54V2"))], entries)
    assert outcome.status == STATUS_UNMATCHED
    assert outcome.content == b""
    assert "more than one" in outcome.message


def test_an_unrelated_id_is_never_fuzzy_matched():
    entries = [ShipToEntry("FBA19VYS54V7", "MCC1")]
    [outcome] = correct_exports([("a.csv", _export("FBA15KQWM2ZT"))], entries)
    assert outcome.status == STATUS_UNMATCHED


def test_one_entry_cannot_be_claimed_by_two_fuzzy_files():
    entries = [ShipToEntry("FBA19VYS54V7", "MCC1")]
    matches, _ = match_files_to_entries(["FBAI9VYS54V7", "FBA19VYS5417"], entries)
    assert sum(1 for item in matches if item is not None) <= 1


def test_id_distance_is_cheaper_for_look_alike_characters():
    assert id_distance("FBA19VYS54V7", "FBA19VYS54V7") == 0
    assert id_distance("FBA19VYS54V7", "FBAI9VYS54V7") == pytest.approx(0.35)
    assert id_distance("FBA19VYS54V7", "FBA19VYS54VX") == 1.0
    assert id_distance("FBA19VYS54V7", "FBA19VYS54V") == 1.0


# --- bad input ------------------------------------------------------------


def test_a_bad_file_does_not_stop_the_others():
    outcomes = correct_exports(
        [
            ("notes.txt", b"hello"),
            ("empty.csv", b""),
            ("random.csv", b"a,b,c\n1,2,3\n"),
            ("good.csv", _export()),
        ],
        [ENTRY],
    )
    assert [item.status for item in outcomes] == [
        STATUS_ERROR,
        STATUS_ERROR,
        STATUS_ERROR,
        STATUS_CORRECTED,
    ]
    assert "csv" in outcomes[0].message.lower()
    assert "empty" in outcomes[1].message.lower()
    assert outcomes[2].message


def test_export_without_a_ship_to_line_is_an_error():
    raw = _export().decode("utf-8-sig").replace('"Ship to","Florence, NJ"\n', "").encode()
    [outcome] = correct_exports([("a.csv", raw)], [ENTRY])
    assert outcome.status == STATUS_ERROR
    assert "no Ship to line" in outcome.message


def test_tab_delimited_file_is_refused():
    tabbed = _export().decode("utf-8-sig").replace('","', '"\t"').encode()
    [outcome] = correct_exports([("a.csv", tabbed)], [ENTRY])
    assert outcome.status == STATUS_ERROR
    assert "tab-delimited" in outcome.message


def test_shipment_id_falls_back_to_the_filename():
    raw = _export().decode("utf-8-sig").replace('"Shipment ID","FBA19VYRQ498"\n', "").encode()
    [outcome] = correct_exports([("FBA19VYRQ498 (1).csv", raw)], [ENTRY])
    assert outcome.status == STATUS_CORRECTED
    assert outcome.shipment_id == "FBA19VYRQ498"


def test_too_many_files_is_refused():
    with pytest.raises(ShipToFixError):
        correct_exports([("a.csv", b"x")] * 51, [ENTRY])


def test_output_filename():
    assert output_filename("FBA19VYS54V7.csv") == "FBA19VYS54V7-output.csv"
    assert output_filename("C:\\temp\\FBA19VYS54V7_1.CSV") == "FBA19VYS54V7_1-output.csv"
    assert output_filename("no extension") == "no extension-output.csv"
    assert output_filename("") == "shipment-output.csv"


# --- entry validation -----------------------------------------------------


def test_parse_entries_normalises_ids_and_codes():
    entries = parse_entries(
        [{"shipment_id": " fba19vyrq498 ", "ship_to": " abe8 "}, {"shipment_id": "FBA19VYS-54V7", "ship_to": "MCC1"}]
    )
    assert entries == [
        ShipToEntry("FBA19VYRQ498", "ABE8"),
        ShipToEntry("FBA19VYS54V7", "MCC1"),
    ]


def test_parse_entries_collapses_a_repeated_identical_entry():
    entries = parse_entries(
        [
            {"shipment_id": "FBA19VYRQ498", "ship_to": "ABE8"},
            {"shipment_id": "FBA19VYRQ498", "ship_to": "abe8"},
        ]
    )
    assert entries == [ShipToEntry("FBA19VYRQ498", "ABE8")]


@pytest.mark.parametrize(
    "payload, fragment",
    [
        ("nope", "list"),
        ([], "at least one"),
        (["x"], "not valid"),
        ([{"shipment_id": "", "ship_to": "ABE8"}], "no Shipment ID"),
        ([{"shipment_id": "ABC123", "ship_to": "ABE8"}], "Amazon Shipment ID"),
        ([{"shipment_id": "FBA19VYRQ498", "ship_to": ""}], "no Ship to"),
        ([{"shipment_id": "FBA19VYRQ498", "ship_to": "Florence, NJ"}], "valid Ship to"),
        ([{"shipment_id": "FBA19VYRQ498", "ship_to": "AB8"}], "valid Ship to"),
        (
            [
                {"shipment_id": "FBA19VYRQ498", "ship_to": "ABE8"},
                {"shipment_id": "FBA19VYRQ498", "ship_to": "GYR3"},
            ],
            "twice",
        ),
    ],
)
def test_parse_entries_rejects_bad_input(payload, fragment):
    with pytest.raises(ShipToFixError) as exc:
        parse_entries(payload)
    assert fragment in str(exc.value)


# --- the endpoint ---------------------------------------------------------


def _client(catalog_rows: list[dict] | None = None) -> TestClient:
    app = FastAPI()
    app.state.limiter = limiter
    app.include_router(shipments.router, prefix="/api/v1")
    db = MagicMock()
    db.table.return_value = db
    db.select.return_value = db
    db.in_.return_value = db
    db.limit.return_value = db
    db.execute.return_value = MagicMock(data=catalog_rows or [])
    app.dependency_overrides[get_supabase] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: {
        "id": "user-1",
        "email": "staff@example.com",
    }
    return TestClient(app)


def _post(client: TestClient, files, entries):
    return client.post(
        "/api/v1/shipments/ship-to-fix",
        files=[("files", (name, content, "text/csv")) for name, content in files],
        data={"entries": json.dumps(entries)},
    )


def test_endpoint_returns_corrected_files_and_catalog_status():
    client = _client(catalog_rows=[{"code": "ABE8"}])
    response = _post(
        client,
        [("FBA19VYRQ498.csv", _export()), ("other.csv", _export("FBA19VZZZZZZ"))],
        [{"shipment_id": "FBA19VYRQ498", "ship_to": "ABE8"}],
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["corrected_count"] == 1
    assert body["unmatched_count"] == 1
    assert body["error_count"] == 0

    first, second = body["results"]
    assert first["status"] == "corrected"
    assert first["output_filename"] == "FBA19VYRQ498-output.csv"
    assert first["old_ship_to"] == "Florence, NJ"
    assert first["new_ship_to"] == "ABE8"
    assert first["ship_to_in_catalog"] is True
    decoded = base64.b64decode(first["content_base64"])
    assert _cells(decoded)[3][1] == "ABE8"

    assert second["status"] == "unmatched"
    assert second["content_base64"] == ""
    assert second["ship_to_in_catalog"] is None


def test_endpoint_flags_a_code_missing_from_the_catalog():
    client = _client(catalog_rows=[])
    response = _post(
        client,
        [("a.csv", _export())],
        [{"shipment_id": "FBA19VYRQ498", "ship_to": "ABE8"}],
    )
    assert response.status_code == 200
    assert response.json()["results"][0]["ship_to_in_catalog"] is False


def test_endpoint_still_corrects_when_the_catalog_cannot_be_read():
    client = _client()
    client.app.dependency_overrides[get_supabase] = lambda: MagicMock(
        table=MagicMock(side_effect=RuntimeError("down"))
    )
    response = _post(
        client,
        [("a.csv", _export())],
        [{"shipment_id": "FBA19VYRQ498", "ship_to": "ABE8"}],
    )
    assert response.status_code == 200
    result = response.json()["results"][0]
    assert result["status"] == "corrected"
    assert result["ship_to_in_catalog"] is None


@pytest.mark.parametrize(
    "entries",
    [
        [],
        [{"shipment_id": "FBA19VYRQ498", "ship_to": "Florence, NJ"}],
        [{"shipment_id": "nope", "ship_to": "ABE8"}],
    ],
)
def test_endpoint_rejects_bad_entries_with_a_message(entries):
    response = _post(_client(), [("a.csv", _export())], entries)
    assert response.status_code == 400
    assert response.json()["detail"]


def test_endpoint_rejects_unreadable_entries():
    response = _client().post(
        "/api/v1/shipments/ship-to-fix",
        files=[("files", ("a.csv", _export(), "text/csv"))],
        data={"entries": "{not json"},
    )
    assert response.status_code == 400


def test_endpoint_does_not_shadow_the_other_shipment_routes():
    paths = {(route.path, tuple(sorted(route.methods))) for route in shipments.router.routes}
    assert ("/shipments/ship-to-fix", ("POST",)) in paths
    assert ("/shipments/{shipment_id}", ("GET",)) in paths
    assert ("/shipments/folders", ("POST",)) in paths
