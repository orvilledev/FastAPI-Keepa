"""Service for report generation and operations."""
from typing import List, Tuple
from uuid import UUID
from app.repositories.report_repository import ReportRepository
from app.repositories.map_repository import MAPRepository
from app.repositories.seller_name_repository import SellerNameRepository
from app.services.csv_generator import CSVGenerator
from supabase import Client
import logging

logger = logging.getLogger(__name__)


class ReportService:
    """Service for generating and managing reports."""
    
    def __init__(self, db: Client):
        self.report_repo = ReportRepository(db)
        self.map_repo = MAPRepository(db)
        self.seller_name_repo = SellerNameRepository(db)
        self.csv_generator = CSVGenerator()
        self.db = db
    
    def get_price_alerts_for_job(self, job_id: UUID) -> List[dict]:
        """Get all price alerts for a job."""
        return self.report_repo.get_price_alerts(job_id)
    
    def generate_csv_for_job(self, job_id: UUID, job_name: str) -> Tuple[bytes, str, int]:
        """
        Generate comprehensive CSV report for a job matching spreadsheet format.
        
        Returns:
            Tuple of (csv_bytes, filename, off_price_count)
        """
        # Get all processed UPCs with their Keepa data
        processed_items = self.report_repo.get_all_processed_upcs_for_job(job_id)
        
        if not processed_items:
            # Return empty Excel file with headers
            csv_bytes, off_price_count = self.csv_generator.generate_comprehensive_report_csv(
                [], {}
            )
            filename = self.csv_generator.generate_csv_filename(job_name, extension="xlsx")
            return csv_bytes, filename, off_price_count

        upcs = [item.get("upc") for item in processed_items if item.get("upc")]
        map_prices_by_upc = self.map_repo.get_map_prices_by_upcs(upcs)
        
        # Load seller name lookup map from database
        try:
            seller_name_map = self.seller_name_repo.get_seller_name_map()
            logger.info(f"Loaded {len(seller_name_map)} seller name mappings for report")
        except Exception as e:
            logger.warning(f"Could not load seller names, will use raw IDs: {e}")
            seller_name_map = {}

        # Generate comprehensive Excel report
        csv_bytes, off_price_count = self.csv_generator.generate_comprehensive_report_csv(
            processed_items,
            map_prices_by_upc,
            seller_name_map=seller_name_map,
        )
        filename = self.csv_generator.generate_csv_filename(job_name, extension="xlsx")
        
        return csv_bytes, filename, off_price_count
    
    def get_total_upcs_for_job(self, job_id: UUID) -> int:
        """Get total UPC count for a job."""
        return self.report_repo.get_total_upcs_for_job(job_id)

