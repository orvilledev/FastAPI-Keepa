"""Email service for sending CSV reports."""
import html as html_lib
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
from app.services.graph_mail_service import GraphMailClient, GraphMailError

SMTP_TIMEOUT = 30  # seconds

# Hard caps mirror the DB CHECK constraints so a misconfigured row can't be
# stretched here. Keep generous but bounded to avoid pathological inputs.
MAX_SUBJECT_TEMPLATE_LENGTH = 300
MAX_BODY_TEMPLATE_LENGTH = 10000

DEFAULT_FROM_DISPLAY_NAME = "MSW Overwatch"
EMAIL_PREHEADER = "Daily marketplace monitoring report from MetroShoe Warehouse."
EMAIL_SIGNATURE_ADDRESS = "overwatch@metroshoewarehouse.com"
EMAIL_WEBSITE = "metroshoewarehouse.com"
EMAIL_DISCLAIMER = (
    "MSW Overwatch is a proprietary marketplace monitoring system developed by "
    "MetroShoe Warehouse. Marketplace pricing and seller information are based on "
    "available third-party marketplace data and may change over time."
)

# {token} placeholders are replaced with values from the rendering context.
# Unknown tokens are left as-is so users can freely write arbitrary `{...}`
# text without crashing the send.
_TEMPLATE_TOKEN_RE = re.compile(r"\{([A-Za-z_][A-Za-z0-9_]*)\}")
_JOB_ISO_DATE_RE = re.compile(r"(20\d{2}-\d{2}-\d{2})")

logger = logging.getLogger(__name__)


def _resolve_email_datetime(job_name: str = "", now: Optional[datetime] = None) -> datetime:
    """Prefer YYYY-MM-DD embedded in job_name; otherwise use now."""
    match = _JOB_ISO_DATE_RE.search(str(job_name or ""))
    if match:
        try:
            return datetime.strptime(match.group(1), "%Y-%m-%d")
        except ValueError:
            pass
    return now or datetime.now()


def _format_mdyy_date(now: Optional[datetime] = None) -> str:
    """Format date as M.D.YY (e.g. 5.27.26)."""
    dt = now or datetime.now()
    return f"{dt.month}.{dt.day}.{dt.strftime('%y')}"


def _format_long_date(now: Optional[datetime] = None) -> str:
    """Format date as 'August 27, 2026' (no zero-padded day)."""
    dt = now or datetime.now()
    return f"{dt.strftime('%B')} {dt.day}, {dt.year}"


def _format_iso_date(now: Optional[datetime] = None) -> str:
    """Format date as YYYY-MM-DD."""
    dt = now or datetime.now()
    return dt.strftime("%Y-%m-%d")


def _infer_vendor_from_job_name(job_name: str) -> str:
    """Best-effort vendor extraction from job names like 'Daily DNK ...'."""
    match = re.match(r"^\s*Daily\s+([A-Za-z0-9_-]+)\s+", str(job_name or ""))
    if match:
        return match.group(1).upper()
    return "UNKNOWN"


def _brand_name_for_vendor(vendor_code: str) -> str:
    """Resolve brand display name (e.g. dnk → Dansko) for email copy."""
    from app.services.off_price_analytics_vendors import VENDOR_LABELS

    code = (vendor_code or "").strip().lower()
    label = VENDOR_LABELS.get(code)
    if label:
        paren = re.search(r"\(([^)]+)\)", label)
        if paren:
            return paren.group(1).strip()
        return label
    upper = (vendor_code or "").strip().upper()
    return upper if upper and upper != "UNKNOWN" else "Vendor"


