#!/usr/bin/env python3
"""
Script to verify the database schema, specifically checking the upcs table
and category column configuration.
"""
import sys
from pathlib import Path

# Add backend directory to path so we can import app modules
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

from app.database import get_supabase
from app.config import settings
import logging

logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger(__name__)


def check_table_exists(db, table_name: str) -> bool:
    """Check if a table exists by trying to query it."""
    try:
        # Try to get a count (limit 0 to avoid fetching data)
        result = db.table(table_name).select("id", count="exact").limit(0).execute()
        return True
    except Exception as e:
        logger.error(f"Table {table_name} does not exist or is not accessible: {e}")
        return False


def check_category_column(db) -> dict:
    """Check if category column exists and get sample data."""
    results = {
        "column_exists": False,
        "has_data": False,
        "sample_records": [],
        "category_distribution": {},
        "issues": []
    }
    
    try:
        # Try to select category column
        result = db.table("upcs").select("id, upc, category, created_at").limit(10).execute()
        
        if result.data:
            results["column_exists"] = True
            results["has_data"] = True
            results["sample_records"] = result.data
            
            # Count categories
            all_upcs = db.table("upcs").select("category").execute()
            for record in all_upcs.data:
                cat = record.get("category", "NULL")
                results["category_distribution"][cat] = results["category_distribution"].get(cat, 0) + 1
            
            # Check for records with NULL or missing category
            null_category = [r for r in all_upcs.data if not r.get("category")]
            if null_category:
                results["issues"].append(f"Found {len(null_category)} records with NULL or missing category")
            
            # Check for records with invalid category values
            invalid_categories = [r for r in all_upcs.data if r.get("category") not in ["dnk", "clk", None]]
            if invalid_categories:
                invalid_values = set(r.get("category") for r in invalid_categories)
                results["issues"].append(f"Found records with invalid category values: {invalid_values}")
        else:
            results["column_exists"] = True
            results["has_data"] = False
            results["issues"].append("Table exists but has no data")
            
    except Exception as e:
        error_msg = str(e).lower()
        if "column" in error_msg and "category" in error_msg:
            results["issues"].append("Category column does not exist in the database")
        elif "relation" in error_msg or "table" in error_msg:
            results["issues"].append("upcs table does not exist")
        else:
            results["issues"].append(f"Error checking category column: {e}")
    
    return results


def check_unique_constraint(db) -> dict:
    """Check if unique constraint on (upc, category) is working."""
    results = {
        "constraint_exists": False,
        "test_passed": False,
        "issues": []
    }
    
    try:
        # Try to get all UPCs and check for duplicates
        all_upcs = db.table("upcs").select("upc, category").execute()
        
        # Check for duplicate (upc, category) pairs
        seen_pairs = {}
        duplicates = []
        
        for record in all_upcs.data:
            upc = record.get("upc")
            category = record.get("category", "dnk")  # Default to 'dnk' if missing
            
            pair = (upc, category)
            if pair in seen_pairs:
                duplicates.append(pair)
            else:
                seen_pairs[pair] = record
        
        if duplicates:
            results["issues"].append(f"Found {len(duplicates)} duplicate (upc, category) pairs - unique constraint may not be working")
            results["test_passed"] = False
        else:
            results["test_passed"] = True
        
        # Check if same UPC can exist in both categories (this should be allowed)
        upc_to_categories = {}
        for record in all_upcs.data:
            upc = record.get("upc")
            category = record.get("category", "dnk")
            if upc not in upc_to_categories:
                upc_to_categories[upc] = set()
            upc_to_categories[upc].add(category)
        
        # Find UPCs that exist in both categories (this is expected behavior)
        multi_category_upcs = {upc: cats for upc, cats in upc_to_categories.items() if len(cats) > 1}
        if multi_category_upcs:
            results["issues"].append(f"Found {len(multi_category_upcs)} UPCs that exist in multiple categories (this is allowed): {list(multi_category_upcs.keys())[:5]}")
        
        results["constraint_exists"] = True  # Assume it exists if we can query
        
    except Exception as e:
        results["issues"].append(f"Error checking unique constraint: {e}")
    
    return results


