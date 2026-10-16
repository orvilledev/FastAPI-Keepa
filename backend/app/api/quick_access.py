"""Quick Access Links API endpoints."""
from datetime import datetime, timezone
from typing import Dict, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from supabase import Client

from app.database import get_supabase
from app.dependencies import get_current_user
from app.models.quick_access import (
    QuickAccessGroupCreate,
    QuickAccessGroupResponse,
    QuickAccessGroupUpdate,
    QuickAccessLinkCreate,
    QuickAccessLinkResponse,
    QuickAccessLinkUpdate,
    QuickAccessPerson,
    QuickAccessShareUpdate,
)
from app.utils.error_handler import handle_api_errors
from app.utils.user_display_name import resolve_user_display_name

router = APIRouter()

_MIGRATION_HINT = (
    "Run backend/database/migrations/create_quick_access_groups.sql "
    "in the Supabase SQL Editor."
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _missing_schema(exc: Exception) -> bool:
    text = str(exc).lower()
    return (
        "quick_access_group" in text
        or ("group_id" in text and ("does not exist" in text or "schema cache" in text))
    )


def _schema_error() -> HTTPException:
    return HTTPException(
        status_code=503,
        detail=f"Link categories are not set up yet. {_MIGRATION_HINT}",
    )


def _profile_name(row: Optional[dict]) -> Optional[str]:
    if not row:
        return None
    return resolve_user_display_name(
        display_name=row.get("display_name"),
        email=row.get("email"),
    )


def _load_profiles(db: Client, user_ids: List[str]) -> Dict[str, dict]:
    ids = [item for item in dict.fromkeys(user_ids) if item]
    if not ids:
        return {}
    response = db.table("profiles").select("id, email, display_name").in_("id", ids).execute()
    return {row["id"]: row for row in (response.data or []) if row.get("id")}


def _group_or_404(db: Client, group_id: str, user_id: str) -> tuple[dict, bool]:
    response = db.table("quick_access_groups").select("*").eq("id", group_id).limit(1).execute()
    if not response.data:
        raise HTTPException(status_code=404, detail="Category not found")
    group = response.data[0]
    if group["owner_id"] == user_id:
        return group, True
    share = (
        db.table("quick_access_group_shares")
        .select("user_id")
        .eq("group_id", group_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    if not share.data:
        raise HTTPException(status_code=404, detail="Category not found")
    return group, False


def _link_response(row: dict, profile: Optional[dict], can_edit: bool) -> QuickAccessLinkResponse:
    payload = dict(row)
    payload["added_by_email"] = (profile or {}).get("email")
    payload["added_by_name"] = _profile_name(profile)
    payload["can_edit"] = can_edit
    return QuickAccessLinkResponse(**payload)


def _find_profiles_by_email(db: Client, emails: List[str]) -> Dict[str, dict]:
    found: Dict[str, dict] = {}
    for email in emails:
        response = (
            db.table("profiles")
            .select("id, email, display_name")
            .ilike("email", email)
            .limit(1)
            .execute()
        )
        row = (response.data or [None])[0]
        if row and (row.get("email") or "").strip().lower() == email:
            found[email] = row
    return found


@router.get("/quick-access", response_model=List[QuickAccessLinkResponse])
@handle_api_errors("get quick access links")
def get_quick_access_links(
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase),
):
    """Personal links only. Shared category links come from /quick-access/groups."""
    query = (
        db.table("quick_access_links")
        .select("*")
        .eq("user_id", current_user["id"])
        .order("display_order", desc=False)
        .order("created_at", desc=False)
    )
    try:
        response = query.is_("group_id", "null").execute()
    except Exception as exc:
        if not _missing_schema(exc):
            raise
        response = (
            db.table("quick_access_links")
            .select("*")
            .eq("user_id", current_user["id"])
            .order("display_order", desc=False)
            .order("created_at", desc=False)
            .execute()
        )
    return [QuickAccessLinkResponse(**link) for link in (response.data or [])]


@router.get("/quick-access/people", response_model=List[QuickAccessPerson])
@handle_api_errors("search registered people")
def search_registered_people(
    q: str = Query(default=""),
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase),
):
    """Registered accounts only. Used to share a link category."""
    term = q.strip().lower()
    query = db.table("profiles").select("id, email, display_name").order("email")
    if term:
        safe = term.replace("%", "").replace(",", " ")
        query = query.or_(f"email.ilike.%{safe}%,display_name.ilike.%{safe}%")
    response = query.limit(25).execute()
    people: List[QuickAccessPerson] = []
    for row in response.data or []:
        email = (row.get("email") or "").strip()
        if not email or row.get("id") == current_user["id"]:
            continue
        people.append(
            QuickAccessPerson(
                id=row["id"],
                email=email,
                display_name=_profile_name(row),
            )
        )
    return people


@router.get("/quick-access/groups", response_model=List[QuickAccessGroupResponse])
@handle_api_errors("list link categories")
def list_link_groups(
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase),
):
    user_id = current_user["id"]
    try:
        owned = (
            db.table("quick_access_groups")
            .select("*")
            .eq("owner_id", user_id)
            .order("created_at")
            .execute()
        )
        shares = (
            db.table("quick_access_group_shares")
            .select("group_id")
            .eq("user_id", user_id)
            .execute()
        )
    except Exception as exc:
        if _missing_schema(exc):
            raise _schema_error() from exc
        raise

    groups = list(owned.data or [])
    shared_ids = [row["group_id"] for row in (shares.data or []) if row.get("group_id")]
    if shared_ids:
        extra = db.table("quick_access_groups").select("*").in_("id", shared_ids).execute()
        known = {row["id"] for row in groups}
        groups.extend(row for row in (extra.data or []) if row["id"] not in known)

    if not groups:
        return []

    group_ids = [row["id"] for row in groups]
    member_rows = (
        db.table("quick_access_group_shares")
        .select("group_id, user_id")
        .in_("group_id", group_ids)
        .execute()
    )
    link_rows = (
        db.table("quick_access_links")
        .select("*")
        .in_("group_id", group_ids)
        .order("created_at")
        .execute()
    )
    profile_ids = [row["owner_id"] for row in groups]
    profile_ids.extend(row["user_id"] for row in (member_rows.data or []))
    profile_ids.extend(row["user_id"] for row in (link_rows.data or []))
    profiles = _load_profiles(db, profile_ids)

    members_by_group: Dict[str, list] = {}
    for row in member_rows.data or []:
        profile = profiles.get(row["user_id"]) or {}
        email = (profile.get("email") or "").strip()
        if not email:
            continue
        members_by_group.setdefault(row["group_id"], []).append(
            {
                "user_id": row["user_id"],
                "email": email,
                "display_name": _profile_name(profile),
            }
        )

    links_by_group: Dict[str, list] = {}
    for row in link_rows.data or []:
        is_owner = next((group["owner_id"] == user_id for group in groups if group["id"] == row["group_id"]), False)
        can_edit = is_owner or row["user_id"] == user_id
        links_by_group.setdefault(row["group_id"], []).append(
            _link_response(row, profiles.get(row["user_id"]), can_edit)
        )

    result: List[QuickAccessGroupResponse] = []
    for group in groups:
        owner = profiles.get(group["owner_id"]) or {}
        result.append(
            QuickAccessGroupResponse(
                id=group["id"],
                title=group["title"],
                owner_id=group["owner_id"],
                owner_email=(owner.get("email") or "").strip(),
                owner_name=_profile_name(owner),
                is_owner=group["owner_id"] == user_id,
                members=members_by_group.get(group["id"], []),
                links=links_by_group.get(group["id"], []),
            )
        )
    result.sort(key=lambda item: (not item.is_owner, item.title.lower()))
    return result


