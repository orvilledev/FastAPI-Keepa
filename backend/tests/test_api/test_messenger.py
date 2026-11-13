"""Team Chat API: directory, conversations, messages, unread counts, receipts."""
import uuid
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import messenger
from app.config import settings
from app.database import get_supabase
from app.dependencies import get_current_user, is_team_chat_allowed_user
from app.repositories import messenger_repository
from app.repositories.messenger_repository import (
    MIGRATION_HINT,
    DuplicateAttachment,
    DuplicateDirectConversation,
    MessengerStorageError,
)
from app.services.audit_actions import describe, should_audit
from app.services.messenger import MAX_FILE_BYTES, clean_file_name

ALICE = str(uuid.uuid4())
BOB = str(uuid.uuid4())
CARA = str(uuid.uuid4())
PENDING = str(uuid.uuid4())


class FakeChatStore:
    """In-memory stand-in for the three Team Chat tables plus profiles/presence."""

    def __init__(self):
        self.profiles = [
            {"id": ALICE, "email": "alice@example.com", "display_name": "Alice", "role": "user", "is_active": True},
            {"id": BOB, "email": "bob@example.com", "display_name": None, "role": "user", "is_active": True},
            {"id": CARA, "email": "cara@example.com", "display_name": "Cara", "role": "superadmin", "is_active": False},
            {"id": PENDING, "email": "new@example.com", "display_name": "Pending", "role": "user", "is_active": False},
        ]
        self.online = {BOB}
        self.conversations: dict[str, dict] = {}
        self.members: list[dict] = []
        self.messages: list[dict] = []
        self.clock = datetime(2026, 11, 13, 12, 0, tzinfo=timezone.utc)
        self.fail_with: Exception | None = None
        self.race_direct = False
        # Storage bucket contents: path -> {"size", "mime_type"}.
        self.files: dict[str, dict] = {}

    def _tick(self) -> str:
        self.clock += timedelta(seconds=1)
        return self.clock.isoformat()

    def _check(self):
        if self.fail_with:
            raise self.fail_with

    def repository_class(self):
        store = self

        class FakeRepository:
            def __init__(self, db):
                pass

            def list_profiles(self):
                store._check()
                return [dict(p) for p in store.profiles]

            def online_user_ids(self, since_iso):
                return set(store.online)

            def get_conversations(self, ids):
                store._check()
                return [dict(store.conversations[i]) for i in ids if i in store.conversations]

            def find_direct(self, key):
                store._check()
                for conv in store.conversations.values():
                    if conv.get("direct_key") == key:
                        return dict(conv)
                return None

            def create_conversation(self, row):
                store._check()
                if row.get("direct_key"):
                    if store.race_direct:
                        store.race_direct = False
                        winner = {**row, "id": str(uuid.uuid4()), "created_at": store._tick(), "last_message_at": None}
                        store.conversations[winner["id"]] = winner
                        for uid in winner["direct_key"].split(":"):
                            store.members.append({"conversation_id": winner["id"], "user_id": uid, "last_read_at": None})
                        raise DuplicateDirectConversation("duplicate key")
                    if any(c.get("direct_key") == row["direct_key"] for c in store.conversations.values()):
                        raise DuplicateDirectConversation("duplicate key")
                saved = {
                    "last_message_at": None,
                    "last_message_preview": None,
                    "last_message_sender_id": None,
                    **row,
                    "id": str(uuid.uuid4()),
                    "created_at": store._tick(),
                }
                store.conversations[saved["id"]] = saved
                return dict(saved)

            def update_conversation(self, cid, patch):
                store.conversations[cid].update(patch)

            def delete_conversation(self, cid):
                store.conversations.pop(cid, None)
                store.members = [m for m in store.members if m["conversation_id"] != cid]
                store.messages = [m for m in store.messages if m["conversation_id"] != cid]

            def memberships_for_user(self, user_id):
                store._check()
                return [dict(m) for m in store.members if m["user_id"] == user_id]

            def get_membership(self, cid, user_id):
                store._check()
                for m in store.members:
                    if m["conversation_id"] == cid and m["user_id"] == user_id:
                        return dict(m)
                return None

            def members_of(self, ids):
                wanted = set(ids)
                return [dict(m) for m in store.members if m["conversation_id"] in wanted]

            def add_members(self, rows):
                store.members.extend(dict(r) for r in rows)

            def remove_member(self, cid, user_id):
                store.members = [
                    m for m in store.members if not (m["conversation_id"] == cid and m["user_id"] == user_id)
                ]

            def set_last_read(self, cid, user_id, read_at_iso):
                for m in store.members:
                    if m["conversation_id"] == cid and m["user_id"] == user_id:
                        m["last_read_at"] = read_at_iso

            def list_messages(self, cid, *, limit, before_iso=None, after_iso=None):
                rows = [m for m in store.messages if m["conversation_id"] == cid]
                if before_iso:
                    rows = [m for m in rows if m["created_at"] < before_iso]
                if after_iso:
                    rows = [m for m in rows if m["created_at"] > after_iso]
                rows.sort(key=lambda m: m["created_at"], reverse=not after_iso)
                return [dict(m) for m in rows[:limit]]

            def insert_message(self, row):
                path = row.get("attachment_path")
                if path and any(m.get("attachment_path") == path for m in store.messages):
                    raise DuplicateAttachment("duplicate key")
                saved = {**row, "id": str(uuid.uuid4()), "created_at": store._tick(), "deleted_at": None}
                store.messages.append(saved)
                return dict(saved)

            def get_message(self, mid):
                for m in store.messages:
                    if m["id"] == mid:
                        return dict(m)
                return None

            def message_with_attachment(self, path):
                for m in store.messages:
                    if m.get("attachment_path") == path:
                        return {"id": m["id"]}
                return None

            def update_message(self, mid, patch):
                for m in store.messages:
                    if m["id"] == mid:
                        m.update(patch)
                        return dict(m)
                return None

            def unread_candidates(self, ids, *, since_iso, exclude_sender_id, limit=2000):
                wanted = set(ids)
                return [
                    dict(m)
                    for m in store.messages
                    if m["conversation_id"] in wanted
                    and not m.get("deleted_at")
                    and m["sender_id"] != exclude_sender_id
                    and (since_iso is None or m["created_at"] > since_iso)
                ]

        return FakeRepository

    def file_store_class(self):
        store = self

        class FakeFileStore:
            def create_upload_url(self, path):
                return f"https://storage.example/upload/{path}?token=t"

            def create_download_url(self, path, *, expires_in, download_name=None):
                suffix = f"&download={download_name}" if download_name else ""
                return f"https://storage.example/object/{path}?expires={expires_in}{suffix}"

            def stat(self, path):
                found = store.files.get(path)
                return dict(found) if found else None

            def remove(self, paths):
                for path in paths:
                    store.files.pop(path, None)

            def remove_conversation_files(self, conversation_id):
                self.remove([p for p in list(store.files) if p.startswith(f"{conversation_id}/")])

        return FakeFileStore


