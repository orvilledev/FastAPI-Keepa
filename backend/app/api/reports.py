"""Reports API endpoints."""
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from typing import List
from uuid import UUID
import io
from datetime import datetime
from app.dependencies import get_current_user, verify_job_access
from app.models.price_alert import PriceAlertResponse
from app.database import get_supabase
from app.services.csv_generator import CSVGenerator
from app.services.email_service import EmailService
from app.services.report_service import ReportService
from app.utils.error_handler import handle_api_errors
from supabase import Client

router = APIRouter()


@router.post("/reports/test-email")
async def test_email(
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
                "from": email_service.email_from
            }
        else:
            return {
                "message": "Failed to send test email",
                "error": error_details or "Check backend logs for details",
                "config": {
                    "email_from": email_service.email_from or "NOT SET",
                    "email_to": email_service.email_to or "NOT SET",
                    "recipients_parsed": email_service._parse_recipients(email_service.email_to or ""),
                    "smtp_host": email_service.smtp_host,
                    "smtp_port": email_service.smtp_port,
                    "has_password": bool(email_service.email_password)
                },
                "troubleshooting": {
                    "gmail_app_password": "If using Gmail, you need an App Password. Go to: https://myaccount.google.com/apppasswords",
                    "check_password": "Make sure EMAIL_PASSWORD in .env is a 16-character App Password (no spaces)",
                    "verify_2fa": "2-Step Verification must be enabled to generate App Passwords"
                }
            }
    except Exception as e:
        logger.error(f"Error testing email: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error testing email: {str(e)}")


@router.get("/reports/{job_id}", response_model=List[PriceAlertResponse])
@handle_api_errors("get price alerts")
async def get_price_alerts(
    job: dict = Depends(verify_job_access),
    db: Client = Depends(get_supabase)
):
    """Get price alerts for a job."""
    job_id = UUID(job["id"])
    report_service = ReportService(db)
    alerts = report_service.get_price_alerts_for_job(job_id)
    return [PriceAlertResponse(**alert) for alert in alerts]


@router.get("/reports/{job_id}/csv")
@handle_api_errors("generate CSV")
async def download_csv(
    job: dict = Depends(verify_job_access),
    db: Client = Depends(get_supabase)
):
    """Download CSV report for a job."""
    job_id = UUID(job["id"])
    report_service = ReportService(db)
    csv_bytes, filename = report_service.generate_csv_for_job(job_id, job["job_name"])
    
    return StreamingResponse(
        io.BytesIO(csv_bytes),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )


@router.post("/reports/{job_id}/email")
@handle_api_errors("resend email")
async def resend_email(
    job: dict = Depends(verify_job_access),
    db: Client = Depends(get_supabase)
):
    """Resend email report for a job."""
    job_id = UUID(job["id"])
    report_service = ReportService(db)
    
    # Generate CSV
    csv_bytes, filename = report_service.generate_csv_for_job(job_id, job["job_name"])
    
    # Get alerts and total UPCs
    alerts = report_service.get_price_alerts_for_job(job_id)
    total_upcs = report_service.get_total_upcs_for_job(job_id)
    
    # Send email
    email_service = EmailService()
    success = email_service.send_csv_report(
        csv_bytes=csv_bytes,
        filename=filename,
        job_name=job["job_name"],
        total_upcs=total_upcs,
        alerts_count=len(alerts)
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

