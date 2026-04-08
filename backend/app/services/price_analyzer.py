"""Price analysis service to detect sellers with lowered prices."""
import logging
from typing import List, Dict, Any, Optional
from decimal import Decimal

from app.services.keepa_sellers import build_unified_seller_list

logger = logging.getLogger(__name__)


class PriceAnalyzer:
    """Analyzes Keepa data to detect sellers priced below MAP."""

    @staticmethod
    def _seller_price_cents_to_dollars(raw: Any) -> Optional[Decimal]:
        """Keepa seller list prices are in cents; MAP in DB is in dollars."""
        if raw is None:
            return None
        try:
            cents = float(raw)
            if cents <= 0:
                return None
            return Decimal(str(round(cents / 100.0, 2)))
        except (TypeError, ValueError):
            return None

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

        products = keepa_response.get("products", [])
        if not products or len(products) == 0:
            return None

        product = products[0]

        parsed_data = {
            "asin": product.get("asin"),
            "title": product.get("title"),
            "brand": product.get("brand"),
            "current_sellers": product.get("current_sellers", []),
            "stats": product.get("stats", {}),
            "csv": product.get("csv", []),
            "unified_sellers": build_unified_seller_list(keepa_response),
        }

        return parsed_data

    @staticmethod
    def get_current_prices(keepa_data: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        Extract current seller prices from Keepa data (dollars).

        Args:
            keepa_data: Parsed Keepa product data

        Returns:
            List of current seller prices
        """
        current_prices = []
        if keepa_data.get("unified_sellers") is not None:
            sellers = keepa_data["unified_sellers"]
        elif keepa_data.get("products"):
            sellers = build_unified_seller_list(keepa_data)
        else:
            sellers = keepa_data.get("current_sellers", [])

        for seller in sellers:
            try:
                price_dollars = PriceAnalyzer._seller_price_cents_to_dollars(
                    seller.get("price")
                )
                seller_info = {
                    "seller_id": seller.get("sellerId"),
                    "seller_name": seller.get("sellerName", "Unknown"),
                    "price": price_dollars,
                    "is_fba": seller.get("isFBA", False),
                    "condition": seller.get("condition", "New"),
                }

                if seller_info["price"] is not None and seller_info["price"] > 0:
                    current_prices.append(seller_info)
            except Exception as e:
                logger.error(f"Error extracting seller price: {e}")
                continue

        return current_prices

    def detect_off_price_sellers(
        self,
        keepa_data: Dict[str, Any],
        map_price: Optional[Decimal] = None,
    ) -> List[Dict[str, Any]]:
        """
        Detect sellers whose current price is below MAP.

        Args:
            keepa_data: Parsed Keepa product data
            map_price: MAP (MSRP) for the UPC in dollars; if missing or <= 0, no sellers qualify.

        Returns:
            List of off-price sellers with price comparison data
        """
        off_price_sellers = []

        if map_price is None or map_price <= 0:
            return off_price_sellers

        try:
            current_prices = self.get_current_prices(keepa_data)
            if not current_prices:
                return off_price_sellers

            map_f = float(map_price)

            for seller in current_prices:
                current_price = seller["price"]
                if current_price is None or current_price <= 0:
                    continue

                cur_f = float(current_price)
                if cur_f < map_f:
                    price_change = cur_f - map_f
                    price_change_percent = (price_change / map_f) * 100 if map_f else 0.0

                    off_price_seller = {
                        "seller_id": seller["seller_id"],
                        "seller_name": seller["seller_name"],
                        "current_price": current_price,
                        "map_price": map_price,
                        # Stored in price_alerts.historical_price for schema compatibility (value is MAP)
                        "historical_price": map_price,
                        "price_change": Decimal(str(price_change)),
                        "price_change_percent": price_change_percent,
                        "is_fba": seller["is_fba"],
                        "condition": seller["condition"],
                    }

                    off_price_sellers.append(off_price_seller)

        except Exception as e:
            logger.error(f"Error detecting off-price sellers: {e}")

        return off_price_sellers

    def analyze_product(
        self,
        keepa_response: Dict[str, Any],
        map_price: Optional[Decimal] = None,
    ) -> Dict[str, Any]:
        """
        Complete analysis of a product's Keepa data.

        Args:
            keepa_response: Raw response from Keepa API
            map_price: MAP in dollars for this UPC (from map_prices); optional
        """
        result = {
            "upc": None,
            "product_title": None,
            "off_price_sellers": [],
            "total_sellers": 0,
            "error": None,
        }

        try:
            keepa_data = self.parse_keepa_data(keepa_response)
            if not keepa_data:
                result["error"] = "No product data found in Keepa response"
                return result

            result["upc"] = keepa_data.get("asin")
            result["product_title"] = keepa_data.get("title")

            current_prices = self.get_current_prices(keepa_data)
            result["total_sellers"] = len(current_prices)

            off_price_sellers = self.detect_off_price_sellers(keepa_data, map_price=map_price)
            result["off_price_sellers"] = off_price_sellers

        except Exception as e:
            logger.error(f"Error analyzing product: {e}")
            result["error"] = str(e)

        return result
