"""Email service for sending CSV reports."""
import re
import smtplib
import logging
from datetime import datetime
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.base import MIMEBase
from email import encoders
from email.utils import formataddr, parseaddr
from typing import Optional, List, Mapping
from app.config import settings
from app.services.csv_generator import CSVGenerator

SMTP_TIMEOUT = 30  # seconds

# Hard caps mirror the DB CHECK constraints so a misconfigured row can't be
# stretched here. Keep generous but bounded to avoid pathological inputs.
MAX_SUBJECT_TEMPLATE_LENGTH = 300
MAX_BODY_TEMPLATE_LENGTH = 10000

# {token} placeholders are replaced with values from the rendering context.
# Unknown tokens are left as-is so users can freely write arbitrary `{...}`
# text without crashing the send.
_TEMPLATE_TOKEN_RE = re.compile(r"\{([A-Za-z_][A-Za-z0-9_]*)\}")

logger = logging.getLogger(__name__)


def _format_mdyy_date(now: Optional[datetime] = None) -> str:
    """Format date as M.D.YY (e.g. 5.27.26)."""
    dt = now or datetime.now()
    return f"{dt.month}.{dt.day}.{dt.strftime('%y')}"


def _infer_vendor_from_job_name(job_name: str) -> str:
    """Best-effort vendor extraction from job names like 'Daily DNK ...'."""
    match = re.match(r"^\s*Daily\s+([A-Za-z0-9_-]+)\s+", str(job_name or ""))
    if match:
        return match.group(1).upper()
    return "UNKNOWN"


def _render_email_template(template: Optional[str], context: Mapping[str, object]) -> Optional[str]:
    """Render `{token}` placeholders inside `template` using `context`.

    Returns None when `template` is empty/blank so callers can cleanly fall
    back to the built-in default wording. Unknown tokens stay verbatim; the
    function never raises — on unexpected error it returns None and the
    caller falls back to defaults.
    """
    if template is None:
        return None
    try:
        text = str(template)
    except Exception:
        return None
    if not text.strip():
        return None

    def _replace(match: "re.Match[str]") -> str:
        key = match.group(1)
        if key in context:
            value = context[key]
            return "" if value is None else str(value)
        return match.group(0)

    try:
        return _TEMPLATE_TOKEN_RE.sub(_replace, text)
    except Exception as render_err:
        logger.warning("Email template render failed; using default. %s", render_err)
        return None


