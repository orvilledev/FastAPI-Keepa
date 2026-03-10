# CSV/Report Output — Logic & Calculations

This document describes how the **comprehensive price report** (exported as Excel `.xlsx`) is built: where data comes from, how each column is derived, and how key values are calculated.

---

## 1. Overview

- **What is generated:** One row per processed UPC in a batch job. The file is an **Excel workbook** (not a raw CSV), with one sheet named "Price Report."
- **Main code:** `app/services/csv_generator.py` (`generate_comprehensive_report_csv`, `extract_keepa_product_data`) and `app/services/report_service.py` (`generate_csv_for_job`).
- **Data sources:**
  - **Keepa API** — product info, buy box price, buy box seller, current sellers (per UPC, stored in batch job `keepa_data`).
  - **MAP (MSRP) table** — minimum advertised price / MSRP per UPC, fetched via `MAPRepository.get_map_by_upc(upc)`.

---

## 2. Report Generation Flow

1. **ReportService.generate_csv_for_job(job_id, job_name)**
   - Loads all processed items for the job: `processed_items` = list of `{ upc, keepa_data, ... }`.
   - Loads price alerts by UPC: `price_alerts_by_upc` (used for other report types; comprehensive report does not use it for the main columns).
   - For each UPC, fetches MAP price from DB; builds `map_prices_by_upc[upc] = map_price` (only when MAP exists and `map_price > 0`).
2. **CSVGenerator.generate_comprehensive_report_csv(processed_items, price_alerts_by_upc, map_prices_by_upc)**
   - For each item: extracts product data from Keepa, gets MAP for that UPC, then computes all report columns and appends one row.
   - Builds a DataFrame and writes an **Excel file** (openpyxl) with headers, data rows, and formatting (e.g. red highlight for "Off Price").
3. Filename: `{job_name}_{YYYYMMDD_HHMMSS}.xlsx`.

---

## 3. Keepa Product Data Extraction

For each item, product data is taken from **Keepa** via `CSVGenerator.extract_keepa_product_data(keepa_data)`. Input is the raw Keepa product object (first element of `products`).

### 3.1 Keepa price format

- Keepa returns prices in **cents**. All prices from Keepa are converted to **dollars** by dividing by `100` before use in the report.
- Only **positive** prices are used; zero or negative values are treated as missing.

### 3.2 Buy box price

**Source (in order of use):**

1. **stats.buyBoxPrice** or **stats.buyBoxPriceNew** or **stats.current** (from Keepa `product.stats`).
2. If still missing: price of the seller that matches **stats.buyBoxSellerId** in `current_sellers` (that seller’s `price` in cents → ÷ 100).
3. If still missing (fallback buy box seller): price of the “Amazon”/FBA seller or the first seller in `current_sellers`, same conversion.

Result is stored as **buy_box_price** (dollars) and used in the report as **Buy Box Seller Price**.

### 3.3 Buy box seller (identification)

- **Primary:** Keepa `stats.buyBoxSellerId` identifies the buy box seller.
- **Seller ID in report:** The report’s **Buy Box Seller** column shows the **Seller ID** when available (from `buyBoxSellerId` or, in fallbacks, from the chosen seller’s `sellerId`). If no ID exists, the seller name is used; if neither exists, `"N/A"`.
- **Fallbacks** (when no seller is found by `buyBoxSellerId`):
  1. First seller whose name contains `"amazon"` (case-insensitive) or who has `isFBA == true`.
  2. If none: first seller in `current_sellers`.
- In fallback cases, that seller’s `sellerId` is still used for the **Buy Box Seller** column when available.

### 3.4 Current Amazon price

- **Primary:** Same as **buy_box_price** (buy box price in dollars).
- **Fallback:** If buy box price is missing, the **minimum** of all valid (positive) seller prices in `current_sellers` (after converting cents → dollars). Used for **Current Amazon Price** in the report.

### 3.5 Other product fields

- **asin**, **title**, **brand**: From Keepa `product` (`asin`, `title`, `brand`).

---

## 4. Column-by-Column Logic