@pytest.fixture
def store(monkeypatch):
    monkeypatch.setattr(settings, "team_chat_allowed_emails", "")
    fake = FakeChatStore()
    monkeypatch.setattr(messenger, "MessengerRepository", fake.repository_class())
    monkeypatch.setattr(messenger, "MessengerFileStore", fake.file_store_class())
    return fake


def _client_for(user_id: str, email: str) -> TestClient:
    app = FastAPI()
    app.include_router(messenger.router, prefix="/api/v1")
    app.dependency_overrides[get_supabase] = lambda: object()
    app.dependency_overrides[get_current_user] = lambda: {"id": user_id, "email": email}
    return TestClient(app)


@pytest.fixture
def alice(store):
    return _client_for(ALICE, "alice@example.com")


@pytest.fixture
def bob(store):
    return _client_for(BOB, "bob@example.com")


def _start_direct(client, other_id):
    response = client.post("/api/v1/messenger/conversations", json={"member_ids": [other_id]})
    assert response.status_code == 201, response.text
    return response.json()


def _send(client, conversation_id, body):
    response = client.post(
        f"/api/v1/messenger/conversations/{conversation_id}/messages", json={"body": body}
    )
    assert response.status_code == 201, response.text
    return response.json()


# ---------------------------------------------------------------------------
# Directory
# ---------------------------------------------------------------------------


