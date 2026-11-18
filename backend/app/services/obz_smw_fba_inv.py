"""Split an Amazon FBA inventory ledger into OBZ + SMW FBA INV workbooks.

The upload is Amazon's inventory-ledger CSV (plain ``.csv`` or zipped). The
download is a ZIP with two Excel workbooks whose ``FBA INV`` sheets match the
OBZ weekly report / sales-report masterfile layout:

* Date (datetime, ``mm-dd-yy``)
* FNSKU, ASIN, Vendor, MSKU, Title, Disposition (text)
* Ending Warehouse Balance (integer)
* Location (text)
"""
from __future__ import annotations

import csv
import io
import json
import re
import zipfile
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Mapping, Sequence

from openpyxl import Workbook
from openpyxl.cell import WriteOnlyCell
from openpyxl.styles import Font

MAX_UPLOAD_BYTES = 60 * 1024 * 1024
MAX_ROWS = 500_000

SHEET_NAME = "FBA INV"
_MAPS_PATH = Path(__file__).resolve().parent.parent / "data" / "obz_smw_fba_inv_maps.json"

# Column widths taken from the golden OBZ / masterfile FBA INV sheets.
_COLUMN_WIDTHS = {
    "A": 10.33203125,
    "B": 14.6640625,
    "D": 6.77734375,  # weekly Vendor width; master uses a wider D — set per workbook
    "E": 27.77734375,
    "F": 216.5546875,
    "G": 21.5546875,
    "H": 23.109375,
    "I": 7.88671875,
}
_MASTER_VENDOR_COL_WIDTH = 22.0

_HEADER_FONT = Font(name="Aptos Narrow", size=11, bold=False)
_DATA_FONT = Font(name="Aptos Narrow", size=11, bold=False)
_DATE_FORMAT = "mm-dd-yy"

_UPC_RE = re.compile(r"^\d{8,14}$")
_REQUIRED_COLUMNS = (
    "Date",
    "FNSKU",
    "ASIN",
    "MSKU",
    "Title",
    "Disposition",
    "Ending Warehouse Balance",
    "Location",
)


class ObzSmwFbaInvError(ValueError):
    """The upload is not an inventory ledger we can split."""


@dataclass(frozen=True)
class InvRow:
    report_date: datetime
    fnsku: str
    asin: str
    vendor: str
    msku: str
    title: str
    disposition: str
    ending_balance: int
    location: str


@dataclass(frozen=True)
class GenerateResult:
    zip_bytes: bytes
    zip_filename: str
    weekly_filename: str
    master_filename: str
    ledger_date: date
    source_rows: int
    obz_rows: int
    smw_rows: int
    dropped_amzn_rows: int
    skipped_other_rows: int


def _load_bundled_maps() -> tuple[dict[str, str], dict[str, str], dict[str, str]]:
    if not _MAPS_PATH.is_file():
        return {}, {}, {}
    raw = json.loads(_MAPS_PATH.read_text(encoding="utf-8"))
    return (
        {str(k): str(v) for k, v in (raw.get("sw_style_to_upc") or {}).items()},
        {str(k): str(v) for k, v in (raw.get("old_sku_to_upc") or {}).items()},
        {str(k): str(v) for k, v in (raw.get("asin_to_upc") or {}).items()},
    )


def extract_ledger_csv_bytes(filename: str, payload: bytes) -> bytes:
    name = (filename or "upload").lower()
    if name.endswith(".zip"):
        try:
            with zipfile.ZipFile(io.BytesIO(payload)) as zf:
                csv_names = [
                    info.filename
                    for info in zf.infolist()
                    if not info.is_dir() and info.filename.lower().endswith(".csv")
                ]
                if not csv_names:
                    raise ObzSmwFbaInvError("The ZIP does not contain a .csv inventory ledger.")
                # Prefer a root-level CSV; otherwise the first CSV entry.
                csv_names.sort(key=lambda n: (n.count("/"), n.count("\\"), n))
                return zf.read(csv_names[0])
        except zipfile.BadZipFile as exc:
            raise ObzSmwFbaInvError("The upload is not a valid ZIP file.") from exc
    if name.endswith(".csv"):
        return payload
    raise ObzSmwFbaInvError('Upload a .csv inventory ledger or a .zip that contains one.')


def _parse_ledger_date(value: str) -> datetime:
    text = (value or "").strip()
    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%m-%d-%Y", "%m/%d/%y"):
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    raise ObzSmwFbaInvError(f'Could not parse ledger date "{text}".')


def _ending_balance(value: object) -> int:
    if value is None or value == "":
        return 0
    try:
        return int(float(str(value).strip()))
    except (TypeError, ValueError) as exc:
        raise ObzSmwFbaInvError(f'Invalid Ending Warehouse Balance "{value}".') from exc


