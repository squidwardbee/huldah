CREATE TABLE IF NOT EXISTS wallets (
  address VARCHAR(42) PRIMARY KEY,
  first_seen TIMESTAMP DEFAULT NOW(),
  total_trades INTEGER DEFAULT 0,
  total_volume DECIMAL(20, 6) DEFAULT 0,
  win_count INTEGER DEFAULT 0,
  loss_count INTEGER DEFAULT 0,
  realized_pnl DECIMAL(20, 6) DEFAULT 0,
  last_active TIMESTAMP,
  tags TEXT[],
  metadata JSONB
);

CREATE TABLE IF NOT EXISTS trades (
  id SERIAL PRIMARY KEY,
  tx_hash VARCHAR(66) UNIQUE,
  wallet_address VARCHAR(42) REFERENCES wallets(address),
  market_id VARCHAR(66),
  token_id VARCHAR(66),
  side VARCHAR(4),
  price DECIMAL(10, 4),
  size DECIMAL(20, 6),
  usd_value DECIMAL(20, 6),
  timestamp TIMESTAMP,
  outcome VARCHAR(10),
  is_whale BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS markets (
  condition_id VARCHAR(66) PRIMARY KEY,
  question TEXT,
  slug VARCHAR(255),
  end_date TIMESTAMP,
  volume DECIMAL(20, 6),
  liquidity DECIMAL(20, 6),
  last_price_yes DECIMAL(10, 4),
  last_price_no DECIMAL(10, 4),
  resolved BOOLEAN DEFAULT FALSE,
  resolution_outcome VARCHAR(10),
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_trades_wallet ON trades(wallet_address);
CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_trades_whale ON trades(is_whale) WHERE is_whale = TRUE;
CREATE INDEX IF NOT EXISTS idx_wallets_volume ON wallets(total_volume DESC);



