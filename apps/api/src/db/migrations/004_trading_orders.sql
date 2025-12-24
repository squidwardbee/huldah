-- Trading Orders Schema
-- Tracks all orders placed through the trading terminal

CREATE TABLE IF NOT EXISTS trading_orders (
  id SERIAL PRIMARY KEY,
  order_id VARCHAR(64) UNIQUE NOT NULL,
  
  -- Order details
  token_id VARCHAR(128) NOT NULL,
  side VARCHAR(4) NOT NULL,  -- 'BUY' or 'SELL'
  price DECIMAL(10, 4) NOT NULL,
  size DECIMAL(20, 6) NOT NULL,
  order_type VARCHAR(10) DEFAULT 'GTC',
  
  -- Execution tracking
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  execution_path VARCHAR(20),  -- 'CLOB_RELAYER', 'CLOB_DIRECT', 'ONCHAIN_CTF'
  transaction_hash VARCHAR(66),
  error_message TEXT,
  
  -- Fill tracking
  filled_size DECIMAL(20, 6) DEFAULT 0,
  avg_fill_price DECIMAL(10, 4),
  
  -- Retry tracking
  retry_count INT DEFAULT 0,
  last_retry_at TIMESTAMP,
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP,
  
  -- Constraints
  CHECK (side IN ('BUY', 'SELL')),
  CHECK (price >= 0.01 AND price <= 0.99),
  CHECK (size > 0),
  CHECK (status IN ('PENDING', 'SUBMITTED', 'EXECUTED', 'MINED', 'CONFIRMED', 'FAILED', 'RETRYING', 'CANCELLED'))
);

CREATE INDEX IF NOT EXISTS idx_trading_orders_status ON trading_orders(status);
CREATE INDEX IF NOT EXISTS idx_trading_orders_created ON trading_orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trading_orders_token ON trading_orders(token_id);

-- Order fills tracking
CREATE TABLE IF NOT EXISTS trading_fills (
  id SERIAL PRIMARY KEY,
  order_id VARCHAR(64) REFERENCES trading_orders(order_id),
  
  -- Fill details
  price DECIMAL(10, 4) NOT NULL,
  size DECIMAL(20, 6) NOT NULL,
  side VARCHAR(4) NOT NULL,
  
  -- Transaction
  transaction_hash VARCHAR(66),
  
  -- Timestamp
  filled_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trading_fills_order ON trading_fills(order_id);

-- Trading positions (aggregated)
CREATE TABLE IF NOT EXISTS trading_positions (
  id SERIAL PRIMARY KEY,
  token_id VARCHAR(128) UNIQUE NOT NULL,
  condition_id VARCHAR(66),
  
  -- Position details
  outcome VARCHAR(10),  -- 'YES' or 'NO'
  size DECIMAL(20, 6) NOT NULL DEFAULT 0,
  avg_entry_price DECIMAL(10, 4),
  
  -- P&L tracking
  realized_pnl DECIMAL(20, 6) DEFAULT 0,
  unrealized_pnl DECIMAL(20, 6) DEFAULT 0,
  
  -- Timestamps
  opened_at TIMESTAMP DEFAULT NOW(),
  closed_at TIMESTAMP,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trading_positions_token ON trading_positions(token_id);
CREATE INDEX IF NOT EXISTS idx_trading_positions_condition ON trading_positions(condition_id);

-- Trading stats (daily aggregates)
CREATE TABLE IF NOT EXISTS trading_stats (
  id SERIAL PRIMARY KEY,
  date DATE UNIQUE NOT NULL,
  
  -- Volume
  orders_placed INT DEFAULT 0,
  orders_filled INT DEFAULT 0,
  orders_failed INT DEFAULT 0,
  total_volume DECIMAL(20, 6) DEFAULT 0,
  
  -- Execution
  avg_execution_time_ms INT,
  relayer_usage INT DEFAULT 0,
  direct_usage INT DEFAULT 0,
  onchain_usage INT DEFAULT 0,
  
  -- P&L
  realized_pnl DECIMAL(20, 6) DEFAULT 0,
  
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_trading_stats_date ON trading_stats(date);

