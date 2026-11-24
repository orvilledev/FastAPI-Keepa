"""Tests for the LTL Label Format Checker (Amazon FBA LTL box labels, one page per box).

The fixtures are two real LTL label PDFs from Seller Central:

* FBA19WTTW2CG — 29 boxes tagged P1 - B1 ... P1 - B29 in page order (correct order)
* FBA19WBXZVZZ — 63 boxes tagged FBA19WBXZVZZ - B2, - B42, - B5, ... (wrong order)
"""
from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path

import pytest

fitz = pytest.importorskip("fitz")

from openpyxl import load_workbook  # noqa: E402

from app.services import ltl_label_format_checker as ltl  # noqa: E402

FIXTURES = Path(__file__).resolve().parent.parent / "fixtures" / "ltl_label_format"
CORRECT = FIXTURES / "FBA19WTTW2CG-correct_order.pdf"
WRONG = FIXTURES / "FBA19WBXZVZZ-wrong_order.pdf"

WRONG_ORDER_B = [
    2, 42, 5, 51, 53, 62, 60, 26, 4, 55, 11, 19, 39, 30, 31, 6, 1, 8, 18, 29, 3, 22, 7, 63, 23,
    28, 16, 24, 49, 56, 17, 21, 45, 43, 25, 57, 12, 20, 32, 33, 52, 54, 37, 15, 27, 50, 35, 38,
    48, 58, 40, 44, 47, 10, 13, 36, 46, 14, 34, 9, 41, 61, 59,
]


def _failed_ids(result: ltl.LtlFileResult) -> set[str]:
    return {c.id for c in result.all_checks if c.status == ltl.FAIL}


def _warned_ids(result: ltl.LtlFileResult) -> set[str]:
    return {c.id for c in result.all_checks if c.status == ltl.WARN}


def _file_check(result: ltl.LtlFileResult, check_id: str):
    return next(c for c in result.checks if c.id == check_id)


def _pages(path: Path, pages: list[int]) -> bytes:
    """A new PDF holding ``pages`` (0-based) of ``path`` in that order."""
    doc = fitz.open(path)
    doc.select(pages)
    return doc.tobytes()


def _replace_text(doc, page_index: int, old: str, new: str, fontsize: float = 7) -> None:
    page = doc[page_index]
    rects = page.search_for(old)
    assert rects, f"'{old}' not found on page {page_index + 1}"
    rect = rects[0]
    page.add_redact_annot(fitz.Rect(rect.x0, rect.y0 + 2.5, rect.x1, rect.y1 - 2.5), fill=(1, 1, 1))
    page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE, graphics=fitz.PDF_REDACT_LINE_ART_NONE)
    width = fitz.get_text_length(new, fontname="helv", fontsize=fontsize)
    page.insert_text((rect.x1 - width, rect.y1 - 2.2), new, fontsize=fontsize, fontname="helv")


# --------------------------------------------------------------------------- real labels
def test_correct_order_pdf_passes_every_check():
    result = ltl.check_pdf_bytes(CORRECT.name, CORRECT.read_bytes())
    assert result.status == ltl.FILE_PASS, [
        (c.id, c.page, c.detail) for c in result.all_checks if c.status != ltl.PASS
    ]
    assert result.page_count == 29
    assert len(result.boxes) == 29
    assert result.box_order.status == ltl.PASS
    assert [e["found"] for e in result.box_order.entries] == list(range(1, 30))
    assert "B1 to B29 in order" in _file_check(result, "file.box_order").detail
    ids = {c.id for c in result.all_checks}
    assert {
        "file.readable", "file.pages", "file.box_order", "file.consistency", "file.filename",
        "box.size", "box.text", "box.notice", "box.title", "box.ship_from", "box.ship_to",
        "box.strip", "box.box_id", "box.barcode", "box.pdf417", "box.contents", "box.graphics",
        "box.extra", "box.order",
    } <= ids


