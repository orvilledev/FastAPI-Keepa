from app.utils.user_display_name import (
    format_stored_creator_name,
    profile_display_name,
    resolve_user_display_name,
)


def test_resolve_prefers_display_name():
    assert resolve_user_display_name(display_name="Orville", email="orville@example.com") == "Orville"


def test_resolve_title_cases_email_local_part():
    assert (
        resolve_user_display_name(email="stephanie@metroshoewarehouse.com")
        == "Stephanie"
    )


def test_resolve_handles_dotted_email_local_part():
    assert resolve_user_display_name(email="john.doe@example.com") == "John Doe"


def test_profile_display_name_from_metadata():
    profile = {"email": "stephanie@metroshoewarehouse.com"}
    user = {"email": "stephanie@metroshoewarehouse.com", "user_metadata": {}}
    assert profile_display_name(profile, user) == "Stephanie"


def test_format_stored_creator_name_leaves_plain_names():
    assert format_stored_creator_name("Orville") == "Orville"


def test_format_stored_creator_name_converts_email():
    assert (
        format_stored_creator_name("stephanie@metroshoewarehouse.com")
        == "Stephanie"
    )


def test_format_stored_creator_name_preserves_scheduled_run():
    assert format_stored_creator_name("Scheduled run") == "Scheduled run"
