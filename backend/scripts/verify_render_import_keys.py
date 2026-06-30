#!/usr/bin/env python3
"""Verify KEEPA_IMPORT_API_KEYS on Render (fingerprints only; never prints full keys).

Requires RENDER_API_KEY in backend/.env or the environment.

Usage:
  python scripts/verify_render_import_keys.py
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import List, Optional
from urllib.error import HTTPError
from urllib.request import Request, urlopen

BACKEND_DIR = Path(__file__).resolve().parent.parent
ENV_FILE = BACKEND_DIR / ".env"
RENDER_API = "https://api.render.com/v1"


def _load_dotenv() -> dict[str, str]:
    out: dict[str, str] = {}
    if not ENV_FILE.is_file():
        return out
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def _load_render_api_key() -> str:
    key = (os.getenv("RENDER_API_KEY") or "").strip()
    if key:
        return key
    key = (_load_dotenv().get("RENDER_API_KEY") or "").strip()
    if key:
        return key
    # Fall back to Render CLI token (~/.render/cli.yaml) after `render login`.
    cli_yaml = Path.home() / ".render" / "cli.yaml"
    if cli_yaml.is_file():
        for line in cli_yaml.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if stripped.startswith("key:") and "rnd_" in stripped:
                return stripped.split(":", 1)[1].strip()
    return ""


def _parse_keys(csv: str) -> List[str]:
    seen: set[str] = set()
    out: List[str] = []
    for raw in (csv or "").split(","):
        k = raw.strip()
        if k and k not in seen:
            seen.add(k)
            out.append(k)
    return out


def _suffixes(keys: List[str]) -> List[str]:
    return [k[-6:] if len(k) >= 6 else k for k in keys]


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


def _find_keepa_service(services: List[dict]) -> Optional[dict]:
    candidates: List[dict] = []
    for wrapper in services:
        svc = wrapper.get("service") if isinstance(wrapper.get("service"), dict) else wrapper
        if not isinstance(svc, dict):
            continue
        name = (svc.get("name") or "").lower()
        url = str((svc.get("serviceDetails", {}) or {}).get("url") or svc.get("url") or "").lower()
        if "keepa" in name or "keepa-api" in url or "metro-api" in name:
            candidates.append(svc)
    if len(candidates) == 1:
        return candidates[0]
    for svc in candidates:
        url = str((svc.get("serviceDetails", {}) or {}).get("url") or "").lower()
        if "keepa-api.onrender.com" in url:
            return svc
    return candidates[0] if candidates else None


def _env_vars_for_service(service_id: str, api_key: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for entry in _paginate(f"/services/{service_id}/env-vars", api_key):
        ev = entry.get("envVar") if isinstance(entry.get("envVar"), dict) else entry
        if isinstance(ev, dict) and ev.get("key"):
            out[str(ev["key"])] = "" if ev.get("value") is None else str(ev.get("value"))
    return out


def main() -> int:
    render_key = _load_render_api_key()
    if not render_key:
        print(
            "ERROR: RENDER_API_KEY is not set.\n"
            "Add to backend/.env (from Render → Account Settings → API Keys):\n"
            "  RENDER_API_KEY=rnd_...\n\n"
            "Or ensure `render login` completed and ~/.render/cli.yaml exists.",
            file=sys.stderr,
        )
        return 2

    dotenv = _load_dotenv()
    local_import = _parse_keys(dotenv.get("KEEPA_IMPORT_API_KEYS", ""))
    local_suffixes = _suffixes(local_import)

    try:
        services = _paginate("/services", render_key)
    except HTTPError as e:
        print(f"ERROR: Render API failed ({e.code}): {e.reason}", file=sys.stderr)
        return 1

    svc = _find_keepa_service(services)
    if not svc:
        print("ERROR: No Keepa/metro API web service found.", file=sys.stderr)
        return 1

    service_id = str(svc.get("id") or "")
    name = svc.get("name") or "(unknown)"
    url = (svc.get("serviceDetails", {}) or {}).get("url") or svc.get("url") or ""
    print(f"Service: {name}")
    print(f"  id:  {service_id}")
    print(f"  url: {url}")

    env = _env_vars_for_service(service_id, render_key)
    import_raw = env.get("KEEPA_IMPORT_API_KEYS", "")
    render_import = _parse_keys(import_raw)
    render_suffixes = _suffixes(render_import)

    print("\nKEEPA_IMPORT_API_KEYS on Render:")
    if not import_raw.strip():
        print("  status: NOT SET")
        print("  → Import File falls back to full KEEPA_API_KEYS pool on production.")
    else:
        print(f"  status: SET ({len(render_import)} key(s))")
        print(f"  suffixes: {', '.join(render_suffixes) if render_suffixes else '(empty)'}")

    if local_suffixes:
        print(f"\nLocal KEEPA_IMPORT_API_KEYS ({len(local_suffixes)} key(s)):")
        print(f"  suffixes: {', '.join(local_suffixes)}")
        missing = [s for s in local_suffixes if s not in render_suffixes]
        extra = [s for s in render_suffixes if s not in local_suffixes]
        if missing:
            print(f"  MISSING on Render: {', '.join(missing)}")
        if extra:
            print(f"  EXTRA on Render (not in local): {', '.join(extra)}")
        if not missing and not extra and len(local_suffixes) == len(render_suffixes):
            print("  OK: Render matches local import key set.")

    if import_raw.strip() and len(render_import) == 1:
        print("\nWARNING: Only 1 import key on Render — large vendor builds will hit rate limits.")
    elif import_raw.strip() and len(render_import) >= 5:
        print("\nOK: Multiple import keys configured on Render.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
