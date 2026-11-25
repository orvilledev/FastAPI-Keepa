"""LTL Label Format Checker is open to signed-in users except Hello@warehouserepublic."""


def test_ltl_label_format_checker_blocks_hello_only(monkeypatch):
    monkeypatch.setattr("app.dependencies.is_superadmin_user", lambda user, db: False)
    from app.dependencies import is_ltl_label_format_checker_allowed_user

    db = object()
    assert is_ltl_label_format_checker_allowed_user({"email": "sunshine@metroshoewarehouse.com"}, db) is True
    assert is_ltl_label_format_checker_allowed_user({"email": "Stephanie@MetroShoeWarehouse.com"}, db) is True
    assert is_ltl_label_format_checker_allowed_user({"email": "paolo@metroshoewarehouse.com"}, db) is True
    assert is_ltl_label_format_checker_allowed_user({"email": "cameron@pmshoesinc.com"}, db) is True
    assert is_ltl_label_format_checker_allowed_user({"email": "warehouse1@metroshoewarehouse.com"}, db) is True
    assert is_ltl_label_format_checker_allowed_user({"email": "hello@warehouserepublic.com"}, db) is False
    assert is_ltl_label_format_checker_allowed_user({"email": ""}, db) is False


def test_ltl_label_format_checker_includes_superadmin(monkeypatch):
    monkeypatch.setattr("app.dependencies.is_superadmin_user", lambda user, db: True)
    from app.dependencies import is_ltl_label_format_checker_allowed_user

    assert is_ltl_label_format_checker_allowed_user({"email": "anyone@example.com"}, object()) is True


def test_ltl_label_format_checker_blocks_hello_even_if_superadmin(monkeypatch):
    monkeypatch.setattr("app.dependencies.is_superadmin_user", lambda user, db: True)
    from app.dependencies import is_ltl_label_format_checker_allowed_user

    assert (
        is_ltl_label_format_checker_allowed_user(
            {"email": "hello@warehouserepublic.com"}, object()
        )
        is False
    )
