"""Keepa API client with rate limiting, retry logic, and multi-key support."""
import httpx
import asyncio
import logging
import json
import os
import random
from pathlib import Path
from threading import Lock
from typing import Optional, Dict, Any, List
from app.config import settings
from app.services.keepa_token_summary import KeepaUsageStats, estimate_tokens_for_product_request

logger = logging.getLogger(__name__)


class KeepaClient:
    """Client for interacting with Keepa API using a single key."""
    
    def __init__(
        self,
        api_key: Optional[str] = None,
        key_index: int = 0,
        offers_limit: Optional[int] = None,
    ):
        self.api_key = api_key or settings.keepa_api_key
        self.key_index = key_index
        self.offers_limit = offers_limit
        self.api_url = settings.keepa_api_url.rstrip("/")
        self.client = httpx.AsyncClient(timeout=30.0)
        self.rate_limit_delay = self._compute_effective_rate_limit_delay()
        self.max_retries = max(0, int(settings.keepa_max_retries))
        self.retry_delay = max(0.0, float(settings.keepa_retry_delay_seconds))
        self.retry_max_delay = max(self.retry_delay, float(settings.keepa_retry_max_delay_seconds))
        self.retry_jitter_seconds = max(0.0, float(settings.keepa_retry_jitter_seconds))
        self.cooldown_max_delay = max(0.0, float(settings.keepa_429_cooldown_max_delay_seconds))
        self.dynamic_delay_penalty = 0.0
        self.tokens_left: Optional[int] = None
        self.keepa_tokens_consumed = 0
        self.keepa_tokens_estimated = 0
        self.keepa_requests = 0
        self.keepa_products_returned = 0
        self.keepa_refill_rate_samples: List[int] = []
        logger.info(
            "[Key %s] Keepa pacing configured: offers=%s, delay=%.3fs, retries=%s, retry_delay=%.2fs, retry_max=%.2fs, jitter=%.2fs",
            self.key_index,
            self._resolved_offers_limit(),
            self.rate_limit_delay,
            self.max_retries,
            self.retry_delay,
            self.retry_max_delay,
            self.retry_jitter_seconds,
        )

    def _resolved_offers_limit(self) -> int:
        """Return active offers limit for this client."""
        try:
            return max(
                0,
                int(
                    self.offers_limit
                    if self.offers_limit is not None
                    else settings.keepa_offers_limit
                ),
            )
        except Exception:
            return max(0, int(settings.keepa_offers_limit))

    def _compute_effective_rate_limit_delay(self) -> float:
        """
        Scale request pacing by offers limit so lower offers can run faster.
        """
        base_delay = max(0.0, float(settings.keepa_rate_limit_delay_seconds))
        min_delay = max(0.0, float(settings.keepa_min_rate_limit_delay_seconds))
        offers_ref = max(1, int(settings.keepa_delay_offers_reference))
        offers = self._resolved_offers_limit()
        scaled_delay = base_delay * (offers / offers_ref)
        return max(min_delay, scaled_delay)

    def _retry_wait_seconds(self, retry_count: int) -> float:
        """Exponential backoff + jitter with max cap."""
        base = self.retry_delay * (2 ** retry_count)
        capped = min(self.retry_max_delay, base)
        if self.retry_jitter_seconds <= 0:
            return capped
        return capped + random.uniform(0.0, self.retry_jitter_seconds)

    def _on_success_decay_penalty(self) -> None:
        """Reduce temporary 429 penalty after successful requests."""
        self.dynamic_delay_penalty = max(0.0, self.dynamic_delay_penalty * 0.5)

    def _on_rate_limit_penalty(self) -> None:
        """Increase temporary request spacing after 429 to reduce repeated bursts."""
        if self.cooldown_max_delay <= 0:
            return
        if self.dynamic_delay_penalty <= 0:
            self.dynamic_delay_penalty = min(self.cooldown_max_delay, 0.5)
            return
        self.dynamic_delay_penalty = min(self.cooldown_max_delay, self.dynamic_delay_penalty * 2.0)
        
    async def __aenter__(self):
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.client.aclose()
    
    async def _make_request(
        self, 
        endpoint: str, 
        params: Dict[str, Any],
        retry_count: int = 0
    ) -> Dict[str, Any]:
        """Make HTTP request to Keepa API with retry logic."""
        url = f"{self.api_url}/{endpoint.lstrip('/')}"
        params["key"] = self.api_key
        
        params_log = {k: (v if k != "key" else f"***KEY_{self.key_index}***") for k, v in params.items()}
        logger.info(f"[Key {self.key_index}] Making Keepa API request to: {url}")
        logger.info(f"[Key {self.key_index}] Request parameters: {params_log}")
        
        try:
            response = await self.client.get(url, params=params)
            logger.info(f"[Key {self.key_index}] Keepa API response status: {response.status_code}")
            
            response.raise_for_status()
            data = response.json()
            
            if isinstance(data, dict):
                self.tokens_left = data.get("tokensLeft", self.tokens_left)
                self._record_keepa_usage(data)
                if self.tokens_left is not None:
                    logger.info(f"[Key {self.key_index}] Tokens remaining: {self.tokens_left}")
            self._on_success_decay_penalty()
            
            response_preview = str(data)[:500] if data else "Empty response"
            logger.info(f"[Key {self.key_index}] Keepa API response data (preview): {response_preview}")
            
            if isinstance(data, dict) and "error" in data:
                logger.error(f"[Key {self.key_index}] Keepa API returned error: {data['error']}")
                raise Exception(f"Keepa API error: {data['error']}")
            
            return data
            
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 429:
                self._on_rate_limit_penalty()
                wait_time = self._retry_wait_seconds(retry_count)
                logger.warning(f"[Key {self.key_index}] Rate limited. Waiting {wait_time}s before retry...")
                await asyncio.sleep(wait_time)
                
                if retry_count < self.max_retries:
                    return await self._make_request(endpoint, params, retry_count + 1)
                else:
                    raise Exception("Max retries exceeded due to rate limiting")
            
            elif e.response.status_code >= 500 and retry_count < self.max_retries:
                wait_time = self._retry_wait_seconds(retry_count)
                logger.warning(f"[Key {self.key_index}] Server error {e.response.status_code}. Retrying in {wait_time}s...")
                await asyncio.sleep(wait_time)
                return await self._make_request(endpoint, params, retry_count + 1)
            
            else:
                error_text = e.response.text[:500] if e.response.text else "No error text"
                logger.error(f"[Key {self.key_index}] Keepa API HTTP error {e.response.status_code}: {error_text}")
                raise
                
        except httpx.RequestError as e:
            if retry_count < self.max_retries:
                wait_time = self._retry_wait_seconds(retry_count)
                logger.warning(f"[Key {self.key_index}] Request error: {e}. Retrying in {wait_time}s...")
                await asyncio.sleep(wait_time)
                return await self._make_request(endpoint, params, retry_count + 1)
            else:
                logger.error(f"[Key {self.key_index}] Request failed after {self.max_retries} retries: {e}")
                raise
                
        except Exception as e:
            logger.error(f"[Key {self.key_index}] Unexpected error in Keepa API request: {e}")
            raise

    def _record_keepa_usage(self, data: Dict[str, Any]) -> None:
        """Accumulate tokensConsumed / refillRate from a Keepa JSON body."""
        self.keepa_requests += 1
        products = data.get("products")
        n_products = len(products) if isinstance(products, list) else 0
        self.keepa_products_returned += n_products
        refill_rate = data.get("refillRate")
        try:
            rate_int = int(refill_rate)
        except (TypeError, ValueError):
            rate_int = None
        if rate_int and rate_int > 0:
            self.keepa_refill_rate_samples.append(rate_int)

        consumed_raw = data.get("tokensConsumed")
        if consumed_raw is not None:
            try:
                self.keepa_tokens_consumed += max(0, int(consumed_raw))
                return
            except (TypeError, ValueError):
                pass
        self.keepa_tokens_estimated += estimate_tokens_for_product_request(
            product_count=n_products,
            offers_limit=self._resolved_offers_limit(),
            include_buybox=bool(settings.keepa_include_buybox),
        )

    def usage_stats(self) -> KeepaUsageStats:
        return KeepaUsageStats(
            tokens_consumed=self.keepa_tokens_consumed,
            tokens_estimated=self.keepa_tokens_estimated,
            requests=self.keepa_requests,
            products_returned=self.keepa_products_returned,
            refill_rate_samples=list(self.keepa_refill_rate_samples),
        )
    
    async def fetch_product_data(self, upc: str) -> Optional[Dict[str, Any]]:
        """Fetch product data for a single UPC."""
        try:
            params = {
                "code": upc,
                "domain": str(settings.keepa_domain),
                "stats": str(settings.keepa_stats_window_days),
                "offers": str(max(0, min(100, self._resolved_offers_limit()))),
            }

            # Keep payload lean by default; toggle these via env when needed.
            if settings.keepa_include_history:
                params["history"] = "1"
            if settings.keepa_include_buybox:
                params["buybox"] = "1"
            
            await asyncio.sleep(self.rate_limit_delay + self.dynamic_delay_penalty)
            
            logger.info(f"[Key {self.key_index}] Fetching Keepa data for UPC: {upc}")
            data = await self._make_request("product", params)
            logger.info(f"[Key {self.key_index}] Successfully fetched Keepa data for UPC: {upc}")
            return data
            
        except Exception as e:
            logger.error(f"[Key {self.key_index}] Failed to fetch product data for UPC {upc}: {e}")
            return None

    async def fetch_buybox_only(self, upc: str) -> Optional[Dict[str, Any]]:
        """Fetch only the buy-box winner for a UPC (no marketplace offer list).

        Requests ``stats`` + ``buybox`` and **omits** the ``offers`` parameter so
        Keepa returns the current buy-box seller id and price from the product
        ``stats`` object without the per-offer list. This is the cheapest valid
        request for a ``code`` (UPC/EAN) lookup — roughly one token per product.

        Note: ``offers=0`` is NOT valid for a code lookup (Keepa returns HTTP 400),
        and ``offers`` between 1 and 19 is rejected ("Either no or a minimum of 20
        offers must be requested"). Omitting ``offers`` entirely is the supported
        way to get the buy-box snapshot cheaply, which is all the Keepa Import
        File tool needs (it does not scan competing sellers).
        """
        try:
            params = {
                "code": upc,
                "domain": str(settings.keepa_domain),
                "stats": str(settings.keepa_stats_window_days),
                "buybox": "1",
            }

            await asyncio.sleep(self.rate_limit_delay + self.dynamic_delay_penalty)

            logger.info(f"[Key {self.key_index}] Fetching Keepa buy-box-only data for UPC: {upc}")
            data = await self._make_request("product", params)
            logger.info(f"[Key {self.key_index}] Successfully fetched buy-box-only data for UPC: {upc}")
            return data

        except Exception as e:
            logger.error(f"[Key {self.key_index}] Failed to fetch buy-box-only data for UPC {upc}: {e}")
            return None

    async def batch_fetch(self, upcs: List[str]) -> Dict[str, Optional[Dict[str, Any]]]:
        """Fetch product data for multiple UPCs with rate limiting."""
        results = {}
        
        for upc in upcs:
            try:
                data = await self.fetch_product_data(upc)
                results[upc] = data
            except Exception as e:
                logger.error(f"[Key {self.key_index}] Error processing UPC {upc}: {e}")
                results[upc] = None
        
        return results
    
    async def close(self):
        """Close HTTP client."""
        await self.client.aclose()


