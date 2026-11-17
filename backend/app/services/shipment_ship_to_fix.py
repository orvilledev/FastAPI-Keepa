"""Ship to correction for FBA shipment exports.

Amazon's "Individual units" CSV names the destination by place ("RANCHO CORDOVA,
CA"), while Seller Central names it by fulfilment-centre code ("MCC1"). The
Shipment Manager only accepts the code, so each export's "Ship to" line has to
be rewritten before it is uploaded to a shipment.

The Seller Central values arrive as (Shipment ID, Ship to) entries — read from a
screenshot and confirmed by the user. Each uploaded export is matched to an
entry by its Shipment ID and that one cell is replaced. Nothing else in the file
changes: every other cell is kept character for character.

The corrected file is written the way Excel saves a CSV (UTF-8 with a byte-order
mark, CRLF line endings, minimal quoting, every row padded to the full width),
which is what the warehouse's hand-corrected "-output" files look like.
"""
from __future__ import annotations

import codecs
import csv
import io
import re
from dataclasses import dataclass
from typing import Dict, List, Optional, Sequence, Tuple

from app.services.shipment_manager import (
    ShipmentManagerError,
    _SHIP_TO_CODE,
    _find_header_row,
    _parse_metadata,
)

STATUS_CORRECTED = "corrected"
STATUS_ALREADY_CORRECT = "already_correct"
STATUS_UNMATCHED = "unmatched"
STATUS_ERROR = "error"

MATCH_EXACT = "exact"
MATCH_FUZZY = "fuzzy"

OUTPUT_SUFFIX = "-output"
MAX_FILES = 50

# A Shipment ID read off a screenshot can carry OCR slips (1 vs I, 5 vs S, a
# stray character). A fuzzy match is accepted only when it is close AND clearly
# better than every other candidate, so a slip can never send a file to the
# wrong shipment.
_MAX_FUZZY_COST = 3.0
_AMBIGUITY_MARGIN = 1.5
_MIN_FUZZY_ID_LENGTH = 8
_CONFUSABLE_COST = 0.35

_CONFUSABLE_GROUPS = ("1ILT7", "0OQD", "5S", "9S", "8B", "2Z", "6G", "UV", "EF")


def _build_confusable_pairs() -> frozenset[tuple[str, str]]:
    pairs: set[tuple[str, str]] = set()
    for group in _CONFUSABLE_GROUPS:
        for first in group:
            for second in group:
                if first != second:
                    pairs.add((first, second))
    return frozenset(pairs)


_CONFUSABLE_PAIRS = _build_confusable_pairs()

_SHIPMENT_ID_SHAPE = re.compile(r"FBA[A-Z0-9]{6,}")
_FILENAME_SHIPMENT_ID = re.compile(r"FBA[A-Z0-9]{9}", re.IGNORECASE)
_META_SHIP_TO_LABEL = "ship to"
_META_SHIPMENT_ID_LABEL = "shipment id"


class ShipToFixError(Exception):
    """Raised when the request itself is unusable (bad entries, too many files)."""


@dataclass(frozen=True)
class ShipToEntry:
    """One shipment as Seller Central lists it."""

    shipment_id: str
    ship_to: str


@dataclass
class ShipToMatch:
    entry: ShipToEntry
    kind: str
    cost: float = 0.0


@dataclass
class ShipToFixOutcome:
    filename: str
    output_filename: str = ""
    status: str = STATUS_ERROR
    message: str = ""
    shipment_id: str = ""
    old_ship_to: str = ""
    new_ship_to: str = ""
    matched_shipment_id: str = ""
    match_kind: str = ""
    content: bytes = b""


@dataclass
class _ParsedExport:
    rows: List[List[str]]
    shipment_id: str
    ship_to_row: int
    old_ship_to: str


def normalize_shipment_id(value: object) -> str:
    """Upper-case letters and digits only — IDs compare regardless of spacing or dashes."""
    return re.sub(r"[^A-Z0-9]", "", str(value or "").upper())


