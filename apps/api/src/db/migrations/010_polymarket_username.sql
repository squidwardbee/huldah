-- Migration: Add polymarket_username column to wallets table
-- This stores the Polymarket username from their Data API (if available)

ALTER TABLE wallets ADD COLUMN IF NOT EXISTS polymarket_username VARCHAR(100);

-- Create index for username lookups
CREATE INDEX IF NOT EXISTS idx_wallets_polymarket_username ON wallets(polymarket_username) WHERE polymarket_username IS NOT NULL;
