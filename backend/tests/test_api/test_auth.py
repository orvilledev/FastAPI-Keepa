"""Tests for authentication API endpoints."""
import pytest
from unittest.mock import patch, MagicMock


class TestAuthEndpoints:
    """Test authentication endpoints."""

    @pytest.mark.unit
    def test_health_check(self, client):
        """Test 1: Health check endpoint should return 200 OK."""
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json() == {"status": "healthy"}

    @pytest.mark.unit
    @patch("app.dependencies.get_current_user")
    @patch("app.database.get_supabase")
    def test_get_current_user_authenticated(
        self, mock_db, mock_get_user, client, mock_current_user
    ):
        """Test 2: Authenticated user can retrieve their profile."""
        # Setup mocks
        mock_get_user.return_value = mock_current_user

        mock_supabase = MagicMock()
        mock_supabase.table.return_value.select.return_value.eq.return_value.execute.return_value = MagicMock(
            data=[{
                "role": "user",
                "display_name": "Test User",
                "has_keepa_access": True,
                "can_manage_tools": False,
                "can_assign_tasks": False
            }]
        )
        mock_db.return_value = mock_supabase

        # Make request
        response = client.get(
            "/api/v1/auth/me",
            headers={"Authorization": "Bearer test-token"}
        )

        # Assertions
        assert response.status_code == 200
        data = response.json()
        assert data["email"] == "test@example.com"
        assert data["role"] == "user"
        assert "id" in data

    @pytest.mark.unit
    def test_get_current_user_unauthenticated(self, client):
        """Test 3: Unauthenticated request should return 401."""
        response = client.get("/api/v1/auth/me")
        assert response.status_code == 401
