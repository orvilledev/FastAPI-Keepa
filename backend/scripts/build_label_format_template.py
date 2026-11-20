"""Rebuild the UPS-label template used by the Label Format Checker.

The template captures the fixed structure of page 2 (the UPS label image) of Amazon's
"Thermal Printing - 4x6 inches" box-label PDFs: the rules, black square, MaxiCode
bullseye, barcode frames and datamatrix finder patterns. It is learned from known-good
labels, so re-run this only if Amazon/UPS changes the label layout.

Usage (from the ``backend`` folder; inputs may be .pdf files, .zip files or folders):
    python scripts/build_label_format_template.py "C:/path/FBADNK17112026.zip" "C:/path/more_pdfs"

Writes ``app/data/label_format_ups_template.npz``.
"""
from __future__ import annotations

import sys
import zipfile
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

import fitz  # noqa: E402  PyMuPDF

from app.services import label_format_checker as lfc  # noqa: E402


def _iter_pdfs(source: Path):
    if source.is_dir():
        for child in sorted(source.iterdir()):
            yield from _iter_pdfs(child)
        return
    if source.suffix.lower() == ".pdf":
        yield source.name, source.read_bytes()
    elif source.suffix.lower() == ".zip":
        with zipfile.ZipFile(source) as zf:
            for info in zf.infolist():
                if info.filename.lower().endswith(".pdf") and "__MACOSX" not in info.filename:
                    yield info.filename, zf.read(info)


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        return 2
    masks = []
    for arg in argv:
        for name, data in _iter_pdfs(Path(arg)):
            doc = fitz.open(stream=data, filetype="pdf")
            if doc.page_count != 2:
                print(f"skip {name}: {doc.page_count} pages (expected 2)")
                continue
            page = doc[1]
            if abs(page.rect.width - lfc.PAGE_W) > lfc.PAGE_TOL or abs(page.rect.height - lfc.PAGE_H) > lfc.PAGE_TOL:
                print(f"skip {name}: unexpected page size")
                continue
            masks.append(lfc.render_page_mask(page))
    if len(masks) < 5:
        print(f"Need at least 5 known-good labels to learn a reliable template; found {len(masks)}.")
        return 1
    template = lfc.build_ups_template(masks)
    lfc.save_ups_template(lfc._TEMPLATE_PATH, template)
    print(f"Learned from {len(masks)} labels -> {lfc._TEMPLATE_PATH}")
    print(f"  fixed template pixels: {int(template['static'].sum())}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
