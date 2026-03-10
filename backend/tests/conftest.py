"""Test configuration and fixtures."""
import pytest
from typing import Generator
from fastapi.testclient import TestClient
from app.main import app
from unittest.mock import MagicMock, patch


@pytest.fixture
def client() -> Generator:
    """Create a test client for the FastAPI app."""
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def mock_supabase():
    """Mock Supabase client for testing."""
    mock_client = MagicMock()

    # Mock common Supabase operations
    mock_client.table.return_value = mock_client
    mock_client.select.return_value = mock_client
    mock_client.insert.return_value = mock_client
    mock_client.update.return_value = mock_client
    mock_client.delete.return_value = mock_client
    mock_client.eq.return_value = mock_client
    mock_client.execute.return_value = MagicMock(data=[])

    return mock_client


@pytest.fixture
def mock_current_user():
    """Mock authenticated user for testing."""
    return {
        "id": "test-user-id-123",
        "email": "test@example.com",
        "role": "user",
        "user_metadata": {},
    }


@pytest.fixture
def mock_superadmin_user():
    """Mock superadmin user for testing."""
    return {
        "id": "admin-user-id-456",
        "email": "admin@example.com",
        "role": "superadmin",
        "user_metadata": {},
    }


@pytest.fixture
def auth_headers():
    """Generate mock authentication headers."""
    return {
        "Authorization": "Bearer mock-jwt-token-for-testing"
    }


@pytest.fixture
def mock_keepa_api():
    """Mock Keepa API client."""
    with patch("app.services.keepa_client.KeepaClient") as mock:
        mock_instance = MagicMock()
        mock_instance.get_product_info.return_value = {
            "products": [{"asin": "B00TEST123"}]
        }
        mock.return_value = mock_instance
        yield mock_instance
