#!/usr/bin/env python3
"""Verify Keepa API keys on Render (fingerprints only; never prints full keys).

Requires RENDER_API_KEY (rnd_...) from https://dashboard.render.com/u/settings#api-keys
Set in the environment or backend/.env as RENDER_API_KEY=...

Usage:
  python scripts/verify_render_keepa_keys.py
  python scripts/verify_render_keepa_keys.py --suffix jhi389 --suffix ettq102
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Iterable, List, Optional
from urllib.error import HTTPError
from urllib.request import Request, urlopen

BACKEND_DIR = Path(__file__).resolve().parent.parent
ENV_FILE = BACKEND_DIR / ".env"
RENDER_API = "https://api.render.com/v1"


def _load_render_api_key() -> str:
    key = (os.getenv("RENDER_API_KEY") or "").strip()
    if key:
        return key
    if ENV_FILE.is_file():
        for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("RENDER_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    return ""


def _fingerprint(key: str, index: Optional[int] = None) -> str:
    tail = key[-6:] if len(key) >= 6 else key
    if index is None:
        return f"***{tail}"
    return f"#{index}:***{tail}"


def _parse_keepa_keys(primary: str, keys_csv: str) -> List[str]:
    seen: set[str] = set()
    out: List[str] = []
    for raw in (keys_csv or "").split(","):
        k = raw.strip()
        if k and k not in seen:
            seen.add(k)
            out.append(k)
    p = (primary or "").strip()
    if p and p not in seen:
        out.append(p)
    return out


def _api_get(path: str, api_key: str) -> object:
    req = Request(
        f"{RENDER_API}{path}",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Accept": "application/json",
        },
        method="GET",
    )
    with urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _paginate(path: str, api_key: str) -> List[dict]:
    items: List[dict] = []
    cursor: Optional[str] = None
    while True:
        url = f"{path}?limit=100"
        if cursor:
            url += f"&cursor={cursor}"
        data = _api_get(url, api_key)
        if not isinstance(data, list):
            break
        for entry in data:
            if isinstance(entry, dict):
                items.append(entry)
        cursor = None
        if data and isinstance(data[-1], dict):
            cursor = data[-1].get("cursor")
        if not cursor:
            break
    return items


def _find_keepa_service(services: Iterable[dict]) -> Optional[dict]:
    candidates: List[dict] = []
    for wrapper in services:
        svc = wrapper.get("service") if isinstance(wrapper.get("service"), dict) else wrapper
        if not isinstance(svc, dict):
            continue
        name = (svc.get("name") or "").lower()
        url = (svc.get("serviceDetails", {}) or {}).get("url") or svc.get("url") or ""
        url = str(url).lower()
        if "keepa" in name or "keepa-api" in url or "metro-api" in name:
            candidates.append(svc)
    if len(candidates) == 1:
        return candidates[0]
    if len(candidates) > 1:
        for svc in candidates:
            url = str((svc.get("serviceDetails", {}) or {}).get("url") or "").lower()
            if "keepa-api.onrender.com" in url:
                return svc
        return candidates[0]
    return None


def _env_vars_for_service(service_id: str, api_key: str) -> dict[str, str]:
    out: dict[str, str] = {}
    entries = _paginate(f"/services/{service_id}/env-vars", api_key)
    for entry in entries:
        ev = entry.get("envVar") if isinstance(entry.get("envVar"), dict) else entry
        if not isinstance(ev, dict):
            continue
        k = ev.get("key")
        v = ev.get("value")
        if k:
            out[str(k)] = "" if v is None else str(v)
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify Keepa keys on Render (masked output).")
    parser.add_argument(
        "--suffix",
        action="append",
        default=["jhi389", "ettq102"],
        help="Last-6 key suffix(es) to check (repeatable).",
    )
    parser.add_argument(
        "--service-url",
        default="https://keepa-api.onrender.com",
        help="Expected public service URL (for matching).",
    )
    args = parser.parse_args()
    target_suffixes = [s.lower().lstrip("*") for s in args.suffix]

    render_key = _load_render_api_key()
    if not render_key:
        print(
            "ERROR: RENDER_API_KEY is not set.\n"
            "Add it to backend/.env (gitignored) or the environment:\n"
            "  RENDER_API_KEY=rnd_...   (from Render → Account Settings → API Keys)\n",
            file=sys.stderr,
        )
        return 2

    try:
        services = _paginate("/services", render_key)
    except HTTPError as e:
        print(f"ERROR: Render API failed ({e.code}): {e.reason}", file=sys.stderr)
        return 1

    svc = _find_keepa_service(services)
    if not svc:
        print("ERROR: No Keepa/metro API web service found in this Render workspace.", file=sys.stderr)
        return 1

    service_id = svc.get("id") or ""
    name = svc.get("name") or "(unknown)"
    url = (svc.get("serviceDetails", {}) or {}).get("url") or svc.get("url") or ""
    print(f"Service: {name}")
    print(f"  id:  {service_id}")
    print(f"  url: {url}")
    if args.service_url and args.service_url.rstrip("/") not in str(url):
        print(f"  note: expected URL contains {args.service_url!r}")

    env = _env_vars_for_service(service_id, render_key)
    keepa_keys = _parse_keepa_keys(env.get("KEEPA_API_KEY", ""), env.get("KEEPA_API_KEYS", ""))
    print(f"\nKeepa keys on Render: {len(keepa_keys)} unique")
    print("  fingerprints:", ", ".join(_fingerprint(k, i) for i, k in enumerate(keepa_keys)))

    print("\nTarget key check:")
    for suffix in target_suffixes:
        matches = [k for k in keepa_keys if k.lower().endswith(suffix)]
        if matches:
            idx = keepa_keys.index(matches[0])
            print(f"  ***{suffix}: FOUND at index {idx} ({_fingerprint(matches[0], idx)})")
        else:
            print(f"  ***{suffix}: NOT in Render KEEPA_API_KEY / KEEPA_API_KEYS")

    primary = (env.get("KEEPA_API_KEY") or "").strip()
    if primary:
        print(f"\nKEEPA_API_KEY (primary): {_fingerprint(primary)}")
    else:
        print("\nKEEPA_API_KEY (primary): (not set)")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