def test_wrong_order_pdf_has_correct_format_but_fails_box_order():
    result = ltl.check_pdf_bytes(WRONG.name, WRONG.read_bytes())
    assert result.status == ltl.FILE_FAIL
    # Every label is a valid LTL label: the only failures are the order checks.
    assert _failed_ids(result) == {"file.box_order", "box.order"}
    assert not _warned_ids(result)

    order = result.box_order
    assert [e["found"] for e in order.entries] == WRONG_ORDER_B
    assert [e["expected"] for e in order.entries] == list(range(1, 64))
    assert order.out_of_order == 61
    assert [e["page"] for e in order.entries if e["ok"]] == [11, 22]
    assert order.missing == [] and order.duplicates == []

    detail = _file_check(result, "file.box_order").detail
    assert detail.startswith("starts with B2 instead of B1")
    assert "61 of 63 boxes are out of order" in detail
    assert "page 2 shows B42 (expected B2)" in detail

    page2 = next(c for c in result.boxes[1].checks if c.id == "box.order")
    assert page2.status == ltl.FAIL
    assert "B42" in page2.detail and "B2" in page2.detail


def test_wrong_order_pdf_sorted_by_box_number_passes():
    sorted_pages = sorted(range(63), key=lambda i: WRONG_ORDER_B[i])
    result = ltl.check_pdf_bytes(WRONG.name, _pages(WRONG, sorted_pages))
    assert result.status == ltl.FILE_PASS, [
        (c.id, c.page, c.detail) for c in result.all_checks if c.status != ltl.PASS
    ]
    assert [e["found"] for e in result.box_order.entries] == list(range(1, 64))


def test_extracted_fields_single_sku_with_pack_group_tag():
    result = ltl.check_pdf_bytes(CORRECT.name, CORRECT.read_bytes())
    f = result.boxes[0].fields
    assert f["box_id"] == "FBA19WTTW2CGU000001"
    assert f["shipment_id"] == "FBA19WTTW2CG"
    assert f["shipment_name"] == "FBA STA (11/11/2026 18:51)-ABQ2"
    assert f["created"] == "2026/11/11 11:51 MST (-07)"
    assert f["ship_to_name"] == "PM Shoes Inc"
    assert f["contents"] == "Single SKU"
    assert (f["sku"], f["qty"]) == ("673088447755", 12)
    assert (f["box_tag"], f["pack_group"], f["box_number"]) == ("P1 - B1", "P1", 1)
    assert f["mixed_badge"] is False
    assert result.boxes[5].fields["contents"] == "Mixed SKUs"


def test_extracted_fields_mixed_badge_with_shipment_tag():
    result = ltl.check_pdf_bytes(WRONG.name, WRONG.read_bytes())
    f = result.boxes[1].fields
    assert f["mixed_badge"] is True
    assert f["contents"] == "Mixed SKUs"
    assert (f["box_tag"], f["pack_group"], f["box_number"]) == ("FBA19WBXZVZZ - B42", "FBA19WBXZVZZ", 42)
    assert f["ship_to_address"] == "Amazon.com Services, Inc., 24300 Nandina Ave, Moreno Valley, CA 92551-9534, United States"
    single = result.boxes[4].fields
    assert (single["contents"], single["sku"], single["qty"]) == ("Single SKU", "673088000813", 12)


# --------------------------------------------------------------------------- box order rules
def test_two_swapped_pages_are_flagged():
    order = list(range(29))
    order[3], order[4] = order[4], order[3]
    result = ltl.check_pdf_bytes("swapped.pdf", _pages(CORRECT, order))
    assert result.box_order.status == ltl.FAIL
    assert [e["page"] for e in result.box_order.entries if e["ok"] is False] == [4, 5]
    assert "page 4 shows B5 (expected B4)" in _file_check(result, "file.box_order").detail


