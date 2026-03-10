"""Tests for tasks API endpoints."""
import pytest
from unittest.mock import patch, MagicMock
from datetime import datetime


class TestTasksEndpoints:
    """Test task management endpoints."""

    @pytest.mark.unit
    @patch("app.dependencies.get_current_user")
    @patch("app.database.get_supabase")
    def test_get_tasks_list(self, mock_db, mock_get_user, client, mock_current_user):
        """Test 6: Authenticated user can retrieve tasks list."""
        # Setup mocks
        mock_get_user.return_value = mock_current_user

        mock_supabase = MagicMock()
        mock_tasks_data = [
            {
                "id": 1,
                "title": "Test Task",
                "description": "Test description",
                "status": "pending",
                "created_at": datetime.now().isoformat()
            }
        ]
        mock_supabase.table.return_value.select.return_value.order.return_value.execute.return_value = MagicMock(
            data=mock_tasks_data
        )
        mock_db.return_value = mock_supabase

        # Make request
        response = client.get(
            "/api/v1/tasks",
            headers={"Authorization": "Bearer test-token"}
        )

        # Assertions
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)

    @pytest.mark.unit
    @patch("app.dependencies.get_current_user")
    @patch("app.database.get_supabase")
    def test_create_task_validation(
        self, mock_db, mock_get_user, client, mock_current_user
    ):
        """Test 7: Task creation validates required fields."""
        # Setup mocks
        mock_get_user.return_value = mock_current_user

        # Make request with invalid data (missing required fields)
        invalid_task_data = {}
        response = client.post(
            "/api/v1/tasks",
            json=invalid_task_data,
            headers={"Authorization": "Bearer test-token"}
        )

        # Assertions - Should fail validation
        assert response.status_code == 422  # Unprocessable Entity
