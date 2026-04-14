-- Add seller ID → name mappings (incremental; does not delete existing rows).
-- Run in Supabase SQL Editor if the DB was already seeded without these sellers.

INSERT INTO seller_names (seller_id, seller_name) VALUES
  ('A2L77EE7U53NWQ', 'Amazon Resale'),
  ('A1675HUVWUMF0H', 'Space Laser Industries'),
  ('A1HQOHOLTUK58E', 'Buy DBDeals'),
  ('AB9U0R56IWRKV', 'greenlinegear LLC'),
  ('A20YSPW1I1I0OV', 'OnlineSellingPartner')
ON CONFLICT (seller_id) DO UPDATE SET
  seller_name = EXCLUDED.seller_name,
  updated_at = NOW();
