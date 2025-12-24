-- Insider Detection Schema
-- Based on signals: new wallets, single-market focus, large bets, pre-resolution timing

-- Markets table: Track Polymarket conditions and their resolutions
CREATE TABLE IF NOT EXISTS markets (
  condition_id VARCHAR(66) PRIMARY KEY,
  question TEXT,
  slug VARCHAR(255),
  category VARCHAR(100),
  
  -- Outcome tracking
  outcome_yes_price DECIMAL(10, 4),
  outcome_no_price DECIMAL(10, 4),
  
  -- Resolution data
  resolved BOOLEAN DEFAULT FALSE,
  resolution_outcome INT,  -- 0 = No, 1 = Yes
  resolution_time TIMESTAMP,
  
  -- Volume/liquidity
  volume DECIMAL(20, 6) DEFAULT 0,
  liquidity DECIMAL(20, 6) DEFAULT 0,
  
  -- Timestamps
  end_date TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_markets_resolved ON markets(resolved);
CREATE INDEX IF NOT EXISTS idx_markets_resolution_time ON markets(resolution_time);
CREATE INDEX IF NOT EXISTS idx_markets_category ON markets(category);

-- Wallet market positions: Track which markets each wallet trades
CREATE TABLE IF NOT EXISTS wallet_positions (
  id SERIAL PRIMARY KEY,
  wallet_address VARCHAR(42) NOT NULL REFERENCES wallets(address),
  condition_id VARCHAR(66) NOT NULL,
  
  -- Position details
  outcome_index INT,  -- 0 = No, 1 = Yes
  total_bought DECIMAL(20, 6) DEFAULT 0,
  total_sold DECIMAL(20, 6) DEFAULT 0,
  net_position DECIMAL(20, 6) DEFAULT 0,
  avg_entry_price DECIMAL(10, 4),
  
  -- Timing
  first_trade_time TIMESTAMP,
  last_trade_time TIMESTAMP,
  
  -- Resolution tracking
  outcome_correct BOOLEAN,  -- NULL until resolved
  profit_loss DECIMAL(20, 6),
  
  UNIQUE(wallet_address, condition_id, outcome_index)
);

CREATE INDEX IF NOT EXISTS idx_positions_wallet ON wallet_positions(wallet_address);
CREATE INDEX IF NOT EXISTS idx_positions_market ON wallet_positions(condition_id);

-- Enhanced insider detection fields on wallets
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS 
  markets_traded INT DEFAULT 0;  -- Number of unique markets traded

ALTER TABLE wallets ADD COLUMN IF NOT EXISTS 
  market_concentration DECIMAL(5, 4) DEFAULT 0;  -- 0-1, higher = more concentrated

ALTER TABLE wallets ADD COLUMN IF NOT EXISTS 
  single_market_wallet BOOLEAN DEFAULT FALSE;  -- Only trades 1-2 markets

ALTER TABLE wallets ADD COLUMN IF NOT EXISTS 
  avg_time_to_resolution_hours DECIMAL(10, 2);  -- Avg hours before resolution

ALTER TABLE wallets ADD COLUMN IF NOT EXISTS 
  pre_resolution_correct_rate DECIMAL(5, 4) DEFAULT 0;  -- Win rate on trades <24h before resolution

ALTER TABLE wallets ADD COLUMN IF NOT EXISTS 
  low_odds_win_rate DECIMAL(5, 4) DEFAULT 0;  -- Win rate when betting on <30% odds

ALTER TABLE wallets ADD COLUMN IF NOT EXISTS 
  low_odds_wins INT DEFAULT 0;

ALTER TABLE wallets ADD COLUMN IF NOT EXISTS 
  low_odds_attempts INT DEFAULT 0;

-- Add fields to whale_trades for insider detection
ALTER TABLE whale_trades ADD COLUMN IF NOT EXISTS 
  condition_id VARCHAR(66);

ALTER TABLE whale_trades ADD COLUMN IF NOT EXISTS 
  outcome_index INT;

ALTER TABLE whale_trades ADD COLUMN IF NOT EXISTS 
  outcome_correct BOOLEAN;

ALTER TABLE whale_trades ADD COLUMN IF NOT EXISTS 
  hours_to_resolution DECIMAL(10, 2);

-- Insider alerts table: Track suspicious activity
CREATE TABLE IF NOT EXISTS insider_alerts (
  id SERIAL PRIMARY KEY,
  condition_id VARCHAR(66),
  market_question TEXT,
  
  -- Alert details
  alert_type VARCHAR(50),  -- 'new_whale', 'collective_bet', 'pre_resolution_surge'
  severity VARCHAR(20) DEFAULT 'medium',  -- 'low', 'medium', 'high'
  
  -- Involved wallets
  wallets JSONB,  -- Array of wallet addresses involved
  total_volume DECIMAL(20, 6),
  bet_direction VARCHAR(4),  -- 'YES' or 'NO'
  
  -- Context
  odds_at_time DECIMAL(5, 4),
  description TEXT,
  
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alerts_market ON insider_alerts(condition_id);
CREATE INDEX IF NOT EXISTS idx_alerts_time ON insider_alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_severity ON insider_alerts(severity);

-- View for potential insiders (combines key signals)
CREATE OR REPLACE VIEW potential_insiders AS
SELECT 
  w.address,
  w.first_seen,
  w.total_trades,
  w.total_volume,
  w.markets_traded,
  w.single_market_wallet,
  w.win_count,
  w.loss_count,
  CASE WHEN (w.win_count + w.loss_count) > 0 
       THEN w.win_count::float / (w.win_count + w.loss_count) 
       ELSE 0 END as win_rate,
  w.low_odds_win_rate,
  w.pre_resolution_correct_rate,
  w.insider_score,
  w.tags,
  -- Flag: New wallet (created in last 30 days)
  (w.first_seen > NOW() - INTERVAL '30 days') as is_new_wallet,
  -- Flag: High concentration (trades few markets)
  (w.markets_traded <= 3 AND w.total_volume > 10000) as is_concentrated
FROM wallets w
WHERE 
  -- Has significant activity
  w.total_volume > 5000
  AND (
    -- New wallet with single market focus
    (w.first_seen > NOW() - INTERVAL '30 days' AND w.markets_traded <= 3)
    -- OR high low-odds win rate
    OR (w.low_odds_wins >= 3 AND w.low_odds_win_rate > 0.6)
    -- OR high pre-resolution accuracy
    OR w.pre_resolution_correct_rate > 0.7
    -- OR already flagged as insider
    OR w.insider_score > 50
  )
ORDER BY w.insider_score DESC, w.total_volume DESC;