@router.post("/quick-access/groups", response_model=QuickAccessGroupResponse, status_code=201)
@handle_api_errors("create link category")
def create_link_group(
    payload: QuickAccessGroupCreate,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase),
):
    title = payload.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Category title is required.")
    try:
        response = (
            db.table("quick_access_groups")
            .insert({"owner_id": current_user["id"], "title": title, "updated_at": _now()})
            .execute()
        )
    except Exception as exc:
        if _missing_schema(exc):
            raise _schema_error() from exc
        raise
    if not response.data:
        raise HTTPException(status_code=500, detail="Failed to create category")
    group = response.data[0]
    profile = _load_profiles(db, [current_user["id"]]).get(current_user["id"]) or {}
    return QuickAccessGroupResponse(
        id=group["id"],
        title=group["title"],
        owner_id=group["owner_id"],
        owner_email=(profile.get("email") or current_user.get("email") or "").strip(),
        owner_name=_profile_name(profile) or _profile_name({"email": current_user.get("email")}),
        is_owner=True,
        members=[],
        links=[],
    )


@router.patch("/quick-access/groups/{group_id}", response_model=QuickAccessGroupResponse)
@handle_api_errors("rename link category")
def rename_link_group(
    group_id: UUID,
    payload: QuickAccessGroupUpdate,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase),
):
    _, is_owner = _group_or_404(db, str(group_id), current_user["id"])
    if not is_owner:
        raise HTTPException(status_code=403, detail="Only the category owner can rename it.")
    title = payload.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Category title is required.")
    db.table("quick_access_groups").update({"title": title, "updated_at": _now()}).eq("id", str(group_id)).execute()
    groups = list_link_groups(current_user=current_user, db=db)
    match = next((item for item in groups if str(item.id) == str(group_id)), None)
    if not match:
        raise HTTPException(status_code=500, detail="Failed to rename category")
    return match


