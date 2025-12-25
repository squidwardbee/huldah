-- Add additional market data columns for enhanced UI
-- These fields come from the Gamma API and enable richer market display

-- Image and branding
ALTER TABLE markets ADD COLUMN IF NOT EXISTS image_url VARCHAR(500);
ALTER TABLE markets ADD COLUMN IF NOT EXISTS icon_url VARCHAR(500);

-- Category for filtering
ALTER TABLE markets ADD COLUMN IF NOT EXISTS category VARCHAR(100);

-- 24h metrics for displaying market activity
ALTER TABLE markets ADD COLUMN IF NOT EXISTS volume_24h NUMERIC(20, 2) DEFAULT 0;
ALTER TABLE markets ADD COLUMN IF NOT EXISTS price_change_24h NUMERIC(10, 6) DEFAULT 0;

-- Best bid/ask for quick price display
ALTER TABLE markets ADD COLUMN IF NOT EXISTS best_bid NUMERIC(10, 6);
ALTER TABLE markets ADD COLUMN IF NOT EXISTS best_ask NUMERIC(10, 6);

-- Description for market details
ALTER TABLE markets ADD COLUMN IF NOT EXISTS description TEXT;

-- Index for category filtering
CREATE INDEX IF NOT EXISTS idx_markets_category ON markets(category) WHERE category IS NOT NULL;

-- Index for volume-based sorting (24h volume)
CREATE INDEX IF NOT EXISTS idx_markets_volume_24h ON markets(volume_24h DESC NULLS LAST);