def test_directory_lists_active_people_except_me_online_first(alice):
    users = alice.get("/api/v1/messenger/users").json()["users"]
    ids = [u["id"] for u in users]
    assert ALICE not in ids
    assert PENDING not in ids
    assert ids == [BOB, CARA]
    assert users[0]["online"] is True and users[0]["name"] == "Bob"
    assert users[1]["online"] is False


def test_directory_and_new_chats_follow_the_allowlist(alice, monkeypatch):
    monkeypatch.setattr(settings, "team_chat_allowed_emails", "alice@example.com, BOB@example.com")
    ids = [u["id"] for u in alice.get("/api/v1/messenger/users").json()["users"]]
    # Cara is not listed but is a superadmin, so she stays reachable.
    assert ids == [BOB, CARA]

    monkeypatch.setattr(settings, "team_chat_allowed_emails", "alice@example.com")
    ids = [u["id"] for u in alice.get("/api/v1/messenger/users").json()["users"]]
    assert ids == [CARA]
    response = alice.post("/api/v1/messenger/conversations", json={"member_ids": [BOB]})
    assert response.status_code == 400


def test_team_chat_access_check(monkeypatch):
    monkeypatch.setattr(
        settings,
        "team_chat_allowed_emails",
        "stephanie@metroshoewarehouse.com,johnbernard@metroshoewarehouse.com",
    )

    class NoProfileDb:
        def table(self, name):
            return self

        def select(self, *args):
            return self

        def eq(self, *args):
            return self

        def execute(self):
            return type("Response", (), {"data": []})()

    db = NoProfileDb()
    assert is_team_chat_allowed_user({"id": "1", "email": " Stephanie@MetroShoeWarehouse.com "}, db)
    assert is_team_chat_allowed_user({"id": "2", "email": "johnbernard@metroshoewarehouse.com"}, db)
    assert is_team_chat_allowed_user({"id": "3", "email": "orvillebarba@gmail.com"}, db)
    assert not is_team_chat_allowed_user({"id": "4", "email": "warehouse1@metroshoewarehouse.com"}, db)
    assert not is_team_chat_allowed_user({"id": "5", "email": ""}, db)

    monkeypatch.setattr(settings, "team_chat_allowed_emails", "")
    assert is_team_chat_allowed_user({"id": "4", "email": "warehouse1@metroshoewarehouse.com"}, db)


# ---------------------------------------------------------------------------
# Conversations
# ---------------------------------------------------------------------------


def test_direct_chat_is_reused_for_the_same_pair(alice, bob, store):
    first = _start_direct(alice, BOB)
    again = _start_direct(alice, BOB)
    from_bob = _start_direct(bob, ALICE)
    assert first["id"] == again["id"] == from_bob["id"]
    assert first["is_group"] is False
    assert {m["id"] for m in first["members"]} == {ALICE, BOB}
    assert len(store.conversations) == 1


def test_direct_chat_race_returns_the_winning_thread(alice, store):
    store.race_direct = True
    conv = _start_direct(alice, BOB)
    assert len(store.conversations) == 1
    assert conv["id"] in store.conversations


def test_cannot_start_chat_with_pending_or_unknown_users(alice):
    for target in (PENDING, str(uuid.uuid4())):
        response = alice.post("/api/v1/messenger/conversations", json={"member_ids": [target]})
        assert response.status_code == 400


def test_cannot_start_chat_with_only_myself(alice):
    response = alice.post("/api/v1/messenger/conversations", json={"member_ids": [ALICE]})
    assert response.status_code == 400


def test_group_chat_keeps_title_and_all_members(alice):
    response = alice.post(
        "/api/v1/messenger/conversations",
        json={"member_ids": [BOB, CARA], "title": "  Morning   shift  "},
    )
    assert response.status_code == 201
    group = response.json()
    assert group["is_group"] is True
    assert group["title"] == "Morning shift"
    assert {m["id"] for m in group["members"]} == {ALICE, BOB, CARA}
    assert group["members"][0]["id"] == ALICE


def test_conversation_list_only_shows_my_threads(alice, bob, store):
    _start_direct(alice, BOB)
    carol_client = _client_for(CARA, "cara@example.com")
    assert carol_client.get("/api/v1/messenger/conversations").json()["conversations"] == []
    assert len(bob.get("/api/v1/messenger/conversations").json()["conversations"]) == 1


