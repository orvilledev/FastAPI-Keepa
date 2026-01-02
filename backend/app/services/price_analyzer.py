"""Price analysis service to detect sellers with lowered prices."""
import logging
from typing import List, Dict, Any, Optional
from decimal import Decimal

logger = logging.getLogger(__name__)


class PriceAnalyzer:
    """Analyzes Keepa data to detect off-price sellers (sellers with lowered prices)."""
    
    @staticmethod
    def parse_keepa_data(keepa_response: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """
        Parse Keepa API response and extract relevant product data.
        
        Args:
            keepa_response: Raw response from Keepa API
            
        Returns:
            Parsed product data or None if invalid
        """
        if not keepa_response or not isinstance(keepa_response, dict):
            return None
        
        # Keepa API typically returns products in a list
        products = keepa_response.get("products", [])
        if not products or len(products) == 0:
            return None
        
        # Get first product (assuming single product lookup)
        product = products[0]
        
        # Extract relevant data
        parsed_data = {
            "asin": product.get("asin"),
            "title": product.get("title"),
            "brand": product.get("brand"),
            "current_sellers": product.get("current_sellers", []),
            "stats": product.get("stats", {}),
            "csv": product.get("csv", []),  # Price history CSV data
        }
        
        return parsed_data
    
    @staticmethod
    def extract_price_history(keepa_data: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        Extract price history from Keepa CSV data.
        
        Args:
            keepa_data: Parsed Keepa product data
            
        Returns:
            List of price history entries with timestamp and price
        """
        price_history = []
        csv_data = keepa_data.get("csv", [])
        
        if not csv_data or len(csv_data) == 0:
            return price_history
        
        # Keepa CSV format: [time, price_new, price_used, ...]
        # Index 1 is typically new price, index 2 is used price
        # Time is Unix timestamp in minutes
        
        try:
            for entry in csv_data:
                if len(entry) >= 3:
                    timestamp = entry[0]  # Unix timestamp in minutes
                    price_new = entry[1] if entry[1] != -1 else None
                    price_used = entry[2] if entry[2] != -1 else None
                    
                    # Use new price if available, otherwise used price
                    price = price_new if price_new is not None else price_used
                    
                    if price is not None:
                        price_history.append({
                            "timestamp": timestamp,
                            "price": Decimal(str(price)),
                            "is_new": price_new is not None
                        })
        except Exception as e:
            logger.error(f"Error extracting price history: {e}")
        
        return price_history
    
    @staticmethod
    def get_current_prices(keepa_data: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        Extract current seller prices from Keepa data.
        
        Args:
            keepa_data: Parsed Keepa product data
            
        Returns:
            List of current seller prices
        """
        current_prices = []
        sellers = keepa_data.get("current_sellers", [])
        
        for seller in sellers:
            try:
                seller_info = {
                    "seller_id": seller.get("sellerId"),
                    "seller_name": seller.get("sellerName", "Unknown"),
                    "price": Decimal(str(seller.get("price", 0))) if seller.get("price") else None,
                    "is_fba": seller.get("isFBA", False),
                    "condition": seller.get("condition", "New"),
                }
                
                if seller_info["price"] is not None and seller_info["price"] > 0:
                    current_prices.append(seller_info)
            except Exception as e:
                logger.error(f"Error extracting seller price: {e}")
                continue
        
        return current_prices
    
    @staticmethod
    def calculate_average_historical_price(price_history: List[Dict[str, Any]], days: int = 30) -> Optional[Decimal]:
        """
        Calculate average historical price over specified days.
        
        Args:
            price_history: List of price history entries
            days: Number of days to look back
            
        Returns:
            Average price or None if insufficient data
        """
        if not price_history:
            return None
        
        # Filter prices from last N days
        # Keepa timestamps are in minutes, so days * 24 * 60
        import time
        current_time = int(time.time() / 60)  # Current time in minutes
        cutoff_time = current_time - (days * 24 * 60)
        
        recent_prices = [
            entry["price"] 
            for entry in price_history 
            if entry["timestamp"] >= cutoff_time and entry["price"] is not None
        ]
        
        if not recent_prices:
            # If no recent prices, use all available prices
            recent_prices = [
                entry["price"] 
                for entry in price_history 
                if entry["price"] is not None
            ]
        
        if not recent_prices:
            return None
        
        avg_price = sum(recent_prices) / len(recent_prices)
        return Decimal(str(avg_price))
    
    def detect_off_price_sellers(
        self, 
        keepa_data: Dict[str, Any],
        historical_days: int = 30
    ) -> List[Dict[str, Any]]:
        """
        Detect sellers with lowered prices (off-price sellers).
        
        Any seller with a price lower than historical average is considered off-price.
        
        Args:
            keepa_data: Parsed Keepa product data
            historical_days: Number of days to use for historical price calculation
            
        Returns:
            List of off-price sellers with price comparison data
        """
        off_price_sellers = []
        
        try:
            # Extract current prices
            current_prices = self.get_current_prices(keepa_data)
            if not current_prices:
                return off_price_sellers
            
            # Extract price history
            price_history = self.extract_price_history(keepa_data)
            if not price_history:
                logger.warning("No price history available for comparison")
                return off_price_sellers
            
            # Calculate average historical price
            avg_historical_price = self.calculate_average_historical_price(price_history, historical_days)
            if avg_historical_price is None:
                logger.warning("Could not calculate historical average price")
                return off_price_sellers
            
            # Compare each current seller price with historical average
            for seller in current_prices:
                current_price = seller["price"]
                
                if current_price is None or current_price <= 0:
                    continue
                
                # Check if current price is lower than historical average
                if current_price < avg_historical_price:
                    price_change = current_price - avg_historical_price
                    price_change_percent = (price_change / avg_historical_price) * 100
                    
                    off_price_seller = {
                        "seller_id": seller["seller_id"],
                        "seller_name": seller["seller_name"],
                        "current_price": current_price,
                        "historical_price": avg_historical_price,
                        "price_change": price_change,
                        "price_change_percent": price_change_percent,
                        "is_fba": seller["is_fba"],
                        "condition": seller["condition"],
                    }
                    
                    off_price_sellers.append(off_price_seller)
        
        except Exception as e:
            logger.error(f"Error detecting off-price sellers: {e}")
        
        return off_price_sellers
    
    def analyze_product(self, keepa_response: Dict[str, Any]) -> Dict[str, Any]:
        """
        Complete analysis of a product's Keepa data.
        
        Args:
            keepa_response: Raw response from Keepa API
            
        Returns:
            Analysis results with off-price sellers
        """
        result = {
            "upc": None,
            "product_title": None,
            "off_price_sellers": [],
            "total_sellers": 0,
            "error": None
        }
        
        try:
            # Parse Keepa data
            keepa_data = self.parse_keepa_data(keepa_response)
            if not keepa_data:
                result["error"] = "No product data found in Keepa response"
                return result
            
            result["upc"] = keepa_data.get("asin")
            result["product_title"] = keepa_data.get("title")
            
            # Get current prices
            current_prices = self.get_current_prices(keepa_data)
            result["total_sellers"] = len(current_prices)
            
            # Detect off-price sellers
            off_price_sellers = self.detect_off_price_sellers(keepa_data)
            result["off_price_sellers"] = off_price_sellers
        
        except Exception as e:
            logger.error(f"Error analyzing product: {e}")
            result["error"] = str(e)
        
        return result

