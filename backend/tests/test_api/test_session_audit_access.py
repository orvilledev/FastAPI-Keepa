"""Live App Sessions and Audit Log are limited to superadmin, Stephanie, and Sunshine."""

from app.dependencies import is_session_audit_allowed_user


def test_session_audit_allowlist_is_stephanie_and_sunshine(monkeypatch):
    monkeypatch.setattr("app.dependencies.is_superadmin_user", lambda user, db: False)

    assert is_session_audit_allowed_user({"email": "stephanie@metroshoewarehouse.com"}, object())
    assert is_session_audit_allowed_user({"email": " Sunshine@MetroShoeWarehouse.com "}, object())
    assert not is_session_audit_allowed_user({"email": "paolo@metroshoewarehouse.com"}, object())
    assert not is_session_audit_allowed_user({"email": "warehouse1@metroshoewarehouse.com"}, object())
    assert not is_session_audit_allowed_user({"email": ""}, object())


def test_session_audit_allowlist_includes_superadmin(monkeypatch):
    monkeypatch.setattr("app.dependencies.is_superadmin_user", lambda user, db: True)

    assert is_session_audit_allowed_user({"email": "someone-else@example.com"}, object())