def _clean_msku(raw: str) -> tuple[str | None, str]:
    """Return ``(cleaned_msku_or_None_if_drop, kind)``."""
    m = (raw or "").strip()
    if m.upper().endswith("-FNSKU"):
        return m[:-6], "fnsku_suffix"
    if m.endswith("_FBM"):
        return m[:-4], "fbm"
    if m.startswith("amzn.gr."):
        return None, "amzn"
    if ".missing" in m:
        return m, "missing"
    return m, "ok"


def _detect_vendor(title: str) -> str | None:
    text = title or ""
    lower = text.lower()
    if "oboz" in lower:
        return "OBZ"
    if "smartwool" in lower or "smart wool" in lower:
        return "SMW"
    # Amazon sometimes omits the brand name on Merino kids gaiters.
    if text.startswith("Merino 250 Neck Gaiter"):
        return "SMW"
    return None


def _resolve_msku(
    asin: str,
    msku: str,
    *,
    old_sku_to_upc: Mapping[str, str],
    sw_style_to_upc: Mapping[str, str],
    asin_to_upc: Mapping[str, str],
    inv_asin_upcs: Mapping[str, Counter],
) -> str:
    if msku in old_sku_to_upc:
        return old_sku_to_upc[msku]
    if msku.startswith("SW_") and msku in sw_style_to_upc:
        return sw_style_to_upc[msku]
    if _UPC_RE.match(msku) and not msku.startswith("999"):
        return msku
    counts = inv_asin_upcs.get(asin)
    if counts:
        return counts.most_common(1)[0][0]
    if asin in asin_to_upc:
        return asin_to_upc[asin]
    return msku


def _read_ledger_rows(csv_bytes: bytes) -> list[dict[str, str]]:
    # Amazon ledgers are UTF-8; fall back for Excel-saved copies.
    for encoding in ("utf-8-sig", "utf-8", "cp1252"):
        try:
            text = csv_bytes.decode(encoding)
            break
        except UnicodeDecodeError:
            text = None
    else:
        text = csv_bytes.decode("utf-8", errors="replace")

    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise ObzSmwFbaInvError("The inventory ledger has no header row.")
    fields = {(h or "").strip() for h in reader.fieldnames}
    missing = [col for col in _REQUIRED_COLUMNS if col not in fields]
    if missing:
        raise ObzSmwFbaInvError(
            "This does not look like an Amazon inventory ledger. Missing columns: "
            + ", ".join(missing)
        )
    rows = list(reader)
    if not rows:
        raise ObzSmwFbaInvError("The inventory ledger has no data rows.")
    if len(rows) > MAX_ROWS:
        raise ObzSmwFbaInvError(f"The inventory ledger is too large (max {MAX_ROWS:,} rows).")
    return rows


def _build_vendor_rows(
    ledger_rows: Sequence[Mapping[str, str]],
    vendor: str,
    *,
    old_sku_to_upc: Mapping[str, str],
    sw_style_to_upc: Mapping[str, str],
    asin_to_upc: Mapping[str, str],
) -> tuple[list[InvRow], int]:
    """Return cleaned rows for one vendor plus the amzn.gr drop count for that vendor."""
    dropped_amzn = 0
    pending: list[tuple[Mapping[str, str], str, bool]] = []
    inv_asin_upcs: dict[str, Counter] = defaultdict(Counter)

    for row in ledger_rows:
        if (row.get("Disposition") or "").strip() != "SELLABLE":
            continue
        title = row.get("Title") or ""
        if _detect_vendor(title) != vendor:
            continue
        cleaned, kind = _clean_msku(row.get("MSKU") or "")
        if kind == "amzn" or cleaned is None:
            dropped_amzn += 1
            continue

        msku = cleaned
        if msku in old_sku_to_upc:
            msku = old_sku_to_upc[msku]
        elif msku.startswith("SW_") and msku in sw_style_to_upc:
            msku = sw_style_to_upc[msku]

        if _UPC_RE.match(msku) and not msku.startswith("999"):
            inv_asin_upcs[row.get("ASIN") or ""][msku] += 1
            pending.append((row, msku, True))
        else:
            pending.append((row, cleaned, False))

    out: list[InvRow] = []
    for row, msku0, resolved in pending:
        msku = msku0
        if not resolved:
            msku = _resolve_msku(
                row.get("ASIN") or "",
                msku0,
                old_sku_to_upc=old_sku_to_upc,
                sw_style_to_upc=sw_style_to_upc,
                asin_to_upc=asin_to_upc,
                inv_asin_upcs=inv_asin_upcs,
            )
        out.append(
            InvRow(
                report_date=_parse_ledger_date(row.get("Date") or ""),
                fnsku=str(row.get("FNSKU") or "").strip(),
                asin=str(row.get("ASIN") or "").strip(),
                vendor=vendor,
                msku=str(msku),
                title=str(row.get("Title") or ""),
                disposition="SELLABLE",
                ending_balance=_ending_balance(row.get("Ending Warehouse Balance")),
                location=str(row.get("Location") or "").strip(),
            )
        )
    return out, dropped_amzn


def _format_date_token(value: date) -> str:
    return f"{value.month}.{value.day}.{value.strftime('%y')}"