# ---------------------------------------------------------------------------
# Messages, unread counts, read receipts
# ---------------------------------------------------------------------------


def test_sending_updates_preview_and_unread_counts(alice, bob):
    conv = _start_direct(alice, BOB)
    message = _send(alice, conv["id"], "  Hello Bob  ")
    assert message["body"] == "Hello Bob"
    assert message["sender_id"] == ALICE

    bob_view = bob.get("/api/v1/messenger/conversations").json()["conversations"][0]
    assert bob_view["unread_count"] == 1
    assert bob_view["last_message"]["body"] == "Hello Bob"
    assert bob_view["last_message"]["sender_id"] == ALICE
    assert bob.get("/api/v1/messenger/unread-count").json() == {"count": 1}

    assert alice.get("/api/v1/messenger/unread-count").json() == {"count": 0}


def test_mark_read_clears_unread_and_sets_receipt(alice, bob):
    conv = _start_direct(alice, BOB)
    sent = _send(alice, conv["id"], "Ping")
    response = bob.post(f"/api/v1/messenger/conversations/{conv['id']}/read")
    assert response.status_code == 200
    assert bob.get("/api/v1/messenger/unread-count").json() == {"count": 0}

    alice_view = alice.get(f"/api/v1/messenger/conversations/{conv['id']}").json()
    bob_member = next(m for m in alice_view["members"] if m["id"] == BOB)
    assert bob_member["last_read_at"] >= sent["created_at"]


def test_messages_page_oldest_to_newest_with_has_more(alice, store):
    conv = _start_direct(alice, BOB)
    sent = [_send(alice, conv["id"], f"msg {i}") for i in range(5)]

    page = alice.get(f"/api/v1/messenger/conversations/{conv['id']}/messages", params={"limit": 3}).json()
    assert [m["body"] for m in page["messages"]] == ["msg 2", "msg 3", "msg 4"]
    assert page["has_more"] is True

    older = alice.get(
        f"/api/v1/messenger/conversations/{conv['id']}/messages",
        params={"limit": 3, "before": page["messages"][0]["created_at"]},
    ).json()
    assert [m["body"] for m in older["messages"]] == ["msg 0", "msg 1"]
    assert older["has_more"] is False

    newer = alice.get(
        f"/api/v1/messenger/conversations/{conv['id']}/messages",
        params={"after": sent[2]["created_at"]},
    ).json()
    assert [m["body"] for m in newer["messages"]] == ["msg 3", "msg 4"]


def test_empty_or_oversized_messages_are_rejected(alice):
    conv = _start_direct(alice, BOB)
    url = f"/api/v1/messenger/conversations/{conv['id']}/messages"
    assert alice.post(url, json={"body": "   "}).status_code == 400
    assert alice.post(url, json={"body": ""}).status_code == 400
    assert alice.post(url, json={}).status_code == 400
    assert alice.post(url, json={"body": "x" * 4001}).status_code == 400


def test_outsiders_cannot_read_or_post(alice, store):
    conv = _start_direct(alice, BOB)
    outsider = _client_for(CARA, "cara@example.com")
    base = f"/api/v1/messenger/conversations/{conv['id']}"
    assert outsider.get(f"{base}/messages").status_code == 404
    assert outsider.post(f"{base}/messages", json={"body": "hi"}).status_code == 404
    assert outsider.post(f"{base}/read").status_code == 404
    assert outsider.get(base).status_code == 404


# ---------------------------------------------------------------------------
# Unsend and leave
# ---------------------------------------------------------------------------


def test_only_the_sender_can_unsend(alice, bob):
    conv = _start_direct(alice, BOB)
    message = _send(alice, conv["id"], "oops")
    assert bob.delete(f"/api/v1/messenger/messages/{message['id']}").status_code == 403

    response = alice.delete(f"/api/v1/messenger/messages/{message['id']}")
    assert response.status_code == 200
    assert response.json()["deleted"] is True and response.json()["body"] == ""

    listed = bob.get(f"/api/v1/messenger/conversations/{conv['id']}/messages").json()["messages"]
    assert listed[0]["deleted"] is True and listed[0]["body"] == ""
    summary = bob.get("/api/v1/messenger/conversations").json()["conversations"][0]
    assert summary["last_message"]["body"] == "Message unsent"
    assert summary["unread_count"] == 0