def _default_map_email_body(
    *,
    vendor_name: str,
    brand_name: str,
    alerts_count: int,
    report_date_long: str,
) -> str:
    """Production MAP Pricing exceptions email body (all vendors)."""
    return (
        f"Hello {vendor_name},\n"
        "\n"
        f"MSW Overwatch has completed today's MAP Pricing review for {brand_name}.\n"
        "\n"
        "The attached report identifies Amazon listings where the current advertised price "
        "is below the applicable MAP price, along with the seller and listing information "
        "for your review.\n"
        "\n"
        "Today's Report\n"
        f"• {alerts_count} — MAP Pricing Exceptions\n"
        f"• {report_date_long} — Report Date\n"
        f"• {brand_name} — Brand\n"
        "\n"
        "Please review the attached report for the affected products, sellers, current "
        "advertised prices, and applicable MAP Pricing.\n"
        "\n"
        "If you have questions regarding any listing or would like our team to investigate "
        "an exception further, please reply directly to this email.\n"
        "\n"
        "Regards,\n"
        "MSW Overwatch\n"
        "MAP Pricing & Marketplace Monitoring\n"
        "MetroShoe Warehouse\n"
        f"{EMAIL_SIGNATURE_ADDRESS}\n"
        f"{EMAIL_WEBSITE}\n"
        "\n"
        f"{EMAIL_DISCLAIMER}"
    )


def _format_report_bullet_html(item: str) -> str:
    """Bold the value before an em dash: '133 — Label' → <strong>133</strong> — Label."""
    if " — " in item:
        value, label = item.split(" — ", 1)
        return (
            f"<strong>{html_lib.escape(value)}</strong>"
            f" — {html_lib.escape(label)}"
        )
    return f"<strong>{html_lib.escape(item)}</strong>"


def _plain_body_to_html(plain_body: str) -> str:
    """Convert plain body to HTML with bold report bullets and muted disclaimer."""
    lines = plain_body.split("\n")
    parts: list[str] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        if line == "Today's Report":
            parts.append(
                '<p style="margin:12px 0 6px 0;font-size:12px;letter-spacing:0.06em;'
                'text-transform:uppercase;font-weight:700;color:#111;">'
                "Today's Report"
                "</p>"
            )
            i += 1
            continue
        if line.startswith("• "):
            parts.append(
                '<ul style="margin:4px 0 12px 0;padding-left:22px;'
                'list-style-type:disc;">'
            )
            while i < len(lines) and lines[i].startswith("• "):
                item_html = _format_report_bullet_html(lines[i][2:])
                parts.append(
                    f'<li style="margin:6px 0;font-size:14px;color:#222;">{item_html}</li>'
                )
                i += 1
            parts.append("</ul>")
            continue
        if line == EMAIL_DISCLAIMER:
            parts.append(
                '<p style="margin:16px 0 0 0;font-size:11px;line-height:1.45;'
                f'color:#666;">{html_lib.escape(line)}</p>'
            )
            i += 1
            continue
        if line == "":
            parts.append("<br>")
        else:
            parts.append(f"{html_lib.escape(line)}<br>")
        i += 1
    return "".join(parts)


