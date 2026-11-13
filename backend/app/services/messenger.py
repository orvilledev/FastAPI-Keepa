"""Team Chat rules: who can chat, conversation summaries, unread counts, read receipts."""
from __future__ import annotations

import os
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional

from app.config import settings
from app.repositories.messenger_repository import (
    DuplicateAttachment,
    DuplicateDirectConversation,
    MessengerFileStore,
    MessengerRepository,
)
from app.repositories.user_presence_repository import ONLINE_GRACE_SECONDS, display_label

MAX_MESSAGE_LENGTH = 4000
MAX_TITLE_LENGTH = 80
MAX_GROUP_MEMBERS = 50
PREVIEW_LENGTH = 140
UNSENT_PREVIEW = "Message unsent"
# Keep in sync with the team-chat-files bucket limit in create_messenger_chat.sql.
MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024
MAX_FILE_NAME_LENGTH = 255
PREVIEW_LINK_SECONDS = 60 * 60
DOWNLOAD_LINK_SECONDS = 5 * 60
_LEGACY_SUPERADMIN_EMAIL = "orvillebarba@gmail.com"
_MIME_PATTERN = re.compile(r"^[\w.+-]+/[\w.+-]+$")
_CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f]")


class MessengerError(Exception):
    """A request the caller can fix (bad input, not a member, ...)."""

    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def parse_ts(value: Any) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    text = str(value).strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        # Postgres can return fractional seconds with fewer than 6 digits on older Pythons.
        head, sep, tail = text.partition(".")
        if not sep:
            return None
        digits = "".join(ch for ch in tail if ch.isdigit())
        zone = tail[len(digits):]
        try:
            parsed = datetime.fromisoformat(f"{head}.{digits[:6].ljust(6, '0')}{zone}")
        except ValueError:
            return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def direct_key(user_a: str, user_b: str) -> str:
    first, second = sorted([str(user_a), str(user_b)])
    return f"{first}:{second}"


def _preview(body: str) -> str:
    flat = " ".join((body or "").split())
    if len(flat) <= PREVIEW_LENGTH:
        return flat
    return flat[: PREVIEW_LENGTH - 1].rstrip() + "…"


def _is_chat_eligible(profile: Dict[str, Any]) -> bool:
    role = (profile.get("role") or "").strip().lower()
    email = (profile.get("email") or "").strip().lower()
    # Same accounts get_team_chat_user lets in (the legacy owner email counts as superadmin).
    is_superadmin = role == "superadmin" or email == _LEGACY_SUPERADMIN_EMAIL
    if not (profile.get("is_active") or is_superadmin):
        return False
    allowed = settings.team_chat_allowed_emails_list
    return not allowed or is_superadmin or email in allowed


def clean_file_name(raw: Any) -> str:
    """Display name for an upload: no folders or control characters, at most 255 chars."""
    name = re.split(r"[\\/]", str(raw or ""))[-1]
    name = " ".join(_CONTROL_CHARS.sub("", name).split()).strip(" .")
    if not name:
        return "file"
    if len(name) <= MAX_FILE_NAME_LENGTH:
        return name
    stem, ext = os.path.splitext(name)
    if len(ext) > 16:
        ext = ""
    return stem[: MAX_FILE_NAME_LENGTH - len(ext)].rstrip() + ext


def _storage_extension(name: str) -> str:
    ext = re.sub(r"[^a-z0-9]", "", os.path.splitext(name)[1].lower())[:10]
    return f".{ext}" if ext else ""


def _clean_mime(raw: Any) -> str:
    value = str(raw or "").split(";")[0].strip().lower()[:100]
    return value if _MIME_PATTERN.match(value) else "application/octet-stream"


def _attachment_path_pattern(conversation_id: str, user_id: str) -> "re.Pattern[str]":
    return re.compile(
        rf"^{re.escape(conversation_id)}/{re.escape(user_id)}/[0-9a-f]{{32}}(\.[a-z0-9]{{1,10}})?$"
    )


def _format_size(size: int) -> str:
    return f"{size / (1024 * 1024):.0f} MB"