def _workbook_bytes(rows: Sequence[InvRow], *, vendor_header: str | None) -> bytes:
    """Build an FBA INV workbook quickly via write-only mode."""
    wb = Workbook(write_only=True)
    ws = wb.create_sheet(title=SHEET_NAME)

    widths = dict(_COLUMN_WIDTHS)
    if vendor_header is None:
        widths["D"] = _MASTER_VENDOR_COL_WIDTH
    for col_letter, width in widths.items():
        ws.column_dimensions[col_letter].width = width

    headers = [
        "Date",
        "FNSKU",
        "ASIN",
        vendor_header,  # "Vendor" for OBZ weekly; blank for masterfile
        "MSKU",
        None,  # title column has no header in the golden files
        "Disposition",
        "Ending Warehouse Balance",
        "Location",
    ]
    header_cells: list[WriteOnlyCell] = []
    for value in headers:
        cell = WriteOnlyCell(ws, value=value)
        cell.font = _HEADER_FONT
        header_cells.append(cell)
    ws.append(header_cells)

    for row in rows:
        date_cell = WriteOnlyCell(ws, value=row.report_date)
        date_cell.font = _DATA_FONT
        date_cell.number_format = _DATE_FORMAT

        msku_cell = WriteOnlyCell(ws, value=str(row.msku))
        msku_cell.font = _DATA_FONT
        msku_cell.number_format = "@"  # keep numeric-looking UPCs as text

        end_cell = WriteOnlyCell(ws, value=int(row.ending_balance))
        end_cell.font = _DATA_FONT
        end_cell.number_format = "General"

        # Plain strings keep text type; styled cells enforce date / MSKU-text / int balance.
        ws.append(
            [
                date_cell,
                row.fnsku,
                row.asin,
                row.vendor,
                msku_cell,
                row.title,
                row.disposition,
                end_cell,
                row.location,
            ]
        )

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _build_zip(
    weekly_name: str,
    weekly_bytes: bytes,
    master_name: str,
    master_bytes: bytes,
) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(weekly_name, weekly_bytes)
        zf.writestr(master_name, master_bytes)
    return buf.getvalue()


def generate_fba_inv_reports(
    filename: str,
    payload: bytes,
    *,
    extra_old_sku_to_upc: Mapping[str, str] | None = None,
) -> GenerateResult:
    """Parse an inventory ledger upload and build the OBZ + SMW FBA INV ZIP."""
    if not payload:
        raise ObzSmwFbaInvError("The upload is empty.")
    if len(payload) > MAX_UPLOAD_BYTES:
        raise ObzSmwFbaInvError(f"The upload is too large (max {MAX_UPLOAD_BYTES // (1024 * 1024)} MB).")

    csv_bytes = extract_ledger_csv_bytes(filename, payload)
    ledger_rows = _read_ledger_rows(csv_bytes)

    sw_map, old_map, asin_map = _load_bundled_maps()
    if extra_old_sku_to_upc:
        merged_old = dict(old_map)
        merged_old.update({str(k): str(v) for k, v in extra_old_sku_to_upc.items() if k and v})
        old_map = merged_old

    obz_rows, obz_dropped = _build_vendor_rows(
        ledger_rows,
        "OBZ",
        old_sku_to_upc=old_map,
        sw_style_to_upc=sw_map,
        asin_to_upc=asin_map,
    )
    smw_rows, smw_dropped = _build_vendor_rows(
        ledger_rows,
        "SMW",
        old_sku_to_upc=old_map,
        sw_style_to_upc=sw_map,
        asin_to_upc=asin_map,
    )

    if not obz_rows and not smw_rows:
        raise ObzSmwFbaInvError(
            "No OBZ or SMW sellable inventory rows were found in this ledger."
        )

    ledger_date = (obz_rows or smw_rows)[0].report_date.date()
    date_token = _format_date_token(ledger_date)
    weekly_filename = f"OBZ WEEKLY SALES REPORT WE {date_token}.xlsx"
    master_filename = f"SALES REPORT MASTERFILE {date_token}.xlsx"
    zip_filename = f"OBZ_SMW FBA INV {date_token}.zip"

    weekly_bytes = _workbook_bytes(obz_rows, vendor_header="Vendor")
    master_bytes = _workbook_bytes(smw_rows, vendor_header=None)
    zip_bytes = _build_zip(weekly_filename, weekly_bytes, master_filename, master_bytes)

    skipped_other = len(ledger_rows) - len(obz_rows) - len(smw_rows) - obz_dropped - smw_dropped
    return GenerateResult(
        zip_bytes=zip_bytes,
        zip_filename=zip_filename,
        weekly_filename=weekly_filename,
        master_filename=master_filename,
        ledger_date=ledger_date,
        source_rows=len(ledger_rows),
        obz_rows=len(obz_rows),
        smw_rows=len(smw_rows),
        dropped_amzn_rows=obz_dropped + smw_dropped,
        skipped_other_rows=max(0, skipped_other),
    )