def test_leaving_a_group_and_last_member_removes_it(alice, bob, store):
    group = alice.post(
        "/api/v1/messenger/conversations", json={"member_ids": [BOB, CARA]}
    ).json()
    url = f"/api/v1/messenger/conversations/{group['id']}/leave"
    assert alice.post(url).status_code == 200
    assert alice.get("/api/v1/messenger/conversations").json()["conversations"] == []
    assert bob.post(url).status_code == 200
    assert _client_for(CARA, "cara@example.com").post(url).status_code == 200
    assert group["id"] not in store.conversations


def test_cannot_leave_a_direct_chat(alice):
    conv = _start_direct(alice, BOB)
    response = alice.post(f"/api/v1/messenger/conversations/{conv['id']}/leave")
    assert response.status_code == 400


# ---------------------------------------------------------------------------
# File sharing
# ---------------------------------------------------------------------------


def _upload(client, store, conversation_id, name="report.pdf", size=1234, mime="application/pdf"):
    """Request an upload link, then pretend the browser finished uploading."""
    response = client.post(
        f"/api/v1/messenger/conversations/{conversation_id}/attachments",
        json={"file_name": name, "size": size},
    )
    assert response.status_code == 201, response.text
    ticket = response.json()
    store.files[ticket["path"]] = {"size": size, "mime_type": mime}
    return ticket


def _send_file(client, conversation_id, ticket, name="report.pdf", body=""):
    return client.post(
        f"/api/v1/messenger/conversations/{conversation_id}/messages",
        json={"body": body, "attachment": {"path": ticket["path"], "name": name, "mime_type": "application/pdf"}},
    )


def test_file_is_uploaded_sent_and_viewable_by_members_only(alice, bob, store):
    conv = _start_direct(alice, BOB)
    ticket = _upload(alice, store, conv["id"])
    assert ticket["path"].startswith(f"{conv['id']}/{ALICE}/") and ticket["path"].endswith(".pdf")
    assert ticket["upload_url"].startswith("https://storage.example/upload/")
    assert ticket["max_bytes"] == MAX_FILE_BYTES

    response = _send_file(alice, conv["id"], ticket)
    assert response.status_code == 201, response.text
    message = response.json()
    assert message["body"] == ""
    assert message["attachment"] == {"name": "report.pdf", "size": 1234, "mime_type": "application/pdf"}

    listed = bob.get(f"/api/v1/messenger/conversations/{conv['id']}/messages").json()["messages"]
    assert listed[0]["attachment"]["name"] == "report.pdf"
    summary = bob.get("/api/v1/messenger/conversations").json()["conversations"][0]
    assert summary["last_message"]["body"] == "📎 report.pdf"
    assert summary["unread_count"] == 1

    preview = bob.get(f"/api/v1/messenger/messages/{message['id']}/attachment").json()
    assert preview["expires_in"] == 3600 and "download=" not in preview["url"]
    download = bob.get(
        f"/api/v1/messenger/messages/{message['id']}/attachment", params={"download": "true"}
    ).json()
    assert download["expires_in"] == 300 and download["url"].endswith("&download=report.pdf")

    outsider = _client_for(CARA, "cara@example.com")
    assert outsider.get(f"/api/v1/messenger/messages/{message['id']}/attachment").status_code == 404


def test_text_message_has_no_attachment(alice):
    conv = _start_direct(alice, BOB)
    assert _send(alice, conv["id"], "plain")["attachment"] is None


def test_upload_size_limits_and_membership(alice, store):
    conv = _start_direct(alice, BOB)
    url = f"/api/v1/messenger/conversations/{conv['id']}/attachments"
    assert alice.post(url, json={"file_name": "big.zip", "size": MAX_FILE_BYTES + 1}).status_code == 413
    assert alice.post(url, json={"file_name": "empty.txt", "size": 0}).status_code == 400
    assert alice.post(url, json={"file_name": "ok.zip", "size": MAX_FILE_BYTES}).status_code == 201
    outsider = _client_for(CARA, "cara@example.com")
    assert outsider.post(url, json={"file_name": "x.txt", "size": 5}).status_code == 404


