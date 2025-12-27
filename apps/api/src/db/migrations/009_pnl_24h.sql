-- Add pnl_24h and volume_24h columns to wallets table for storing 24h metrics from Polymarket API
-- This is synced periodically from the Polymarket leaderboard API

ALTER TABLE wallets ADD COLUMN IF NOT EXISTS pnl_24h DECIMAL(20, 6) DEFAULT 0;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS volume_24h DECIMAL(20, 6) DEFAULT 0;

-- Add indexes for sorting by 24h metrics
CREATE INDEX IF NOT EXISTS idx_wallets_pnl_24h ON wallets(pnl_24h DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_wallets_volume_24h ON wallets(volume_24h DESC NULLS LAST);
