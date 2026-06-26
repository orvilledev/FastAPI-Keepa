from app.utils.micro_tool_download import is_work_sheet_template_tool, resolve_download_url


def test_resolve_google_sheet_export_url():
    url = "https://docs.google.com/spreadsheets/d/abc123/edit#gid=0"
    assert resolve_download_url(url) == (
        "https://docs.google.com/spreadsheets/d/abc123/export?format=xlsx"
    )


def test_resolve_google_drive_download_url():
    url = "https://drive.google.com/file/d/abc123/view?usp=sharing"
    assert resolve_download_url(url) == (
        "https://drive.google.com/uc?export=download&id=abc123"
    )


def test_is_work_sheet_template_tool_by_name():
    assert is_work_sheet_template_tool({"name": "NFA Shipment Work Sheet", "tags": []})


def test_is_work_sheet_template_tool_by_tag():
    assert is_work_sheet_template_tool({"name": "Custom Sheet", "tags": ["work-sheet-template"]})
