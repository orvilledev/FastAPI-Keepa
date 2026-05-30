#!/usr/bin/env python3
"""Merge Keepa API keys into Render KEEPA_API_KEYS (add only if missing), then redeploy.

Reads keys to merge from backend/.env (KEEPA_API_KEY + KEEPA_API_KEYS).
Requires RENDER_API_KEY in backend/.env or the environment.

Usage:
  python scripts/sync_render_keepa_keys.py
  python scripts/sync_render_keepa_keys.py --suffix jhi389 --suffix ettq102
  python scripts/sync_render_keepa_keys.py --dry-run
"""
from __future__ import annotations

import argparse
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

# Keys the user asked to ensure on Render (matched by suffix if present in local .env).
DEFAULT_SUFFIXES = ("jhi389", "ettq102")


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
    return (_load_dotenv().get("RENDER_API_KEY") or "").strip()


def _dedupe_keys(keys: List[str]) -> List[str]:
    seen: set[str] = set()
    out: List[str] = []
    for k in keys:
        k = k.strip()
        if k and k not in seen:
            seen.add(k)
            out.append(k)
    return out


def _parse_keepa_keys(primary: str, keys_csv: str) -> List[str]:
    keys = [k.strip() for k in (keys_csv or "").split(",") if k.strip()]
    p = (primary or "").strip()
    if p:
        keys.append(p)
    return _dedupe_keys(keys)


def _fingerprint(key: str, index: Optional[int] = None) -> str:
    tail = key[-6:] if len(key) >= 6 else key
    if index is None:
        return f"***{tail}"
    return f"#{index}:***{tail}"


def _api_request(method: str, path: str, api_key: str, body: object | None = None) -> object:
    data = None
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Accept": "application/json",
    }
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = Request(f"{RENDER_API}{path}", data=data, headers=headers, method=method)
    with urlopen(req, timeout=120) as resp:
        raw = resp.read().decode("utf-8")
        return json.loads(raw) if raw else {}


def _paginate(path: str, api_key: str) -> List[dict]:
    items: List[dict] = []
    cursor: Optional[str] = None
    while True:
        url = f"{path}?limit=100"
        if cursor:
            url += f"&cursor={cursor}"
        data = _api_request("GET", url, api_key)
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


def _keys_from_local_by_suffix(suffixes: tuple[str, ...]) -> List[str]:
    dotenv = _load_dotenv()
    local_keys = _parse_keepa_keys(
        dotenv.get("KEEPA_API_KEY", ""),
        dotenv.get("KEEPA_API_KEYS", ""),
    )
    wanted: List[str] = []
    lower_suffixes = [s.lower().lstrip("*") for s in suffixes]
    for key in local_keys:
        if any(key.lower().endswith(s) for s in lower_suffixes):
            wanted.append(key)
    return _dedupe_keys(wanted)


def _merge_keys(existing: List[str], to_add: List[str]) -> tuple[List[str], List[str]]:
    merged = list(existing)
    added: List[str] = []
    seen = set(existing)
    for key in to_add:
        if key not in seen:
            seen.add(key)
            merged.append(key)
            added.append(key)
    return merged, added


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync Keepa keys to Render KEEPA_API_KEYS.")
    parser.add_argument("--suffix", action="append", default=list(DEFAULT_SUFFIXES))
    parser.add_argument("--dry-run", action="store_true", help="Show changes without updating Render.")
    parser.add_argument("--no-deploy", action="store_true", help="Update env only; do not trigger deploy.")
    args = parser.parse_args()

    render_key = _load_render_api_key()
    if not render_key:
        print(
            "ERROR: RENDER_API_KEY is not set in backend/.env or the environment.",
            file=sys.stderr,
        )
        return 2

    keys_to_add = _keys_from_local_by_suffix(tuple(args.suffix))
    if not keys_to_add:
        print(
            f"ERROR: No local Keepa keys found in {ENV_FILE} matching suffixes: {args.suffix}",
            file=sys.stderr,
        )
        return 1

    try:
        services = _paginate("/services", render_key)
    except HTTPError as e:
        print(f"ERROR: Render API failed ({e.code}): {e.reason}", file=sys.stderr)
        return 1

    svc = _find_keepa_service(services)
    if not svc:
        print("ERROR: keepa-api service not found in Render workspace.", file=sys.stderr)
        return 1

    service_id = str(svc.get("id") or "")
    name = svc.get("name") or "(unknown)"
    print(f"Service: {name} ({service_id})")

    env = _env_vars_for_service(service_id, render_key)
    existing = _parse_keepa_keys(env.get("KEEPA_API_KEY", ""), env.get("KEEPA_API_KEYS", ""))
    merged, added = _merge_keys(existing, keys_to_add)

    print(f"Render keys before: {len(existing)}")
    print(f"Keys to ensure:     {', '.join(_fingerprint(k) for k in keys_to_add)}")
    if added:
        print(f"Will add ({len(added)}): {', '.join(_fingerprint(k) for k in added)}")
    else:
        print("Nothing to add — all target keys already on Render.")
        return 0

    print(f"Render keys after:  {len(merged)}")
    if args.dry_run:
        print("Dry run — no changes applied.")
        return 0

    new_csv = ",".join(merged)
    try:
        _api_request(
            "PUT",
            f"/services/{service_id}/env-vars/KEEPA_API_KEYS",
            render_key,
            {"key": "KEEPA_API_KEYS", "value": new_csv},
        )
    except HTTPError as e:
        print(f"ERROR: Failed to update KEEPA_API_KEYS ({e.code}): {e.reason}", file=sys.stderr)
        return 1

    print("Updated KEEPA_API_KEYS on Render.")

    if args.no_deploy:
        print("Skipped deploy (--no-deploy). Restart manually for keys to take effect.")
        return 0

    try:
        deploy = _api_request("POST", f"/services/{service_id}/deploys", render_key, {})
        deploy_id = deploy.get("id") if isinstance(deploy, dict) else None
        if deploy_id:
            print(f"Triggered deploy: {deploy_id}")
        else:
            print("Triggered deploy.")
    except HTTPError as e:
        print(
            f"WARNING: KEEPA_API_KEYS updated but deploy failed ({e.code}): {e.reason}",
            file=sys.stderr,
        )
        print("Redeploy manually from the Render dashboard.", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
