-- Cluster Enhancements for Wallet Clustering Feature
-- Adds cluster snapshots, aggregated stats, funding events, and funding source tracking

-- ============================================================================
-- Funding Events (for tracking wallet funding sources)
-- ============================================================================

CREATE TABLE IF NOT EXISTS funding_events (
  id SERIAL PRIMARY KEY,
  wallet_address VARCHAR(42) NOT NULL,
  direction VARCHAR(10) NOT NULL,  -- 'deposit' or 'withdrawal'
  counterparty VARCHAR(100) NOT NULL,  -- source address or CEX name
  counterparty_type VARCHAR(20) NOT NULL,  -- 'cex', 'wallet', 'bridge', 'dex', 'unknown'
  amount DECIMAL(20, 6) NOT NULL,
  token VARCHAR(20) DEFAULT 'USDC',
  timestamp TIMESTAMP NOT NULL,
  tx_hash VARCHAR(66) NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_funding_events_wallet ON funding_events(wallet_address);
CREATE INDEX IF NOT EXISTS idx_funding_events_counterparty ON funding_events(counterparty);
CREATE INDEX IF NOT EXISTS idx_funding_events_timestamp ON funding_events(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_funding_events_direction ON funding_events(direction);

-- Add funding totals to wallets table
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS total_deposited DECIMAL(20, 6) DEFAULT 0;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS total_withdrawn DECIMAL(20, 6) DEFAULT 0;

-- ============================================================================
-- Cluster Snapshots (for tracking cluster evolution over time)
-- ============================================================================

CREATE TABLE IF NOT EXISTS cluster_snapshots (
  id SERIAL PRIMARY KEY,
  cluster_id UUID REFERENCES wallet_clusters(cluster_id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,

  -- Aggregate metrics at snapshot time
  member_count INTEGER DEFAULT 0,
  total_volume DECIMAL(20, 6) DEFAULT 0,
  total_pnl DECIMAL(20, 6) DEFAULT 0,
  avg_win_rate DECIMAL(5, 4) DEFAULT 0,
  avg_insider_score INTEGER DEFAULT 0,

  -- After market resolutions, how accurate was cluster's betting?
  resolved_bets INTEGER DEFAULT 0,
  correct_bets INTEGER DEFAULT 0,
  outcome_accuracy DECIMAL(5, 4) DEFAULT 0,

  created_at TIMESTAMP DEFAULT NOW(),

  UNIQUE(cluster_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_cluster_snapshots_cluster ON cluster_snapshots(cluster_id);
CREATE INDEX IF NOT EXISTS idx_cluster_snapshots_date ON cluster_snapshots(snapshot_date DESC);

-- ============================================================================
-- Enhanced wallet_clusters fields
-- ============================================================================

-- Add aggregated performance stats
ALTER TABLE wallet_clusters ADD COLUMN IF NOT EXISTS total_pnl DECIMAL(20, 6) DEFAULT 0;
ALTER TABLE wallet_clusters ADD COLUMN IF NOT EXISTS avg_win_rate DECIMAL(5, 4) DEFAULT 0;
ALTER TABLE wallet_clusters ADD COLUMN IF NOT EXISTS avg_insider_score INTEGER DEFAULT 0;
ALTER TABLE wallet_clusters ADD COLUMN IF NOT EXISTS markets_traded INTEGER DEFAULT 0;

-- Funding source info (for funding_pattern clusters)
ALTER TABLE wallet_clusters ADD COLUMN IF NOT EXISTS funding_source VARCHAR(100);
ALTER TABLE wallet_clusters ADD COLUMN IF NOT EXISTS funding_source_type VARCHAR(20);
ALTER TABLE wallet_clusters ADD COLUMN IF NOT EXISTS total_funded DECIMAL(20, 6) DEFAULT 0;

-- Activity tracking
ALTER TABLE wallet_clusters ADD COLUMN IF NOT EXISTS last_activity TIMESTAMP;
ALTER TABLE wallet_clusters ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

-- ============================================================================
-- Enhanced wallet_cluster_members fields
-- ============================================================================

-- Add member-specific stats for quick display
ALTER TABLE wallet_cluster_members ADD COLUMN IF NOT EXISTS member_volume DECIMAL(20, 6) DEFAULT 0;
ALTER TABLE wallet_cluster_members ADD COLUMN IF NOT EXISTS member_pnl DECIMAL(20, 6) DEFAULT 0;
ALTER TABLE wallet_cluster_members ADD COLUMN IF NOT EXISTS funding_amount DECIMAL(20, 6) DEFAULT 0;
ALTER TABLE wallet_cluster_members ADD COLUMN IF NOT EXISTS funding_date TIMESTAMP;

-- ============================================================================
-- Indexes for cluster queries
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_clusters_method ON wallet_clusters(detection_method);
CREATE INDEX IF NOT EXISTS idx_clusters_volume ON wallet_clusters(total_volume DESC);
CREATE INDEX IF NOT EXISTS idx_clusters_active ON wallet_clusters(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_clusters_funding_source ON wallet_clusters(funding_source) WHERE funding_source IS NOT NULL;

-- ============================================================================
-- Function to update cluster aggregate stats
-- ============================================================================

CREATE OR REPLACE FUNCTION update_cluster_stats(p_cluster_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE wallet_clusters c
  SET
    member_count = (
      SELECT COUNT(*) FROM wallet_cluster_members WHERE cluster_id = p_cluster_id
    ),
    total_volume = (
      SELECT COALESCE(SUM(w.total_volume), 0)
      FROM wallet_cluster_members wcm
      JOIN wallets w ON wcm.wallet_address = w.address
      WHERE wcm.cluster_id = p_cluster_id
    ),
    total_pnl = (
      SELECT COALESCE(SUM(w.realized_pnl), 0)
      FROM wallet_cluster_members wcm
      JOIN wallets w ON wcm.wallet_address = w.address
      WHERE wcm.cluster_id = p_cluster_id
    ),
    avg_win_rate = (
      SELECT COALESCE(AVG(
        CASE WHEN (w.win_count + w.loss_count) > 0
        THEN w.win_count::numeric / (w.win_count + w.loss_count)
        ELSE 0 END
      ), 0)
      FROM wallet_cluster_members wcm
      JOIN wallets w ON wcm.wallet_address = w.address
      WHERE wcm.cluster_id = p_cluster_id
    ),
    avg_insider_score = (
      SELECT COALESCE(AVG(w.insider_score), 0)::int
      FROM wallet_cluster_members wcm
      JOIN wallets w ON wcm.wallet_address = w.address
      WHERE wcm.cluster_id = p_cluster_id
    ),
    markets_traded = (
      SELECT COUNT(DISTINCT wp.condition_id)
      FROM wallet_cluster_members wcm
      JOIN wallet_positions wp ON wcm.wallet_address = wp.wallet_address
      WHERE wcm.cluster_id = p_cluster_id
    ),
    updated_at = NOW()
  WHERE cluster_id = p_cluster_id;
END;
$$ LANGUAGE plpgsql;