class EmailService:
    """Service for sending emails with CSV attachments."""

    def __init__(self):
        self.smtp_host = settings.email_smtp_host
        self.smtp_port = settings.email_smtp_port
        self.email_from = settings.email_from
        self.email_from_name = settings.email_from_name
        self.email_password = settings.email_password
        self.email_to = settings.email_to
        self.last_error = None

    def _bare_from_address(self) -> str:
        """Mailbox only (for SMTP login and From addr-spec). Strips accidental Name <addr> in EMAIL_FROM."""
        _, addr = parseaddr(self.email_from)
        if addr:
            return addr
        return (self.email_from or "").strip()

    def _from_header(self) -> str:
        """RFC 5322 From field: quoted display name + mailbox. Recipients still see the mailbox per their client."""
        display = (self.email_from_name or "Keepa Alert Service").strip()
        return formataddr((display, self._bare_from_address()))
    
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
        recipient_email: Optional[str] = None,
        vendor: Optional[str] = None,
        email_subject_template: Optional[str] = None,
        email_body_template: Optional[str] = None,
        bcc_emails: Optional[List[str]] = None,
        use_default_recipients: bool = True,
    ) -> bool:
        """
        Send email with CSV attachment.

        Args:
            csv_bytes: CSV file content as bytes
            filename: Name of the CSV file
            job_name: Name of the batch job
            total_upcs: Total number of UPCs processed
            alerts_count: Number of price alerts found
            recipient_email: Optional comma-separated To recipients. When blank and
                use_default_recipients is True, falls back to configured EMAIL_TO.
            vendor: Optional vendor/category code (e.g. dnk, clk) for `{vendor}`
                substitution and logging context. Does not affect routing.
            email_subject_template: Optional per-vendor custom subject. Supports
                `{vendor}`, `{job_name}`, `{total_upcs}`, `{alerts_count}`,
                `{run_date}`. Blank/None falls back to the default subject.
            email_body_template: Optional per-vendor custom body (plain text);
                same placeholders. Blank/None falls back to the default body.
            bcc_emails: Optional list of addresses to BCC instead of To.
            use_default_recipients: When recipient_email is empty, whether to use
                EMAIL_TO. Daily runs set this to False so empty lists send nothing.

        Returns:
            True if email sent successfully, False otherwise
        """
        if recipient_email and str(recipient_email).strip():
            all_recipients = self._parse_recipients(recipient_email)
        elif use_default_recipients:
            all_recipients = self._parse_recipients(self.email_to)
        else:
            all_recipients = []

        bcc_set = {email.strip().lower() for email in (bcc_emails or []) if email and email.strip()}
        to_recipients = [email for email in all_recipients if email.lower() not in bcc_set]
        bcc_recipients = [email for email in all_recipients if email.lower() in bcc_set]
        
        # Validate configuration
        if not self._bare_from_address():
            logger.error("EMAIL_FROM is not configured in .env file")
            return False
        if not self.email_password:
            logger.error("EMAIL_PASSWORD is not configured in .env file")
            return False
        if not to_recipients and not bcc_recipients:
            logger.info("No recipients configured; skipping email send")
            return False

        if not to_recipients and bcc_recipients:
            to_recipients = [self._bare_from_address()]

        delivery_addrs = list(dict.fromkeys(to_recipients + bcc_recipients))
        
        logger.info(
            f"Email configuration validated: from={self._bare_from_address()}, "
            f"to={to_recipients}, bcc={bcc_recipients or []}, host={self.smtp_host}:{self.smtp_port}"
        )
        
        try:
            email_date = _format_mdyy_date()
            vendor_upper = (vendor or "").strip().upper() or _infer_vendor_from_job_name(job_name)
            default_job_name_line = f"Daily {vendor_upper} Uploaded Report - {email_date}"
            default_subject = f"Keepa Off Price Report - {job_name}"
            default_body = (
                f"Hi, attached are the listings that are off price as of today {email_date}.\n\n"
                "Job Details:\n"
                f"- Job Name: {default_job_name_line}\n"
                f"- Price Alerts Found: {alerts_count}\n\n"
                "Thank you!"
            )

            template_context = {
                "vendor": vendor_upper,
                "job_name": job_name,
                "total_upcs": total_upcs,
                "alerts_count": alerts_count,
                "run_date": email_date,
            }

            # Templates are truncated defensively in case the DB CHECK was
            # bypassed (e.g. row inserted via raw SQL by an admin).
            safe_subject_template = (
                str(email_subject_template)[:MAX_SUBJECT_TEMPLATE_LENGTH]
                if email_subject_template is not None
                else None
            )
            safe_body_template = (
                str(email_body_template)[:MAX_BODY_TEMPLATE_LENGTH]
                if email_body_template is not None
                else None
            )

            rendered_subject = _render_email_template(safe_subject_template, template_context)
            rendered_body = _render_email_template(safe_body_template, template_context)

            subject = rendered_subject if rendered_subject is not None else default_subject
            body = rendered_body if rendered_body is not None else default_body

            if rendered_subject is not None or rendered_body is not None:
                logger.info(
                    "Using custom email template for vendor=%s (subject_overridden=%s, body_overridden=%s)",
                    vendor or "<unknown>",
                    rendered_subject is not None,
                    rendered_body is not None,
                )

            msg = MIMEMultipart()
            msg["From"] = self._from_header()
            msg["To"] = ", ".join(to_recipients)
            if bcc_recipients:
                msg["Bcc"] = ", ".join(bcc_recipients)
            msg["Subject"] = subject

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
            logger.info(
                f"Attempting to send email to {delivery_addrs} via {self.smtp_host}:{self.smtp_port}"
            )
            with smtplib.SMTP(self.smtp_host, self.smtp_port, timeout=SMTP_TIMEOUT) as server:
                server.starttls()
                server.login(self._bare_from_address(), self.email_password)
                server.send_message(msg, to_addrs=delivery_addrs)
            
            logger.info(f"Email sent successfully to {', '.join(delivery_addrs)}")
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
        recipient_email: Optional[str] = None,
        vendor: Optional[str] = None,
        email_subject_template: Optional[str] = None,
        email_body_template: Optional[str] = None,
    ) -> bool:
        """
        Send job completion email with optional CSV attachment.

        Args:
            job_name: Name of the batch job
            total_upcs: Total number of UPCs processed
            alerts_count: Number of price alerts found
            csv_bytes: Optional CSV file content
            recipient_email: Optional recipient email, defaults to configured email_to
            vendor: Optional vendor/category code for template substitution.
            email_subject_template: Optional per-vendor custom subject.
            email_body_template: Optional per-vendor custom body.

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
                recipient_email=recipient_email,
                vendor=vendor,
                email_subject_template=email_subject_template,
                email_body_template=email_body_template,
            )
        else:
            recipients = self._parse_recipients(self.email_to)
            
            if not recipients:
                logger.error("No recipients configured")
                return False
            
            try:
                msg = MIMEMultipart()
                msg["From"] = self._from_header()
                msg["To"] = ", ".join(recipients)
                msg["Subject"] = f"MSW Overwatch Job Completed - {job_name}"
                
                body = f"""
                Hello,
                
                Your MSW Overwatch batch job has completed processing.
                
                Job Details:
                - Job Name: {job_name}
                - Total UPCs Processed: {total_upcs}
                - Price Alerts Found: {alerts_count}
                
                You can view the full report in the dashboard.
                
                Best regards,
                MSW Overwatch
                """
                
                msg.attach(MIMEText(body, "plain"))
                
                with smtplib.SMTP(self.smtp_host, self.smtp_port, timeout=SMTP_TIMEOUT) as server:
                    server.starttls()
                    server.login(self._bare_from_address(), self.email_password)
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
            to_addrs = [to_email]
            msg = MIMEMultipart()
            msg["From"] = self._from_header()
            msg["To"] = to_email
            msg["Subject"] = subject
            
            msg.attach(MIMEText(body, "plain"))
            
            with smtplib.SMTP(self.smtp_host, self.smtp_port, timeout=SMTP_TIMEOUT) as server:
                server.starttls()
                server.login(self._bare_from_address(), self.email_password)
                server.send_message(msg, to_addrs=to_addrs)
            
            logger.info(f"Email sent successfully to {to_email}")
            return True
            
        except Exception as e:
            error_msg = f"Failed to send email: {type(e).__name__}: {str(e)}"
            logger.error(error_msg, exc_info=True)
            self.last_error = error_msg
            return False

