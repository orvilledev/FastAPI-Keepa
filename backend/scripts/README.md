# Database Schema Verification Script

This script verifies that the database schema is correctly configured, specifically checking the `upcs` table and `category` column.

## Usage

From the backend directory, run:

```bash
python scripts/verify_schema.py
```

Or from the project root:

```bash
cd backend
python scripts/verify_schema.py
```

## What it checks

1. **Table existence**: Verifies the `upcs` table exists
2. **Category column**: Checks if the `category` column exists and has data
3. **Data integrity**: 
   - Shows category distribution (dnk vs clk)
   - Checks for NULL or invalid category values
   - Displays sample records
4. **Unique constraint**: Verifies the unique constraint on `(upc, category)` is working
5. **Indexes**: Notes that indexes should be checked in Supabase dashboard

## Requirements

- Python 3.8+
- Valid `.env` file in the backend directory with Supabase credentials
- Database access permissions

## Example Output

```
================================================================================
Database Schema Verification Script
================================================================================

Connecting to database...
✓ Connected to Supabase: https://your-project.supabase.co

1. Checking if 'upcs' table exists...
   ✓ 'upcs' table exists

2. Checking 'category' column...
   ✓ 'category' column exists
   ✓ Table has data (150 total records)

   Category distribution:
     - dnk: 100 records
     - clk: 50 records

   Sample records (first 5):
     1. UPC: 1234567890123, Category: dnk, Created: 2024-01-15T10:30:00
     2. UPC: 9876543210987, Category: clk, Created: 2024-01-15T11:00:00
     ...

3. Checking unique constraint on (upc, category)...
   ✓ Unique constraint appears to be working (no duplicate pairs found)

4. Index information:
   Cannot directly verify indexes via Supabase client. Check in Supabase dashboard.

================================================================================
Summary
================================================================================
✓ Schema verification passed! The database schema appears to be correct.
```

## Troubleshooting

If the script reports that the `category` column doesn't exist:

1. Run the migration script in Supabase SQL Editor:
   ```sql
   -- Run: backend/database/upcs_add_category.sql
   ```

2. Verify the migration completed successfully

3. Re-run this verification script

If you see duplicate (upc, category) pairs:

1. Check the unique constraint exists in Supabase dashboard
2. Verify the migration script was run completely
3. Check for any database triggers that might be interfering