def normalize_ship_to_code(value: object) -> str:
    return str(value or "").strip().upper()


def is_valid_ship_to_code(code: str) -> bool:
    """A fulfilment-centre code is three letters then one or two digits (MCC1, DEN8)."""
    return bool(_SHIP_TO_CODE.fullmatch(code or ""))


def parse_entries(payload: object) -> List[ShipToEntry]:
    """Validate the Seller Central entries sent by the client.

    The same Shipment ID may be repeated (two screenshots can overlap) as long as
    it always carries the same Ship to; two different Ship to values for one ID is
    ambiguous and rejected.
    """
    if not isinstance(payload, list):
        raise ShipToFixError("Seller Central shipments must be sent as a list.")

    entries: Dict[str, ShipToEntry] = {}
    for position, item in enumerate(payload, start=1):
        if not isinstance(item, dict):
            raise ShipToFixError(f"Seller Central shipment #{position} is not valid.")
        shipment_id = normalize_shipment_id(item.get("shipment_id"))
        code = normalize_ship_to_code(item.get("ship_to"))
        if not shipment_id:
            raise ShipToFixError(f"Seller Central shipment #{position} has no Shipment ID.")
        if not _SHIPMENT_ID_SHAPE.fullmatch(shipment_id):
            raise ShipToFixError(
                f"“{shipment_id}” does not look like an Amazon Shipment ID "
                "(it starts with FBA followed by letters and digits)."
            )
        if not code:
            raise ShipToFixError(f"{shipment_id} has no Ship to code.")
        if not is_valid_ship_to_code(code):
            raise ShipToFixError(
                f"“{code}” for {shipment_id} is not a valid Ship to code. "
                "Use the fulfilment-centre code, three letters then one or two digits (e.g. MCC1)."
            )
        existing = entries.get(shipment_id)
        if existing and existing.ship_to != code:
            raise ShipToFixError(
                f"{shipment_id} is listed twice with different Ship to codes "
                f"({existing.ship_to} and {code}). Keep one."
            )
        entries[shipment_id] = ShipToEntry(shipment_id=shipment_id, ship_to=code)

    if not entries:
        raise ShipToFixError("Add at least one Seller Central shipment.")
    return list(entries.values())


def _substitution_cost(first: str, second: str) -> float:
    if first == second:
        return 0.0
    if (first, second) in _CONFUSABLE_PAIRS:
        return _CONFUSABLE_COST
    return 1.0


def id_distance(first: str, second: str) -> float:
    """Edit distance between two Shipment IDs, cheaper for look-alike characters."""
    if first == second:
        return 0.0
    previous = [float(index) for index in range(len(second) + 1)]
    for row, char_a in enumerate(first, start=1):
        current = [float(row)]
        for column, char_b in enumerate(second, start=1):
            current.append(
                min(
                    previous[column] + 1.0,
                    current[column - 1] + 1.0,
                    previous[column - 1] + _substitution_cost(char_a, char_b),
                )
            )
        previous = current
    return previous[-1]


