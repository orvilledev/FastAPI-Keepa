"""Service for report generation and operations."""
from typing import List, Tuple
from uuid import UUID
from app.repositories.report_repository import ReportRepository
from app.services.csv_generator import CSVGenerator
from supabase import Client


class ReportService:
    """Service for generating and managing reports."""
    
    def __init__(self, db: Client):
        self.report_repo = ReportRepository(db)
        self.csv_generator = CSVGenerator()
    
    def get_price_alerts_for_job(self, job_id: UUID) -> List[dict]:
        """Get all price alerts for a job."""
        return self.report_repo.get_price_alerts(job_id)
    
    def generate_csv_for_job(self, job_id: UUID, job_name: str) -> Tuple[bytes, str]:
        """
        Generate CSV report for a job.
        
        Returns:
            Tuple of (csv_bytes, filename)
        """
        alerts = self.report_repo.get_price_alerts(job_id)
        
        # Convert to CSV format
        alerts_for_csv = self.csv_generator.convert_alerts_to_csv_format(alerts)
        
        # Generate CSV
        csv_bytes = self.csv_generator.generate_price_alerts_csv(alerts_for_csv)
        filename = self.csv_generator.generate_csv_filename(job_name)
        
        return csv_bytes, filename
    
    def get_total_upcs_for_job(self, job_id: UUID) -> int:
        """Get total UPC count for a job."""
        return self.report_repo.get_total_upcs_for_job(job_id)

