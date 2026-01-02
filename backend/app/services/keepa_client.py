"""Keepa API client with rate limiting and retry logic."""
import httpx
import asyncio
import logging
from typing import Optional, Dict, Any, List
from app.config import settings

logger = logging.getLogger(__name__)


class KeepaClient:
    """Client for interacting with Keepa API."""
    
    def __init__(self):
        self.api_key = settings.keepa_api_key
        self.api_url = settings.keepa_api_url.rstrip("/")
        self.client = httpx.AsyncClient(timeout=30.0)
        self.rate_limit_delay = 1.0  # Delay between requests in seconds
        self.max_retries = 3
        self.retry_delay = 2.0  # Initial retry delay in seconds
        
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
        
        # Log the request details (mask API key for security)
        params_log = {k: (v if k != "key" else "***MASKED***") for k, v in params.items()}
        logger.info(f"Making Keepa API request to: {url}")
        logger.info(f"Request parameters: {params_log}")
        
        try:
            response = await self.client.get(url, params=params)
            logger.info(f"Keepa API response status: {response.status_code}")
            
            response.raise_for_status()
            data = response.json()
            
            # Log response data (truncated for large responses)
            response_preview = str(data)[:500] if data else "Empty response"
            logger.info(f"Keepa API response data (preview): {response_preview}")
            
            # Check for API errors in response
            if isinstance(data, dict) and "error" in data:
                logger.error(f"Keepa API returned error in response: {data['error']}")
                raise Exception(f"Keepa API error: {data['error']}")
            
            logger.info(f"Keepa API request successful for endpoint: {endpoint}")
            return data
            
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 429:  # Rate limited
                wait_time = self.retry_delay * (2 ** retry_count)
                logger.warning(f"Rate limited. Waiting {wait_time}s before retry...")
                await asyncio.sleep(wait_time)
                
                if retry_count < self.max_retries:
                    return await self._make_request(endpoint, params, retry_count + 1)
                else:
                    raise Exception("Max retries exceeded due to rate limiting")
            
            elif e.response.status_code >= 500 and retry_count < self.max_retries:
                # Server error - retry
                wait_time = self.retry_delay * (2 ** retry_count)
                logger.warning(f"Server error {e.response.status_code}. Retrying in {wait_time}s...")
                await asyncio.sleep(wait_time)
                return await self._make_request(endpoint, params, retry_count + 1)
            
            else:
                error_text = e.response.text[:500] if e.response.text else "No error text"
                logger.error(f"Keepa API HTTP error {e.response.status_code}: {error_text}")
                logger.error(f"Request URL was: {url}")
                logger.error(f"Request params (key masked): {params_log}")
                raise
                
        except httpx.RequestError as e:
            if retry_count < self.max_retries:
                wait_time = self.retry_delay * (2 ** retry_count)
                logger.warning(f"Request error: {e}. Retrying in {wait_time}s...")
                await asyncio.sleep(wait_time)
                return await self._make_request(endpoint, params, retry_count + 1)
            else:
                logger.error(f"Request failed after {self.max_retries} retries: {e}")
                raise
                
        except Exception as e:
            logger.error(f"Unexpected error in Keepa API request: {e}")
            raise
    
    async def fetch_product_data(self, upc: str) -> Optional[Dict[str, Any]]:
        """
        Fetch product data for a single UPC.
        
        Args:
            upc: Product UPC code
            
        Returns:
            Product data from Keepa API or None if not found
        """
        try:
            # Keepa API uses 'code' parameter for UPC/EAN lookups
            # Use 'asin' parameter for ASIN lookups
            params = {
                "code": upc,  # Use 'code' parameter for UPC/EAN codes
                "domain": "1",  # 1 = US, 2 = UK, etc.
                "stats": "180",  # Request 180 days of stats
                "history": "1",  # Include price history
            }
            
            # Add rate limiting delay
            await asyncio.sleep(self.rate_limit_delay)
            
            logger.info(f"Fetching Keepa data for UPC: {upc}")
            data = await self._make_request("product", params)
            logger.info(f"Successfully fetched Keepa data for UPC: {upc}")
            return data
            
        except Exception as e:
            logger.error(f"Failed to fetch product data for UPC {upc}: {e}")
            return None
    
    async def batch_fetch(self, upcs: List[str]) -> Dict[str, Optional[Dict[str, Any]]]:
        """
        Fetch product data for multiple UPCs with rate limiting.
        
        Args:
            upcs: List of UPC codes
            
        Returns:
            Dictionary mapping UPC to product data (or None if not found)
        """
        results = {}
        
        for upc in upcs:
            try:
                data = await self.fetch_product_data(upc)
                results[upc] = data
            except Exception as e:
                logger.error(f"Error processing UPC {upc}: {e}")
                results[upc] = None
        
        return results
    
    async def close(self):
        """Close HTTP client."""
        await self.client.aclose()


# Singleton instance (optional, can also use context manager)
_keepa_client: Optional[KeepaClient] = None


async def get_keepa_client() -> KeepaClient:
    """Get or create Keepa client instance."""
    global _keepa_client
    if _keepa_client is None:
        _keepa_client = KeepaClient()
    return _keepa_client

