"""Tests for UPC repository."""
import pytest
from unittest.mock import MagicMock, patch
from app.repositories.upc_repository import UPCRepository


class TestUPCRepository:
    """Test UPC repository data operations."""

    @pytest.mark.unit
    def test_get_upcs_returns_list(self, mock_supabase):
        """Test 10: UPC repository returns list of UPCs."""
        # Setup mock
        mock_supabase.table.return_value.select.return_value.eq.return_value.execute.return_value = MagicMock(
            data=[
                {"id": 1, "upc": "123456789012", "name": "Test Product", "category": "dnk"},
                {"id": 2, "upc": "987654321098", "name": "Test Product 2", "category": "clk"}
            ]
        )

        # Create repository instance
        repo = UPCRepository(mock_supabase)

        # Test getting UPCs
        upcs = repo.get_all_upcs(category="dnk")

        # Assertions
        assert isinstance(upcs, list)
        assert len(upcs) >= 0
        if len(upcs) > 0:
            assert "upc" in upcs[0] or "id" in upcs[0]