def serialize_message(row: Dict[str, Any]) -> Dict[str, Any]:
    deleted = bool(row.get("deleted_at"))
    attachment = None
    if not deleted and row.get("attachment_path"):
        attachment = {
            "name": row.get("attachment_name") or "file",
            "size": int(row.get("attachment_size") or 0),
            "mime_type": row.get("attachment_type") or "application/octet-stream",
        }
    return {
        "id": str(row.get("id")),
        "conversation_id": str(row.get("conversation_id")),
        "sender_id": str(row["sender_id"]) if row.get("sender_id") else None,
        "body": "" if deleted else (row.get("body") or ""),
        "created_at": row.get("created_at"),
        "deleted": deleted,
        "attachment": attachment,
    }


class MessengerService:
    def __init__(self, repo: MessengerRepository, files: Optional[MessengerFileStore] = None):
        self.repo = repo
        self.files = files

    def _file_store(self) -> MessengerFileStore:
        if self.files is None:
            self.files = MessengerFileStore()
        return self.files

    # --- People ---------------------------------------------------------------

    def _people(self) -> Dict[str, Dict[str, Any]]:
        """Every profile keyed by id, with a display name and online flag."""
        since = (utcnow() - timedelta(seconds=ONLINE_GRACE_SECONDS)).isoformat()
        online = self.repo.online_user_ids(since)
        people: Dict[str, Dict[str, Any]] = {}
        for profile in self.repo.list_profiles():
            user_id = str(profile.get("id") or "")
            if not user_id:
                continue
            email = (profile.get("email") or "").strip().lower() or None
            people[user_id] = {
                "id": user_id,
                "name": display_label(profile.get("display_name"), email) or "Unknown user",
                "email": email,
                "online": user_id in online,
                "eligible": _is_chat_eligible(profile),
            }
        return people

    @staticmethod
    def _public_person(person: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "id": person["id"],
            "name": person["name"],
            "email": person["email"],
            "online": person["online"],
        }

    def list_directory(self, current_user_id: str) -> List[Dict[str, Any]]:
        people = self._people()
        rows = [
            self._public_person(person)
            for person in people.values()
            if person["eligible"] and person["id"] != str(current_user_id)
        ]
        rows.sort(key=lambda p: (not p["online"], p["name"].lower()))
        return rows

    # --- Membership -----------------------------------------------------------

    def require_membership(self, conversation_id: str, user_id: str) -> Dict[str, Any]:
        membership = self.repo.get_membership(conversation_id, user_id)
        if not membership:
            raise MessengerError(404, "Conversation not found")
        return membership

    # --- Conversations --------------------------------------------------------

    def _build_summaries(
        self,
        conversations: List[Dict[str, Any]],
        current_user_id: str,
        people: Optional[Dict[str, Dict[str, Any]]] = None,
    ) -> List[Dict[str, Any]]:
        if not conversations:
            return []
        me = str(current_user_id)
        people = people if people is not None else self._people()
        ids = [str(c["id"]) for c in conversations]
        members = self.repo.members_of(ids)

        members_by_conv: Dict[str, List[Dict[str, Any]]] = {cid: [] for cid in ids}
        my_read: Dict[str, Optional[datetime]] = {}
        for row in members:
            cid = str(row.get("conversation_id"))
            uid = str(row.get("user_id"))
            if cid not in members_by_conv:
                continue
            person = people.get(uid) or {
                "id": uid,
                "name": "Former user",
                "email": None,
                "online": False,
            }
            members_by_conv[cid].append(
                {**self._public_person(person), "last_read_at": row.get("last_read_at")}
            )
            if uid == me:
                my_read[cid] = parse_ts(row.get("last_read_at"))

        unread = self._unread_by_conversation(my_read, me)

        summaries: List[Dict[str, Any]] = []
        for conv in conversations:
            cid = str(conv["id"])
            conv_members = sorted(
                members_by_conv.get(cid, []),
                key=lambda m: (m["id"] != me, m["name"].lower()),
            )
            last_message = None
            if conv.get("last_message_at"):
                last_message = {
                    "body": conv.get("last_message_preview") or "",
                    "sender_id": (
                        str(conv["last_message_sender_id"])
                        if conv.get("last_message_sender_id")
                        else None
                    ),
                    "created_at": conv.get("last_message_at"),
                }
            summaries.append(
                {
                    "id": cid,
                    "is_group": bool(conv.get("is_group")),
                    "title": conv.get("title"),
                    "created_by": str(conv["created_by"]) if conv.get("created_by") else None,
                    "created_at": conv.get("created_at"),
                    "last_message_at": conv.get("last_message_at"),
                    "last_message": last_message,
                    "members": conv_members,
                    "unread_count": unread.get(cid, 0),
                }
            )

        def sort_key(summary: Dict[str, Any]) -> datetime:
            return (
                parse_ts(summary.get("last_message_at"))
                or parse_ts(summary.get("created_at"))
                or datetime.min.replace(tzinfo=timezone.utc)
            )

        summaries.sort(key=sort_key, reverse=True)
        return summaries

    def _unread_by_conversation(
        self, my_read: Dict[str, Optional[datetime]], user_id: str
    ) -> Dict[str, int]:
        if not my_read:
            return {}
        reads = list(my_read.values())
        since = None if any(r is None for r in reads) else min(r for r in reads if r)
        candidates = self.repo.unread_candidates(
            my_read.keys(),
            since_iso=since.isoformat() if since else None,
            exclude_sender_id=user_id,
        )
        counts: Dict[str, int] = {}
        for row in candidates:
            cid = str(row.get("conversation_id"))
            if cid not in my_read:
                continue
            created = parse_ts(row.get("created_at"))
            read_at = my_read[cid]
            if read_at is not None and (created is None or created <= read_at):
                continue
            counts[cid] = counts.get(cid, 0) + 1
        return counts

    def list_conversations(self, current_user_id: str) -> List[Dict[str, Any]]:
        memberships = self.repo.memberships_for_user(str(current_user_id))
        ids = [str(m.get("conversation_id")) for m in memberships if m.get("conversation_id")]
        if not ids:
            return []
        conversations = self.repo.get_conversations(ids)
        return self._build_summaries(conversations, current_user_id)

    def get_conversation(self, conversation_id: str, current_user_id: str) -> Dict[str, Any]:
        self.require_membership(conversation_id, str(current_user_id))
        conversations = self.repo.get_conversations([conversation_id])
        if not conversations:
            raise MessengerError(404, "Conversation not found")
        return self._build_summaries(conversations, current_user_id)[0]

    def total_unread(self, current_user_id: str) -> int:
        memberships = self.repo.memberships_for_user(str(current_user_id))
        my_read = {
            str(m.get("conversation_id")): parse_ts(m.get("last_read_at"))
            for m in memberships
            if m.get("conversation_id")
        }
        return sum(self._unread_by_conversation(my_read, str(current_user_id)).values())

    def create_conversation(
        self,
        current_user_id: str,
        member_ids: Iterable[str],
        title: Optional[str] = None,
    ) -> Dict[str, Any]:
        me = str(current_user_id)
        others: List[str] = []
        for raw in member_ids:
            uid = str(raw).strip()
            if uid and uid != me and uid not in others:
                others.append(uid)
        if not others:
            raise MessengerError(400, "Pick at least one person to chat with.")
        if len(others) + 1 > MAX_GROUP_MEMBERS:
            raise MessengerError(400, f"A group can have at most {MAX_GROUP_MEMBERS} people.")

        people = self._people()
        unknown = [uid for uid in others if not (people.get(uid) or {}).get("eligible")]
        if unknown:
            raise MessengerError(400, "One or more selected people cannot be added to a chat.")

        clean_title = " ".join((title or "").split())[:MAX_TITLE_LENGTH] or None
        now_iso = utcnow().isoformat()

        if len(others) == 1:
            key = direct_key(me, others[0])
            existing = self.repo.find_direct(key)
            if existing:
                return self._build_summaries([existing], me, people)[0]
            try:
                conversation = self.repo.create_conversation(
                    {
                        "is_group": False,
                        "title": None,
                        "direct_key": key,
                        "created_by": me,
                        "updated_at": now_iso,
                    }
                )
            except DuplicateDirectConversation:
                existing = self.repo.find_direct(key)
                if not existing:
                    raise
                return self._build_summaries([existing], me, people)[0]
        else:
            conversation = self.repo.create_conversation(
                {
                    "is_group": True,
                    "title": clean_title,
                    "direct_key": None,
                    "created_by": me,
                    "updated_at": now_iso,
                }
            )

        cid = str(conversation["id"])
        try:
            self.repo.add_members(
                [
                    {"conversation_id": cid, "user_id": uid, "last_read_at": now_iso if uid == me else None}
                    for uid in [me, *others]
                ]
            )
        except Exception:
            # Never leave an empty thread behind (it would block the 1:1 key forever).
            try:
                self.repo.delete_conversation(cid)
            except Exception:
                pass
            raise
        return self._build_summaries([conversation], me, people)[0]

    def leave_conversation(self, conversation_id: str, current_user_id: str) -> None:
        me = str(current_user_id)
        self.require_membership(conversation_id, me)
        conversations = self.repo.get_conversations([conversation_id])
        if not conversations:
            raise MessengerError(404, "Conversation not found")
        if not conversations[0].get("is_group"):
            raise MessengerError(400, "You can only leave group chats.")
        self.repo.remove_member(conversation_id, me)
        if not self.repo.members_of([conversation_id]):
            self.repo.delete_conversation(conversation_id)
            self._file_store().remove_conversation_files(conversation_id)

    # --- Messages -------------------------------------------------------------

    def list_messages(
        self,
        conversation_id: str,
        current_user_id: str,
        *,
        limit: int,
        before: Optional[datetime] = None,
        after: Optional[datetime] = None,
    ) -> Dict[str, Any]:
        self.require_membership(conversation_id, str(current_user_id))
        rows = self.repo.list_messages(
            conversation_id,
            limit=limit + 1,
            before_iso=before.isoformat() if before else None,
            after_iso=after.isoformat() if after else None,
        )
        has_more = len(rows) > limit
        rows = rows[:limit]
        if not after:
            rows = list(reversed(rows))
        return {
            "messages": [serialize_message(row) for row in rows],
            "has_more": has_more,
        }

    def send_message(
        self,
        conversation_id: str,
        current_user_id: str,
        body: str,
        attachment: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        me = str(current_user_id)
        text = (body or "").strip()
        if not text and not attachment:
            raise MessengerError(400, "Message cannot be empty.")
        if len(text) > MAX_MESSAGE_LENGTH:
            raise MessengerError(400, f"Messages are limited to {MAX_MESSAGE_LENGTH} characters.")
        self.require_membership(conversation_id, me)

        row: Dict[str, Any] = {"conversation_id": conversation_id, "sender_id": me, "body": text}
        if attachment:
            row.update(self._verified_attachment(conversation_id, me, attachment))
        try:
            saved = self.repo.insert_message(row)
        except DuplicateAttachment as exc:
            raise MessengerError(409, "That file was already sent.") from exc
        created_at = saved.get("created_at") or utcnow().isoformat()
        preview = _preview(text) if text else _preview(f"📎 {row['attachment_name']}")
        self.repo.update_conversation(
            conversation_id,
            {
                "last_message_at": created_at,
                "last_message_preview": preview,
                "last_message_sender_id": me,
                "updated_at": utcnow().isoformat(),
            },
        )
        # Sending implies you have read everything up to your own message.
        self.repo.set_last_read(conversation_id, me, created_at)
        return serialize_message(saved)

    def unsend_message(self, message_id: str, current_user_id: str) -> Dict[str, Any]:
        me = str(current_user_id)
        row = self.repo.get_message(message_id)
        if not row:
            raise MessengerError(404, "Message not found")
        conversation_id = str(row.get("conversation_id"))
        self.require_membership(conversation_id, me)
        if str(row.get("sender_id") or "") != me:
            raise MessengerError(403, "You can only unsend your own messages.")
        if row.get("deleted_at"):
            return serialize_message(row)

        patch = {
            "body": "",
            "deleted_at": utcnow().isoformat(),
            "attachment_path": None,
            "attachment_name": None,
            "attachment_size": None,
            "attachment_type": None,
        }
        updated = self.repo.update_message(message_id, patch) or {**row, **patch}
        if row.get("attachment_path"):
            self._file_store().remove([str(row["attachment_path"])])

        latest = self.repo.list_messages(conversation_id, limit=1)
        if latest and str(latest[0].get("id")) == str(message_id):
            self.repo.update_conversation(
                conversation_id,
                {"last_message_preview": UNSENT_PREVIEW, "updated_at": utcnow().isoformat()},
            )
        return serialize_message(updated)

    # --- Files ----------------------------------------------------------------

    def prepare_upload(
        self,
        conversation_id: str,
        current_user_id: str,
        *,
        file_name: str,
        size: int,
    ) -> Dict[str, Any]:
        """Reserve a storage path for one file and return a one-time upload link."""
        me = str(current_user_id)
        if size <= 0:
            raise MessengerError(400, "That file is empty.")
        if size > MAX_FILE_BYTES:
            raise MessengerError(413, f"Files can be at most {_format_size(MAX_FILE_BYTES)}.")
        self.require_membership(conversation_id, me)
        name = clean_file_name(file_name)
        path = f"{conversation_id}/{me}/{uuid.uuid4().hex}{_storage_extension(name)}"
        upload_url = self._file_store().create_upload_url(path)
        return {"path": path, "upload_url": upload_url, "max_bytes": MAX_FILE_BYTES}

    def discard_upload(self, conversation_id: str, current_user_id: str, path: str) -> None:
        """Delete a file the sender uploaded but did not send (cancelled or failed)."""
        me = str(current_user_id)
        self.require_membership(conversation_id, me)
        if not _attachment_path_pattern(conversation_id, me).match(path or ""):
            raise MessengerError(400, "That file does not belong to you.")
        if self.repo.message_with_attachment(path):
            raise MessengerError(409, "That file was already sent. Unsend the message instead.")
        self._file_store().remove([path])

    def _verified_attachment(
        self, conversation_id: str, me: str, attachment: Dict[str, Any]
    ) -> Dict[str, Any]:
        path = str(attachment.get("path") or "")
        if not _attachment_path_pattern(conversation_id, me).match(path):
            raise MessengerError(400, "That file does not belong to this conversation.")
        files = self._file_store()
        stored = files.stat(path)
        if not stored:
            raise MessengerError(400, "The file upload did not finish. Please try again.")
        if stored["size"] <= 0:
            files.remove([path])
            raise MessengerError(400, "That file is empty.")
        if stored["size"] > MAX_FILE_BYTES:
            files.remove([path])
            raise MessengerError(413, f"Files can be at most {_format_size(MAX_FILE_BYTES)}.")
        mime = _clean_mime(stored.get("mime_type"))
        if mime == "application/octet-stream":
            mime = _clean_mime(attachment.get("mime_type"))
        return {
            "attachment_path": path,
            "attachment_name": clean_file_name(attachment.get("name")),
            "attachment_size": stored["size"],
            "attachment_type": mime,
        }

    def attachment_link(
        self, message_id: str, current_user_id: str, *, download: bool
    ) -> Dict[str, Any]:
        """Short-lived link to a message's file, for members of its conversation only."""
        row = self.repo.get_message(message_id)
        if not row:
            raise MessengerError(404, "Message not found")
        self.require_membership(str(row.get("conversation_id")), str(current_user_id))
        if row.get("deleted_at") or not row.get("attachment_path"):
            raise MessengerError(404, "This file is no longer available.")
        expires_in = DOWNLOAD_LINK_SECONDS if download else PREVIEW_LINK_SECONDS
        url = self._file_store().create_download_url(
            str(row["attachment_path"]),
            expires_in=expires_in,
            download_name=(row.get("attachment_name") or "file") if download else None,
        )
        return {"url": url, "expires_in": expires_in}

    def mark_read(self, conversation_id: str, current_user_id: str) -> Dict[str, Any]:
        me = str(current_user_id)
        self.require_membership(conversation_id, me)
        read_at = utcnow()
        latest = self.repo.list_messages(conversation_id, limit=1)
        if latest:
            # The database clock may run slightly ahead of this server's clock.
            newest = parse_ts(latest[0].get("created_at"))
            if newest and newest > read_at:
                read_at = newest
        read_iso = read_at.isoformat()
        self.repo.set_last_read(conversation_id, me, read_iso)
        return {"conversation_id": conversation_id, "last_read_at": read_iso}