def check_indexes(db) -> dict:
    """Check if indexes exist (we can't directly query indexes via Supabase, but we can note it)."""
    results = {
        "index_info": "Cannot directly verify indexes via Supabase client. Check in Supabase dashboard."
    }
    return results


def main():
    """Main function to run schema verification."""
    print("=" * 80)
    print("Database Schema Verification Script")
    print("=" * 80)
    print()
    
    try:
        # Initialize database connection
        print("Connecting to database...")
        db = get_supabase()
        print(f"✓ Connected to Supabase: {settings.supabase_url}")
        print()
        
        # Check if upcs table exists
        print("1. Checking if 'upcs' table exists...")
        if check_table_exists(db, "upcs"):
            print("   ✓ 'upcs' table exists")
        else:
            print("   ✗ 'upcs' table does not exist or is not accessible")
            print("   → Run the database migration to create the table")
            return
        print()
        
        # Check category column
        print("2. Checking 'category' column...")
        category_check = check_category_column(db)
        
        if category_check["column_exists"]:
            print("   ✓ 'category' column exists")
        else:
            print("   ✗ 'category' column does not exist")
            print("   → Run the migration script: backend/database/upcs_add_category.sql")
            print()
            return
        
        if category_check["has_data"]:
            print(f"   ✓ Table has data ({sum(category_check['category_distribution'].values())} total records)")
            print()
            print("   Category distribution:")
            for cat, count in sorted(category_check["category_distribution"].items()):
                print(f"     - {cat}: {count} records")
        else:
            print("   ⚠ Table exists but has no data")
        
        if category_check["sample_records"]:
            print()
            print("   Sample records (first 5):")
            for i, record in enumerate(category_check["sample_records"][:5], 1):
                upc = record.get("upc", "N/A")
                cat = record.get("category", "NULL")
                created = record.get("created_at", "N/A")
                print(f"     {i}. UPC: {upc}, Category: {cat}, Created: {created}")
        
        if category_check["issues"]:
            print()
            print("   ⚠ Issues found:")
            for issue in category_check["issues"]:
                print(f"     - {issue}")
        print()
        
        # Check unique constraint
        print("3. Checking unique constraint on (upc, category)...")
        constraint_check = check_unique_constraint(db)
        
        if constraint_check["test_passed"]:
            print("   ✓ Unique constraint appears to be working (no duplicate pairs found)")
        else:
            print("   ✗ Unique constraint may not be working properly")
        
        if constraint_check["issues"]:
            print()
            print("   ⚠ Issues found:")
            for issue in constraint_check["issues"]:
                print(f"     - {issue}")
        print()
        
        # Check indexes
        print("4. Index information:")
        index_check = check_indexes(db)
        print(f"   {index_check['index_info']}")
        print()
        
        # Summary
        print("=" * 80)
        print("Summary")
        print("=" * 80)
        
        all_issues = category_check["issues"] + constraint_check["issues"]
        
        if not all_issues:
            print("✓ Schema verification passed! The database schema appears to be correct.")
            print()
            print("If you're still experiencing issues with UPCs appearing in the wrong category:")
            print("  1. Check the backend logs when adding UPCs to see what category is being used")
            print("  2. Verify the frontend is passing the correct category parameter")
            print("  3. Check for any database triggers or functions that might modify the category")
        else:
            print("⚠ Schema verification found some issues:")
            for issue in all_issues:
                print(f"  - {issue}")
            print()
            print("Recommended actions:")
            if any("column" in issue.lower() and "does not exist" in issue.lower() for issue in all_issues):
                print("  1. Run the migration script: backend/database/upcs_add_category.sql")
            if any("constraint" in issue.lower() for issue in all_issues):
                print("  2. Verify the unique constraint exists in Supabase dashboard")
                print("  3. Check the migration script was run completely")
            print("  4. After fixing issues, restart the backend server")
        
        print()
        
    except Exception as e:
        logger.error(f"Error during schema verification: {e}", exc_info=True)
        print()
        print("✗ Schema verification failed with error:")
        print(f"  {e}")
        print()
        print("Make sure:")
        print("  1. Your .env file has correct Supabase credentials")
        print("  2. The Supabase database is accessible")
        print("  3. You have the necessary permissions")
        sys.exit(1)


if __name__ == "__main__":
    main()
