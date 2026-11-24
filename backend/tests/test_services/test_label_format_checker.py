"""Tests for the Label Format Checker (Amazon FBA box labels, Thermal Printing - 4x6 inches).

The fixtures are two real Amazon label PDFs (page 1 box label + page 2 UPS label): one
"Mixed SKUs" box and one "Single SKU" box. Negative cases are produced by damaging a
real label in one specific way and asserting the matching check fails.
"""
from __future__ import annotations

import io
import zipfile
from pathlib import Path

import pytest

fitz = pytest.importorskip("fitz")

from openpyxl import load_workbook  # noqa: E402

from app.services import label_format_checker as lfc  # noqa: E402

FIXTURES = Path(__file__).resolve().parent.parent / "fixtures" / "label_format"
MIXED = FIXTURES / "FBA19Y05XLDY-FBADNK17112026.pdf"
SINGLE = FIXTURES / "FBA19Y08MQFZ-FBADNK25112026.pdf"


def _bytes(path: Path) -> bytes:
    return path.read_bytes()


def _statuses(result: lfc.FileResult) -> dict[str, str]:
    return {c.id: c.status for c in result.all_checks}


def _failed_ids(result: lfc.FileResult) -> set[str]:
    return {c.id for c in result.all_checks if c.status == lfc.FAIL}


def _warned_ids(result: lfc.FileResult) -> set[str]:
    return {c.id for c in result.all_checks if c.status == lfc.WARN}


def _replace_text(doc, page_index: int, old: str, new: str, fontsize: float = 8) -> None:
    page = doc[page_index]
    rects = page.search_for(old)
    assert rects, f"'{old}' not found on page {page_index + 1}"
    rect = rects[0]
    # Redact only the middle band of the line: text lines sit 8 pt apart, so the full
    # glyph box would also clip the lines above and below.
    page.add_redact_annot(fitz.Rect(rect.x0, rect.y0 + 3.5, rect.x1, rect.y1 - 3.6), fill=(1, 1, 1))
    page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE, graphics=fitz.PDF_REDACT_LINE_ART_NONE)
    page.insert_text((rect.x0, rect.y1 - 2), new, fontsize=fontsize, fontname="helv")


def _shifted_copy(path: Path, dx: float, dy: float, pages: tuple[int, ...] = (0, 1)) -> bytes:
    src = fitz.open(path)
    out = fitz.open()
    for pno in range(src.page_count):
        page = out.new_page(width=306, height=432)
        if pno in pages:
            page.show_pdf_page(fitz.Rect(dx, dy, 306 + dx, 432 + dy), src, pno)
        else:
            page.show_pdf_page(page.rect, src, pno)
    return out.tobytes()


# --------------------------------------------------------------------------- real labels
@pytest.mark.parametrize("path", [MIXED, SINGLE], ids=["mixed-skus", "single-sku"])
def test_real_labels_pass_every_check(path: Path):
    result = lfc.check_pdf_bytes(path.name, _bytes(path))
    assert result.status == lfc.FILE_PASS, [
        (c.id, c.detail) for c in result.all_checks if c.status != lfc.PASS
    ]
    assert result.page_count == 2
    assert len(result.boxes) == 1
    assert len(result.thumbnails) == 2
    # Every check family ran
    ids = {c.id for c in result.all_checks}
    assert {
        "file.readable", "file.pages", "file.filename", "box.size", "box.text", "box.title",
        "box.ship_from", "box.ship_to", "box.strip", "box.box_id", "box.barcode", "box.pdf417",
        "box.contents", "box.footer", "box.graphics", "box.extra", "ups.size", "ups.image", "ups.layout",
    } <= ids


def test_extracted_fields_mixed_skus():
    result = lfc.check_pdf_bytes(MIXED.name, _bytes(MIXED))
    f = result.boxes[0].fields
    assert f["box_id"] == "FBA19Y05XLDYU000001"
    assert f["shipment_name"] == "FBADNK17112026"
    assert (f["box_number"], f["box_total"], f["weight_lb"]) == (1, 1, 21.0)
    assert f["fulfillment_center"] == "RYY2"
    assert f["ship_to_name"] == "PM Shoes Inc"
    assert f["created"] == "2026/11/20 11:46 EST (-05)"
    assert f["contents"] == "Mixed SKUs"
    assert f["pack_group_box"] == "P1 - B1"


