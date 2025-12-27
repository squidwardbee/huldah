-- Wallet Intelligence System
-- Adds support for wallet snapshots, clusters, funding tracking, and subscriptions

-- ============================================================================
-- Wallet Clusters (Sybil Detection)
-- ============================================================================

CREATE TABLE IF NOT EXISTS wallet_clusters (
  cluster_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  detection_method VARCHAR(50) NOT NULL,  -- 'funding_pattern', 'timing', 'behavior', 'manual'
  confidence DECIMAL(5, 4) DEFAULT 0,     -- 0-1
  total_volume DECIMAL(20, 6) DEFAULT 0,
  member_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS wallet_cluster_members (
  wallet_address VARCHAR(42) REFERENCES wallets(address) ON DELETE CASCADE,
  cluster_id UUID REFERENCES wallet_clusters(cluster_id) ON DELETE CASCADE,
  role VARCHAR(20) DEFAULT 'unknown',     -- 'primary', 'funding', 'receiving', 'unknown'
  joined_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (wallet_address, cluster_id)
);

CREATE INDEX IF NOT EXISTS idx_cluster_members_cluster ON wallet_cluster_members(cluster_id);

-- ============================================================================
-- Wallet Snapshots (for ML/AI training)
-- ============================================================================

CREATE TABLE IF NOT EXISTS wallet_snapshots (
  id SERIAL PRIMARY KEY,
  wallet_address VARCHAR(42) REFERENCES wallets(address) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,

  -- Metrics at snapshot time
  total_volume DECIMAL(20, 6) DEFAULT 0,
  realized_pnl DECIMAL(20, 6) DEFAULT 0,
  unrealized_pnl DECIMAL(20, 6) DEFAULT 0,
  open_positions_value DECIMAL(20, 6) DEFAULT 0,
  open_positions_count INTEGER DEFAULT 0,
  win_count INTEGER DEFAULT 0,
  loss_count INTEGER DEFAULT 0,
  total_trades INTEGER DEFAULT 0,

  -- Scores at snapshot time
  smart_money_score INTEGER DEFAULT 0,
  insider_score INTEGER DEFAULT 0,
  whale_score INTEGER DEFAULT 0,

  -- Tags (denormalized for easy querying)
  tags TEXT[] DEFAULT '{}',

  -- Category breakdown (JSONB for flexibility)
  category_stats JSONB DEFAULT '{}',

  created_at TIMESTAMP DEFAULT NOW(),

  UNIQUE(wallet_address, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_snapshots_wallet ON wallet_snapshots(wallet_address);
CREATE INDEX IF NOT EXISTS idx_snapshots_date ON wallet_snapshots(snapshot_date);
CREATE INDEX IF NOT EXISTS idx_snapshots_wallet_date ON wallet_snapshots(wallet_address, snapshot_date DESC);

-- ============================================================================
-- Funding Events
-- ============================================================================

CREATE TABLE IF NOT EXISTS funding_events (
  id SERIAL PRIMARY KEY,
  wallet_address VARCHAR(42) REFERENCES wallets(address) ON DELETE CASCADE,
  direction VARCHAR(10) NOT NULL,          -- 'deposit' or 'withdrawal'
  counterparty VARCHAR(100),               -- Address or CEX name
  counterparty_type VARCHAR(20) DEFAULT 'unknown',  -- 'cex', 'dex', 'bridge', 'wallet', 'unknown'
  amount DECIMAL(20, 6) NOT NULL,
  token VARCHAR(20) DEFAULT 'USDC',
  timestamp TIMESTAMP NOT NULL,
  tx_hash VARCHAR(66) UNIQUE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_funding_wallet ON funding_events(wallet_address);
CREATE INDEX IF NOT EXISTS idx_funding_time ON funding_events(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_funding_direction ON funding_events(direction);

-- ============================================================================
-- Wallet Subscriptions (Observer Pattern for Monitoring)
-- ============================================================================

CREATE TABLE IF NOT EXISTS wallet_subscriptions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES trading_users(id) ON DELETE CASCADE,
  wallet_address VARCHAR(42) REFERENCES wallets(address) ON DELETE CASCADE,
  subscribed_at TIMESTAMP DEFAULT NOW(),

  -- Notification preferences
  notify_on_trade BOOLEAN DEFAULT FALSE,
  notify_on_whale_trade BOOLEAN DEFAULT TRUE,
  notify_on_new_position BOOLEAN DEFAULT FALSE,
  notify_on_position_closed BOOLEAN DEFAULT FALSE,

  -- User labels
  nickname VARCHAR(64),
  notes TEXT,

  UNIQUE(user_id, wallet_address)
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON wallet_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_wallet ON wallet_subscriptions(wallet_address);

-- ============================================================================
-- Enhanced Wallet Fields
-- ============================================================================

-- Add new columns to existing wallets table
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS total_deposited DECIMAL(20, 6) DEFAULT 0;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS total_withdrawn DECIMAL(20, 6) DEFAULT 0;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS unrealized_pnl DECIMAL(20, 6) DEFAULT 0;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS holdings_value DECIMAL(20, 6) DEFAULT 0;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS open_positions_count INTEGER DEFAULT 0;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS volume_24h DECIMAL(20, 6) DEFAULT 0;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS volume_7d DECIMAL(20, 6) DEFAULT 0;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS volume_30d DECIMAL(20, 6) DEFAULT 0;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS trades_24h INTEGER DEFAULT 0;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS trades_7d INTEGER DEFAULT 0;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS whale_score INTEGER DEFAULT 0;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS category_stats JSONB DEFAULT '{}';
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS cluster_id UUID REFERENCES wallet_clusters(cluster_id) ON DELETE SET NULL;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS profit_factor DECIMAL(10, 4) DEFAULT 0;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS max_drawdown DECIMAL(20, 6) DEFAULT 0;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS roi DECIMAL(10, 4) DEFAULT 0;

-- Index for cluster lookups
CREATE INDEX IF NOT EXISTS idx_wallets_cluster ON wallets(cluster_id) WHERE cluster_id IS NOT NULL;

-- Index for volume-based queries
CREATE INDEX IF NOT EXISTS idx_wallets_volume_24h ON wallets(volume_24h DESC);
CREATE INDEX IF NOT EXISTS idx_wallets_volume_7d ON wallets(volume_7d DESC);

-- ============================================================================
-- Enhanced Insider Alerts
-- ============================================================================

-- Add new alert types and resolution tracking
ALTER TABLE insider_alerts ADD COLUMN IF NOT EXISTS resolved BOOLEAN DEFAULT FALSE;
ALTER TABLE insider_alerts ADD COLUMN IF NOT EXISTS resolution_outcome VARCHAR(10);  -- 'YES' or 'NO'
ALTER TABLE insider_alerts ADD COLUMN IF NOT EXISTS alert_accuracy BOOLEAN;  -- Did alert predict correctly?
ALTER TABLE insider_alerts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

-- Index for unresolved alerts
CREATE INDEX IF NOT EXISTS idx_alerts_unresolved ON insider_alerts(resolved) WHERE resolved = FALSE;

-- ============================================================================
-- Subscription Activity Log (for notification delivery)
-- ============================================================================

CREATE TABLE IF NOT EXISTS subscription_activity_log (
  id SERIAL PRIMARY KEY,
  subscription_id INTEGER REFERENCES wallet_subscriptions(id) ON DELETE CASCADE,
  wallet_address VARCHAR(42) NOT NULL,
  activity_type VARCHAR(30) NOT NULL,   -- 'trade', 'whale_trade', 'position_opened', etc.
  activity_data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  delivered BOOLEAN DEFAULT FALSE,
  delivered_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_activity_log_subscription ON subscription_activity_log(subscription_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_wallet ON subscription_activity_log(wallet_address);
CREATE INDEX IF NOT EXISTS idx_activity_log_pending ON subscription_activity_log(delivered) WHERE delivered = FALSE;