def match_files_to_entries(
    file_ids: Sequence[str], entries: Sequence[ShipToEntry]
) -> Tuple[List[Optional[ShipToMatch]], set[int]]:
    """Pair each file's Shipment ID with a Seller Central entry.

    Exact (normalised) IDs are matched first. Remaining files are then matched
    one-to-one to the entries nobody claimed exactly, by closest ID. Returns the
    match for every file (None when there is none) and the indexes of files whose
    closest candidates were too similar to choose between.
    """
    keys = [normalize_shipment_id(item) for item in file_ids]
    matches: List[Optional[ShipToMatch]] = [None] * len(keys)
    by_id = {entry.shipment_id: entry for entry in entries}

    claimed: set[str] = set()
    for index, key in enumerate(keys):
        entry = by_id.get(key)
        if entry is not None:
            matches[index] = ShipToMatch(entry=entry, kind=MATCH_EXACT)
            claimed.add(key)

    free_entries = [entry for entry in entries if entry.shipment_id not in claimed]
    pending = [
        index
        for index, key in enumerate(keys)
        if matches[index] is None and len(key) >= _MIN_FUZZY_ID_LENGTH
    ]
    ambiguous: set[int] = set()
    if not pending or not free_entries:
        return matches, ambiguous

    costs: Dict[Tuple[int, str], float] = {
        (index, entry.shipment_id): id_distance(keys[index], entry.shipment_id)
        for index in pending
        for entry in free_entries
    }
    candidates: List[Tuple[float, int, ShipToEntry]] = []
    for index in pending:
        for entry in free_entries:
            cost = costs[(index, entry.shipment_id)]
            if cost <= _MAX_FUZZY_COST:
                candidates.append((cost, index, entry))
    ranked = sorted(candidates, key=lambda item: (item[0], item[1], item[2].shipment_id))

    taken_files: set[int] = set()
    taken_entries: set[str] = set()
    for cost, index, entry in ranked:
        if index in taken_files or entry.shipment_id in taken_entries:
            continue
        rival_entry = any(
            costs[(index, other.shipment_id)] - cost < _AMBIGUITY_MARGIN
            for other in free_entries
            if other.shipment_id != entry.shipment_id
        )
        rival_file = any(
            costs[(other, entry.shipment_id)] - cost < _AMBIGUITY_MARGIN
            for other in pending
            if other != index
        )
        if rival_entry or rival_file:
            ambiguous.add(index)
            continue
        matches[index] = ShipToMatch(entry=entry, kind=MATCH_FUZZY, cost=cost)
        taken_files.add(index)
        taken_entries.add(entry.shipment_id)
    return matches, {index for index in ambiguous if matches[index] is None}


def _decode(content: bytes) -> str:
    try:
        return content.decode("utf-8-sig")
    except UnicodeDecodeError:
        try:
            # Excel's plain "CSV (Comma delimited)" save is Windows-1252, not UTF-8.
            return content.decode("cp1252")
        except UnicodeDecodeError as exc:
            raise ShipmentManagerError(
                "That file could not be read as text. Upload the FBA shipment export as a .csv file."
            ) from exc


def _parse_export(filename: str, content: bytes) -> _ParsedExport:
    if not content:
        raise ShipmentManagerError("That file is empty.")
    text = _decode(content)
    first_line = text.split("\n", 1)[0]
    if first_line.count("\t") > first_line.count(","):
        raise ShipmentManagerError(
            "That file is tab-delimited. Upload the FBA shipment export as a comma-separated .csv file."
        )
    try:
        rows = [list(row) for row in csv.reader(io.StringIO(text, newline=""))]
    except csv.Error as exc:
        raise ShipmentManagerError(f"That file is not a valid CSV: {exc}") from exc
    if not rows:
        raise ShipmentManagerError("That file is empty.")

    stripped = [[cell.strip() for cell in row] for row in rows]
    header_index = _find_header_row(stripped)
    metadata = _parse_metadata(stripped, header_index)

    ship_to_row = next(
        (
            index
            for index, row in enumerate(stripped[:header_index])
            if row and row[0].lower() == _META_SHIP_TO_LABEL
        ),
        None,
    )
    if ship_to_row is None:
        raise ShipmentManagerError(
            "This FBA export has no Ship to line, so there is nothing to correct."
        )

    shipment_id = metadata.get(_META_SHIPMENT_ID_LABEL, "")
    if not normalize_shipment_id(shipment_id):
        found = _FILENAME_SHIPMENT_ID.search(filename or "")
        shipment_id = found.group(0) if found else ""
    if not normalize_shipment_id(shipment_id):
        raise ShipmentManagerError(
            "This FBA export has no Shipment ID, so it cannot be matched to Seller Central."
        )

    current = rows[ship_to_row]
    old_ship_to = current[1].strip() if len(current) > 1 else ""
    return _ParsedExport(
        rows=rows,
        shipment_id=shipment_id.strip(),
        ship_to_row=ship_to_row,
        old_ship_to=old_ship_to,
    )