class MultiKeyKeepaClient:
    """Manages multiple Keepa API keys for parallel UPC processing."""
    _next_start_index = 0
    _rotation_lock = Lock()
    _rotation_state_path = Path(__file__).resolve().parents[2] / ".keepa_rotation_state.json"
    _backend_env_path = Path(__file__).resolve().parents[2] / ".env"
    
    def __init__(self, api_keys: Optional[List[str]] = None):
        """Build a multi-key client.

        ``api_keys`` lets a caller pin an explicit key pool (e.g. the Keepa
        Import File tool's dedicated high-refill keys). When omitted, all keys
        are loaded from the merged runtime sources as before.
        """
        if api_keys:
            self.api_keys = self._dedupe_keys(api_keys)
        else:
            self.api_keys = self._load_runtime_api_keys()
        if not self.api_keys:
            self.api_keys = [settings.keepa_api_key]
        self.num_keys = len(self.api_keys)
        logger.info(f"MultiKeyKeepaClient initialized with {self.num_keys} API key(s)")
        logger.info("Active Keepa key fingerprints: %s", ", ".join(self._key_fingerprints(self.api_keys)))

    @classmethod
    def _dedupe_keys(cls, keys: List[str]) -> List[str]:
        """Preserve order while deduplicating non-empty keys."""
        out: List[str] = []
        seen = set()
        for key in keys:
            k = (key or "").strip()
            if not k or k in seen:
                continue
            seen.add(k)
            out.append(k)
        return out

    @classmethod
    def _key_fingerprints(cls, keys: List[str]) -> List[str]:
        """Return non-sensitive key fingerprints for operational verification."""
        fingerprints: List[str] = []
        for idx, key in enumerate(keys):
            k = (key or "").strip()
            tail = k[-6:] if len(k) >= 6 else k
            fingerprints.append(f"#{idx}:***{tail}")
        return fingerprints

    @classmethod
    def _read_env_file_values(cls) -> Dict[str, str]:
        """Best-effort parse of backend/.env into a key->value dict."""
        if not cls._backend_env_path.exists():
            return {}
        values: Dict[str, str] = {}
        try:
            for line in cls._backend_env_path.read_text(encoding="utf-8").splitlines():
                raw = line.strip()
                if not raw or raw.startswith("#") or "=" not in raw:
                    continue
                key, value = raw.split("=", 1)
                values[key.strip()] = value.strip()
        except Exception as e:
            logger.debug(f"Could not parse backend/.env for Keepa keys: {e}")
            return {}
        return values

    @classmethod
    def _parse_keepa_keys_from_env_file(cls) -> List[str]:
        """Best-effort parse of KEEPA_API_KEYS/KEEPA_API_KEY from backend/.env."""
        values = cls._read_env_file_values()
        if not values:
            return []
        csv_keys = [k.strip() for k in values.get("KEEPA_API_KEYS", "").split(",") if k.strip()]
        primary = values.get("KEEPA_API_KEY", "").strip()
        if primary:
            csv_keys.append(primary)
        return cls._dedupe_keys(csv_keys)

    @classmethod
    def _load_named_csv_keys(cls, env_name: str, settings_keys: List[str]) -> List[str]:
        """Merge comma-separated keys from .env, process env, and settings."""
        file_values = cls._read_env_file_values()
        file_keys = [
            k.strip()
            for k in file_values.get(env_name, "").split(",")
            if k.strip()
        ]
        env_keys = [
            k.strip()
            for k in os.getenv(env_name, "").split(",")
            if k.strip()
        ]
        return cls._dedupe_keys(file_keys + env_keys + list(settings_keys or []))

    @classmethod
    def load_import_api_keys(cls) -> List[str]:
        """Load the Keepa Import File dedicated key pool, or [] when unset.

        Merges the same sources as the full pool (backend/.env, process env,
        pydantic settings) but only for ``KEEPA_IMPORT_API_KEYS``. Returns an
        empty list when the variable is not configured anywhere, so the caller
        can fall back to the full key pool.
        """
        merged = cls._load_named_csv_keys(
            "KEEPA_IMPORT_API_KEYS",
            settings.keepa_import_api_keys_list,
        )
        if merged:
            logger.info(
                "Keepa Import File using dedicated key pool: %s key(s) [%s]",
                len(merged),
                ", ".join(cls._key_fingerprints(merged)),
            )
        return merged

    @classmethod
    def load_daily_api_keys(cls) -> List[str]:
        """Load the restricted product-API key pool, or [] when unset.

        Used by API Mode Daily Run, Same Day Run, and Express Jobs.
        Prefers ``KEEPA_DAILY_API_KEYS``. If that is empty, reuses the Import
        File high-refill pool. Empty means the caller should use the full pool.
        """
        dedicated = cls._load_named_csv_keys(
            "KEEPA_DAILY_API_KEYS",
            settings.keepa_daily_api_keys_list,
        )
        if dedicated:
            logger.info(
                "Product-API jobs using dedicated key pool: %s key(s) [%s]",
                len(dedicated),
                ", ".join(cls._key_fingerprints(dedicated)),
            )
            return dedicated
        import_keys = cls.load_import_api_keys()
        if import_keys:
            logger.info(
                "Product-API jobs falling back to Import File key pool: %s key(s) [%s]",
                len(import_keys),
                ", ".join(cls._key_fingerprints(import_keys)),
            )
        return import_keys

    @classmethod
    def product_request_api_keys(cls) -> Optional[List[str]]:
        """Restricted keys for Express / Daily API jobs, or None for the full pool."""
        keys = cls.load_daily_api_keys()
        return keys or None

    @classmethod
    def _product_pool_keys_quiet(cls) -> List[str]:
        """Same 5-key product pool as Express/Daily API, without INFO logs."""
        dedicated = cls._load_named_csv_keys(
            "KEEPA_DAILY_API_KEYS",
            settings.keepa_daily_api_keys_list,
        )
        if dedicated:
            return dedicated
        return cls._load_named_csv_keys(
            "KEEPA_IMPORT_API_KEYS",
            settings.keepa_import_api_keys_list,
        )

    @staticmethod
    def parse_token_status_payload(data: Dict[str, Any]) -> Dict[str, Any]:
        """Normalize Keepa /token fields for the Express Jobs meters."""
        def _as_int(raw: Any) -> Optional[int]:
            if raw is None:
                return None
            try:
                return int(raw)
            except (TypeError, ValueError):
                return None

        refill_rate = _as_int(data.get("refillRate"))
        if refill_rate is None or refill_rate <= 0:
            refill_rate = 5
        bucket_max = max(60, refill_rate * 60)
        return {
            "tokens_left": _as_int(data.get("tokensLeft")),
            "refill_rate": refill_rate,
            "refill_in_ms": _as_int(data.get("refillIn")),
            "bucket_max": bucket_max,
        }

    @classmethod
    async def fetch_product_pool_token_status(cls) -> Dict[str, Any]:
        """Poll Keepa /token (0 cost) for the Express/Daily 5-key pool only."""
        keys = cls._product_pool_keys_quiet()
        fingerprints = cls._key_fingerprints(keys)
        api_url = settings.keepa_api_url.rstrip("/")

        async def _one(index: int, api_key: str) -> Dict[str, Any]:
            row: Dict[str, Any] = {
                "index": index,
                "label": f"Key {index + 1}",
                "fingerprint": fingerprints[index],
                "ok": False,
                "tokens_left": None,
                "refill_rate": None,
                "refill_in_ms": None,
                "bucket_max": None,
            }
            try:
                async with httpx.AsyncClient(timeout=12.0) as client:
                    resp = await client.get(f"{api_url}/token", params={"key": api_key})
                    resp.raise_for_status()
                    payload = resp.json()
                if not isinstance(payload, dict):
                    return row
                if payload.get("error"):
                    logger.debug("Keepa /token error for key %s: %s", index, payload.get("error"))
                    return row
                parsed = cls.parse_token_status_payload(payload)
                row.update(parsed)
                row["ok"] = parsed.get("tokens_left") is not None
                return row
            except Exception as exc:
                logger.debug("Keepa token status failed for key %s: %s", index, exc)
                return row

        meters = list(await asyncio.gather(*[_one(i, key) for i, key in enumerate(keys)]))
        return {"keys": meters, "pool_size": len(keys)}

    @classmethod
    def _load_runtime_api_keys(cls) -> List[str]:
        """
        Load Keepa keys at runtime by merging all known sources:
        1) backend/.env (latest local edits)
        2) process environment
        3) pydantic settings snapshot

        We merge (not short-circuit) to avoid silently dropping valid keys
        that may be present in one source but missing in another.
        """
        file_keys = cls._parse_keepa_keys_from_env_file()
        env_keys = [k.strip() for k in os.getenv("KEEPA_API_KEYS", "").split(",") if k.strip()]
        env_primary = (os.getenv("KEEPA_API_KEY") or "").strip()
        if env_primary:
            env_keys.append(env_primary)
        env_keys = cls._dedupe_keys(env_keys)

        settings_keys = cls._dedupe_keys(settings.keepa_api_keys_list)
        merged = cls._dedupe_keys(file_keys + env_keys + settings_keys)

        logger.info(
            "Keepa key source counts: file=%s env=%s settings=%s merged=%s",
            len(file_keys),
            len(env_keys),
            len(settings_keys),
            len(merged),
        )
        if merged:
            return merged

        # Defensive fallback (should rarely be hit due keepa_api_key required).
        return [settings.keepa_api_key]
    
    @classmethod
    def _load_rotation_index(cls) -> int:
        """Load persisted rotation index (best-effort)."""
        try:
            if cls._rotation_state_path.exists():
                raw = json.loads(cls._rotation_state_path.read_text(encoding="utf-8"))
                idx = int(raw.get("next_start_index", 0))
                if idx >= 0:
                    return idx
        except Exception as e:
            logger.debug(f"Could not read Keepa rotation state: {e}")
        return 0

    @classmethod
    def _save_rotation_index(cls, value: int) -> None:
        """Persist rotation index so fairness survives app restarts."""
        try:
            cls._rotation_state_path.write_text(
                json.dumps({"next_start_index": int(value)}),
                encoding="utf-8",
            )
        except Exception as e:
            logger.debug(f"Could not persist Keepa rotation state: {e}")

    def distribute_items(self, items: list) -> List[List]:
        """Split items evenly across available keys with rotating key priority."""
        chunks = [[] for _ in range(self.num_keys)]
        if self.num_keys == 0:
            return chunks

        # Rotate the starting key each run so all keys contribute over time,
        # including newly added keys at the end of the list. Persist cursor.
        with MultiKeyKeepaClient._rotation_lock:
            loaded_index = MultiKeyKeepaClient._load_rotation_index()
            MultiKeyKeepaClient._next_start_index = loaded_index % self.num_keys
            start_index = MultiKeyKeepaClient._next_start_index
            MultiKeyKeepaClient._next_start_index = (start_index + 1) % self.num_keys
            MultiKeyKeepaClient._save_rotation_index(MultiKeyKeepaClient._next_start_index)

        for i, item in enumerate(items):
            key_index = (start_index + i) % self.num_keys
            chunks[key_index].append(item)
        return chunks
    
    async def process_items_parallel(
        self,
        items: list,
        process_fn,
        batch_id=None,
        db=None,
        offers_limit: Optional[int] = None,
    ) -> KeepaUsageStats:
        """
        Process batch items in parallel across all API keys.
        
        Args:
            items: List of batch items to process
            process_fn: Async function(keepa_client, item) -> bool
            batch_id: Optional batch ID for cancellation checks
            db: Optional database client for cancellation checks
            
        Returns:
            Usage stats including processed item count and Keepa tokens consumed
        """
        usage = KeepaUsageStats()
        chunks = self.distribute_items(items)
        
        for i, chunk in enumerate(chunks):
            logger.info(f"Key {i}: assigned {len(chunk)} UPCs")
        
        async def worker(key_index: int, api_key: str, worker_items: list) -> KeepaUsageStats:
            """Worker that processes its assigned items using one API key."""
            worker_usage = KeepaUsageStats()
            check_every = max(1, int(settings.keepa_cancel_check_every_items))
            async with KeepaClient(
                api_key=api_key,
                key_index=key_index,
                offers_limit=offers_limit,
            ) as client:
                for idx, item in enumerate(worker_items):
                    if batch_id and db and (idx % check_every == 0):
                        batch_check = db.table("upc_batches").select("status").eq("id", str(batch_id)).execute()
                        if batch_check.data and batch_check.data[0].get("status") == "cancelled":
                            logger.info(f"[Key {key_index}] Batch {batch_id} was cancelled, stopping")
                            break
                    
                    success = await process_fn(client, item)
                    if success:
                        worker_usage.processed += 1
                worker_usage.merge(client.usage_stats())
            return worker_usage
        
        tasks = []
        for i, (api_key, chunk) in enumerate(zip(self.api_keys, chunks)):
            if chunk:
                tasks.append(worker(i, api_key, chunk))
        
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                logger.error(f"[Key {i}] Worker failed with error: {result}")
            else:
                usage.merge(result)
                logger.info(f"[Key {i}] Processed {result.processed} items")
        
        logger.info(f"Total processed across {self.num_keys} keys: {usage.processed}")
        return usage


_keepa_client: Optional[KeepaClient] = None


async def get_keepa_client() -> KeepaClient:
    """Get or create Keepa client instance."""
    global _keepa_client
    if _keepa_client is None:
        _keepa_client = KeepaClient()
    return _keepa_client
