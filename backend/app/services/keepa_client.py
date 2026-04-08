"""Keepa API client with rate limiting, retry logic, and multi-key support."""
import httpx
import asyncio
import logging
from typing import Optional, Dict, Any, List
from app.config import settings

logger = logging.getLogger(__name__)


class KeepaClient:
    """Client for interacting with Keepa API using a single key."""
    
    def __init__(self, api_key: Optional[str] = None, key_index: int = 0):
        self.api_key = api_key or settings.keepa_api_key
        self.key_index = key_index
        self.api_url = settings.keepa_api_url.rstrip("/")
        self.client = httpx.AsyncClient(timeout=30.0)
        self.rate_limit_delay = 1.0
        self.max_retries = 3
        self.retry_delay = 2.0
        self.tokens_left: Optional[int] = None
        
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
            
            response_preview = str(data)[:500] if data else "Empty response"
            logger.info(f"[Key {self.key_index}] Keepa API response data (preview): {response_preview}")
            
            if isinstance(data, dict) and "error" in data:
                logger.error(f"[Key {self.key_index}] Keepa API returned error: {data['error']}")
                raise Exception(f"Keepa API error: {data['error']}")
            
            return data
            
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 429:
                wait_time = self.retry_delay * (2 ** retry_count)
                logger.warning(f"[Key {self.key_index}] Rate limited. Waiting {wait_time}s before retry...")
                await asyncio.sleep(wait_time)
                
                if retry_count < self.max_retries:
                    return await self._make_request(endpoint, params, retry_count + 1)
                else:
                    raise Exception("Max retries exceeded due to rate limiting")
            
            elif e.response.status_code >= 500 and retry_count < self.max_retries:
                wait_time = self.retry_delay * (2 ** retry_count)
                logger.warning(f"[Key {self.key_index}] Server error {e.response.status_code}. Retrying in {wait_time}s...")
                await asyncio.sleep(wait_time)
                return await self._make_request(endpoint, params, retry_count + 1)
            
            else:
                error_text = e.response.text[:500] if e.response.text else "No error text"
                logger.error(f"[Key {self.key_index}] Keepa API HTTP error {e.response.status_code}: {error_text}")
                raise
                
        except httpx.RequestError as e:
            if retry_count < self.max_retries:
                wait_time = self.retry_delay * (2 ** retry_count)
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
                "domain": "1",
                "stats": "180",
                "history": "1",
                "offers": "50",
                "buybox": "1",
            }
            
            await asyncio.sleep(self.rate_limit_delay)
            
            logger.info(f"[Key {self.key_index}] Fetching Keepa data for UPC: {upc}")
            data = await self._make_request("product", params)
            logger.info(f"[Key {self.key_index}] Successfully fetched Keepa data for UPC: {upc}")
            return data
            
        except Exception as e:
            logger.error(f"[Key {self.key_index}] Failed to fetch product data for UPC {upc}: {e}")
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
    
    def __init__(self):
        self.api_keys = settings.keepa_api_keys_list
        self.num_keys = len(self.api_keys)
        logger.info(f"MultiKeyKeepaClient initialized with {self.num_keys} API key(s)")
    
    def distribute_items(self, items: list) -> List[List]:
        """Split items evenly across available keys."""
        chunks = [[] for _ in range(self.num_keys)]
        for i, item in enumerate(items):
            chunks[i % self.num_keys].append(item)
        return chunks
    
    async def process_items_parallel(
        self,
        items: list,
        process_fn,
        batch_id=None,
        db=None,
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
            async with KeepaClient(api_key=api_key, key_index=key_index) as client:
                for item in worker_items:
                    if batch_id and db:
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