def _render(parsed: _ParsedExport, ship_to: str) -> bytes:
    """Write the export back out with only the Ship to value changed."""
    rows = [list(row) for row in parsed.rows]
    target = rows[parsed.ship_to_row]
    while len(target) < 2:
        target.append("")
    target[1] = ship_to

    width = max(len(row) for row in rows)
    buffer = io.StringIO(newline="")
    writer = csv.writer(buffer, lineterminator="\r\n")
    for row in rows:
        writer.writerow(row + [""] * (width - len(row)))
    return codecs.BOM_UTF8 + buffer.getvalue().encode("utf-8")


def output_filename(filename: str) -> str:
    """'FBA19VYS54V7.csv' -> 'FBA19VYS54V7-output.csv'."""
    leaf = (filename or "").replace("\\", "/").rsplit("/", 1)[-1].strip()
    stem = leaf[: -len(".csv")] if leaf.lower().endswith(".csv") else leaf
    stem = re.sub(r'[\\/:*?"<>|\r\n]+', " ", stem).strip()
    return f"{stem or 'shipment'}{OUTPUT_SUFFIX}.csv"


def correct_exports(
    files: Sequence[Tuple[str, bytes]], entries: Sequence[ShipToEntry]
) -> List[ShipToFixOutcome]:
    """Correct the Ship to line of every export that matches a Seller Central entry.

    One bad file never stops the others: it is reported with its own message and
    the rest are still processed.
    """
    if len(files) > MAX_FILES:
        raise ShipToFixError(f"Upload at most {MAX_FILES} files at a time.")

    outcomes: List[ShipToFixOutcome] = []
    parsed_by_index: Dict[int, _ParsedExport] = {}
    for index, (filename, content) in enumerate(files):
        outcome = ShipToFixOutcome(
            filename=filename, output_filename=output_filename(filename)
        )
        outcomes.append(outcome)
        if not (filename or "").lower().endswith(".csv"):
            outcome.message = "Upload the FBA shipment export as a .csv file."
            continue
        try:
            parsed = _parse_export(filename, content)
        except ShipmentManagerError as exc:
            outcome.message = str(exc)
            continue
        parsed_by_index[index] = parsed
        outcome.shipment_id = parsed.shipment_id
        outcome.old_ship_to = parsed.old_ship_to

    order = sorted(parsed_by_index)
    matches, ambiguous = match_files_to_entries(
        [parsed_by_index[index].shipment_id for index in order], entries
    )
    for position, index in enumerate(order):
        outcome = outcomes[index]
        parsed = parsed_by_index[index]
        match = matches[position]
        if match is None:
            outcome.status = STATUS_UNMATCHED
            outcome.message = (
                "Its Shipment ID is close to more than one Seller Central shipment. "
                "Fix the Shipment IDs in the list so they match exactly, then try again."
                if position in ambiguous
                else "No Seller Central shipment in the list has this Shipment ID."
            )
            continue

        code = match.entry.ship_to
        outcome.new_ship_to = code
        outcome.matched_shipment_id = match.entry.shipment_id
        outcome.match_kind = match.kind
        outcome.content = _render(parsed, code)
        if parsed.old_ship_to == code:
            outcome.status = STATUS_ALREADY_CORRECT
            outcome.message = "Ship to was already correct."
        else:
            outcome.status = STATUS_CORRECTED
            outcome.message = (
                f"Matched {match.entry.shipment_id} by similarity — check it is the right shipment."
                if match.kind == MATCH_FUZZY
                else ""
            )
    return outcomes
