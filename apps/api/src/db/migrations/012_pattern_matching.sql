-- Pattern Matching Tables for DTW Analysis
-- Stores historical price candles and pre-computed pattern windows

-- Price candles table (5-minute OHLCV data)
CREATE TABLE IF NOT EXISTS price_candles (
  id SERIAL PRIMARY KEY,
  token_id VARCHAR(100) NOT NULL,
  market_id VARCHAR(100),
  time TIMESTAMP NOT NULL,
  open DECIMAL(10, 6),
  high DECIMAL(10, 6),
  low DECIMAL(10, 6),
  close DECIMAL(10, 6),
  volume DECIMAL(20, 6) DEFAULT 0,
  trade_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(token_id, time)
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_candles_token_time ON price_candles (token_id, time DESC);
CREATE INDEX IF NOT EXISTS idx_candles_time ON price_candles (time DESC);

-- Pre-computed pattern windows for fast DTW search
CREATE TABLE IF NOT EXISTS pattern_windows (
  id SERIAL PRIMARY KEY,
  token_id VARCHAR(100) NOT NULL,
  market_id VARCHAR(100),
  market_question TEXT,
  window_start TIMESTAMP NOT NULL,
  window_end TIMESTAMP NOT NULL,
  pattern_length INTEGER NOT NULL,
  pattern_data DECIMAL(10, 6)[] NOT NULL,  -- normalized price series
  outcome_1h DECIMAL(10, 6),    -- price change after 1 hour
  outcome_4h DECIMAL(10, 6),    -- price change after 4 hours
  outcome_24h DECIMAL(10, 6),   -- price change after 24 hours
  final_price DECIMAL(10, 6),   -- final price if market resolved
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(token_id, window_start, pattern_length)
);

CREATE INDEX IF NOT EXISTS idx_patterns_token ON pattern_windows (token_id);
CREATE INDEX IF NOT EXISTS idx_patterns_length ON pattern_windows (pattern_length);
CREATE INDEX IF NOT EXISTS idx_patterns_window ON pattern_windows (window_start, window_end);

-- Track pattern matching prediction accuracy
CREATE TABLE IF NOT EXISTS pattern_predictions (
  id SERIAL PRIMARY KEY,
  token_id VARCHAR(100) NOT NULL,
  predicted_at TIMESTAMP DEFAULT NOW(),
  pattern_start TIMESTAMP NOT NULL,
  pattern_end TIMESTAMP NOT NULL,
  match_count INTEGER NOT NULL,
  up_percentage DECIMAL(5, 2) NOT NULL,
  down_percentage DECIMAL(5, 2) NOT NULL,
  predicted_direction VARCHAR(4),  -- 'UP' or 'DOWN'
  confidence DECIMAL(5, 4),
  horizon VARCHAR(10) NOT NULL,   -- '1h', '4h', '24h'
  actual_direction VARCHAR(4),    -- filled in later
  actual_move DECIMAL(10, 6),     -- filled in later
  verified_at TIMESTAMP           -- when outcome was verified
);

CREATE INDEX IF NOT EXISTS idx_predictions_token ON pattern_predictions (token_id);
CREATE INDEX IF NOT EXISTS idx_predictions_verified ON pattern_predictions (verified_at) WHERE verified_at IS NULL;
