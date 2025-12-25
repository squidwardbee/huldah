-- Multi-User Trading Schema
-- Supports multiple users trading through the aggregation terminal

-- Users table - tracks all registered users
CREATE TABLE IF NOT EXISTS trading_users (
  id SERIAL PRIMARY KEY,
  
  -- Wallet addresses
  eoa_address VARCHAR(42) UNIQUE NOT NULL,  -- User's EOA (MetaMask, etc.)
  proxy_address VARCHAR(42),  -- Deployed Safe/Proxy wallet
  
  -- User info
  username VARCHAR(64),
  
  -- Onboarding status
  proxy_deployed BOOLEAN DEFAULT FALSE,
  usdc_approved BOOLEAN DEFAULT FALSE,
  tokens_approved BOOLEAN DEFAULT FALSE,
  
  -- Stats
  total_orders INT DEFAULT 0,
  total_volume DECIMAL(20, 6) DEFAULT 0,
  total_trades INT DEFAULT 0,
  realized_pnl DECIMAL(20, 6) DEFAULT 0,
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  last_active TIMESTAMP DEFAULT NOW(),
  
  -- API credentials (encrypted/hashed - for server use)
  api_key_hash VARCHAR(128),
  api_nonce INT DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_trading_users_eoa ON trading_users(eoa_address);
CREATE INDEX IF NOT EXISTS idx_trading_users_proxy ON trading_users(proxy_address);

-- User sessions - for authenticated API access
CREATE TABLE IF NOT EXISTS user_sessions (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES trading_users(id) ON DELETE CASCADE,
  
  -- Session token (hashed)
  token_hash VARCHAR(128) UNIQUE NOT NULL,
  
  -- Session info
  expires_at TIMESTAMP NOT NULL,
  ip_address VARCHAR(45),
  user_agent TEXT,
  
  created_at TIMESTAMP DEFAULT NOW(),
  last_used TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expires_at);

-- User API credentials - Polymarket CLOB credentials per user
CREATE TABLE IF NOT EXISTS user_api_credentials (
  id SERIAL PRIMARY KEY,
  user_id INT UNIQUE REFERENCES trading_users(id) ON DELETE CASCADE,
  
  -- Encrypted credentials (AES-256)
  api_key_encrypted TEXT NOT NULL,
  api_secret_encrypted TEXT NOT NULL,
  api_passphrase_encrypted TEXT NOT NULL,
  
  -- Metadata
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Update trading_orders to be per-user
ALTER TABLE trading_orders ADD COLUMN IF NOT EXISTS user_id INT REFERENCES trading_users(id);
CREATE INDEX IF NOT EXISTS idx_trading_orders_user ON trading_orders(user_id);

-- User positions - per-user position tracking
CREATE TABLE IF NOT EXISTS user_positions (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES trading_users(id) ON DELETE CASCADE,
  
  -- Position details
  token_id VARCHAR(128) NOT NULL,
  condition_id VARCHAR(66),
  outcome VARCHAR(10),  -- 'YES' or 'NO'
  
  -- Position size and pricing
  size DECIMAL(20, 6) NOT NULL DEFAULT 0,
  avg_entry_price DECIMAL(10, 4),
  
  -- P&L
  realized_pnl DECIMAL(20, 6) DEFAULT 0,
  
  -- Timestamps
  opened_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(user_id, token_id)
);

CREATE INDEX IF NOT EXISTS idx_user_positions_user ON user_positions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_positions_token ON user_positions(token_id);

-- Pending operations - track async operations per user
CREATE TABLE IF NOT EXISTS user_pending_operations (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES trading_users(id) ON DELETE CASCADE,
  
  -- Operation details
  operation_type VARCHAR(50) NOT NULL,  -- 'deploy_wallet', 'approve_usdc', 'approve_tokens'
  status VARCHAR(20) DEFAULT 'PENDING',  -- 'PENDING', 'SUBMITTED', 'CONFIRMED', 'FAILED'
  
  -- Transaction info
  transaction_hash VARCHAR(66),
  error_message TEXT,
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_pending_ops_user ON user_pending_operations(user_id);
CREATE INDEX IF NOT EXISTS idx_user_pending_ops_status ON user_pending_operations(status);

-- Nonce tracking for signature verification
CREATE TABLE IF NOT EXISTS user_nonces (
  id SERIAL PRIMARY KEY,
  eoa_address VARCHAR(42) UNIQUE NOT NULL,
  nonce VARCHAR(64) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_nonces_address ON user_nonces(eoa_address);


