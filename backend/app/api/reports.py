"""Reports API endpoints."""
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from typing import List
from uuid import UUID
import io
from app.dependencies import get_current_user
from app.models.price_alert import PriceAlertResponse
from app.database import get_supabase
from app.services.csv_generator import CSVGenerator
from app.services.email_service import EmailService
from supabase import Client

router = APIRouter()


@router.post("/reports/test-email")
async def test_email(
    current_user: dict = Depends(get_current_user),
):
    """Test email configuration by sending a test email."""
    try:
        from app.services.email_service import EmailService
        from app.services.csv_generator import CSVGenerator
        from datetime import datetime
        import smtplib
        
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
        raise HTTPException(status_code=500, detail=f"Error testing email: {str(e)}")


@router.get("/reports/{job_id}", response_model=List[PriceAlertResponse])
async def get_price_alerts(
    job_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Get price alerts for a job."""
    try:
        # Verify job exists and user has access
        job_response = db.table("batch_jobs").select("created_by").eq("id", str(job_id)).execute()
        
        if not job_response.data:
            raise HTTPException(status_code=404, detail="Job not found")
        
        job = job_response.data[0]
        
        # Check permissions
        profile_response = db.table("profiles").select("role").eq("id", current_user["id"]).execute()
        is_admin = profile_response.data and profile_response.data[0].get("role") == "admin"
        
        if not is_admin and job["created_by"] != current_user["id"]:
            raise HTTPException(status_code=403, detail="Not authorized to view this job")
        
        # Get price alerts
        alerts_response = db.table("price_alerts").select("*").eq(
            "batch_job_id", str(job_id)
        ).order("detected_at", desc=True).execute()
        
        return [PriceAlertResponse(**alert) for alert in alerts_response.data]
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get price alerts: {str(e)}")


@router.get("/reports/{job_id}/csv")
async def download_csv(
    job_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Download CSV report for a job."""
    try:
        # Verify job exists and user has access
        job_response = db.table("batch_jobs").select("*").eq("id", str(job_id)).execute()
        
        if not job_response.data:
            raise HTTPException(status_code=404, detail="Job not found")
        
        job = job_response.data[0]
        
        # Check permissions
        profile_response = db.table("profiles").select("role").eq("id", current_user["id"]).execute()
        is_admin = profile_response.data and profile_response.data[0].get("role") == "admin"
        
        if not is_admin and job["created_by"] != current_user["id"]:
            raise HTTPException(status_code=403, detail="Not authorized to view this job")
        
        # Get price alerts
        alerts_response = db.table("price_alerts").select("*").eq(
            "batch_job_id", str(job_id)
        ).order("detected_at", desc=True).execute()
        
        alerts = alerts_response.data
        
        # Convert to CSV format
        alerts_for_csv = [
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
        
        # Generate CSV
        csv_generator = CSVGenerator()
        csv_bytes = csv_generator.generate_price_alerts_csv(alerts_for_csv)
        filename = csv_generator.generate_csv_filename(job["job_name"])
        
        # Return as streaming response
        return StreamingResponse(
            io.BytesIO(csv_bytes),
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'}
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate CSV: {str(e)}")


@router.post("/reports/{job_id}/email")
async def resend_email(
    job_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Resend email report for a job."""
    try:
        # Verify job exists and user has access
        job_response = db.table("batch_jobs").select("*").eq("id", str(job_id)).execute()
        
        if not job_response.data:
            raise HTTPException(status_code=404, detail="Job not found")
        
        job = job_response.data[0]
        
        # Check permissions
        profile_response = db.table("profiles").select("role").eq("id", current_user["id"]).execute()
        is_admin = profile_response.data and profile_response.data[0].get("role") == "admin"
        
        if not is_admin and job["created_by"] != current_user["id"]:
            raise HTTPException(status_code=403, detail="Not authorized to resend email for this job")
        
        # Get price alerts
        alerts_response = db.table("price_alerts").select("*").eq(
            "batch_job_id", str(job_id)
        ).execute()
        
        alerts = alerts_response.data
        
        # Convert to CSV format
        alerts_for_csv = [
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
        
        # Generate CSV
        csv_generator = CSVGenerator()
        csv_bytes = csv_generator.generate_price_alerts_csv(alerts_for_csv)
        filename = csv_generator.generate_csv_filename(job["job_name"])
        
        # Get total UPCs count
        batches_response = db.table("upc_batches").select("upc_count").eq(
            "batch_job_id", str(job_id)
        ).execute()
        total_upcs = sum(batch["upc_count"] for batch in batches_response.data)
        
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
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to resend email: {str(e)}")