def test_cannot_attach_files_that_are_not_mine_or_not_uploaded(alice, bob, store):
    conv = _start_direct(alice, BOB)
    bobs_ticket = _upload(bob, store, conv["id"])
    assert _send_file(alice, conv["id"], bobs_ticket).status_code == 400

    other_conv = alice.post("/api/v1/messenger/conversations", json={"member_ids": [BOB, CARA]}).json()
    foreign = _upload(alice, store, other_conv["id"])
    assert _send_file(alice, conv["id"], foreign).status_code == 400

    unfinished = alice.post(
        f"/api/v1/messenger/conversations/{conv['id']}/attachments",
        json={"file_name": "slow.pdf", "size": 10},
    ).json()
    response = _send_file(alice, conv["id"], unfinished)
    assert response.status_code == 400
    assert "did not finish" in response.json()["detail"]


def test_oversized_upload_is_rejected_and_deleted(alice, store):
    conv = _start_direct(alice, BOB)
    ticket = _upload(alice, store, conv["id"], size=10)
    store.files[ticket["path"]]["size"] = MAX_FILE_BYTES + 1
    assert _send_file(alice, conv["id"], ticket).status_code == 413
    assert ticket["path"] not in store.files


def test_same_file_cannot_be_sent_twice(alice, store):
    conv = _start_direct(alice, BOB)
    ticket = _upload(alice, store, conv["id"])
    assert _send_file(alice, conv["id"], ticket).status_code == 201
    assert _send_file(alice, conv["id"], ticket).status_code == 409


def test_unsending_a_file_deletes_it(alice, bob, store):
    conv = _start_direct(alice, BOB)
    ticket = _upload(alice, store, conv["id"])
    message = _send_file(alice, conv["id"], ticket).json()

    unsent = alice.delete(f"/api/v1/messenger/messages/{message['id']}").json()
    assert unsent["deleted"] is True and unsent["attachment"] is None
    assert ticket["path"] not in store.files
    assert bob.get(f"/api/v1/messenger/messages/{message['id']}/attachment").status_code == 404


def test_discarding_an_unsent_upload(alice, bob, store):
    conv = _start_direct(alice, BOB)
    url = f"/api/v1/messenger/conversations/{conv['id']}/attachments/discard"
    ticket = _upload(alice, store, conv["id"])
    assert bob.post(url, json={"path": ticket["path"]}).status_code == 400
    assert alice.post(url, json={"path": ticket["path"]}).status_code == 200
    assert ticket["path"] not in store.files

    sent = _upload(alice, store, conv["id"])
    _send_file(alice, conv["id"], sent)
    assert alice.post(url, json={"path": sent["path"]}).status_code == 409
    assert sent["path"] in store.files


def test_deleting_an_empty_group_removes_its_files(alice, bob, store):
    group = alice.post("/api/v1/messenger/conversations", json={"member_ids": [BOB, CARA]}).json()
    ticket = _upload(alice, store, group["id"])
    _send_file(alice, group["id"], ticket)
    url = f"/api/v1/messenger/conversations/{group['id']}/leave"
    alice.post(url)
    bob.post(url)
    assert ticket["path"] in store.files
    _client_for(CARA, "cara@example.com").post(url)
    assert ticket["path"] not in store.files


class _StorageCalls:
    """Records Storage REST calls and replies with canned responses."""

    def __init__(self, replies):
        self.replies = list(replies)
        self.calls = []

    def __call__(self, method, url, **kwargs):
        self.calls.append((method, url, kwargs.get("json")))
        status_code, payload = self.replies.pop(0)
        return httpx.Response(status_code, json=payload, request=httpx.Request(method, url))


def _file_store(monkeypatch, replies):
    calls = _StorageCalls(replies)
    monkeypatch.setattr(messenger_repository.settings, "supabase_url", "https://proj.supabase.co/")
    monkeypatch.setattr(messenger_repository.httpx, "request", calls)
    return messenger_repository.MessengerFileStore(), calls