@router.put("/quick-access/groups/{group_id}/shares", response_model=QuickAccessGroupResponse)
@handle_api_errors("share link category")
def share_link_group(
    group_id: UUID,
    payload: QuickAccessShareUpdate,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase),
):
    _, is_owner = _group_or_404(db, str(group_id), current_user["id"])
    if not is_owner:
        raise HTTPException(status_code=403, detail="Only the category owner can share it.")

    emails: List[str] = []
    for raw in payload.emails:
        email = (raw or "").strip().lower()
        if email and email not in emails:
            emails.append(email)
    own_email = (current_user.get("email") or "").strip().lower()
    emails = [email for email in emails if email != own_email]
    if len(emails) > 40:
        raise HTTPException(status_code=400, detail="Share a category with at most 40 people.")

    found = _find_profiles_by_email(db, emails)
    missing = [email for email in emails if email not in found]
    if missing:
        raise HTTPException(
            status_code=400,
            detail="Only registered accounts can be chosen: " + ", ".join(missing),
        )

    db.table("quick_access_group_shares").delete().eq("group_id", str(group_id)).execute()
    if found:
        db.table("quick_access_group_shares").insert(
            [{"group_id": str(group_id), "user_id": row["id"]} for row in found.values()]
        ).execute()

    groups = list_link_groups(current_user=current_user, db=db)
    match = next((item for item in groups if str(item.id) == str(group_id)), None)
    if not match:
        raise HTTPException(status_code=500, detail="Failed to update sharing")
    return match


@router.delete("/quick-access/groups/{group_id}")
@handle_api_errors("delete link category")
def delete_link_group(
    group_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase),
):
    _, is_owner = _group_or_404(db, str(group_id), current_user["id"])
    if not is_owner:
        raise HTTPException(status_code=403, detail="Only the category owner can delete it.")
    response = db.table("quick_access_groups").delete().eq("id", str(group_id)).eq("owner_id", current_user["id"]).execute()
    if not response.data:
        raise HTTPException(status_code=404, detail="Category not found")
    return {"message": "Category deleted"}


