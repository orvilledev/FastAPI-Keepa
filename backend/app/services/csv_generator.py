"""CSV generation service for price alerts."""
import pandas as pd
import io
import logging
from typing import List, Dict, Any
from datetime import datetime

logger = logging.getLogger(__name__)


class CSVGenerator:
    """Generates CSV files from price alert data."""
    
    @staticmethod
    def generate_price_alerts_csv(price_alerts: List[Dict[str, Any]]) -> bytes:
        """
        Generate CSV file from price alerts data.
        
        Args:
            price_alerts: List of price alert dictionaries
            
        Returns:
            CSV file as bytes
        """
        if not price_alerts:
            # Return empty CSV with headers
            df = pd.DataFrame(columns=[
                "UPC",
                "Seller Name",
                "Current Price",
                "Historical Price",
                "Price Change %",
                "Detected At"
            ])
        else:
            # Prepare data for DataFrame
            csv_data = []
            for alert in price_alerts:
                csv_data.append({
                    "UPC": alert.get("upc", ""),
                    "Seller Name": alert.get("seller_name", ""),
                    "Current Price": float(alert.get("current_price", 0)) if alert.get("current_price") else "",
                    "Historical Price": float(alert.get("historical_price", 0)) if alert.get("historical_price") else "",
                    "Price Change %": float(alert.get("price_change_percent", 0)) if alert.get("price_change_percent") else "",
                    "Detected At": alert.get("detected_at", ""),
                })
            
            df = pd.DataFrame(csv_data)
        
        # Generate CSV bytes
        csv_buffer = io.BytesIO()
        df.to_csv(csv_buffer, index=False, encoding="utf-8")
        csv_bytes = csv_buffer.getvalue()
        csv_buffer.close()
        
        return csv_bytes
    
    @staticmethod
    def generate_csv_filename(job_name: str = "keepa_report") -> str:
        """
        Generate CSV filename with timestamp.
        
        Args:
            job_name: Base name for the file
            
        Returns:
            Filename string
        """
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        # Sanitize job_name for filename
        safe_name = "".join(c for c in job_name if c.isalnum() or c in (" ", "-", "_")).strip()
        safe_name = safe_name.replace(" ", "_")
        filename = f"{safe_name}_{timestamp}.csv"
        return filename
    
    @staticmethod
    def convert_alerts_to_csv_format(alerts: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Convert price alerts from database format to CSV format.
        
        Args:
            alerts: List of price alert dictionaries from database
            
        Returns:
            List of dictionaries formatted for CSV generation
        """
        return [
            {
                "upc": alert["upc"],
                "seller_name": alert.get("seller_name"),
                "current_price": alert.get("current_price"),
                "historical_price": alert.get("historical_price"),
                "price_change_percent": alert.get("price_change_percent"),
                "detected_at": alert.get("detected_at"),
            }
            for alert in alerts
        ]

