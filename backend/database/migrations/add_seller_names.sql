-- Migration: Create seller_names table for seller ID to name lookup
-- Run this in Supabase SQL Editor

-- 1. Create the seller_names table
CREATE TABLE IF NOT EXISTS seller_names (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id TEXT UNIQUE NOT NULL,
  seller_name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Enable RLS
ALTER TABLE seller_names ENABLE ROW LEVEL SECURITY;

-- 3. RLS Policies - authenticated users can read, admins can manage
CREATE POLICY "Authenticated users can view seller names"
  ON seller_names FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Admins can manage seller names"
  ON seller_names FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

-- 4. Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_seller_names_seller_id ON seller_names(seller_id);

-- 5. Clear old data and insert updated seller name mappings
DELETE FROM seller_names;

INSERT INTO seller_names (seller_id, seller_name) VALUES
  ('A2BMBHD2OU3XDU', '6pm'),
  ('A3IWCKVAUAY2TJ', 'A2T SALES'),
  ('A1BFMVOW4SGTB2', 'Abundance Allocations LLC'),
  ('A1L8QQ0P66TIO0', 'Active Authority'),
  ('A3RIMEM2H2YSHI', 'Alakhras LLC'),
  ('A81U22O639HKB', 'Alexanders Uniforms'),
  ('A1K2P7MIX0F2CH', 'all_the_above'),
  ('AWJMXP5IJRVY4', 'Amazin Group'),
  ('ATVPDKIKX0DER', 'Amazon'),
  ('A1S4JQAXYFGSFR', 'Automatic Fashion'),
  ('A8PEXSLRSCNI2', 'Ben Stevens Inc'),
  ('A2OWC1XWWZ0EDR', 'bestdealsummer'),
  ('A1LP8ENTIU1DPC', 'Birkenstock of San Diego Stores'),
  ('A37H64HUL33DH6', 'Boddigan'),
  ('AGIM5SN3LIH8S', 'Brown''s Shoe Fit Co. West Des Moines'),
  ('A3RTZF65YN8CEF', 'BusBrand Shop'),
  ('A1NYLSOGAMTIF4', 'Buyer''s Connection'),
  ('A1CM3MMPYWFVJR', 'C Rae''s Marketplace'),
  ('A3TQ4TA2EG5XNO', 'California-Gift-Finds'),
  ('A3DQY03E03JMV9', 'Care Wear Uniforms Inc. /Heavenly Shoes Inc.'),
  ('A2JTJ08TPO39GH', 'Clognado'),
  ('A2W7XA3NFY1GCV', 'Corner Suite'),
  ('A26IPZ4A8TMSJG', 'Cucumai'),
  ('AUOMN8SHW0554', 'Dansko LLC'),
  ('A2USQE83C0MDD6', 'Dardano''s Shoes'),
  ('ARZ3M7UIXFM0Z', 'Deals galore 4u'),
  ('AQS3T1AXDII0S', 'Discount Shoe Source'),
  ('A3PNAUNF9JM94B', 'DLS & Son, LLC'),
  ('A3U8RQLBZU4YC4', 'e_Lifestyle'),
  ('A3I8FJ4SUZTJQM', 'eComical'),
  ('A1JHO0FVPPVLG4', 'ELK Enterprise'),
  ('A3H6F7ZR9XHWN2', 'EPTV STORE'),
  ('A2FTZQ9TKRGLMV', 'eshoewarehouse'),
  ('A2RYHT8TPHP9VA', 'Family Footwear Center'),
  ('A1E9FT1UFOTH9W', 'Firelight Home'),
  ('A1OCLJKML2FNVV', 'Footwear etc'),
  ('A1L7YEF0DEI569', 'GATT STORE'),
  ('ARB2N29L1FEGE', 'Gilbert Trading Post, LLC'),
  ('A24FVLFTW1Z1C1', 'GoodSprings'),
  ('A1WDDDDRL8P3GR', 'Great Lakes Outpost'),
  ('A2FICB5BBVCGVL', 'Groundswell Goods'),
  ('A2AW7H61R5IYKV', 'Gtrade-NH'),
  ('A97Q0EOBC55M7', 'Hansen Shoes'),
  ('A2QFVG1AI36ZUF', 'HAVEN3'),
  ('ANZCO5I7QOMPV', 'Heart & Sole'),
  ('A2IM9PHK2JSLC3', 'Houser Shoes'),
  ('A2UQ2GTFNV6YKE', 'ILS Retail Group'),
  ('A2EGK4P5GLPVR4', 'Lark Shoes'),
  ('A1K69NF7UURW98', 'LB Enterprises56'),
  ('ABP7VDOH06O4W', 'LS Outfitters'),
  ('A3BNLLU5BWYUA', 'Lucky Soles'),
  ('AVDM9FM9KBGCZ', 'Lycian Dreams'),
  ('A2WU6JHR5PVKH1', 'MetroShoe Warehouse'),
  ('A15UY3S29L4ILM', 'Midwest Deals'),
  ('A1UAUOZI8SJSFV', 'Monsey Shoes & Apparel'),
  ('A2NEM58BFPMEIL', 'Orva Stores'),
  ('A7ULJO7NAWM0L', 'OutdoorEquipped'),
  ('A23ZZE5SKNIL09', 'Outland USA'),
  ('A5OI56VYJCDI2', 'Ozzy Prods'),
  ('A1W9QH4ZTIRNYR', 'Pao''s Marketplace'),
  ('A1BNXE6U3W2NOH', 'Peltz Shoes'),
  ('A1PITRZCJZNEUO', 'Portsmouth Supply International, LLC'),
  ('AB1XQ3DA8GGTV', 'Premier Shipping Fast'),
  ('A14BWDDARP3W5Z', 'PS Traders, LLC'),
  ('A3PB81QAKOAL31', 'Reaching Stars Retail'),
  ('A21RO8AXWEE456', 'Real Green'),
  ('A2Y8CKHQSZF3V6', 'Rogaland Retail Central'),
  ('A30X7FB3IRKD61', 'Roxago corp'),
  ('A8JQIR7DG93F2', 'Roxanne''s Birkenstock'),
  ('A33HSECU5TKETS', 'RustyyDeals'),
  ('AFJW5C377TXF9', 'S.N.E.L. Solutions'),
  ('A2HEPXRJ0D7EXO', 'Scarlet Isle'),
  ('A19CQ9PM0VT3B', 'Schuler Shoes'),
  ('AHI84X0AXVCOX', 'ScrubMarket by Expressions'),
  ('A2XAX54MF6IUSN', 'Serenityonlineworld'),
  ('A25K0YI7ZX8W1O', 'ShellySells Shoppe'),
  ('A34YNPNGCSHLEF', 'SHOE BANK'),
  ('A2NB4AZUIKI242', 'Shoe Lodge'),
  ('A2D3R71ZYX0Y75', 'ShoeCo.Shoe'),
  ('AQV6HPRA5BZCI', 'Shoes & More'),
  ('A352ERZNY8GPTD', 'ShoeStoresCom'),
  ('AF90QR3SWS1VM', 'Shop 4Less'),
  ('A35UG3V3GUEC75', 'Showcase Sales'),
  ('A1SMZHLOZ1H1Y0', 'Simons Shoes of Boston'),
  ('A1MGCI1LA82E26', 'SJ North Star Enterprises LLC'),
  ('A3ORKDS26DU9YX', 'Sole Comfort Footwear'),
  ('A1TE0W9YL2L3UP', 'Sole Provisions'),
  ('A3NNQYW9K7BJGB', 'SoPro Logistics'),
  ('A2GWCD1OVLWL4X', 'Sportzstuff'),
  ('A1C3P9MUUATSEM', 'Square Deal Central'),
  ('A2JT9W5YKWODGB', 'ST3 Group'),
  ('A3K82CEIZN4O1H', 'Sunny Ridge Market'),
  ('APVCEX4IH261C', 'Super Store Team'),
  ('A1X6IB4YHUQJP8', 'Superior Fast Shipping'),
  ('A13UW7JEEA7NI3', 'TDSC Enterprises'),
  ('ACY9XRQRWZ3PT', 'THE MEDIA MONKEY'),
  ('A2NA17Y01W0O3P', 'Tip Top Shoes'),
  ('AFJHKM6HTR552', 'tradzon'),
  ('A6ZZBOL19VYZ1', 'Trend Home Goods'),
  ('A3E9SVC4GWPUCM', 'Voadera'),
  ('A1R2LN4EZ9SAP8', 'Walking Comfort'),
  ('A6NEVGVA01KMC', 'wanderlux'),
  ('A217RMPKFMDOY6', 'Wildflower Industries'),
  ('A4XGQVD7S67VA', 'WW Distribution'),
  ('AH1YFAUS3NHX2', 'Zappos')
ON CONFLICT (seller_id) DO UPDATE SET seller_name = EXCLUDED.seller_name, updated_at = NOW();