def test_missing_box_is_flagged():
    result = ltl.check_pdf_bytes("gap.pdf", _pages(CORRECT, [0, 1, 3, 4]))
    assert result.box_order.status == ltl.FAIL
    assert result.box_order.missing == [3]
    assert "missing: B3" in _file_check(result, "file.box_order").detail


def test_repeated_box_is_flagged():
    result = ltl.check_pdf_bytes("dupe.pdf", _pages(CORRECT, [0, 1, 1, 2]))
    assert result.box_order.status == ltl.FAIL
    assert result.box_order.duplicates == [2]
    assert "file.duplicate_box" in _failed_ids(result)


def test_later_part_of_a_split_shipment_is_review_not_failure():
    result = ltl.check_pdf_bytes("part2.pdf", _pages(CORRECT, list(range(10, 29))))
    assert result.box_order.status == ltl.WARN
    assert result.box_order.expected_start == 11
    assert not _failed_ids(result)
    assert "no B1" in _file_check(result, "file.box_order").detail


def test_numbering_restarting_per_pack_group_is_in_order():
    boxes = []
    for i, (group, num) in enumerate([("P1", 1), ("P1", 2), ("P1", 3), ("P2", 1), ("P2", 2)], start=1):
        boxes.append(ltl.LtlBox(index=i, page=i, fields={"pack_group": group, "box_number": num}))
    order = ltl.evaluate_box_order(boxes)
    assert order.status == ltl.PASS
    assert order.mode == "pack_group"


def test_global_numbering_across_pack_groups_is_in_order():
    boxes = []
    for i, group in enumerate(["P1", "P1", "P2", "P2"], start=1):
        boxes.append(ltl.LtlBox(index=i, page=i, fields={"pack_group": group, "box_number": i}))
    order = ltl.evaluate_box_order(boxes)
    assert order.status == ltl.PASS
    assert order.mode == "sequence"


def test_unreadable_box_tag_fails_contents_and_reviews_order():
    doc = fitz.open(CORRECT)
    _replace_text(doc, 2, "P1 - B3", "BOX THREE")
    result = ltl.check_pdf_bytes("unreadable.pdf", doc.tobytes())
    assert "box.contents" in _failed_ids(result)
    assert result.box_order.unreadable_pages == [3]
    assert result.box_order.status == ltl.WARN


def test_box_tag_from_another_shipment_fails():
    doc = fitz.open(WRONG)
    doc.select([16])  # FBA19WBXZVZZ - B1
    _replace_text(doc, 0, "FBA19WBXZVZZ - B1", "FBA19WTTW2CG - B1")
    result = ltl.check_pdf_bytes("other-shipment.pdf", doc.tobytes())
    contents = next(c for c in result.boxes[0].checks if c.id == "box.contents")
    assert contents.status == ltl.FAIL
    assert "does not match the Box ID shipment" in contents.detail


# --------------------------------------------------------------------------- wrong formats
def test_original_two_page_box_plus_ups_label_is_not_the_ltl_format():
    original = Path(__file__).resolve().parent.parent / "fixtures" / "label_format" / "FBA19Y05XLDY-FBADNK17112026.pdf"
    result = ltl.check_pdf_bytes(original.name, original.read_bytes())
    assert result.status == ltl.FILE_FAIL
    # page 1 has the notice at the bottom / a 'Box N of M' line; page 2 is a UPS image
    assert {"box.notice", "box.text"} <= _failed_ids(result)


def test_letter_size_page_fails():
    src = fitz.open(CORRECT)
    out = fitz.open()
    page = out.new_page(width=612, height=792)
    page.show_pdf_page(fitz.Rect(0, 0, 306, 432), src, 0)
    result = ltl.check_pdf_bytes("letter.pdf", out.tobytes())
    assert "box.size" in _failed_ids(result)


def test_rasterized_label_fails():
    src = fitz.open(CORRECT)
    out = fitz.open()
    page = out.new_page(width=306, height=432)
    page.insert_image(page.rect, pixmap=src[0].get_pixmap(dpi=150))
    result = ltl.check_pdf_bytes("scan.pdf", out.tobytes())
    assert "box.text" in _failed_ids(result)


