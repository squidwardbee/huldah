-- Add token_id columns to markets table for orderbook lookups
-- Polymarket has separate token_ids for YES and NO outcomes

ALTER TABLE markets ADD COLUMN IF NOT EXISTS yes_token_id VARCHAR(100);
ALTER TABLE markets ADD COLUMN IF NOT EXISTS no_token_id VARCHAR(100);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_markets_yes_token ON markets(yes_token_id) WHERE yes_token_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_markets_no_token ON markets(no_token_id) WHERE no_token_id IS NOT NULL;

