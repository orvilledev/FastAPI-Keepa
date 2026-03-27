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

-- 5. Insert initial seller name mappings
INSERT INTO seller_names (seller_id, seller_name) VALUES
  ('A2BFMHD2O3XOJU', '6pm'),
  ('A3BWOXIALY2T1', 'ADT SALES'),
  ('A1BFMVOW4SGTB2', 'Abundance Allocations LLC'),
  ('A1L8UXQPMF5U60', 'Active Authority'),
  ('A38RHNS96YO4H4', 'Alabama LLC'),
  ('A801U220639HIB', 'Alexandres Uniforms'),
  ('A1X2P79M00F2CH', 'all_the_above'),
  ('ATVPDKIKX0DER', 'Amazon'),
  ('A1S4OUQAXYFOSRR', 'Automatic Fashion'),
  ('A3PK04JRLSF2NE', 'Ban Steveire'),
  ('A2OWC1XWW2EIDR', 'Bierenstock'),
  ('A1LPRFNTJU1DPC', 'Birkenstock of San Diego Stores'),
  ('A3SH34N4JL3SBB', 'Bootlegusa'),
  ('ADMS60KSL8H4B', 'Browns Shoe Fit Co, West Des Moines'),
  ('A3RTZ56YSNA6CF', 'Bush and Shop'),
  ('A1YNL5C0JFH1F6', 'Buyers Connection'),
  ('A2X2NHPJMVQJVR', 'C Bars Marketplace'),
  ('A3RQTATZE0SXNO', 'California-Off-Finds'),
  ('A2OKVQER03MV9', 'Cara Wear Uniforms Inc. / Heavenly Shoes Inc.'),
  ('A10LPDY8FO9IB8', 'Chipinado'),
  ('A2QW77A3NFY1OCY', 'Corner Suite'),
  ('A58PQUAB1TMSQ', 'Cucumel'),
  ('A1GPHMR8YI6L4A', 'Dansko LLC'),
  ('A5OB5S3COMPDB', 'Dorabanos Shoes'),
  ('ARIZM7UXXHPMB2', 'Deals galore 4u'),
  ('AQRITANJQMPB', 'Discount Shoe Source'),
  ('A9N1PORMP5M88', 'DLS & Son, LLC'),
  ('A3U8RQLB2U4YC4', 'e_Lifestyle'),
  ('A38R4BA1A1J4IM', 'eCorr'),
  ('A1ABTFVJAYRQL4A', 'ELA Enterprises'),
  ('A3HEF2ZIBXDHVN3Q', 'EPTV STORE'),
  ('A2PIZOH3DHJPY', 'enfashionhouse'),
  ('A2QYNH3FPPMWQY', 'Family Footwear Center'),
  ('A1E0F11UFO1DHWB', 'Firelight Home'),
  ('A1OCLCLM2L2NHWV', 'FootSmart'),
  ('A1L7FY4HSSBOB', 'GAIT STORE'),
  ('AFB2NZDLLF1EQL', 'Gilbert Trading/Post, LLC'),
  ('A2QPVLF1YW1L2C3', 'GoodSprings'),
  ('A2MBDCSR3FLP5K', 'Great Lakes Outreach'),
  ('A2JHCBISBBVCOYL', 'Groundswell Goods'),
  ('A2GW1HBL5RSHXY', 'Grade-NI'),
  ('A0V92QEBRC85MFT', 'Harwood Shoes'),
  ('A3HPVQG3JQBKUP', 'HHHYEN10'),
  ('ANZCOS1QQMP1', 'Heart & Sole'),
  ('A2RMPKM2SLL23', 'Houser Shoes'),
  ('A2R2Q2THYBRN98', 'ILS Retail Group'),
  ('A28CK4R5CUPVYA', 'Lark Shoes'),
  ('A1R5OK7U0U1I9W6', 'LB Enterprises68'),
  ('AFYFQNYQPEFAAW', 'LS Doublles'),
  ('A38NLLUBNYB4A', 'Lucky Soles'),
  ('AVDMR1PM5RROCZ', 'Lycun Orleans'),
  ('A2DVNFP3VDYQ42', 'MetroShoe Warehouse'),
  ('A1OUYSS2914L6M', 'Midwest Deals'),
  ('A1AJUOQB5J8PV', 'Monkey Shoes & Apparel'),
  ('A2YQN1873PSPP1', 'Onyx Shoes'),
  ('A2ILALULYNHM41', 'Outdoorrecreated'),
  ('A23Z2JSS1KNLL00', 'Outland USA'),
  ('A100YVHFY1C3U8', 'Ovary Prada'),
  ('A189MQA32ENUL', 'Paas Marketplace'),
  ('A1EN06BU20W2NQHV', 'Pella Shoes'),
  ('AHTPLN4QEN60FO', 'Portsmouth Supply International, LLC'),
  ('A6R9MA0M0P3WQC', 'Premium Shipping Pass'),
  ('A14BWDDARP3WUZ', 'PS Traders, LLC'),
  ('A3P8ISUA0KAL3L', 'Reachcong Shares Retail'),
  ('A2Y5BCQHQ52V5V6', 'Ropaland Retail Central'),
  ('A30X7PR85183D6L', 'Roscop.com'),
  ('A1BCQUGRQPE2', 'Rossono & Birkenstock'),
  ('A2HWSC37T1XFP', 'S.N.E.L. Solutions'),
  ('A2HFMYUXD1F4X80', 'Scawfield Sales'),
  ('A3FSCQPIMV1Y1B0', 'Schuler Shoes'),
  ('AH1S4XQAXVCCX', 'SchuMarket by expressions'),
  ('A2VKXAA4PN3BKNN', 'Serenely/ever/world'),
  ('A3WDMCQZ0BMV1', 'ShoeBuds Shqpee'),
  ('A34YVPINCC5HALFP', 'SHOE BANK'),
  ('A2ENBA4ZU1R0Z42', 'Shoe Lodge'),
  ('A3RBHMMPIRA8ZCI', 'ShopAtShoe'),
  ('A4QVBHMPIRA8ZCI', 'Shoes & More'),
  ('A0RPGQSAHNP5D10', 'ShoeSuresCorn'),
  ('AFPFQOSA51KYXN', 'ShopAms'),
  ('A3SUCG3VSGUE75', 'Showcase Sales'),
  ('A19M2HLOO2DJ1HYP', 'Simons Shoes of Boston'),
  ('A1DMCGU1ALAR2BN', 'SF North Star Enterprises LLC'),
  ('A38RBBFCSK086S0', 'Sole Comfort Footwear'),
  ('A1A0NDVYL2L3UP', 'Sole Provisions'),
  ('A3NOYWIQBK7RGGB', 'SoPro Logistics'),
  ('A2CSPMUA0A1A8EM', 'Square Deal Central'),
  ('A2019WM8FVWDBGB', 'STS Group'),
  ('AXPVCDEX4H201C', 'Super Store Team'),
  ('A1UBXTHU1QU3P5', 'Supercar First Shipping'),
  ('A1QLITM1EAZ2A31', 'TEDC Enterprises'),
  ('ACYINBORQW2C3PT', 'THE MEDIA MONKEY'),
  ('ASNA171VW8G02P', 'Tip Top Shoes'),
  ('A62B50L1R0YT21', 'Treat Home Goods'),
  ('A3RISVCA6WPUICM', 'Walking Comfort'),
  ('A2177M8NFMM0Y0', 'Wildflower Industries'),
  ('A4KOOVD75027VA', 'WJW Distribution'),
  ('A3AXPCCVO1D1H', 'SunnyRidge Market'),
  ('AWJ4MH1PSURVY4', 'Amazon')
ON CONFLICT (seller_id) DO UPDATE SET seller_name = EXCLUDED.seller_name, updated_at = NOW();
