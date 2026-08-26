"""Tests for email group member normalization helpers."""

import pytest
from fastapi import HTTPException

from app.utils.email_group_members import (
    members_from_create_payload,
    normalize_group_members,
    split_members_to_bcc,
)


class TestNormalizeGroupMembers:
    @pytest.mark.unit
    def test_legacy_flat_strings_become_to(self):
        result = normalize_group_members(["a@x.com", "b@x.com"])
        assert result == [
            {"email": "a@x.com", "role": "to"},
            {"email": "b@x.com", "role": "to"},
        ]

    @pytest.mark.unit
    def test_objects_with_roles_and_bcc_wins_on_duplicate(self):
        result = normalize_group_members(
            [
                {"email": "A@X.com", "role": "to"},
                {"email": "a@x.com", "role": "bcc"},
                {"email": "c@x.com", "role": "bcc"},
            ]
        )
        assert result == [
            {"email": "a@x.com", "role": "bcc"},
            {"email": "c@x.com", "role": "bcc"},
        ]

    @pytest.mark.unit
    def test_validate_email_skips_invalid(self):
        def validate(email: str) -> str:
            if "@" not in email:
                raise HTTPException(status_code=400, detail="bad")
            return email.strip().lower()

        result = normalize_group_members(
            ["good@x.com", "not-an-email", {"email": "also@x.com", "role": "bcc"}],
            validate_email=validate,
        )
        assert result == [
            {"email": "good@x.com", "role": "to"},
            {"email": "also@x.com", "role": "bcc"},
        ]

    @pytest.mark.unit
    def test_members_from_create_prefers_members_over_emails(self):
        result = members_from_create_payload(
            [{"email": "a@x.com", "role": "bcc"}],
            ["b@x.com"],
        )
        assert result == [{"email": "a@x.com", "role": "bcc"}]

    @pytest.mark.unit
    def test_members_from_create_falls_back_to_emails(self):
        result = members_from_create_payload([], ["b@x.com"])
        assert result == [{"email": "b@x.com", "role": "to"}]

    @pytest.mark.unit
    def test_split_members_to_bcc(self):
        to_list, bcc_list = split_members_to_bcc(
            [
                {"email": "a@x.com", "role": "to"},
                {"email": "b@x.com", "role": "bcc"},
            ]
        )
        assert to_list == ["a@x.com"]
        assert bcc_list == ["b@x.com"]