@router.post("/quick-access", response_model=QuickAccessLinkResponse, status_code=201)
@handle_api_errors("create quick access link")
def create_quick_access_link(
    link_data: QuickAccessLinkCreate,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase),
):
    """Create a personal link, or contribute a link to a shared category."""
    link_dict = link_data.model_dump()
    group_id = link_dict.get("group_id")
    can_edit = True
    if group_id:
        _group_or_404(db, str(group_id), current_user["id"])
        link_dict["group_id"] = str(group_id)
    else:
        link_dict.pop("group_id", None)
    link_dict["user_id"] = current_user["id"]

    try:
        response = db.table("quick_access_links").insert(link_dict).execute()
    except Exception as exc:
        if _missing_schema(exc) and group_id:
            raise _schema_error() from exc
        text = str(exc).lower()
        if "duplicate" in text or "unique" in text:
            raise HTTPException(status_code=409, detail="That URL is already in this list.") from exc
        raise

    if not response.data:
        raise HTTPException(status_code=500, detail="Failed to create quick access link")
    profile = _load_profiles(db, [current_user["id"]]).get(current_user["id"])
    return _link_response(response.data[0], profile, can_edit)


@router.put("/quick-access/{link_id}", response_model=QuickAccessLinkResponse)
@handle_api_errors("update quick access link")
def update_quick_access_link(
    link_id: UUID,
    link_data: QuickAccessLinkUpdate,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase),
):
    """Update a personal link, or a category link you added or own."""
    existing = db.table("quick_access_links").select("*").eq("id", str(link_id)).limit(1).execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Quick access link not found")
    row = existing.data[0]
    user_id = current_user["id"]
    group_id = row.get("group_id")
    if group_id:
        _, is_owner = _group_or_404(db, group_id, user_id)
        if not is_owner and row["user_id"] != user_id:
            raise HTTPException(status_code=403, detail="You can only edit links you added.")
    elif row["user_id"] != user_id:
        raise HTTPException(status_code=404, detail="Quick access link not found")

    update_data = {
        k: v
        for k, v in link_data.model_dump().items()
        if v is not None and k not in {"group_id", "place_in_group"}
    }
    if link_data.place_in_group:
        target = link_data.group_id
        if target:
            _group_or_404(db, str(target), user_id)
        elif row["user_id"] != user_id:
            raise HTTPException(status_code=403, detail="Only the person who added a link can make it personal.")
        update_data["group_id"] = str(target) if target else None
    update_data["updated_at"] = _now()
    try:
        response = db.table("quick_access_links").update(update_data).eq("id", str(link_id)).execute()
    except Exception as exc:
        text = str(exc).lower()
        if "duplicate" in text or "unique" in text:
            raise HTTPException(status_code=409, detail="That URL is already in this list.") from exc
        raise
    if not response.data:
        raise HTTPException(status_code=500, detail="Failed to update quick access link")
    saved = response.data[0]
    profile = _load_profiles(db, [saved["user_id"]]).get(saved["user_id"])
    can_edit = True
    return _link_response(saved, profile, can_edit)


@router.delete("/quick-access/{link_id}")
@handle_api_errors("delete quick access link")
def delete_quick_access_link(
    link_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase),
):
    """Delete a personal link, or a category link you added or own."""
    existing = db.table("quick_access_links").select("*").eq("id", str(link_id)).limit(1).execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Quick access link not found")
    row = existing.data[0]
    user_id = current_user["id"]
    group_id = row.get("group_id")
    if group_id:
        _, is_owner = _group_or_404(db, group_id, user_id)
        if not is_owner and row["user_id"] != user_id:
            raise HTTPException(status_code=403, detail="You can only remove links you added.")
    elif row["user_id"] != user_id:
        raise HTTPException(status_code=404, detail="Quick access link not found")

    response = db.table("quick_access_links").delete().eq("id", str(link_id)).execute()
    if not response.data:
        raise HTTPException(status_code=404, detail="Quick access link not found")
    return {"message": "Quick access link deleted successfully"}
