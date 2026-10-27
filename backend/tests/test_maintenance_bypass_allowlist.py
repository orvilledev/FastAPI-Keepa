"""Maintenance bypass allowlist: env emails and the database list."""
from app.config import settings
from app.services.maintenance_bypass_allowlist import (
    is_maintenance_bypass_allowed,
    list_maintenance_bypass_emails,
    normalize_email_list,
)


class _Result:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, rows):
        self._rows = rows

    def select(self, *_args, **_kwargs):
        return self

    def execute(self):
        return _Result(self._rows)


class _Db:
    def __init__(self, rows):
        self._rows = rows

    def table(self, name):
        assert name == "maintenance_bypass_allowlist"
        return _Query(self._rows)


def test_normalize_email_list_dedupes_and_sorts():
    assert normalize_email_list(
        ["  B@Example.com ", "a@example.com", "b@example.com", "not-an-email", ""]
    ) == ["a@example.com", "b@example.com"]


def test_database_email_is_allowed(monkeypatch):
    monkeypatch.setattr(settings, "maintenance_allowlist_emails", "")
    db = _Db([{"email": "Floor@MetroShoeWarehouse.com"}])
    assert list_maintenance_bypass_emails(db) == ["floor@metroshoewarehouse.com"]
    assert is_maintenance_bypass_allowed(db, "floor@metroshoewarehouse.com") is True
    assert is_maintenance_bypass_allowed(db, "other@example.com") is False


def test_env_email_is_allowed_when_table_is_empty(monkeypatch):
    monkeypatch.setattr(settings, "maintenance_allowlist_emails", "Ops@Example.com")
    db = _Db([])
    assert is_maintenance_bypass_allowed(db, "ops@example.com") is True


def test_missing_table_denies_non_env_email(monkeypatch):
    monkeypatch.setattr(settings, "maintenance_allowlist_emails", "")

    class _Broken:
        def table(self, _name):
            raise RuntimeError("relation does not exist")

    assert is_maintenance_bypass_allowed(_Broken(), "ops@example.com") is False
