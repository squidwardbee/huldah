-- DTW (Dynamic Time Warping) scores for wallet-market pairs
-- Used for insider/smart money detection by correlating trade patterns with price movements

CREATE TABLE IF NOT EXISTS wallet_market_dtw (
  id SERIAL PRIMARY KEY,
  wallet_address VARCHAR(42) NOT NULL,
  token_id VARCHAR(100) NOT NULL,
  market_question TEXT,

  -- DTW analysis results
  dtw_score INTEGER NOT NULL,           -- 0-100, higher = more predictive
  correlation DECIMAL(5, 2),            -- Pearson correlation (-1 to 1)
  trade_count INTEGER NOT NULL,
  total_volume DECIMAL(20, 6) NOT NULL,
  avg_trade_size DECIMAL(20, 6),
  profit_direction VARCHAR(10),         -- 'YES', 'NO', or 'MIXED'

  computed_at TIMESTAMP DEFAULT NOW(),

  UNIQUE(wallet_address, token_id)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_dtw_token ON wallet_market_dtw(token_id);
CREATE INDEX IF NOT EXISTS idx_dtw_wallet ON wallet_market_dtw(wallet_address);
CREATE INDEX IF NOT EXISTS idx_dtw_score ON wallet_market_dtw(dtw_score DESC);
CREATE INDEX IF NOT EXISTS idx_dtw_computed ON wallet_market_dtw(computed_at);

-- Add dtw_insider_score to wallets table (aggregated across markets)
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS dtw_insider_score INTEGER DEFAULT 0;