def test_shifted_label_fails_layout_checks():
    src = fitz.open(CORRECT)
    out = fitz.open()
    page = out.new_page(width=306, height=432)
    page.show_pdf_page(fitz.Rect(10, 0, 316, 432), src, 0)
    result = ltl.check_pdf_bytes("shifted.pdf", out.tobytes())
    assert result.status == ltl.FILE_FAIL
    assert _failed_ids(result) & {"box.title", "box.ship_from", "box.ship_to", "box.graphics"}


def test_box_id_text_not_matching_barcode_fails():
    doc = fitz.open(CORRECT)
    doc.select([0])
    page = doc[0]
    rect = page.search_for("FBA19WTTW2CGU000001")[0]
    page.add_redact_annot(fitz.Rect(rect.x0, rect.y0 + 3, rect.x1, rect.y1 - 3), fill=(1, 1, 1))
    page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE, graphics=fitz.PDF_REDACT_LINE_ART_NONE)
    page.insert_text((rect.x0, rect.y1 - 2.5), "FBA19WTTW2CGU000009", fontsize=8, fontname="helv")
    result = ltl.check_pdf_bytes("mismatch.pdf", doc.tobytes())
    barcode = next(c for c in result.boxes[0].checks if c.id == "box.barcode")
    assert barcode.status == ltl.FAIL
    assert "FBA19WTTW2CGU000001" in barcode.detail and "FBA19WTTW2CGU000009" in barcode.detail


def test_unexpected_text_is_review_not_failure():
    doc = fitz.open(CORRECT)
    doc.select([0])
    doc[0].insert_text((20, 350), "HANDLE WITH CARE", fontsize=8, fontname="helv")
    result = ltl.check_pdf_bytes("extra.pdf", doc.tobytes())
    assert result.status == ltl.FILE_REVIEW
    assert _warned_ids(result) == {"box.extra"}


def test_labels_from_two_shipments_in_one_pdf_are_review():
    doc = fitz.open(CORRECT)
    doc.select([0, 1])
    other = fitz.open(WRONG)
    doc.insert_pdf(other, from_page=20, to_page=20)  # FBA19WBXZVZZ - B3
    result = ltl.check_pdf_bytes("mixed-shipments.pdf", doc.tobytes())
    consistency = _file_check(result, "file.consistency")
    assert consistency.status == ltl.WARN
    assert "shipment ID" in consistency.detail


def test_filename_with_another_shipment_id_is_review():
    result = ltl.check_pdf_bytes("FBA19WBXZVZZ-labels.pdf", CORRECT.read_bytes())
    assert _warned_ids(result) == {"file.filename"}


def test_password_protected_pdf_fails():
    data = fitz.open(CORRECT).tobytes(encryption=fitz.PDF_ENCRYPT_AES_256, owner_pw="o", user_pw="u")
    result = ltl.check_pdf_bytes("locked.pdf", data)
    assert result.status == ltl.FILE_FAIL
    assert "password" in result.checks[0].detail


# --------------------------------------------------------------------------- previews
def test_thumbnails_prefer_out_of_order_pages():
    order = list(range(29))
    order[20], order[25] = order[25], order[20]
    result = ltl.check_pdf_bytes("late-swap.pdf", _pages(CORRECT, order))
    pages = [t["page"] for t in result.thumbnails]
    assert len(pages) == ltl.MAX_THUMBNAIL_PAGES
    assert 21 in pages and 26 in pages
    assert all(t["src"].startswith("data:image/png;base64,") for t in result.thumbnails)


