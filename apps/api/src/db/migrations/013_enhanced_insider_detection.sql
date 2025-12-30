-- Enhanced Insider Detection Schema
-- Comprehensive multi-factor insider scoring system

-- ============================================================
-- MARKET CATEGORY RISK CLASSIFICATION
-- ============================================================

-- Market categories with insider risk levels
CREATE TABLE IF NOT EXISTS market_category_risk (
  category VARCHAR(100) PRIMARY KEY,
  risk_level VARCHAR(20) NOT NULL DEFAULT 'medium', -- 'low', 'medium', 'high', 'critical'
  risk_multiplier DECIMAL(3, 2) DEFAULT 1.0, -- Score multiplier for this category
  description TEXT,
  keywords TEXT[], -- Keywords to auto-classify markets
  created_at TIMESTAMP DEFAULT NOW()
);

-- Seed with category risk levels
INSERT INTO market_category_risk (category, risk_level, risk_multiplier, description, keywords) VALUES
  ('crypto', 'critical', 1.5, 'Crypto/token markets - project teams, VCs, exchanges have inside info',
   ARRAY['bitcoin', 'btc', 'ethereum', 'eth', 'crypto', 'token', 'coin', 'blockchain', 'defi', 'nft', 'solana', 'sol']),
  ('company', 'critical', 1.5, 'Company-specific markets - employees, board, investors have inside info',
   ARRAY['earnings', 'quarterly', 'revenue', 'profit', 'acquisition', 'merger', 'ipo', 'layoff', 'ceo', 'stock']),
  ('regulatory', 'critical', 1.5, 'Regulatory decisions - government employees, lobbyists have inside info',
   ARRAY['sec', 'fda', 'approval', 'ruling', 'regulation', 'antitrust', 'ftc', 'doj', 'lawsuit', 'fine']),
  ('politics_insider', 'high', 1.3, 'Political campaigns - staff, pollsters, donors have inside polling data',
   ARRAY['campaign', 'primary', 'debate', 'endorsement', 'withdraw', 'dropout', 'internal poll']),
  ('sports_injury', 'high', 1.3, 'Sports injuries/lineup - coaches, doctors, players know before public',
   ARRAY['injury', 'injured', 'lineup', 'suspended', 'trade', 'starting', 'benched', 'roster']),
  ('legal', 'high', 1.3, 'Court cases - lawyers, clerks may know outcomes early',
   ARRAY['verdict', 'trial', 'court', 'judge', 'jury', 'ruling', 'appeal', 'settlement']),
  ('entertainment', 'high', 1.3, 'Awards/entertainment - academy members, producers know winners',
   ARRAY['oscar', 'grammy', 'emmy', 'award', 'winner', 'nomination', 'academy']),
  ('elections', 'medium', 1.1, 'General elections - harder to insider trade, but exit polls exist',
   ARRAY['election', 'vote', 'ballot', 'poll', 'president', 'senator', 'governor', 'congress']),
  ('geopolitical', 'medium', 1.1, 'Geopolitics - diplomats, intelligence have some advance knowledge',
   ARRAY['treaty', 'sanction', 'war', 'invasion', 'ceasefire', 'summit', 'negotiation']),
  ('weather', 'low', 0.7, 'Weather events - hard to insider trade nature',
   ARRAY['hurricane', 'earthquake', 'temperature', 'weather', 'storm', 'flood']),
  ('science', 'medium', 1.0, 'Scientific discoveries - researchers know before publication',
   ARRAY['study', 'research', 'discovery', 'trial', 'vaccine', 'drug', 'clinical']),
  ('general', 'low', 0.8, 'General/misc markets - lower insider risk',
   ARRAY[]::TEXT[])
ON CONFLICT (category) DO UPDATE SET
  risk_level = EXCLUDED.risk_level,
  risk_multiplier = EXCLUDED.risk_multiplier,
  description = EXCLUDED.description,
  keywords = EXCLUDED.keywords;

-- Add insider risk category to markets table
ALTER TABLE markets ADD COLUMN IF NOT EXISTS insider_risk_category VARCHAR(100);
ALTER TABLE markets ADD COLUMN IF NOT EXISTS insider_risk_level VARCHAR(20);
ALTER TABLE markets ADD COLUMN IF NOT EXISTS insider_risk_multiplier DECIMAL(3, 2) DEFAULT 1.0;

-- ============================================================
-- ENHANCED WALLET INSIDER METRICS
-- ============================================================

