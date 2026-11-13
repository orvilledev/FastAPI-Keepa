"""Data access for Team Chat (messenger_conversations / members / messages)."""
from __future__ import annotations

import logging
from typing import Any, Dict, Iterable, List, Optional, Set
from urllib.parse import quote

import httpx
from supabase import Client

from app.config import settings

logger = logging.getLogger(__name__)

CONVERSATIONS = "messenger_conversations"
MEMBERS = "messenger_members"
MESSAGES = "messenger_messages"
_TABLES = (CONVERSATIONS, MEMBERS, MESSAGES)
FILES_BUCKET = "team-chat-files"

MIGRATION_HINT = (
    "Team Chat is not set up yet (or is missing its latest update). Run "
    "backend/database/migrations/create_messenger_chat.sql in the Supabase SQL Editor."
)
FILES_HINT = (
    "File sharing is not set up yet. Run backend/database/migrations/create_messenger_chat.sql "
    "in the Supabase SQL Editor to create the team-chat-files storage bucket."
)

_CONVERSATION_COLUMNS = (
    "id, is_group, title, direct_key, created_by, last_message_at, "
    "last_message_preview, last_message_sender_id, created_at, updated_at"
)
_MEMBER_COLUMNS = "conversation_id, user_id, joined_at, last_read_at"
_MESSAGE_COLUMNS = (
    "id, conversation_id, sender_id, body, created_at, deleted_at, "
    "attachment_path, attachment_name, attachment_size, attachment_type"
)
# PostgREST URLs get long with big IN lists; chunk to stay well under limits.
_IN_CHUNK = 150


class MessengerStorageError(RuntimeError):
    """A chat table could not be read or written."""

    def __init__(self, message: str, *, missing_tables: bool = False):
        super().__init__(message)
        self.missing_tables = missing_tables


class DuplicateDirectConversation(RuntimeError):
    """Another request created the same 1:1 conversation first."""


class DuplicateAttachment(RuntimeError):
    """An uploaded file is already attached to another message."""


def _message(exc: Exception) -> str:
    return str(exc).lower()


def _is_missing_table_error(exc: Exception) -> bool:
    message = _message(exc)
    return any(table in message for table in _TABLES) and (
        "does not exist" in message
        or "schema cache" in message
        or "pgrst205" in message
        or "42p01" in message
        or "could not find the table" in message
    )


def _is_duplicate_error(exc: Exception) -> bool:
    message = _message(exc)
    return "23505" in message or "duplicate key" in message


def _storage_error(action: str, exc: Exception) -> MessengerStorageError:
    if _is_missing_table_error(exc):
        return MessengerStorageError(MIGRATION_HINT, missing_tables=True)
    return MessengerStorageError(f"Failed to {action}: {exc}")


def _rows(response: Any) -> List[Dict[str, Any]]:
    return list(getattr(response, "data", None) or [])


def _chunks(values: Iterable[str]) -> Iterable[List[str]]:
    items = [str(v) for v in values if v]
    for start in range(0, len(items), _IN_CHUNK):
        yield items[start:start + _IN_CHUNK]


