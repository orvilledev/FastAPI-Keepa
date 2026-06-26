"""Serve Work Sheet Template files (bundled assets or remote fallback)."""
from __future__ import annotations

import ipaddress
import re
from pathlib import Path
from typing import Optional, Tuple
from urllib.parse import urlparse

import httpx

WORK_SHEET_TEMPLATE_TOOL_NAMES = frozenset({"NFA Shipment Work Sheet"})

BACKEND_ROOT = Path(__file__).resolve().parents[2]
BUNDLED_WORK_SHEET_FILES: dict[str, dict[str, object]] = {
    "NFA Shipment Work Sheet": {
        "path": BACKEND_ROOT / "assets" / "work-sheet-templates" / "nfa-shipment-work-sheet.xlsx",
        "download_name": "NFA Shipments 6.26.26.xlsx",
        "media_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
}

XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def is_work_sheet_template_tool(tool: dict) -> bool:
    name = (tool.get("name") or "").strip()
    if name in WORK_SHEET_TEMPLATE_TOOL_NAMES:
        return True
    tags = tool.get("tags") or []
    return any(str(tag).lower().replace(" ", "-") == "work-sheet-template" for tag in tags)


def has_bundled_work_sheet_file(tool_name: str) -> bool:
    return (tool_name or "").strip() in BUNDLED_WORK_SHEET_FILES


def load_bundled_work_sheet_file(tool_name: str) -> Tuple[bytes, str, str]:
    """Return bundled file bytes, download filename, and media type."""
    key = (tool_name or "").strip()
    entry = BUNDLED_WORK_SHEET_FILES.get(key)
    if not entry:
        raise ValueError("No bundled work sheet file is configured for this tool.")

    path = Path(entry["path"])
    if not path.is_file():
        raise ValueError("The work sheet file is not available on the server.")

    return (
        path.read_bytes(),
        str(entry["download_name"]),
        str(entry["media_type"]),
    )


def resolve_download_url(url: str) -> str:
    """Turn common Google share links into direct download/export URLs."""
    try:
        parsed = urlparse(url.strip())
        host = (parsed.hostname or "").lower()
        if "drive.google.com" in host:
            file_match = re.search(r"/file/d/([^/]+)", parsed.path)
            if file_match:
                return f"https://drive.google.com/uc?export=download&id={file_match.group(1)}"
        if "docs.google.com" in host:
            doc_match = re.search(r"/d/([^/]+)", parsed.path)
            if doc_match:
                doc_id = doc_match.group(1)
                if "/spreadsheets/" in parsed.path:
                    return (
                        f"https://docs.google.com/spreadsheets/d/{doc_id}/export?format=xlsx"
                    )
                if "/document/" in parsed.path:
                    return f"https://docs.google.com/document/d/{doc_id}/export?format=docx"
    except Exception:
        pass
    return url.strip()


def _validate_remote_url(url: str) -> str:
    parsed = urlparse(url.strip())
    if parsed.scheme not in {"https", "http"}:
        raise ValueError("Only http(s) links are allowed")
    host = (parsed.hostname or "").strip().lower()
    if not host:
        raise ValueError("Invalid URL host")
    if host in {"localhost", "127.0.0.1", "0.0.0.0"} or host.endswith(".local"):
        raise ValueError("Blocked URL host")
    try:
        ip = ipaddress.ip_address(host)
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
            raise ValueError("Blocked URL host")
    except ValueError as exc:
        if "Blocked URL host" in str(exc):
            raise
    return url.strip()


def _filename_from_url(url: str, fallback_name: str) -> str:
    try:
        last = urlparse(url).path.rstrip("/").split("/")[-1]
        if last and re.search(r"\.[a-z0-9]{2,5}$", last, re.IGNORECASE):
            return last
    except Exception:
        pass
    safe = re.sub(r'[<>:"/\\|?*]', "-", fallback_name).strip() or "download"
    return safe


def _filename_from_content_disposition(header: Optional[str]) -> Optional[str]:
    if not header:
        return None
    match = re.search(r'filename\*?=(?:UTF-8\'\')?"?([^";]+)"?', header, re.IGNORECASE)
    if not match:
        return None
    return match.group(1).strip()


def _guess_extension(content_type: Optional[str], url: str) -> str:
    if content_type:
        lowered = content_type.lower()
        if "spreadsheetml" in lowered or "excel" in lowered:
            return ".xlsx"
        if "wordprocessingml" in lowered or "msword" in lowered:
            return ".docx"
        if "pdf" in lowered:
            return ".pdf"
        if "csv" in lowered:
            return ".csv"
    if "format=xlsx" in url:
        return ".xlsx"
    if "format=docx" in url:
        return ".docx"
    return ".xlsx"


def _fetch_google_drive_with_confirm(client: httpx.Client, url: str) -> httpx.Response:
    response = client.get(url)
    content_type = (response.headers.get("content-type") or "").lower()
    if "text/html" not in content_type:
        return response

    confirm_match = re.search(r"confirm=([0-9A-Za-z_]+)", response.text)
    if confirm_match:
        separator = "&" if "?" in url else "?"
        confirmed_url = f"{url}{separator}confirm={confirm_match.group(1)}"
        return client.get(confirmed_url)

    uuid_match = re.search(r"/uc\?export=download&id=([^&]+)", url)
    token_match = re.search(r'name="uuid"\s+value="([^"]+)"', response.text)
    if uuid_match and token_match:
        file_id = uuid_match.group(1)
        token = token_match.group(1)
        return client.get(
            "https://drive.usercontent.google.com/download",
            params={"id": file_id, "export": "download", "confirm": token},
        )
    return response


def fetch_work_sheet_file(tool_name: str, source_url: str, fallback_name: str) -> Tuple[bytes, str, str]:
    """Load a work sheet file from bundled assets or a remote URL."""
    if has_bundled_work_sheet_file(tool_name):
        return load_bundled_work_sheet_file(tool_name)

    if not (source_url or "").strip():
        raise ValueError("This tool has no file configured.")

    validated = _validate_remote_url(source_url)
    download_url = resolve_download_url(validated)

    with httpx.Client(timeout=60.0, follow_redirects=True) as client:
        if "drive.google.com" in download_url:
            response = _fetch_google_drive_with_confirm(client, download_url)
        else:
            response = client.get(download_url)
        response.raise_for_status()

        content_type = response.headers.get("content-type") or "application/octet-stream"
        if "text/html" in content_type.lower():
            raise ValueError(
                "The linked file could not be downloaded. Confirm the link is public and try again."
            )

        filename = _filename_from_content_disposition(
            response.headers.get("content-disposition")
        ) or _filename_from_url(download_url, fallback_name)
        if "." not in filename.split("/")[-1]:
            filename = f"{filename}{_guess_extension(content_type, download_url)}"

        return response.content, filename, content_type.split(";")[0].strip()