-- Detailed insider signals per wallet
CREATE TABLE IF NOT EXISTS wallet_insider_signals (
  wallet_address VARCHAR(42) PRIMARY KEY REFERENCES wallets(address),

  -- Temporal Signals (30% weight)
  pre_resolution_1h_accuracy DECIMAL(5, 4) DEFAULT 0, -- Win rate on trades <1h before resolution
  pre_resolution_4h_accuracy DECIMAL(5, 4) DEFAULT 0, -- Win rate on trades <4h before resolution
  pre_resolution_24h_accuracy DECIMAL(5, 4) DEFAULT 0, -- Win rate on trades <24h before resolution
  pre_resolution_sample_size INT DEFAULT 0,
  news_anticipation_score DECIMAL(5, 4) DEFAULT 0, -- Large positions before major price moves
  timing_consistency_score DECIMAL(5, 4) DEFAULT 0, -- How consistent is trade timing before events

  -- Trade Quality Signals (25% weight)
  entry_price_advantage DECIMAL(6, 4) DEFAULT 0, -- Avg entry vs VWAP advantage
  low_odds_win_rate DECIMAL(5, 4) DEFAULT 0, -- Win rate at <30% odds
  low_odds_sample_size INT DEFAULT 0,
  longshot_win_rate DECIMAL(5, 4) DEFAULT 0, -- Win rate at <15% odds
  longshot_sample_size INT DEFAULT 0,
  conviction_sizing_score DECIMAL(5, 4) DEFAULT 0, -- Do they size up on winners?
  exit_timing_score DECIMAL(5, 4) DEFAULT 0, -- Quality of exit timing

  -- Category Risk Signals (15% weight)
  high_risk_category_win_rate DECIMAL(5, 4) DEFAULT 0, -- Win rate in high-risk categories
  high_risk_category_volume DECIMAL(20, 6) DEFAULT 0,
  category_concentration DECIMAL(5, 4) DEFAULT 0, -- How concentrated in risky categories
  primary_category VARCHAR(100),

  -- Network/Cluster Signals (15% weight)
  cluster_correlation_score DECIMAL(5, 4) DEFAULT 0, -- Correlated with other suspicious wallets
  funding_overlap_score DECIMAL(5, 4) DEFAULT 0, -- Shares funding source with suspicious wallets
  timing_sync_score DECIMAL(5, 4) DEFAULT 0, -- Trades synchronized with other wallets
  is_cluster_leader BOOLEAN DEFAULT FALSE, -- First to trade in coordinated patterns
  cluster_id INT,

  -- Statistical Anomaly Signals (15% weight)
  adjusted_win_rate DECIMAL(5, 4) DEFAULT 0, -- Win rate adjusted for sample size (Bayesian)
  streak_anomaly_score DECIMAL(5, 4) DEFAULT 0, -- Probability of observed win streaks
  profit_distribution_skew DECIMAL(6, 4) DEFAULT 0, -- How skewed is profit distribution
  sharpe_anomaly_score DECIMAL(5, 4) DEFAULT 0, -- Sharpe ratio vs market average

  -- Composite Scores
  temporal_score DECIMAL(5, 2) DEFAULT 0, -- 0-30
  trade_quality_score DECIMAL(5, 2) DEFAULT 0, -- 0-25
  category_risk_score DECIMAL(5, 2) DEFAULT 0, -- 0-15
  network_score DECIMAL(5, 2) DEFAULT 0, -- 0-15
  statistical_score DECIMAL(5, 2) DEFAULT 0, -- 0-15
  total_insider_score DECIMAL(5, 2) DEFAULT 0, -- 0-100

  -- Metadata
  last_computed TIMESTAMP DEFAULT NOW(),
  computation_version INT DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_insider_signals_score ON wallet_insider_signals(total_insider_score DESC);

-- ============================================================
-- TRADE-LEVEL INSIDER TRACKING
-- ============================================================

-- Track timing of each trade relative to resolution
ALTER TABLE whale_trades ADD COLUMN IF NOT EXISTS resolution_time TIMESTAMP;
ALTER TABLE whale_trades ADD COLUMN IF NOT EXISTS minutes_to_resolution INT;
ALTER TABLE whale_trades ADD COLUMN IF NOT EXISTS price_at_resolution DECIMAL(10, 4);
ALTER TABLE whale_trades ADD COLUMN IF NOT EXISTS price_move_after_trade DECIMAL(10, 4);
ALTER TABLE whale_trades ADD COLUMN IF NOT EXISTS was_pre_news BOOLEAN DEFAULT FALSE;

-- Market prices snapshots for calculating price advantage
CREATE TABLE IF NOT EXISTS market_price_snapshots (
  id SERIAL PRIMARY KEY,
  condition_id VARCHAR(66) NOT NULL,
  token_id VARCHAR(100),
  snapshot_time TIMESTAMP NOT NULL,
  yes_price DECIMAL(10, 4),
  no_price DECIMAL(10, 4),
  volume_24h DECIMAL(20, 6),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_price_snapshots_market ON market_price_snapshots(condition_id, snapshot_time);

-- ============================================================
-- INSIDER ALERTS ENHANCEMENT
-- ============================================================

ALTER TABLE insider_alerts ADD COLUMN IF NOT EXISTS risk_category VARCHAR(100);
ALTER TABLE insider_alerts ADD COLUMN IF NOT EXISTS confidence_score DECIMAL(5, 4);
ALTER TABLE insider_alerts ADD COLUMN IF NOT EXISTS verified_outcome BOOLEAN; -- Was the alert correct after resolution?
ALTER TABLE insider_alerts ADD COLUMN IF NOT EXISTS resolution_result VARCHAR(10); -- 'correct', 'incorrect', 'pending'

-- Alert types expansion
-- 'pre_resolution_surge' - Multiple wallets trading right before resolution
-- 'collective_bet' - Coordinated betting by new/suspicious wallets
-- 'new_whale' - New wallet making large bet in risky category
-- 'timing_anomaly' - Trade timing suggests advance knowledge
-- 'cluster_activity' - Known cluster trading same direction
-- 'low_odds_winner' - Pattern of winning long-shot bets
-- 'category_specialist' - High win rate in single risky category

-- ============================================================
-- WALLET TRADE TIMING ANALYSIS
-- ============================================================

-- Pre-computed timing analysis per wallet per market
CREATE TABLE IF NOT EXISTS wallet_trade_timing (
  id SERIAL PRIMARY KEY,
  wallet_address VARCHAR(42) NOT NULL,
  condition_id VARCHAR(66) NOT NULL,

  first_trade_time TIMESTAMP,
  last_trade_time TIMESTAMP,
  resolution_time TIMESTAMP,

  minutes_before_resolution INT,
  position_direction VARCHAR(4), -- 'YES' or 'NO'
  position_size DECIMAL(20, 6),
  avg_entry_price DECIMAL(10, 4),

  outcome_correct BOOLEAN,
  profit_loss DECIMAL(20, 6),

  -- Was there a major price move after this wallet's trade?
  price_before_trade DECIMAL(10, 4),
  price_after_1h DECIMAL(10, 4),
  price_after_4h DECIMAL(10, 4),

  created_at TIMESTAMP DEFAULT NOW(),

  UNIQUE(wallet_address, condition_id)
);

CREATE INDEX IF NOT EXISTS idx_trade_timing_wallet ON wallet_trade_timing(wallet_address);
CREATE INDEX IF NOT EXISTS idx_trade_timing_resolution ON wallet_trade_timing(minutes_before_resolution);

-- ============================================================
-- VIEWS FOR ANALYSIS
-- ============================================================

-- Top insider suspects with full breakdown
CREATE OR REPLACE VIEW insider_suspects_detailed AS
SELECT
  w.address,
  w.polymarket_username,
  w.first_seen,
  w.total_trades,
  w.total_volume,
  w.win_count,
  w.loss_count,
  ROUND(w.win_count::numeric / NULLIF(w.win_count + w.loss_count, 0) * 100, 1) as win_rate_pct,

  -- Component scores
  COALESCE(wis.temporal_score, 0) as temporal_score,
  COALESCE(wis.trade_quality_score, 0) as trade_quality_score,
  COALESCE(wis.category_risk_score, 0) as category_risk_score,
  COALESCE(wis.network_score, 0) as network_score,
  COALESCE(wis.statistical_score, 0) as statistical_score,
  COALESCE(wis.total_insider_score, 0) as insider_score,

  -- Key signals
  COALESCE(wis.pre_resolution_24h_accuracy, 0) as pre_res_accuracy,
  COALESCE(wis.low_odds_win_rate, 0) as low_odds_win_rate,
  COALESCE(wis.high_risk_category_win_rate, 0) as risky_category_win_rate,
  wis.primary_category,
  wis.is_cluster_leader,
  wis.cluster_id,

  w.tags,
  wis.last_computed

FROM wallets w
LEFT JOIN wallet_insider_signals wis ON w.address = wis.wallet_address
WHERE w.total_volume > 1000
ORDER BY COALESCE(wis.total_insider_score, 0) DESC;

-- Markets with high insider activity
CREATE OR REPLACE VIEW markets_insider_activity AS
SELECT
  m.condition_id,
  m.question,
  m.category,
  m.insider_risk_level,
  m.insider_risk_multiplier,
  m.resolved,
  m.resolution_outcome,

  COUNT(DISTINCT wtt.wallet_address) as unique_traders,
  COUNT(DISTINCT wtt.wallet_address) FILTER (
    WHERE EXISTS (
      SELECT 1 FROM wallet_insider_signals wis
      WHERE wis.wallet_address = wtt.wallet_address
      AND wis.total_insider_score > 50
    )
  ) as suspicious_traders,

  SUM(wtt.position_size) as total_volume,
  SUM(wtt.position_size) FILTER (WHERE wtt.minutes_before_resolution < 60) as volume_last_hour,

  AVG(wtt.minutes_before_resolution) as avg_trade_timing,

  COUNT(*) FILTER (WHERE wtt.minutes_before_resolution < 60 AND wtt.outcome_correct = true) as last_hour_correct,
  COUNT(*) FILTER (WHERE wtt.minutes_before_resolution < 60) as last_hour_total

FROM markets m
LEFT JOIN wallet_trade_timing wtt ON m.condition_id = wtt.condition_id
GROUP BY m.condition_id, m.question, m.category, m.insider_risk_level,
         m.insider_risk_multiplier, m.resolved, m.resolution_outcome
HAVING COUNT(DISTINCT wtt.wallet_address) > 0
ORDER BY suspicious_traders DESC, total_volume DESC;
