"""Reports API endpoints."""
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from typing import List
from uuid import UUID
import io
import logging
from datetime import datetime
from app.dependencies import get_current_user, verify_job_access
from app.database import get_supabase
from app.services.csv_generator import CSVGenerator
from app.services.email_service import EmailService
from app.services.report_service import ReportService
from app.utils.error_handler import handle_api_errors
from supabase import Client

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/reports/test-email")
def test_email(
    current_user: dict = Depends(get_current_user),
):
    """Test email configuration by sending a test email."""
    try:
        email_service = EmailService()
        
        # Create a simple test CSV
        test_data = [
            {
                "upc": "TEST123",
                "seller_name": "Test Seller",
                "current_price": 99.99,
                "historical_price": 89.99,
                "price_change_percent": 11.11,
                "detected_at": datetime.utcnow().isoformat(),
            }
        ]
        
        csv_generator = CSVGenerator()
        csv_bytes = csv_generator.generate_price_alerts_csv(test_data)
        filename = f"test_email_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
        
        # Try to send email and capture detailed error
        success = email_service.send_csv_report(
            csv_bytes=csv_bytes,
            filename=filename,
            job_name="Email Configuration Test",
            total_upcs=1,
            alerts_count=1
        )
        error_details = email_service.last_error
        
        if success:
            recipients_list = email_service._parse_recipients(email_service.email_to)
            return {
                "message": "Test email sent successfully",
                "recipients": recipients_list,
                "from": email_service.email_from,
                "transport": email_service.email_transport,
            }
        else:
            from app.config import settings
            return {
                "message": "Failed to send test email",
                "error": error_details or "Check backend logs for details",
                "config": {
                    "email_from": email_service.email_from or "NOT SET",
                    "email_to": email_service.email_to or "NOT SET",
                    "recipients_parsed": email_service._parse_recipients(email_service.email_to or ""),
                    "transport": email_service.email_transport,
                    "graph_configured": settings.graph_email_configured,
                    "smtp_host": email_service.smtp_host,
                    "smtp_port": email_service.smtp_port,
                    "has_password": bool(email_service.email_password),
                },
                "troubleshooting": {
                    "graph_setup": "For Microsoft 365, use Graph API (see docs/microsoft-graph-email-setup.md). Set AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, and EMAIL_TRANSPORT=graph.",
                    "smtp_auth_disabled": "If SMTP fails with SmtpClientAuthentication is disabled, your tenant blocks SMTP AUTH — use Graph instead.",
                    "gmail_app_password": "If using Gmail SMTP, use an App Password: https://myaccount.google.com/apppasswords",
                }
            }
    except Exception as e:
        logger.error(f"Error testing email: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error testing email: {str(e)}")


@router.get("/reports/{job_id}", response_model=List[dict])
@handle_api_errors("get price alerts")
def get_price_alerts(
    job: dict = Depends(verify_job_access),
    db: Client = Depends(get_supabase)
):
    """Get report rows using the same logic as CSV/email output."""
    job_id = UUID(job["id"])
    report_service = ReportService(db)
    return report_service.get_comprehensive_report_rows_for_job(job_id)


@router.get("/reports/{job_id}/csv")
@handle_api_errors("generate CSV")
def download_csv(
    job: dict = Depends(verify_job_access),
    db: Client = Depends(get_supabase)
):
    """Download Excel report for a job."""
    job_id = UUID(job["id"])
    report_service = ReportService(db)
    csv_bytes, filename, _ = report_service.generate_csv_for_job(
        job_id, job["job_name"], map_vendor_type=job.get("map_vendor_type")
    )
    
    # Determine content type based on file extension
    if filename.endswith('.xlsx'):
        media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    else:
        media_type = "text/csv"
    
    return StreamingResponse(
        io.BytesIO(csv_bytes),
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )


@router.post("/reports/{job_id}/email")
@handle_api_errors("resend email")
def resend_email(
    job: dict = Depends(verify_job_access),
    db: Client = Depends(get_supabase)
):
    """Resend email report for a job."""
    job_id = UUID(job["id"])
    report_service = ReportService(db)
    
    # Generate CSV
    csv_bytes, filename, off_price_count = report_service.generate_csv_for_job(
        job_id, job["job_name"], map_vendor_type=job.get("map_vendor_type")
    )
    
    total_upcs = report_service.get_total_upcs_for_job(job_id)
    
    # Send email
    email_service = EmailService()
    success = email_service.send_csv_report(
        csv_bytes=csv_bytes,
        filename=filename,
        job_name=job["job_name"],
        total_upcs=total_upcs,
        alerts_count=off_price_count
    )
    
    if success:
        return {"message": "Email sent successfully", "job_id": str(job_id)}
    else:
        # Provide more helpful error message
        error_detail = "Failed to send email. Please check your email configuration in backend/.env file. "
        error_detail += "Common issues: incorrect SMTP_HOST (should be 'smtp.gmail.com' for Gmail), "
        error_detail += "invalid password/app password, or network connectivity issues. "
        error_detail += "Check backend terminal logs for detailed error messages."
        raise HTTPException(status_code=500, detail=error_detail)