def test_extracted_fields_single_sku():
    result = lfc.check_pdf_bytes(SINGLE.name, _bytes(SINGLE))
    f = result.boxes[0].fields
    assert f["contents"] == "Single SKU"
    assert f["sku"] == "673088535001"
    assert f["qty"] == 2
    assert f["weight_lb"] == 5.0


def test_barcode_decodes_to_the_printed_box_id():
    doc = fitz.open(MIXED)
    decoded, rect = lfc._decode_barcode_from_drawings(doc[0].get_drawings())
    assert decoded == "FBA19Y05XLDYU000001"
    assert rect is not None


# --------------------------------------------------------------------------- upload handling
def _zip_of(members: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, data in members.items():
            zf.writestr(name, data)
    return buf.getvalue()


def test_single_pdf_upload():
    run = lfc.check_upload(MIXED.name, _bytes(MIXED))
    assert run.source_kind == "pdf"
    assert run.summary() == {"total": 1, "passed": 1, "review": 0, "failed": 0, "skipped": 0}


def test_multiple_pdf_uploads_are_checked_as_one_batch():
    run = lfc.check_uploads(
        [
            (MIXED.name, _bytes(MIXED)),
            (SINGLE.name, _bytes(SINGLE)),
        ]
    )
    assert run.source_kind == "batch"
    assert run.summary() == {"total": 2, "passed": 2, "review": 0, "failed": 0, "skipped": 0}
    assert {f.name for f in run.files} == {MIXED.name, SINGLE.name}
    assert MIXED.name in run.source_name and SINGLE.name in run.source_name


def test_multiple_uploads_flag_duplicate_box_ids_across_files():
    run = lfc.check_uploads(
        [
            ("first.pdf", _bytes(MIXED)),
            ("second.pdf", _bytes(MIXED)),
        ]
    )
    by_path = {f.path: f for f in run.files}
    assert by_path["first.pdf"].status == lfc.FILE_PASS
    assert by_path["second.pdf"].status == lfc.FILE_REVIEW
    assert "file.duplicate" in _warned_ids(by_path["second.pdf"])


def test_zip_upload_checks_every_pdf_and_skips_the_rest():
    raw = _zip_of(
        {
            "FBADNK17112026/FBA19Y05XLDY-FBADNK17112026.pdf": _bytes(MIXED),
            "FBADNK25112026/FBA19Y08MQFZ-FBADNK25112026.pdf": _bytes(SINGLE),
            "notes.txt": b"hello",
            "__MACOSX/._FBA19Y05XLDY-FBADNK17112026.pdf": b"junk",
        }
    )
    run = lfc.check_upload("labels.zip", raw)
    assert run.source_kind == "zip"
    assert run.summary() == {"total": 2, "passed": 2, "review": 0, "failed": 0, "skipped": 1}
    assert run.skipped[0].name == "notes.txt"
    assert {f.name for f in run.files} == {
        "FBA19Y05XLDY-FBADNK17112026.pdf",
        "FBA19Y08MQFZ-FBADNK25112026.pdf",
    }


def test_zip_flags_the_same_box_id_in_two_files():
    raw = _zip_of({"a.pdf": _bytes(MIXED), "b.pdf": _bytes(MIXED)})
    run = lfc.check_upload("dupes.zip", raw)
    by_name = {f.name: f for f in run.files}
    assert by_name["a.pdf"].status == lfc.FILE_PASS
    assert by_name["b.pdf"].status == lfc.FILE_REVIEW
    assert "file.duplicate" in _warned_ids(by_name["b.pdf"])


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
    with pytest.raises(lfc.LabelFormatCheckerError, match=message):
        lfc.check_upload(name, payload)


def test_zip_without_pdfs_is_rejected():
    with pytest.raises(lfc.LabelFormatCheckerError, match="does not contain any PDF"):
        lfc.check_upload("x.zip", _zip_of({"a.txt": b"1"}))


def test_corrupt_pdf_inside_zip_fails_without_aborting_the_rest():
    raw = _zip_of({"good.pdf": _bytes(MIXED), "bad.pdf": b"%PDF-1.4 garbage"})
    run = lfc.check_upload("mixed.zip", raw)
    by_name = {f.name: f for f in run.files}
    assert by_name["good.pdf"].status == lfc.FILE_PASS
    assert by_name["bad.pdf"].status == lfc.FILE_FAIL
    assert "file.readable" in _failed_ids(by_name["bad.pdf"])


def test_password_protected_pdf_fails():
    doc = fitz.open(MIXED)
    data = doc.tobytes(encryption=fitz.PDF_ENCRYPT_AES_256, owner_pw="o", user_pw="u")
    result = lfc.check_pdf_bytes("locked.pdf", data)
    assert result.status == lfc.FILE_FAIL
    assert "password" in result.checks[0].detail


# --------------------------------------------------------------------------- wrong formats
def test_letter_size_page_fails():
    src = fitz.open(MIXED)
    out = fitz.open()
    for pno in range(2):
        page = out.new_page(width=612, height=792)
        page.show_pdf_page(fitz.Rect(0, 0, 306, 432), src, pno)
    result = lfc.check_pdf_bytes("letter.pdf", out.tobytes())
    failed = _failed_ids(result)
    assert {"box.size", "ups.size"} <= failed
    assert result.status == lfc.FILE_FAIL


def test_missing_ups_page_fails():
    doc = fitz.open(MIXED)
    doc.delete_page(1)
    result = lfc.check_pdf_bytes("one-page.pdf", doc.tobytes())
    failed = _failed_ids(result)
    assert "file.pages" in failed
    assert "ups.missing" in failed


def test_pages_in_the_wrong_order_fail():
    doc = fitz.open(MIXED)
    doc.move_page(1, 0)
    result = lfc.check_pdf_bytes("swapped.pdf", doc.tobytes())
    failed = _failed_ids(result)
    assert "box.text" in failed
    assert "ups.image" in failed
    assert result.status == lfc.FILE_FAIL


def test_rasterized_box_label_fails():
    src = fitz.open(MIXED)
    out = fitz.open()
    pix = src[0].get_pixmap(dpi=150)
    page = out.new_page(width=306, height=432)
    page.insert_image(page.rect, pixmap=pix)
    out.insert_pdf(src, from_page=1, to_page=1)
    result = lfc.check_pdf_bytes("scan.pdf", out.tobytes())
    assert "box.text" in _failed_ids(result)


def test_box_id_text_not_matching_barcode_fails():
    doc = fitz.open(MIXED)
    _replace_text(doc, 0, "FBA19Y05XLDYU000001", "FBA19Y05XLDYU000002")
    result = lfc.check_pdf_bytes("mismatch.pdf", doc.tobytes())
    barcode = next(c for c in result.all_checks if c.id == "box.barcode")
    assert barcode.status == lfc.FAIL
    assert "FBA19Y05XLDYU000001" in barcode.detail and "FBA19Y05XLDYU000002" in barcode.detail


def test_malformed_box_line_fails():
    doc = fitz.open(MIXED)
    _replace_text(doc, 0, "Box 1 of 1 - 21lb", "Box 1 - 21 kg", fontsize=14.6)
    result = lfc.check_pdf_bytes("kg.pdf", doc.tobytes())
    assert "box.title" in _failed_ids(result)


def test_box_number_greater_than_total_fails():
    doc = fitz.open(MIXED)
    _replace_text(doc, 0, "Box 1 of 1 - 21lb", "Box 3 of 2 - 21lb", fontsize=14.6)
    result = lfc.check_pdf_bytes("badnum.pdf", doc.tobytes())
    assert "box.title" in _failed_ids(result)


def test_shifted_box_label_fails_layout_checks():
    result = lfc.check_pdf_bytes("shifted.pdf", _shifted_copy(MIXED, 10, 0, pages=(0,)))
    assert result.status == lfc.FILE_FAIL
    assert _failed_ids(result) & {"box.title", "box.ship_from", "box.ship_to", "box.strip", "box.graphics"}


def test_shifted_ups_label_fails_layout():
    result = lfc.check_pdf_bytes("ups-shifted.pdf", _shifted_copy(MIXED, 0, 12, pages=(1,)))
    assert "ups.layout" in _failed_ids(result) or "ups.image" in _failed_ids(result)


def test_ups_page_replaced_by_the_box_label_fails():
    src = fitz.open(MIXED)
    out = fitz.open()
    out.insert_pdf(src, from_page=0, to_page=0)
    pix = src[0].get_pixmap(dpi=150)
    page = out.new_page(width=306, height=432)
    page.insert_image(fitz.Rect(31, 5, 275, 371), pixmap=pix)
    result = lfc.check_pdf_bytes("dup.pdf", out.tobytes())
    assert "ups.layout" in _failed_ids(result)


def test_odd_extra_page_fails():
    src = fitz.open(MIXED)
    src.insert_pdf(fitz.open(MIXED), from_page=0, to_page=0)
    result = lfc.check_pdf_bytes("three.pdf", src.tobytes())
    assert "file.pages" in _failed_ids(result)


# --------------------------------------------------------------------------- advisory (review) items
def test_unexpected_text_is_review_not_failure():
    doc = fitz.open(MIXED)
    doc[0].insert_text((20, 350), "HANDLE WITH CARE", fontsize=8, fontname="helv")
    result = lfc.check_pdf_bytes("extra.pdf", doc.tobytes())
    assert result.status == lfc.FILE_REVIEW
    assert _warned_ids(result) == {"box.extra"}


def test_other_ship_from_is_review_not_failure():
    doc = fitz.open(MIXED)
    _replace_text(doc, 0, "DANSKO", "OBOZ")
    result = lfc.check_pdf_bytes("other-vendor.pdf", doc.tobytes())
    assert result.status == lfc.FILE_REVIEW
    assert not _failed_ids(result)
    # (box.extra may also warn: the redaction used to edit the fixture leaves a white rectangle)
    assert "box.ship_from" in _warned_ids(result)


def test_filename_that_disagrees_with_the_label_is_review():
    result = lfc.check_pdf_bytes("FBA19Y05XLDY-FBADNK99999999.pdf", _bytes(MIXED))
    assert result.status == lfc.FILE_REVIEW
    assert _warned_ids(result) == {"file.filename"}


def test_filename_variants_used_by_amazon_exports_are_accepted():
    for name in (
        "FBA19Y05XLDY-FBADNK17112026.pdf",
        "FBA19Y05XLDY-FBADNK17112026-1.pdf".replace("-1", ""),
        "My renamed label.pdf",  # not Amazon's pattern: not judged
    ):
        assert lfc.check_pdf_bytes(name, _bytes(MIXED)).status == lfc.FILE_PASS


# --------------------------------------------------------------------------- report
def test_report_workbook_has_summary_results_and_details():
    raw = _zip_of({"a.pdf": _bytes(MIXED), "b.pdf": _bytes(SINGLE), "c.pdf": b"%PDF-1.4 broken"})
    run = lfc.check_upload("batch.zip", raw)
    wb = load_workbook(io.BytesIO(lfc.build_report_xlsx(run)))
    assert wb.sheetnames == ["Summary", "Results", "Check details"]

    results = list(wb["Results"].iter_rows(values_only=True))
    assert results[0][:2] == ("File", "Status")
    by_file = {row[0]: row for row in results[1:]}
    assert by_file["a.pdf"][1] == "PASS"
    assert by_file["a.pdf"][4] == "FBA19Y05XLDYU000001"
    assert by_file["c.pdf"][1] == "FAIL"

    summary = {row[0]: row[1] for row in wb["Summary"].iter_rows(values_only=True) if row[0]}
    assert summary["PDFs checked"] == 3
    assert summary["Passed"] == 2
    assert summary["Failed"] == 1
    assert len(list(wb["Check details"].iter_rows(values_only=True))) > 3 * 5


def test_report_filename_is_safe():
    run = lfc.check_upload("FBADNK17112026.zip", _zip_of({"a.pdf": _bytes(MIXED)}))
    assert lfc.report_filename(run) == "SPD Label Format Check - FBADNK17112026.xlsx"


def test_result_json_is_serialisable():
    import json

    run = lfc.check_upload("a.pdf", _bytes(MIXED))
    payload = json.dumps(run.to_dict())
    assert "FBA19Y05XLDYU000001" in payload
