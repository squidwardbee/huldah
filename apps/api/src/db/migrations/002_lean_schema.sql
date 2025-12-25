-- Lean schema: Store only wallet stats + tags, and whale trades for the feed

-- Add scoring columns to wallets
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS insider_score INTEGER DEFAULT 0;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS smart_money_score INTEGER DEFAULT 0;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS avg_trade_size DECIMAL(20, 6) DEFAULT 0;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS early_position_count INTEGER DEFAULT 0;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS computed_at TIMESTAMP;

-- Create whale_trades table (only trades >$1000, kept for 7 days)
CREATE TABLE IF NOT EXISTS whale_trades (
  id SERIAL PRIMARY KEY,
  tx_hash VARCHAR(128) UNIQUE,
  wallet_address VARCHAR(42) NOT NULL,
  market_slug VARCHAR(255),
  market_question TEXT,
  side VARCHAR(4),
  price DECIMAL(10, 4),
  size DECIMAL(20, 6),
  usd_value DECIMAL(20, 6),
  timestamp TIMESTAMP,
  wallet_tags TEXT[],
  wallet_volume DECIMAL(20, 6),
  wallet_trade_count INTEGER
);

CREATE INDEX IF NOT EXISTS idx_whale_trades_timestamp ON whale_trades(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_whale_trades_wallet ON whale_trades(wallet_address);

-- Add index for tag queries
CREATE INDEX IF NOT EXISTS idx_wallets_insider ON wallets(insider_score DESC);
CREATE INDEX IF NOT EXISTS idx_wallets_smart ON wallets(smart_money_score DESC);