def _build_html_body(plain_body: str, preheader: str = EMAIL_PREHEADER) -> str:
    """HTML alternative with a hidden inbox preheader, then the plain body."""
    safe_preheader = html_lib.escape(preheader)
    safe_body = _plain_body_to_html(plain_body)
    return (
        "<!DOCTYPE html><html><body>"
        '<div style="display:none;font-size:1px;color:#ffffff;line-height:1px;'
        'max-height:0;max-width:0;opacity:0;overflow:hidden;">'
        f"{safe_preheader}"
        "</div>"
        '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;'
        'line-height:1.5;color:#222;">'
        f"{safe_body}"
        "</div>"
        "</body></html>"
    )


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
        self.email_transport = settings.effective_email_transport
        self.last_error = None
        self._graph_client: Optional[GraphMailClient] = None

    def _graph_client_or_none(self) -> Optional[GraphMailClient]:
        if not settings.graph_email_configured:
            return None
        if self._graph_client is None:
            self._graph_client = GraphMailClient(
                tenant_id=settings.azure_tenant_id,
                client_id=settings.azure_client_id,
                client_secret=settings.azure_client_secret,
                from_address=self._bare_from_address(),
                from_display_name=(self.email_from_name or DEFAULT_FROM_DISPLAY_NAME),
            )
        return self._graph_client

    def _email_configured_for_transport(self) -> bool:
        if not self._bare_from_address():
            return False
        if self.email_transport == "graph":
            return settings.graph_email_configured
        return bool(self.email_password)

    def _bare_from_address(self) -> str:
        """Mailbox only (for SMTP login and From addr-spec). Strips accidental Name <addr> in EMAIL_FROM."""
        _, addr = parseaddr(self.email_from)
        if addr:
            return addr
        return (self.email_from or "").strip()

    def _from_header(self) -> str:
        """RFC 5322 From field: quoted display name + mailbox. Recipients still see the mailbox per their client."""
        display = (self.email_from_name or DEFAULT_FROM_DISPLAY_NAME).strip()
        return formataddr((display, self._bare_from_address()))
    
    def _parse_recipients(self, recipients: str) -> List[str]:
        """Parse comma-separated email addresses into a list."""
        if not recipients:
            return []
        # Split by comma and strip whitespace
        return [email.strip() for email in recipients.split(",") if email.strip()]

    def _send_outbound(
        self,
        *,
        subject: str,
        plain_body: str,
        to_recipients: List[str],
        bcc_recipients: List[str],
        attachments: Optional[List[tuple[str, bytes, str]]] = None,
        html_body: Optional[str] = None,
    ) -> bool:
        """Send via Graph or SMTP depending on configured transport."""
        delivery_addrs = list(dict.fromkeys(to_recipients + bcc_recipients))
        html = html_body if html_body is not None else _build_html_body(plain_body)

        if self.email_transport == "graph":
            client = self._graph_client_or_none()
            if client is None:
                self.last_error = "Microsoft Graph email client is not configured"
                return False
            client.send_message(
                subject=subject,
                plain_body=plain_body,
                html_body=html,
                to_recipients=to_recipients,
                bcc_recipients=bcc_recipients,
                attachments=attachments,
            )
            logger.info("Email sent successfully via Graph to %s", ", ".join(delivery_addrs))
            return True

        msg = MIMEMultipart("mixed")
        msg["From"] = self._from_header()
        msg["To"] = ", ".join(to_recipients)
        if bcc_recipients:
            msg["Bcc"] = ", ".join(bcc_recipients)
        msg["Subject"] = subject

        alt = MIMEMultipart("alternative")
        alt.attach(MIMEText(plain_body, "plain", "utf-8"))
        alt.attach(MIMEText(html, "html", "utf-8"))
        msg.attach(alt)

        for attach_name, attach_bytes, mime_type in attachments or []:
            maintype, _, subtype = (mime_type or "application/octet-stream").partition("/")
            part = MIMEBase(maintype, subtype or "octet-stream")
            part.set_payload(attach_bytes)
            encoders.encode_base64(part)
            part.add_header("Content-Disposition", f'attachment; filename="{attach_name}"')
            msg.attach(part)

        logger.info(
            "Attempting SMTP send to %s via %s:%s",
            delivery_addrs,
            self.smtp_host,
            self.smtp_port,
        )
        with smtplib.SMTP(self.smtp_host, self.smtp_port, timeout=SMTP_TIMEOUT) as server:
            server.starttls()
            server.login(self._bare_from_address(), self.email_password)
            server.send_message(msg, to_addrs=delivery_addrs)
        logger.info("Email sent successfully via SMTP to %s", ", ".join(delivery_addrs))
        return True
    
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
        summary_footer: Optional[str] = None,
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
                `{vendor}`, `{brand}`, `{vendor_name}`, `{job_name}`, `{total_upcs}`,
                `{alerts_count}`, `{run_date}`, `{run_date_long}`, `{run_date_iso}`.
                Blank/None falls back to
                ``MSW Overwatch | MAP Pricing Exceptions — {Month D, YYYY}``.
            email_body_template: Optional per-vendor custom body (plain text);
                same placeholders. Blank/None falls back to the production MAP body.
            bcc_emails: Optional list of addresses to BCC instead of To.
            use_default_recipients: When recipient_email is empty, whether to use
                EMAIL_TO. Daily runs set this to False so empty lists send nothing.
            summary_footer: Optional Keepa token / Token Load recap appended after the body.

        Returns:
            True if email sent successfully, False otherwise
        """
        if recipient_email and str(recipient_email).strip():
            all_recipients = self._parse_recipients(recipient_email)
        elif use_default_recipients:
            all_recipients = self._parse_recipients(self.email_to)
        else:
            all_recipients = []

        bcc_recipients: List[str] = []
        bcc_seen: set[str] = set()
        for email in bcc_emails or []:
            normalized = email.strip()
            if not normalized:
                continue
            key = normalized.lower()
            if key in bcc_seen:
                continue
            bcc_seen.add(key)
            bcc_recipients.append(normalized)

        bcc_set = set(bcc_seen)
        to_recipients = [email for email in all_recipients if email.lower() not in bcc_set]
        
        # Validate configuration
        if not self._bare_from_address():
            logger.error("EMAIL_FROM is not configured in .env file")
            return False
        if self.email_transport == "graph":
            if not settings.graph_email_configured:
                logger.error(
                    "EMAIL_TRANSPORT=graph but Azure credentials are missing "
                    "(AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET)"
                )
                self.last_error = "Microsoft Graph email is not configured"
                return False
        elif not self.email_password:
            logger.error("EMAIL_PASSWORD is not configured in .env file")
            return False
        if not to_recipients and not bcc_recipients:
            logger.info("No recipients configured; skipping email send")
            return False

        if not to_recipients and bcc_recipients:
            to_recipients = [self._bare_from_address()]
        
        logger.info(
            "Email configuration validated: transport=%s from=%s "
            "to=%s bcc=%s",
            self.email_transport,
            self._bare_from_address(),
            to_recipients,
            bcc_recipients or [],
        )
        
        try:
            run_dt = _resolve_email_datetime(job_name)
            email_date = _format_mdyy_date(run_dt)
            email_date_long = _format_long_date(run_dt)
            email_date_iso = _format_iso_date(run_dt)
            vendor_upper = (vendor or "").strip().upper() or _infer_vendor_from_job_name(job_name)
            brand_name = _brand_name_for_vendor(vendor_upper)
            # Greeting uses the brand/partner name (same source as Brand: line).
            vendor_name = brand_name
            # Same subject line for every vendor; only the run date changes.
            default_subject = f"MSW Overwatch | MAP Pricing Exceptions — {email_date_long}"
            default_body = _default_map_email_body(
                vendor_name=vendor_name,
                brand_name=brand_name,
                alerts_count=alerts_count,
                report_date_long=email_date_long,
            )

            template_context = {
                "vendor": vendor_upper,
                "brand": brand_name,
                "vendor_name": vendor_name,
                "job_name": job_name,
                "total_upcs": total_upcs,
                "alerts_count": alerts_count,
                "run_date": email_date,
                "run_date_long": email_date_long,
                "run_date_iso": email_date_iso,
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
            footer = (summary_footer or "").strip()
            if footer:
                body = f"{body.rstrip()}\n\n---\nKeepa API run summary\n{footer}\n"

            if rendered_subject is not None or rendered_body is not None:
                logger.info(
                    "Using custom email template for vendor=%s (subject_overridden=%s, body_overridden=%s)",
                    vendor or "<unknown>",
                    rendered_subject is not None,
                    rendered_body is not None,
                )

            html_body = _build_html_body(body)

            self._send_outbound(
                subject=subject,
                plain_body=body,
                html_body=html_body,
                to_recipients=to_recipients,
                bcc_recipients=bcc_recipients,
                attachments=[(filename, csv_bytes, "application/octet-stream")],
            )
            return True
            
        except GraphMailError as e:
            error_msg = f"Microsoft Graph send failed: {e}"
            logger.error(error_msg)
            self.last_error = error_msg
            return False
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
                if not self._email_configured_for_transport():
                    logger.error("Email is not configured for transport=%s", self.email_transport)
                    return False
                body = (
                    "Hello,\n\n"
                    "Your MSW Overwatch batch job has completed processing.\n\n"
                    "Job Details:\n"
                    f"- Job Name: {job_name}\n"
                    f"- Total UPCs Processed: {total_upcs}\n"
                    f"- Price Alerts Found: {alerts_count}\n\n"
                    "You can view the full report in the dashboard.\n\n"
                    "Best regards,\n"
                    "MSW Overwatch"
                )
                self._send_outbound(
                    subject=f"MSW Overwatch Job Completed - {job_name}",
                    plain_body=body,
                    to_recipients=recipients,
                    bcc_recipients=[],
                )
                return True
                
            except GraphMailError as e:
                logger.error("Failed to send job completion email via Graph: %s", e)
                self.last_error = str(e)
                return False
            except Exception as e:
                logger.error(f"Failed to send job completion email: {e}")
                self.last_error = str(e)
                return False

    def send_binary_attachment(
        self,
        file_bytes: bytes,
        filename: str,
        subject: str,
        body: str,
        recipient_email: Optional[str] = None,
        bcc_emails: Optional[List[str]] = None,
        mime_type: str = "application/octet-stream",
        use_default_recipients: bool = True,
    ) -> bool:
        """Send an email with an arbitrary binary attachment."""
        if recipient_email and str(recipient_email).strip():
            all_recipients = self._parse_recipients(recipient_email)
        elif use_default_recipients:
            all_recipients = self._parse_recipients(self.email_to)
        else:
            all_recipients = []

        bcc_recipients: List[str] = []
        bcc_seen: set[str] = set()
        for email in bcc_emails or []:
            normalized = email.strip()
            if not normalized:
                continue
            key = normalized.lower()
            if key in bcc_seen:
                continue
            bcc_seen.add(key)
            bcc_recipients.append(normalized)

        bcc_set = set(bcc_seen)
        to_recipients = [email for email in all_recipients if email.lower() not in bcc_set]

        if not self._email_configured_for_transport():
            logger.error("Email is not configured for transport=%s", self.email_transport)
            return False
        if not to_recipients and not bcc_recipients:
            logger.info("No recipients configured; skipping email send")
            return False
        if not to_recipients and bcc_recipients:
            to_recipients = [self._bare_from_address()]

        try:
            self._send_outbound(
                subject=subject,
                plain_body=body,
                to_recipients=to_recipients,
                bcc_recipients=bcc_recipients,
                attachments=[(filename, file_bytes, mime_type)],
            )
            return True
        except GraphMailError as e:
            logger.error("Failed to send attachment email via Graph: %s", e)
            self.last_error = str(e)
            return False
        except Exception as e:
            logger.error("Failed to send attachment email: %s", e, exc_info=True)
            self.last_error = str(e)
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
            if not self._email_configured_for_transport():
                self.last_error = "Email is not configured"
                return False
            self._send_outbound(
                subject=subject,
                plain_body=body,
                to_recipients=[to_email],
                bcc_recipients=[],
            )
            return True
            
        except GraphMailError as e:
            error_msg = f"Microsoft Graph send failed: {e}"
            logger.error(error_msg)
            self.last_error = error_msg
            return False
        except Exception as e:
            error_msg = f"Failed to send email: {type(e).__name__}: {str(e)}"
            logger.error(error_msg, exc_info=True)
            self.last_error = error_msg
            return False