def test_file_store_builds_upload_and_download_links(monkeypatch):
    files, calls = _file_store(
        monkeypatch,
        [
            (200, {"url": "/object/upload/sign/team-chat-files/c/u/f.pdf?token=abc"}),
            (200, {"signedURL": "/object/sign/team-chat-files/c/u/f.pdf?token=xyz"}),
        ],
    )
    assert files.create_upload_url("c/u/f.pdf") == (
        "https://proj.supabase.co/storage/v1/object/upload/sign/team-chat-files/c/u/f.pdf?token=abc"
    )
    assert files.create_download_url("c/u/f.pdf", expires_in=300, download_name="Q3 report.pdf") == (
        "https://proj.supabase.co/storage/v1/object/sign/team-chat-files/c/u/f.pdf?token=xyz"
        "&download=Q3%20report.pdf"
    )
    assert calls.calls[0][:2] == (
        "POST", "https://proj.supabase.co/storage/v1/object/upload/sign/team-chat-files/c/u/f.pdf"
    )
    assert calls.calls[1][2] == {"expiresIn": 300}


def test_file_store_stat_finds_the_exact_object(monkeypatch):
    files, calls = _file_store(
        monkeypatch,
        [
            (200, [
                {"name": "abc.pdf.old", "id": "1", "metadata": {"size": 1, "mimetype": "x/y"}},
                {"name": "abc.pdf", "id": "2", "metadata": {"size": 42, "mimetype": "application/pdf"}},
            ]),
            (200, []),
        ],
    )
    assert files.stat("c/u/abc.pdf") == {"size": 42, "mime_type": "application/pdf"}
    assert calls.calls[0][2]["prefix"] == "c/u" and calls.calls[0][2]["search"] == "abc.pdf"
    assert files.stat("c/u/missing.pdf") is None


def test_file_store_reports_missing_bucket_as_setup_error(monkeypatch):
    files, _ = _file_store(
        monkeypatch, [(400, {"statusCode": "404", "error": "Bucket not found", "message": "Bucket not found"})]
    )
    with pytest.raises(MessengerStorageError) as excinfo:
        files.create_upload_url("c/u/f.pdf")
    assert excinfo.value.missing_tables is True
    assert "create_messenger_chat.sql" in str(excinfo.value)


def test_file_store_remove_never_raises(monkeypatch):
    files, calls = _file_store(monkeypatch, [(500, {"message": "boom"})])
    files.remove(["c/u/f.pdf"])
    assert calls.calls[0][0] == "DELETE" and calls.calls[0][2] == {"prefixes": ["c/u/f.pdf"]}


def test_file_names_are_cleaned():
    assert clean_file_name("C:\\Users\\me\\Desktop\\label.pdf") == "label.pdf"
    assert clean_file_name("../../etc/passwd") == "passwd"
    assert clean_file_name("bad\x00name\n.txt") == "badname.txt"
    assert clean_file_name("   ") == "file"
    long_name = clean_file_name("a" * 300 + ".xlsx")
    assert len(long_name) == 255 and long_name.endswith(".xlsx")


# ---------------------------------------------------------------------------
# Setup errors and audit rules
# ---------------------------------------------------------------------------


def test_missing_tables_return_setup_hint(alice, store):
    store.fail_with = MessengerStorageError(MIGRATION_HINT, missing_tables=True)
    response = alice.get("/api/v1/messenger/conversations")
    assert response.status_code == 503
    assert "create_messenger_chat.sql" in response.json()["detail"]


def test_audit_skips_message_traffic_but_records_actions():
    cid = str(uuid.uuid4())
    assert should_audit("POST", f"/api/v1/messenger/conversations/{cid}/messages") is False
    assert should_audit("POST", f"/api/v1/messenger/conversations/{cid}/read") is False
    assert should_audit("POST", f"/api/v1/messenger/conversations/{cid}/attachments") is False
    assert should_audit("POST", f"/api/v1/messenger/conversations/{cid}/attachments/discard") is False
    assert describe("POST", "/api/v1/messenger/conversations").action == "team_chat.conversation_create"
    assert describe("POST", f"/api/v1/messenger/conversations/{cid}/leave").action == "team_chat.leave"
    assert describe("DELETE", f"/api/v1/messenger/messages/{cid}").action == "team_chat.unsend"
