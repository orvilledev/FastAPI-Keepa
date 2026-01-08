"""Service for report generation and operations."""
from typing import List, Tuple, Dict
from uuid import UUID
from decimal import Decimal
from app.repositories.report_repository import ReportRepository
from app.repositories.map_repository import MAPRepository
from app.services.csv_generator import CSVGenerator
from supabase import Client
from fastapi import HTTPException
import logging

logger = logging.getLogger(__name__)


class ReportService:
    """Service for generating and managing reports."""
    
    def __init__(self, db: Client):
        self.report_repo = ReportRepository(db)
        self.map_repo = MAPRepository(db)
        self.csv_generator = CSVGenerator()
        self.db = db
    
    def get_price_alerts_for_job(self, job_id: UUID) -> List[dict]:
        """Get all price alerts for a job."""
        return self.report_repo.get_price_alerts(job_id)
    
    def generate_csv_for_job(self, job_id: UUID, job_name: str) -> Tuple[bytes, str]:
        """
        Generate comprehensive CSV report for a job matching spreadsheet format.
        
        Returns:
            Tuple of (csv_bytes, filename)
        """
        # Get all processed UPCs with their Keepa data
        processed_items = self.report_repo.get_all_processed_upcs_for_job(job_id)
        
        if not processed_items:
            # Return empty Excel file with headers
            csv_bytes = self.csv_generator.generate_comprehensive_report_csv(
                [], {}, {}
            )
            filename = self.csv_generator.generate_csv_filename(job_name, extension="xlsx")
            return csv_bytes, filename
        
        # Get price alerts grouped by UPC
        price_alerts_by_upc = self.report_repo.get_price_alerts_by_upc(job_id)
        
        # Get MAP prices for all UPCs
        map_prices_by_upc = {}
        upcs = [item.get("upc") for item in processed_items if item.get("upc")]
        
        # Fetch MAP prices (handle cases where MAP doesn't exist)
        for upc in upcs:
            try:
                map_entry = self.map_repo.get_map_by_upc(upc)
                map_price = Decimal(str(map_entry.get("map_price", 0)))
                if map_price > 0:
                    map_prices_by_upc[upc] = map_price
            except HTTPException:
                # MAP price not found for this UPC (404), skip it
                pass
            except Exception as e:
                # Other errors, log but continue
                logger.debug(f"Error fetching MAP price for UPC {upc}: {e}")
                pass
        
        # Generate comprehensive Excel report
        csv_bytes = self.csv_generator.generate_comprehensive_report_csv(
            processed_items,
            price_alerts_by_upc,
            map_prices_by_upc
        )
        filename = self.csv_generator.generate_csv_filename(job_name, extension="xlsx")
        
        return csv_bytes, filename
    
    def get_total_upcs_for_job(self, job_id: UUID) -> int:
        """Get total UPC count for a job."""
        return self.report_repo.get_total_upcs_for_job(job_id)

