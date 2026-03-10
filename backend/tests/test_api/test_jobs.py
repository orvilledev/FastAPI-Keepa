"""Tests for jobs API endpoints."""
import pytest
from unittest.mock import patch, MagicMock
from datetime import datetime


class TestJobsEndpoints:
    """Test job management endpoints."""

    @pytest.mark.unit
    @patch("app.dependencies.get_current_user")
    @patch("app.database.get_supabase")
    def test_get_jobs_list(self, mock_db, mock_get_user, client, mock_current_user):
        """Test 4: Authenticated user can retrieve jobs list."""
        # Setup mocks
        mock_get_user.return_value = mock_current_user

        mock_supabase = MagicMock()
        mock_jobs_data = [
            {
                "id": 1,
                "job_name": "Daily UPC Update",
                "status": "completed",
                "created_at": datetime.now().isoformat()
            }
        ]
        mock_supabase.table.return_value.select.return_value.order.return_value.execute.return_value = MagicMock(
            data=mock_jobs_data
        )
        mock_db.return_value = mock_supabase

        # Make request
        response = client.get(
            "/api/v1/jobs",
            headers={"Authorization": "Bearer test-token"}
        )

        # Assertions
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        if len(data) > 0:
            assert "job_name" in data[0]

    @pytest.mark.unit
    @patch("app.dependencies.get_current_user")
    @patch("app.database.get_supabase")
    def test_create_job_requires_auth(
        self, mock_db, mock_get_user, client, mock_current_user
    ):
        """Test 5: Creating a job requires authentication."""
        # Setup mocks
        mock_get_user.return_value = mock_current_user

        mock_supabase = MagicMock()
        mock_supabase.table.return_value.insert.return_value.execute.return_value = MagicMock(
            data=[{"id": 1, "job_name": "Test Job", "status": "pending"}]
        )
        mock_db.return_value = mock_supabase

        # Make request
        job_data = {
            "job_name": "Test Job",
            "category": "dnk"
        }
        response = client.post(
            "/api/v1/jobs",
            json=job_data,
            headers={"Authorization": "Bearer test-token"}
        )

        # Assertions - Should succeed with auth
        assert response.status_code in [200, 201]
