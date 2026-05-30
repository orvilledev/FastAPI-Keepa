"""JWT claim helpers (payload decode only; token is verified via Supabase auth API)."""
import base64
import json
from typing import Any


def decode_jwt_payload(token: str) -> dict[str, Any]:
    """Decode the JWT payload without signature verification."""
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return {}
        payload = parts[1]
        padding = "=" * (-len(payload) % 4)
        decoded = base64.urlsafe_b64decode(payload + padding)
        return json.loads(decoded)
    except Exception:
        return {}


def get_jwt_aal(token: str) -> str:
    """Return authenticator assurance level from JWT (aal1 or aal2)."""
    claims = decode_jwt_payload(token)
    aal = claims.get("aal")
    if isinstance(aal, str) and aal:
        return aal
    return "aal1"