class MessengerRepository:
    def __init__(self, db: Client):
        self.db = db

    # --- People ---------------------------------------------------------------

    def list_profiles(self) -> List[Dict[str, Any]]:
        try:
            response = (
                self.db.table("profiles")
                .select("id, email, display_name, role, is_active")
                .execute()
            )
        except Exception as exc:
            logger.error("Team Chat: failed to list profiles: %s", exc)
            raise _storage_error("load people", exc) from exc
        return _rows(response)

    def online_user_ids(self, since_iso: str) -> Set[str]:
        """Users with a presence heartbeat at or after ``since_iso``. Best effort."""
        try:
            response = (
                self.db.table("user_presence_sessions")
                .select("user_id")
                .gte("last_heartbeat_at", since_iso)
                .execute()
            )
        except Exception as exc:
            logger.debug("Team Chat: presence lookup failed: %s", exc)
            return set()
        return {str(row.get("user_id")) for row in _rows(response) if row.get("user_id")}

    # --- Conversations --------------------------------------------------------

    def get_conversations(self, conversation_ids: Iterable[str]) -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []
        try:
            for chunk in _chunks(conversation_ids):
                response = (
                    self.db.table(CONVERSATIONS)
                    .select(_CONVERSATION_COLUMNS)
                    .in_("id", chunk)
                    .execute()
                )
                out.extend(_rows(response))
        except Exception as exc:
            logger.error("Team Chat: failed to load conversations: %s", exc)
            raise _storage_error("load conversations", exc) from exc
        return out

    def find_direct(self, direct_key: str) -> Optional[Dict[str, Any]]:
        try:
            response = (
                self.db.table(CONVERSATIONS)
                .select(_CONVERSATION_COLUMNS)
                .eq("direct_key", direct_key)
                .limit(1)
                .execute()
            )
        except Exception as exc:
            logger.error("Team Chat: failed to look up direct conversation: %s", exc)
            raise _storage_error("load the conversation", exc) from exc
        rows = _rows(response)
        return rows[0] if rows else None

    def create_conversation(self, row: Dict[str, Any]) -> Dict[str, Any]:
        try:
            response = self.db.table(CONVERSATIONS).insert(row).execute()
        except Exception as exc:
            if row.get("direct_key") and _is_duplicate_error(exc):
                raise DuplicateDirectConversation(str(exc)) from exc
            logger.error("Team Chat: failed to create conversation: %s", exc)
            raise _storage_error("create the conversation", exc) from exc
        rows = _rows(response)
        if not rows:
            raise MessengerStorageError("Failed to create the conversation: no row returned")
        return rows[0]

    def update_conversation(self, conversation_id: str, patch: Dict[str, Any]) -> None:
        try:
            self.db.table(CONVERSATIONS).update(patch).eq("id", conversation_id).execute()
        except Exception as exc:
            logger.error("Team Chat: failed to update conversation %s: %s", conversation_id, exc)
            raise _storage_error("update the conversation", exc) from exc

    def delete_conversation(self, conversation_id: str) -> None:
        try:
            self.db.table(CONVERSATIONS).delete().eq("id", conversation_id).execute()
        except Exception as exc:
            logger.error("Team Chat: failed to delete conversation %s: %s", conversation_id, exc)
            raise _storage_error("delete the conversation", exc) from exc

    # --- Members --------------------------------------------------------------

    def memberships_for_user(self, user_id: str) -> List[Dict[str, Any]]:
        try:
            response = (
                self.db.table(MEMBERS)
                .select(_MEMBER_COLUMNS)
                .eq("user_id", user_id)
                .execute()
            )
        except Exception as exc:
            logger.error("Team Chat: failed to load memberships: %s", exc)
            raise _storage_error("load your conversations", exc) from exc
        return _rows(response)

    def get_membership(self, conversation_id: str, user_id: str) -> Optional[Dict[str, Any]]:
        try:
            response = (
                self.db.table(MEMBERS)
                .select(_MEMBER_COLUMNS)
                .eq("conversation_id", conversation_id)
                .eq("user_id", user_id)
                .limit(1)
                .execute()
            )
        except Exception as exc:
            logger.error("Team Chat: failed to check membership: %s", exc)
            raise _storage_error("load the conversation", exc) from exc
        rows = _rows(response)
        return rows[0] if rows else None

    def members_of(self, conversation_ids: Iterable[str]) -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []
        try:
            for chunk in _chunks(conversation_ids):
                response = (
                    self.db.table(MEMBERS)
                    .select(_MEMBER_COLUMNS)
                    .in_("conversation_id", chunk)
                    .execute()
                )
                out.extend(_rows(response))
        except Exception as exc:
            logger.error("Team Chat: failed to load members: %s", exc)
            raise _storage_error("load conversation members", exc) from exc
        return out

    def add_members(self, rows: List[Dict[str, Any]]) -> None:
        if not rows:
            return
        try:
            self.db.table(MEMBERS).insert(rows).execute()
        except Exception as exc:
            logger.error("Team Chat: failed to add members: %s", exc)
            raise _storage_error("add conversation members", exc) from exc

    def remove_member(self, conversation_id: str, user_id: str) -> None:
        try:
            (
                self.db.table(MEMBERS)
                .delete()
                .eq("conversation_id", conversation_id)
                .eq("user_id", user_id)
                .execute()
            )
        except Exception as exc:
            logger.error("Team Chat: failed to remove member: %s", exc)
            raise _storage_error("leave the conversation", exc) from exc

    def set_last_read(self, conversation_id: str, user_id: str, read_at_iso: str) -> None:
        try:
            (
                self.db.table(MEMBERS)
                .update({"last_read_at": read_at_iso})
                .eq("conversation_id", conversation_id)
                .eq("user_id", user_id)
                .execute()
            )
        except Exception as exc:
            logger.error("Team Chat: failed to mark read: %s", exc)
            raise _storage_error("mark the conversation as read", exc) from exc

    # --- Messages -------------------------------------------------------------

    def list_messages(
        self,
        conversation_id: str,
        *,
        limit: int,
        before_iso: Optional[str] = None,
        after_iso: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Newest first, or oldest first when ``after_iso`` is given."""
        try:
            query = (
                self.db.table(MESSAGES)
                .select(_MESSAGE_COLUMNS)
                .eq("conversation_id", conversation_id)
            )
            if before_iso:
                query = query.lt("created_at", before_iso)
            if after_iso:
                query = query.gt("created_at", after_iso)
            response = (
                query.order("created_at", desc=not after_iso)
                .limit(limit)
                .execute()
            )
        except Exception as exc:
            logger.error("Team Chat: failed to list messages: %s", exc)
            raise _storage_error("load messages", exc) from exc
        return _rows(response)

    def insert_message(self, row: Dict[str, Any]) -> Dict[str, Any]:
        try:
            response = self.db.table(MESSAGES).insert(row).execute()
        except Exception as exc:
            if row.get("attachment_path") and _is_duplicate_error(exc):
                raise DuplicateAttachment(str(exc)) from exc
            logger.error("Team Chat: failed to send message: %s", exc)
            raise _storage_error("send the message", exc) from exc
        rows = _rows(response)
        if not rows:
            raise MessengerStorageError("Failed to send the message: no row returned")
        return rows[0]

    def get_message(self, message_id: str) -> Optional[Dict[str, Any]]:
        try:
            response = (
                self.db.table(MESSAGES)
                .select(_MESSAGE_COLUMNS)
                .eq("id", message_id)
                .limit(1)
                .execute()
            )
        except Exception as exc:
            logger.error("Team Chat: failed to load message %s: %s", message_id, exc)
            raise _storage_error("load the message", exc) from exc
        rows = _rows(response)
        return rows[0] if rows else None

    def message_with_attachment(self, path: str) -> Optional[Dict[str, Any]]:
        try:
            response = (
                self.db.table(MESSAGES)
                .select("id")
                .eq("attachment_path", path)
                .limit(1)
                .execute()
            )
        except Exception as exc:
            logger.error("Team Chat: failed to look up attachment: %s", exc)
            raise _storage_error("check the file", exc) from exc
        rows = _rows(response)
        return rows[0] if rows else None

    def update_message(self, message_id: str, patch: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        try:
            response = self.db.table(MESSAGES).update(patch).eq("id", message_id).execute()
        except Exception as exc:
            logger.error("Team Chat: failed to update message %s: %s", message_id, exc)
            raise _storage_error("update the message", exc) from exc
        rows = _rows(response)
        return rows[0] if rows else None

    def unread_candidates(
        self,
        conversation_ids: Iterable[str],
        *,
        since_iso: Optional[str],
        exclude_sender_id: str,
        limit: int = 2000,
    ) -> List[Dict[str, Any]]:
        """Messages from others (not unsent) newer than ``since_iso`` in these conversations."""
        out: List[Dict[str, Any]] = []
        try:
            for chunk in _chunks(conversation_ids):
                query = (
                    self.db.table(MESSAGES)
                    .select("conversation_id, sender_id, created_at")
                    .in_("conversation_id", chunk)
                    .is_("deleted_at", "null")
                    .neq("sender_id", exclude_sender_id)
                )
                if since_iso:
                    query = query.gt("created_at", since_iso)
                response = query.order("created_at", desc=True).limit(limit).execute()
                out.extend(_rows(response))
        except Exception as exc:
            logger.error("Team Chat: failed to count unread messages: %s", exc)
            raise _storage_error("count unread messages", exc) from exc
        return out


class MessengerFileStore:
    """Signed links and housekeeping for the private Team Chat Storage bucket.

    Talks to the Storage REST API directly: the pinned supabase-py release builds
    malformed signed upload URLs and drops the ``download`` option.
    """

    def __init__(self, *, timeout: float = 20.0):
        self._base = f"{settings.supabase_url.rstrip('/')}/storage/v1"
        self._headers = {
            "apikey": settings.supabase_key,
            "Authorization": f"Bearer {settings.supabase_key}",
        }
        self._timeout = timeout

    def _request(self, method: str, path: str, action: str, **kwargs: Any) -> Any:
        try:
            response = httpx.request(
                method,
                f"{self._base}{path}",
                headers=self._headers,
                timeout=self._timeout,
                **kwargs,
            )
        except httpx.HTTPError as exc:
            logger.error("Team Chat: storage request to %s failed: %s", action, exc)
            raise MessengerStorageError(f"Failed to {action}: file storage is unreachable") from exc
        if response.status_code >= 400:
            text = response.text[:500]
            if "bucket not found" in text.lower():
                raise MessengerStorageError(FILES_HINT, missing_tables=True)
            logger.error("Team Chat: storage could not %s (%s): %s", action, response.status_code, text)
            raise MessengerStorageError(f"Failed to {action}")
        try:
            return response.json()
        except ValueError:
            return None

    def _absolute(self, relative: str) -> str:
        return f"{self._base}/{relative.lstrip('/')}"

    def create_upload_url(self, path: str) -> str:
        """One-time link the browser PUTs the file to (valid for two hours)."""
        data = self._request(
            "POST", f"/object/upload/sign/{FILES_BUCKET}/{path}", "prepare the upload"
        ) or {}
        relative = data.get("url")
        if not relative or "token=" not in relative:
            raise MessengerStorageError("Failed to prepare the upload: no upload link returned")
        return self._absolute(relative)

    def create_download_url(
        self, path: str, *, expires_in: int, download_name: Optional[str] = None
    ) -> str:
        data = self._request(
            "POST",
            f"/object/sign/{FILES_BUCKET}/{path}",
            "open the file",
            json={"expiresIn": expires_in},
        ) or {}
        relative = data.get("signedURL") or data.get("signedUrl")
        if not relative:
            raise MessengerStorageError("Failed to open the file: no link returned")
        url = self._absolute(relative)
        if download_name:
            url += f"&download={quote(download_name, safe='')}"
        return url

    def _list(self, prefix: str, *, search: str = "", limit: int = 1000) -> List[Dict[str, Any]]:
        data = self._request(
            "POST",
            f"/object/list/{FILES_BUCKET}",
            "check the file",
            json={
                "prefix": prefix,
                "search": search,
                "limit": limit,
                "offset": 0,
                "sortBy": {"column": "name", "order": "asc"},
            },
        )
        return list(data or [])

    def stat(self, path: str) -> Optional[Dict[str, Any]]:
        """``{"size", "mime_type"}`` for an uploaded object, or None if it is not there."""
        folder, _, name = path.rpartition("/")
        for item in self._list(folder, search=name, limit=10):
            if item.get("name") != name:
                continue
            metadata = item.get("metadata") or {}
            try:
                size = int(metadata.get("size"))
            except (TypeError, ValueError):
                return None
            return {"size": size, "mime_type": metadata.get("mimetype")}
        return None

    def remove(self, paths: List[str]) -> None:
        """Best effort: a leftover file only costs storage, never correctness."""
        for start in range(0, len(paths), 100):
            batch = paths[start:start + 100]
            try:
                self._request(
                    "DELETE", f"/object/{FILES_BUCKET}", "delete files", json={"prefixes": batch}
                )
            except MessengerStorageError as exc:
                logger.warning("Team Chat: could not delete %s file(s): %s", len(batch), exc)

    def remove_conversation_files(self, conversation_id: str) -> None:
        """Delete every file under ``<conversation_id>/`` (used when a group is deleted)."""
        try:
            paths: List[str] = []
            for folder in self._list(conversation_id):
                if folder.get("id") is not None:
                    continue
                prefix = f"{conversation_id}/{folder.get('name')}"
                paths.extend(
                    f"{prefix}/{item['name']}"
                    for item in self._list(prefix)
                    if item.get("id") is not None and item.get("name")
                )
        except MessengerStorageError as exc:
            logger.warning("Team Chat: could not list files of %s: %s", conversation_id, exc)
            return
        self.remove(paths)
