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

        Requests ``stats`` + ``buybox`` with ``offers=0`` so Keepa returns the
        current buy-box seller id and price inside the product ``stats`` object
        without the per-offer list. This avoids the ``offers`` token surcharge
        (6 tokens per 10 offers), so it costs only a few tokens per UPC instead
        of dozens. Intended for the Keepa Import File tool, which only needs the
        buy-box winner and does not scan competing sellers.
        """
        try:
            params = {
                "code": upc,
                "domain": str(settings.keepa_domain),
                "stats": str(settings.keepa_stats_window_days),
                "offers": "0",
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
    
    def __init__(self):
        self.api_keys = self._load_runtime_api_keys()
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
    def _parse_keepa_keys_from_env_file(cls) -> List[str]:
        """Best-effort parse of KEEPA_API_KEYS/KEEPA_API_KEY from backend/.env."""
        if not cls._backend_env_path.exists():
            return []

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
            return []

        csv_keys = [k.strip() for k in values.get("KEEPA_API_KEYS", "").split(",") if k.strip()]
        primary = values.get("KEEPA_API_KEY", "").strip()
        if primary:
            csv_keys.append(primary)
        return cls._dedupe_keys(csv_keys)

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
    ) -> int:
        """
        Process batch items in parallel across all API keys.
        
        Args:
            items: List of batch items to process
            process_fn: Async function(keepa_client, item) -> bool
            batch_id: Optional batch ID for cancellation checks
            db: Optional database client for cancellation checks
            
        Returns:
            Total number of processed items
        """
        chunks = self.distribute_items(items)
        
        for i, chunk in enumerate(chunks):
            logger.info(f"Key {i}: assigned {len(chunk)} UPCs")
        
        async def worker(key_index: int, api_key: str, worker_items: list) -> int:
            """Worker that processes its assigned items using one API key."""
            processed = 0
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
                        processed += 1
            return processed
        
        tasks = []
        for i, (api_key, chunk) in enumerate(zip(self.api_keys, chunks)):
            if chunk:
                tasks.append(worker(i, api_key, chunk))
        
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        total_processed = 0
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                logger.error(f"[Key {i}] Worker failed with error: {result}")
            else:
                total_processed += result
                logger.info(f"[Key {i}] Processed {result} items")
        
        logger.info(f"Total processed across {self.num_keys} keys: {total_processed}")
        return total_processed


_keepa_client: Optional[KeepaClient] = None


async def get_keepa_client() -> KeepaClient:
    """Get or create Keepa client instance."""
    global _keepa_client
    if _keepa_client is None:
        _keepa_client = KeepaClient()
    return _keepa_client