For each row (one UPC), columns are computed as follows.

| Column | Logic / Formula |
|--------|------------------|
| **UPC** | UPC of the batch item. If value is in scientific notation (e.g. `1.23E+12`), it is converted to a full integer string for display. |
| **ASIN** | From Keepa product data (`product_data.asin`). |
| **Product Title** | From Keepa product data (`product_data.title`). |
| **Brand** | From Keepa product data (`product_data.brand`). |
| **Off Price Listing** | **"Off Price"** if `MSRP > Buy Box Seller Price` (both must be non-null); otherwise **"Not Off Price"**. Rows with **"Off Price"** have the **Off Price Listing** cell highlighted in **red** with white bold text in the Excel file. |
| **MSRP** | MAP price for this UPC from the database (`map_prices_by_upc[upc]`). Displayed as `$X.XX`. If no MAP or MAP not found: **"N/A"**. |
| **Current Amazon Price** | `product_data.current_amazon_price` (dollars). Displayed as `$X.XX` or **"N/A"** if missing. |
| **Price Difference** | **MSRP − Buy Box Seller Price** (in dollars). Displayed as `$X.XX`. If either MSRP or Buy Box Seller Price is missing: **"$0.00"**. |
| **Buy Box Seller Price** | Buy box price in dollars from Keepa (`product_data.buy_box_price`). Displayed as `$X.XX` or **"N/A"** if missing. |
| **Buy Box Seller** | **Seller ID** when available; otherwise seller name; otherwise **"N/A"**. (See §3.3.) |
| **Discount %** | `((MSRP − Buy Box Seller Price) / MSRP) × 100`, with 2 decimal places and a `%` sign. Requires `MSRP > 0` and both MSRP and Buy Box Seller Price; otherwise **"N/A"**. |
| **Amazon URL** | `https://www.amazon.com/dp/{asin}` if ASIN is present; otherwise **"N/A"**. |

---

## 5. Formulas (summary)

- **Price Difference**  
  `Price Difference = MSRP − Buy Box Seller Price`

- **Off Price Listing**  
  `Off Price Listing = "Off Price"` if `MSRP > Buy Box Seller Price`, else `"Not Off Price"`

- **Discount %**  
  `Discount % = ((MSRP − Buy Box Seller Price) / MSRP) × 100`  
  (Displayed as `X.XX%`; shown only when MSRP and Buy Box Seller Price exist and MSRP > 0.)

---

## 6. Excel Formatting

- **Output format:** Excel (`.xlsx`), not raw CSV. Sheet name: **"Price Report"**.
- **Header row:** Bold.
- **Off Price Listing (column E):** If the cell value is **"Off Price"**, the cell is filled **red** and the text is **white** and **bold**.
- **Column widths:** Auto-sized from content, capped at 50 characters.

---

## 7. Edge Cases

- **No Keepa product:** Empty product data; most columns become empty or **"N/A"**; Price Difference and Discount % use the rules above (e.g. **"$0.00"** / **"N/A"** when data is missing).
- **No MAP for UPC:** MSRP = **"N/A"**; Price Difference = **"$0.00"**; Off Price Listing = **"Not Off Price"**; Discount % = **"N/A"**.
- **No buy box price:** Buy Box Seller Price = **"N/A"**; Current Amazon Price uses lowest seller price if available; Price Difference / Discount % behave as when Buy Box Seller Price is missing (e.g. **"$0.00"** / **"N/A"**).
- **Negative or zero Keepa price:** Treated as invalid; not used for buy box or current price.

---

## 8. Related Code References

| Component | File | Main functions |
|-----------|------|----------------|
| Report orchestration | `app/services/report_service.py` | `generate_csv_for_job` |
| CSV/Excel build & Keepa parsing | `app/services/csv_generator.py` | `generate_comprehensive_report_csv`, `extract_keepa_product_data` |
| MAP (MSRP) lookup | `app/repositories/map_repository.py` | `get_map_by_upc` |
| Processed items per job | `app/repositories/report_repository.py` | `get_all_processed_upcs_for_job` |