# --------------------------------------------------------------------------- uploads
def _zip_of(members: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, data in members.items():
            zf.writestr(name, data)
    return buf.getvalue()


def test_batch_of_pdfs_and_summary_counts():
    run = ltl.check_uploads([(CORRECT.name, CORRECT.read_bytes()), (WRONG.name, WRONG.read_bytes())])
    assert run.source_kind == "batch"
    assert run.summary() == {
        "total": 2, "passed": 1, "review": 0, "failed": 1, "skipped": 0, "out_of_order": 1,
    }


def test_zip_upload_checks_every_pdf_and_skips_the_rest():
    raw = _zip_of(
        {
            f"labels/{CORRECT.name}": CORRECT.read_bytes(),
            f"labels/{WRONG.name}": WRONG.read_bytes(),
            "notes.txt": b"hello",
            f"__MACOSX/._{CORRECT.name}": b"junk",
        }
    )
    run = ltl.check_uploads([("labels.zip", raw)])
    assert run.source_kind == "zip"
    assert run.summary()["total"] == 2
    assert run.summary()["skipped"] == 1


def test_same_pdf_twice_flags_duplicate_box_ids_across_files():
    run = ltl.check_uploads([("a.pdf", CORRECT.read_bytes()), ("b.pdf", CORRECT.read_bytes())])
    by_path = {f.path: f for f in run.files}
    assert by_path["a.pdf"].status == ltl.FILE_PASS
    assert "file.duplicate" in _warned_ids(by_path["b.pdf"])


@pytest.mark.parametrize(
    "name,payload,message",
    [
        ("labels.txt", b"x", "not supported"),
        ("labels.pdf", b"", "empty"),
        ("labels.pdf", b"this is not a pdf", "not a PDF"),
        ("labels.zip", b"not a zip", "not a valid ZIP"),
    ],
)
def test_unusable_uploads_raise_clear_errors(name, payload, message):
    with pytest.raises(ltl.LtlLabelFormatCheckerError, match=message):
        ltl.check_uploads([(name, payload)])


# --------------------------------------------------------------------------- report
def test_report_workbook_has_box_order_sheet():
    run = ltl.check_uploads([(CORRECT.name, CORRECT.read_bytes()), (WRONG.name, WRONG.read_bytes())])
    wb = load_workbook(io.BytesIO(ltl.build_report_xlsx(run)))
    assert wb.sheetnames == ["Summary", "Results", "Box order", "Check details"]

    results = {row[0]: row for row in list(wb["Results"].iter_rows(values_only=True))[1:]}
    assert results[CORRECT.name][1] == "PASS" and results[CORRECT.name][4] == "IN ORDER"
    assert results[WRONG.name][1] == "FAIL" and results[WRONG.name][4] == "OUT OF ORDER"
    assert results[WRONG.name][5] == 61

    order_rows = list(wb["Box order"].iter_rows(values_only=True))
    assert order_rows[0] == ("File", "Page", "Box ID", "Box tag", "Found", "Expected", "Result")
    assert len(order_rows) == 1 + 29 + 63
    wrong_rows = [r for r in order_rows[1:] if r[0] == WRONG.name]
    assert wrong_rows[1][3:] == ("FBA19WBXZVZZ - B42", "B42", "B2", "FAIL")
    assert wrong_rows[10][6] == "PASS"

    summary = {row[0]: row[1] for row in wb["Summary"].iter_rows(values_only=True) if row[0]}
    assert summary["PDFs with boxes out of order"] == 1


def test_report_filename_is_safe():
    run = ltl.check_uploads([("FBA19WTTW2CG.zip", _zip_of({CORRECT.name: CORRECT.read_bytes()}))])
    assert ltl.report_filename(run) == "LTL Label Format Check - FBA19WTTW2CG.xlsx"


def test_result_json_is_serialisable():
    run = ltl.check_uploads([(WRONG.name, WRONG.read_bytes())])
    payload = json.loads(json.dumps(run.to_dict()))
    file = payload["files"][0]
    assert file["box_order"]["out_of_order"] == 61
    assert file["shipment_id"] == "FBA19WBXZVZZ"
