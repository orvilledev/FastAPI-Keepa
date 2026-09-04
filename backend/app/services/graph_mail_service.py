"""Send mail via Microsoft Graph API (application permissions, no SMTP AUTH)."""
from __future__ import annotations

import base64
import logging
import time
from typing import List, Optional

import httpx

logger = logging.getLogger(__name__)

GRAPH_SCOPE = "https://graph.microsoft.com/.default"
GRAPH_TIMEOUT_SECONDS = 60
TOKEN_URL_TEMPLATE = "https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token"
SEND_MAIL_URL_TEMPLATE = "https://graph.microsoft.com/v1.0/users/{mailbox}/sendMail"
# Creating a draft needs Mail.ReadWrite (application); sendMail only needs Mail.Send.
CREATE_MESSAGE_URL_TEMPLATE = "https://graph.microsoft.com/v1.0/users/{mailbox}/messages"


class GraphMailError(Exception):
    """Raised when Graph token acquisition or sendMail fails."""


class GraphMailClient:
    """OAuth client-credentials sender for a single Microsoft 365 mailbox."""

    def __init__(
        self,
        *,
        tenant_id: str,
        client_id: str,
        client_secret: str,
        from_address: str,
        from_display_name: str = "MSW Overwatch",
    ) -> None:
        self.tenant_id = tenant_id.strip()
        self.client_id = client_id.strip()
        self.client_secret = client_secret
        self.from_address = from_address.strip()
        self.from_display_name = (from_display_name or "MSW Overwatch").strip()
        self._access_token: Optional[str] = None
        self._token_expires_at: float = 0.0

    def _token_url(self) -> str:
        return TOKEN_URL_TEMPLATE.format(tenant_id=self.tenant_id)

    def _send_mail_url(self) -> str:
        return SEND_MAIL_URL_TEMPLATE.format(mailbox=self.from_address)

    def _create_message_url(self) -> str:
        return CREATE_MESSAGE_URL_TEMPLATE.format(mailbox=self.from_address)

    def _get_access_token(self) -> str:
        now = time.time()
        if self._access_token and now < self._token_expires_at - 60:
            return self._access_token

        data = {
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "scope": GRAPH_SCOPE,
            "grant_type": "client_credentials",
        }
        try:
            with httpx.Client(timeout=GRAPH_TIMEOUT_SECONDS) as client:
                response = client.post(self._token_url(), data=data)
        except httpx.HTTPError as exc:
            raise GraphMailError(f"Graph token request failed: {exc}") from exc

        if response.status_code != 200:
            raise GraphMailError(
                f"Graph token request failed ({response.status_code}): {response.text[:500]}"
            )

        payload = response.json()
        token = payload.get("access_token")
        if not token:
            raise GraphMailError("Graph token response missing access_token")

        expires_in = int(payload.get("expires_in") or 3600)
        self._access_token = token
        self._token_expires_at = now + expires_in
        return token

    @staticmethod
    def _recipient_list(addresses: List[str]) -> List[dict]:
        return [
            {"emailAddress": {"address": addr}}
            for addr in addresses
            if addr and str(addr).strip()
        ]

    @staticmethod
    def _file_attachments(
        attachments: Optional[List[tuple[str, bytes, str]]],
    ) -> List[dict]:
        graph_attachments: List[dict] = []
        for filename, content, mime_type in attachments or []:
            graph_attachments.append(
                {
                    "@odata.type": "#microsoft.graph.fileAttachment",
                    "name": filename,
                    "contentType": mime_type or "application/octet-stream",
                    "contentBytes": base64.b64encode(content).decode("ascii"),
                }
            )
        return graph_attachments

    def create_draft(
        self,
        *,
        subject: str,
        plain_body: str,
        html_body: str,
        to_recipients: List[str],
        cc_recipients: Optional[List[str]] = None,
        bcc_recipients: Optional[List[str]] = None,
        attachments: Optional[List[tuple[str, bytes, str]]] = None,
    ) -> dict:
        """
        Create a draft in the Overwatch mailbox Drafts folder.

        Requires application permission Mail.ReadWrite (in addition to Mail.Send).
        Returns the Graph message payload (includes ``id`` and ``webLink``).
        """
        to_list = self._recipient_list(to_recipients)
        cc_list = self._recipient_list(cc_recipients or [])
        bcc_list = self._recipient_list(bcc_recipients or [])
        if not to_list and not cc_list and not bcc_list:
            raise GraphMailError("No recipients provided for Graph draft")

        # Creating via POST /messages stores the message as a draft by default.
        _ = plain_body
        message: dict = {
            "subject": subject,
            "body": {
                "contentType": "HTML",
                "content": html_body,
            },
            "from": {
                "emailAddress": {
                    "name": self.from_display_name,
                    "address": self.from_address,
                }
            },
            "toRecipients": to_list,
        }
        if cc_list:
            message["ccRecipients"] = cc_list
        if bcc_list:
            message["bccRecipients"] = bcc_list
        file_attachments = self._file_attachments(attachments)
        if file_attachments:
            message["attachments"] = file_attachments

        token = self._get_access_token()
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }
        try:
            with httpx.Client(timeout=GRAPH_TIMEOUT_SECONDS) as client:
                response = client.post(
                    self._create_message_url(), headers=headers, json=message
                )
        except httpx.HTTPError as exc:
            raise GraphMailError(f"Graph create draft request failed: {exc}") from exc

        if response.status_code not in (200, 201):
            raise GraphMailError(
                f"Graph create draft failed ({response.status_code}): {response.text[:800]}"
            )

        payload = response.json()
        logger.info(
            "Graph draft created for %s (id=%s, to=%s, cc=%s, bcc=%s)",
            self.from_address,
            payload.get("id"),
            to_recipients,
            cc_recipients or [],
            bcc_recipients or [],
        )
        return payload

    def send_message(
        self,
        *,
        subject: str,
        plain_body: str,
        html_body: str,
        to_recipients: List[str],
        cc_recipients: Optional[List[str]] = None,
        bcc_recipients: Optional[List[str]] = None,
        attachments: Optional[List[tuple[str, bytes, str]]] = None,
        save_to_sent_items: bool = True,
    ) -> None:
        """
        Send a message through Graph sendMail.

        attachments: list of (filename, bytes, mime_type)
        """
        to_list = self._recipient_list(to_recipients)
        cc_list = self._recipient_list(cc_recipients or [])
        bcc_list = self._recipient_list(bcc_recipients or [])
        if not to_list and not cc_list and not bcc_list:
            raise GraphMailError("No recipients provided for Graph sendMail")

        graph_attachments = self._file_attachments(attachments)

        message: dict = {
            "subject": subject,
            "body": {
                "contentType": "HTML",
                "content": html_body,
            },
            "from": {
                "emailAddress": {
                    "name": self.from_display_name,
                    "address": self.from_address,
                }
            },
            "toRecipients": to_list,
        }
        if cc_list:
            message["ccRecipients"] = cc_list
        if bcc_list:
            message["bccRecipients"] = bcc_list
        if graph_attachments:
            message["attachments"] = graph_attachments

        # Plain body is not sent separately; HTML is built from the same content upstream.
        _ = plain_body

        body = {
            "message": message,
            "saveToSentItems": save_to_sent_items,
        }

        token = self._get_access_token()
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }
        try:
            with httpx.Client(timeout=GRAPH_TIMEOUT_SECONDS) as client:
                response = client.post(self._send_mail_url(), headers=headers, json=body)
        except httpx.HTTPError as exc:
            raise GraphMailError(f"Graph sendMail request failed: {exc}") from exc

        # sendMail returns 202 Accepted on success.
        if response.status_code not in (200, 202, 204):
            raise GraphMailError(
                f"Graph sendMail failed ({response.status_code}): {response.text[:800]}"
            )

        logger.info(
            "Graph sendMail accepted for %s (to=%s, cc=%s, bcc=%s)",
            self.from_address,
            to_recipients,
            cc_recipients or [],
            bcc_recipients or [],
        )
