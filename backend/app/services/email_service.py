"""Email service for sending CSV reports."""
import smtplib
import logging
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.base import MIMEBase
from email import encoders
from typing import Optional, List
from app.config import settings
from app.services.csv_generator import CSVGenerator

logger = logging.getLogger(__name__)


class EmailService:
    """Service for sending emails with CSV attachments."""
    
    # Hardcoded recipient email
    RECIPIENT_EMAIL = "remote@metroshoewarehouse.com"
    
    def __init__(self):
        self.smtp_host = settings.email_smtp_host
        self.smtp_port = settings.email_smtp_port
        self.email_from = settings.email_from
        self.email_from_name = settings.email_from_name
        self.email_password = settings.email_password
        self.email_to = settings.email_to
        self.last_error = None
    
    def _parse_recipients(self, recipients: str) -> List[str]:
        """Parse comma-separated email addresses into a list."""
        if not recipients:
            return []
        # Split by comma and strip whitespace
        return [email.strip() for email in recipients.split(",") if email.strip()]
    
    def send_csv_report(
        self,
        csv_bytes: bytes,
        filename: str,
        job_name: str,
        total_upcs: int,
        alerts_count: int,
        recipient_email: Optional[str] = None
    ) -> bool:
        """
        Send email with CSV attachment.
        
        Args:
            csv_bytes: CSV file content as bytes
            filename: Name of the CSV file
            job_name: Name of the batch job
            total_upcs: Total number of UPCs processed
            alerts_count: Number of price alerts found
            recipient_email: Optional recipient email (ignored - always uses remote@metroshoewarehouse.com)
            
        Returns:
            True if email sent successfully, False otherwise
        """
        # Always use the hardcoded recipient email
        recipients = [self.RECIPIENT_EMAIL]
        
        # Validate configuration
        if not self.email_from:
            logger.error("EMAIL_FROM is not configured in .env file")
            return False
        if not self.email_password:
            logger.error("EMAIL_PASSWORD is not configured in .env file")
            return False
        if not recipients:
            logger.error("No recipients configured")
            return False
        
        logger.info(f"Email configuration validated: from={self.email_from}, to={recipients}, host={self.smtp_host}:{self.smtp_port}")
        
        try:
            # Create message
            msg = MIMEMultipart()
            # Format: Display name only (email address used for SMTP auth but not shown)
            msg["From"] = self.email_from_name
            # Join multiple recipients with comma for the "To" header
            msg["To"] = ", ".join(recipients)
            msg["Subject"] = f"Keepa Off Price Report - {job_name}"
            
            # Create email body
            body = f"""
            Hello,
            
            Your Keepa Off Price report has been generated.
            
            Job Details:
            - Job Name: {job_name}
            - Total UPCs Processed: {total_upcs}
            - Price Alerts Found: {alerts_count}
            
            Please find the detailed report attached as a CSV file.
            
            Best regards,
            Keepa Alert Service
            """
            
            msg.attach(MIMEText(body, "plain"))
            
            # Attach CSV file
            part = MIMEBase("application", "octet-stream")
            part.set_payload(csv_bytes)
            encoders.encode_base64(part)
            part.add_header(
                "Content-Disposition",
                f'attachment; filename= "{filename}"'
            )
            msg.attach(part)
            
            # Send email
            logger.info(f"Attempting to send email to {recipients} via {self.smtp_host}:{self.smtp_port}")
            with smtplib.SMTP(self.smtp_host, self.smtp_port) as server:
                server.starttls()
                logger.info(f"Connecting to SMTP server and authenticating...")
                server.login(self.email_from, self.email_password)
                logger.info(f"Authentication successful, sending message...")
                # Send to all recipients
                server.send_message(msg, to_addrs=recipients)
            
            logger.info(f"Email sent successfully to {', '.join(recipients)}")
            return True
            
        except smtplib.SMTPAuthenticationError as e:
            error_msg = f"SMTP authentication failed: {e}. For Gmail, you must use an App Password (not your regular password). Enable 2-Step Verification and generate an App Password at https://myaccount.google.com/apppasswords"
            logger.error(error_msg)
            # Store error for retrieval if needed
            self.last_error = error_msg
            return False
        except smtplib.SMTPException as e:
            error_msg = f"SMTP error occurred: {e}"
            logger.error(error_msg)
            self.last_error = error_msg
            return False
        except Exception as e:
            error_msg = f"Failed to send email: {type(e).__name__}: {str(e)}"
            logger.error(error_msg, exc_info=True)
            self.last_error = error_msg
            return False
    
    def send_job_completion_email(
        self,
        job_name: str,
        total_upcs: int,
        alerts_count: int,
        csv_bytes: Optional[bytes] = None,
        recipient_email: Optional[str] = None
    ) -> bool:
        """
        Send job completion email with optional CSV attachment.
        
        Args:
            job_name: Name of the batch job
            total_upcs: Total number of UPCs processed
            alerts_count: Number of price alerts found
            csv_bytes: Optional CSV file content
            recipient_email: Optional recipient email (ignored - always uses remote@metroshoewarehouse.com)
            
        Returns:
            True if email sent successfully, False otherwise
        """
        if csv_bytes:
            filename = CSVGenerator.generate_csv_filename(job_name)
            return self.send_csv_report(
                csv_bytes=csv_bytes,
                filename=filename,
                job_name=job_name,
                total_upcs=total_upcs,
                alerts_count=alerts_count,
                recipient_email=recipient_email
            )
        else:
            # Send email without attachment
            # Always use the hardcoded recipient email
            recipients = [self.RECIPIENT_EMAIL]
            
            if not recipients:
                logger.error("No recipients configured")
                return False
            
            try:
                msg = MIMEMultipart()
                # Format: Display name only (email address used for SMTP auth but not shown)
                msg["From"] = self.email_from_name
                msg["To"] = ", ".join(recipients)
                msg["Subject"] = f"Orbit Hub Job Completed - {job_name}"
                
                body = f"""
                Hello,
                
                Your Orbit Hub batch job has completed processing.
                
                Job Details:
                - Job Name: {job_name}
                - Total UPCs Processed: {total_upcs}
                - Price Alerts Found: {alerts_count}
                
                You can view the full report in the dashboard.
                
                Best regards,
                Orbit
                """
                
                msg.attach(MIMEText(body, "plain"))
                
                with smtplib.SMTP(self.smtp_host, self.smtp_port) as server:
                    server.starttls()
                    server.login(self.email_from, self.email_password)
                    server.send_message(msg, to_addrs=recipients)
                
                logger.info(f"Job completion email sent to {', '.join(recipients)}")
                return True
                
            except Exception as e:
                logger.error(f"Failed to send job completion email: {e}")
                return False
    
    def send_email(
        self,
        to_email: str,
        subject: str,
        body: str
    ) -> bool:
        """
        Send a simple text email.
        
        Args:
            to_email: Recipient email address
            subject: Email subject
            body: Email body text
            
        Returns:
            True if email sent successfully, False otherwise
        """
        try:
            msg = MIMEMultipart()
            msg["From"] = f"{self.email_from_name} <{self.email_from}>"
            msg["To"] = to_email
            msg["Subject"] = subject
            
            msg.attach(MIMEText(body, "plain"))
            
            with smtplib.SMTP(self.smtp_host, self.smtp_port) as server:
                server.starttls()
                server.login(self.email_from, self.email_password)
                server.send_message(msg, to_addrs=[to_email])
            
            logger.info(f"Email sent successfully to {to_email}")
            return True
            
        except Exception as e:
            error_msg = f"Failed to send email: {type(e).__name__}: {str(e)}"
            logger.error(error_msg, exc_info=True)
            self.last_error = error_msg
            return False

