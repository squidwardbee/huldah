# Wallet Intelligence System - Feature Document

## Overview

The Intelligence page provides deep wallet analytics, activity tracking, and insider detection for Polymarket traders. Users can monitor wallets, analyze trading patterns, and receive alerts on unusual market activity.

## Core Data Model

### WalletProfile Object

The central entity representing a tracked wallet with comprehensive analytics.

```typescript
interface WalletProfile {
  // Identity
  address: string;                    // Ethereum address (0x...)
  entityId?: string;                  // Link to known entity (fund, influencer, etc.)
  clusterId?: string;                 // Related wallet cluster (Sybil detection)
  firstSeen: Date;
  lastActive: Date;

  // Funding & Withdrawals
  funding: {
    totalDeposited: number;           // USDC deposited lifetime
    totalWithdrawn: number;           // USDC withdrawn lifetime
    netFunding: number;               // deposits - withdrawals
    lastFundingSource?: string;       // CEX name or wallet address
    fundingSourceType: 'cex' | 'dex' | 'bridge' | 'wallet' | 'unknown';
  };

  // Performance Metrics
  performance: {
    realizedPnl: number;              // Settled P&L
    unrealizedPnl: number;            // Open position P&L
    totalPnl: number;                 // realized + unrealized
    winCount: number;
    lossCount: number;
    winRate: number;                  // 0-1, wins / (wins + losses)
    profitFactor: number;             // sum(wins) / abs(sum(losses))
    maxDrawdown: number;              // Largest peak-to-trough decline
    roi: number;                      // totalPnl / totalDeposited
  };

  // Volume & Activity
  activity: {
    totalVolume: number;              // Lifetime USD volume
    totalTrades: number;
    avgTradeSize: number;
    volume24h: number;
    volume7d: number;
    volume30d: number;
    tradesLast24h: number;
    tradesLast7d: number;
  };

  // Holdings
  holdings: {
    openPositions: number;            // Count of open positions
    holdingsValue: number;            // Mark-to-market value
    largestPosition?: {
      marketId: string;
      marketQuestion: string;
      outcome: 'YES' | 'NO';
      size: number;
      value: number;
      unrealizedPnl: number;
    };
  };

  // Market Specialization
  specialization: {
    topCategories: Array<{
      category: string;               // Politics, Crypto, Sports, etc.
      volume: number;
      winRate: number;
      pnl: number;
    }>;
    marketsTraded: number;            // Unique markets
    marketConcentration: number;      // 0-1, Herfindahl index
    focusedMarkets: string[];         // Top 3 market IDs by volume
  };

  // Timing & Behavior
  behavior: {
    avgHoldTime: number;              // Hours average position held
    avgTimeToResolution: number;      // Hours before market closes when trading
    preResolutionRate: number;        // % trades in final 24h
    tradingHours: number[];           // 24-element array, activity by hour
    preferredSide: 'YES' | 'NO' | 'balanced';
  };

  // Scoring & Tags
  scores: {
    smartMoneyScore: number;          // 0-100
    insiderScore: number;             // 0-100
    whaleScore: number;               // 0-100 based on volume percentile
  };
  tags: string[];                     // whale, smart_money, insider_suspect, etc.

  // Fees (if available from subgraph)
  fees: {
    totalFeesPaid: number;
    avgFeePerTrade: number;
  };

  // Computed timestamps
  computedAt: Date;
  snapshotHistory?: WalletSnapshot[];  // For ML training
}
```

### WalletSnapshot (for ML/AI training)

Daily snapshots to track wallet evolution over time.

```typescript
interface WalletSnapshot {
  walletAddress: string;
  snapshotDate: Date;

  // Point-in-time metrics
  totalVolume: number;
  realizedPnl: number;
  unrealizedPnl: number;
  openPositionsValue: number;
  winCount: number;
  lossCount: number;

  // Scores at snapshot time
  smartMoneyScore: number;
  insiderScore: number;

  // Tags at snapshot time
  tags: string[];
}
```

### WalletTrade (individual trade record)

```typescript
interface WalletTrade {
  txHash: string;
  walletAddress: string;
  timestamp: Date;

  // Trade details
  marketId: string;
  marketQuestion: string;
  outcome: 'YES' | 'NO';
  side: 'BUY' | 'SELL';
  price: number;                      // 0-1
  size: number;                       // Token amount
  usdValue: number;

  // Context at trade time
  marketOdds: number;                 // Market price when trade occurred
  hoursToResolution?: number;         // If market has end_date

  // Post-resolution (filled later)
  outcomeCorrect?: boolean;
  profitLoss?: number;
}
```

### WalletCluster (Sybil detection)

```typescript
interface WalletCluster {
  clusterId: string;
  detectionMethod: 'funding_pattern' | 'timing' | 'behavior' | 'manual';
  confidence: number;                 // 0-1

  members: Array<{
    address: string;
    role: 'primary' | 'funding' | 'receiving' | 'unknown';
    joinedCluster: Date;
  }>;

  aggregateMetrics: {
    totalVolume: number;
    totalPnl: number;
    memberCount: number;
  };

  createdAt: Date;
  metadata?: Record<string, unknown>;
}
```

### FundingEvent

```typescript
interface FundingEvent {
  id: number;
  walletAddress: string;
  direction: 'deposit' | 'withdrawal';

  // Source/destination
  counterparty: string;               // Address or CEX name
  counterpartyType: 'cex' | 'dex' | 'bridge' | 'wallet' | 'unknown';

  amount: number;
  token: string;                      // USDC, MATIC, etc.
  timestamp: Date;
  txHash: string;
}
```

## Wallet Subscription System (Observer Pattern)

Simple implementation for wallet monitoring.

```typescript
interface WalletSubscription {
  userId: number;                     // trading_users.id
  walletAddress: string;
  subscribedAt: Date;

  // Notification preferences
  notifications: {
    onTrade: boolean;                 // Any trade
    onWhaleTrade: boolean;            // Trades > $1000
    onNewPosition: boolean;           // New market entered
    onPositionClosed: boolean;        // Position exited
  };

  // Optional labels
  nickname?: string;                  // User's label for this wallet
  notes?: string;
}

// Observer interface
interface WalletObserver {
  onWalletActivity(event: WalletActivityEvent): void;
}

interface WalletActivityEvent {
  type: 'trade' | 'whale_trade' | 'position_opened' | 'position_closed' | 'funding';
  walletAddress: string;
  timestamp: Date;
  data: WalletTrade | FundingEvent;
}
```

## Insider Alert System

```typescript
interface InsiderAlert {
  id: number;
  marketId: string;
  marketQuestion: string;
  alertType:
    | 'new_whale'              // Large wallet enters market
    | 'collective_bet'         // Multiple wallets same direction
    | 'pre_resolution_surge'   // Volume spike near resolution
    | 'low_odds_accumulation'  // Smart money buying cheap
    | 'unusual_timing'         // Trades at suspicious times
    | 'cluster_activity';      // Related wallets acting together

  severity: 'low' | 'medium' | 'high' | 'critical';

  // Context
  involvedWallets: Array<{
    address: string;
    volume: number;
    direction: 'YES' | 'NO';
  }>;
  totalVolume: number;
  betDirection: 'YES' | 'NO';
  oddsAtTime: number;

  description: string;
  createdAt: Date;

  // Resolution tracking
  resolved?: boolean;
  resolutionOutcome?: 'YES' | 'NO';
  alertAccuracy?: boolean;            // Did the alert predict correctly?
}
```

## Database Schema Additions

```sql
-- Wallet Profiles (enhanced view, computed from existing data)
-- Most fields derived from existing wallets table + new computations

-- Wallet Snapshots for ML training
CREATE TABLE wallet_snapshots (
  id SERIAL PRIMARY KEY,
  wallet_address VARCHAR(42) REFERENCES wallets(address),
  snapshot_date DATE NOT NULL,

  -- Metrics at snapshot time
  total_volume DECIMAL(20, 6),
  realized_pnl DECIMAL(20, 6),
  unrealized_pnl DECIMAL(20, 6),
  open_positions_value DECIMAL(20, 6),
  win_count INTEGER,
  loss_count INTEGER,

  -- Scores
  smart_money_score INTEGER,
  insider_score INTEGER,

  -- Tags (denormalized for easy querying)
  tags TEXT[],

  created_at TIMESTAMP DEFAULT NOW(),

  UNIQUE(wallet_address, snapshot_date)
);

CREATE INDEX idx_snapshots_wallet ON wallet_snapshots(wallet_address);
CREATE INDEX idx_snapshots_date ON wallet_snapshots(snapshot_date);

-- Wallet Clusters (Sybil detection)
CREATE TABLE wallet_clusters (
  cluster_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  detection_method VARCHAR(50) NOT NULL,
  confidence DECIMAL(5, 4),
  total_volume DECIMAL(20, 6),
  member_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  metadata JSONB
);

CREATE TABLE wallet_cluster_members (
  wallet_address VARCHAR(42) REFERENCES wallets(address),
  cluster_id UUID REFERENCES wallet_clusters(cluster_id) ON DELETE CASCADE,
  role VARCHAR(20) DEFAULT 'unknown',
  joined_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (wallet_address, cluster_id)
);

-- Funding Events
CREATE TABLE funding_events (
  id SERIAL PRIMARY KEY,
  wallet_address VARCHAR(42) REFERENCES wallets(address),
  direction VARCHAR(10) NOT NULL,     -- 'deposit' or 'withdrawal'
  counterparty VARCHAR(100),          -- Address or CEX name
  counterparty_type VARCHAR(20),      -- 'cex', 'dex', 'bridge', 'wallet', 'unknown'
  amount DECIMAL(20, 6) NOT NULL,
  token VARCHAR(20) DEFAULT 'USDC',
  timestamp TIMESTAMP NOT NULL,
  tx_hash VARCHAR(66) UNIQUE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_funding_wallet ON funding_events(wallet_address);
CREATE INDEX idx_funding_time ON funding_events(timestamp);

-- Wallet Subscriptions (for monitoring)
CREATE TABLE wallet_subscriptions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES trading_users(id) ON DELETE CASCADE,
  wallet_address VARCHAR(42) REFERENCES wallets(address),
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

CREATE INDEX idx_subscriptions_user ON wallet_subscriptions(user_id);
CREATE INDEX idx_subscriptions_wallet ON wallet_subscriptions(wallet_address);

-- Enhanced wallet fields (add to existing wallets table)
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS
  total_deposited DECIMAL(20, 6) DEFAULT 0,
  total_withdrawn DECIMAL(20, 6) DEFAULT 0,
  unrealized_pnl DECIMAL(20, 6) DEFAULT 0,
  holdings_value DECIMAL(20, 6) DEFAULT 0,
  open_positions_count INTEGER DEFAULT 0,
  volume_24h DECIMAL(20, 6) DEFAULT 0,
  volume_7d DECIMAL(20, 6) DEFAULT 0,
  volume_30d DECIMAL(20, 6) DEFAULT 0,
  trades_24h INTEGER DEFAULT 0,
  trades_7d INTEGER DEFAULT 0,
  category_stats JSONB DEFAULT '{}',
  cluster_id UUID REFERENCES wallet_clusters(cluster_id);
```

## Frontend Pages & Components

### Intelligence Page Structure

```
/intelligence
├── Tabs
│   ├── Activity    - Live whale feed + recent trades
│   ├── Wallets     - Top wallets with filtering/sorting
│   ├── Alerts      - Insider alerts + unusual activity
│   └── Monitor     - User's subscribed wallets
│
├── Wallet Detail Modal/Page
│   ├── Profile header (address, tags, scores)
│   ├── Performance metrics
│   ├── Holdings (open positions)
│   ├── Trade history
│   ├── Category breakdown
│   └── Subscribe button
│
└── Alert Detail Modal
    ├── Market info
    ├── Involved wallets
    ├── Timeline of activity
    └── Resolution tracking
```

### Component Hierarchy

```
IntelligencePage
├── IntelligenceHeader
│   └── TabNavigation [Activity, Wallets, Alerts, Monitor]
│
├── ActivityTab
│   ├── WhaleFeed (existing, enhanced)
│   └── RecentAlerts (sidebar)
│
├── WalletsTab
│   ├── WalletFilters
│   │   ├── TagFilter (whale, smart_money, insider, etc.)
│   │   ├── SortSelect (volume, pnl, win_rate, etc.)
│   │   └── SearchInput
│   ├── WalletGrid
│   │   └── WalletCard (compact view)
│   └── WalletDetailModal
│       ├── ProfileHeader
│       ├── PerformanceMetrics
│       ├── HoldingsTable
│       ├── TradeHistory
│       ├── CategoryBreakdown
│       └── SubscribeButton
│
├── AlertsTab
│   ├── AlertFilters
│   │   ├── SeverityFilter
│   │   ├── TypeFilter
│   │   └── MarketSearch
│   ├── AlertList
│   │   └── AlertCard
│   └── AlertDetailModal
│
└── MonitorTab
    ├── SubscribedWalletsList
    │   └── MonitoredWalletCard
    ├── ActivityFeed (for subscribed wallets only)
    └── EmptyState (if no subscriptions)
```

## API Endpoints

### Wallet Endpoints (Enhanced)

```
GET  /api/wallets                      - List wallets with filters
GET  /api/wallets/top                  - Top wallets by metric
GET  /api/wallets/:address             - Full wallet profile
GET  /api/wallets/:address/trades      - Wallet trade history
GET  /api/wallets/:address/positions   - Current holdings
GET  /api/wallets/:address/performance - Performance breakdown
GET  /api/wallets/:address/categories  - Category stats

POST /api/wallets/:address/subscribe   - Subscribe to wallet (auth required)
DELETE /api/wallets/:address/subscribe - Unsubscribe

GET  /api/user/subscriptions           - List subscribed wallets (auth required)
GET  /api/user/subscriptions/activity  - Activity feed for subscribed wallets
```

### Alert Endpoints

```
GET  /api/alerts                       - List alerts with filters
GET  /api/alerts/:id                   - Alert detail
GET  /api/alerts/market/:conditionId   - Alerts for specific market
GET  /api/alerts/recent                - Recent high-severity alerts
```

### Cluster Endpoints

```
GET  /api/clusters                     - List detected clusters
GET  /api/clusters/:clusterId          - Cluster detail with members
GET  /api/wallets/:address/cluster     - Get wallet's cluster (if any)
```

## ML/AI Considerations

### Feature Storage for Training

The `wallet_snapshots` table enables:
- Time-series analysis of wallet evolution
- Before/after comparisons for insider detection
- Feature engineering for classification models

### Recommended ML Features

```typescript
interface MLFeatures {
  // Static features
  accountAge: number;                  // Days since first_seen
  totalVolume: number;
  avgTradeSize: number;

  // Performance features
  winRate: number;
  profitFactor: number;
  roi: number;

  // Behavioral features
  marketConcentration: number;         // 0-1
  avgTimeToResolution: number;
  preResolutionRate: number;
  lowOddsWinRate: number;

  // Temporal features
  tradingHourEntropy: number;          // How spread out is activity
  tradeVelocity: number;               // Trades per day

  // Network features
  clusterSize: number;                 // 0 if not in cluster
  fundingSourceDiversity: number;

  // Labels (for supervised learning)
  isInsider?: boolean;                 // Manual label or derived
  isSmartMoney?: boolean;
  isProfitable?: boolean;
}
```

### Clustering Approach

For Sybil/related wallet detection:
1. **Funding pattern clustering** - Wallets funded by same source
2. **Timing clustering** - Wallets trading at same times
3. **Behavioral clustering** - Similar trading patterns (K-means, DBSCAN)
4. **Graph analysis** - Transaction flow between wallets

## Implementation Priority

### Phase 1: Core Data Model
1. Add new database tables (snapshots, clusters, funding, subscriptions)
2. Create WalletProfile service to compute full profiles
3. Enhance wallet API endpoints

### Phase 2: Subscription System
1. Implement wallet subscription CRUD
2. Add Observer pattern for activity notifications
3. Build Monitor tab UI

### Phase 3: Enhanced Analytics
1. Implement daily snapshot job
2. Add category performance tracking
3. Build wallet detail modal

### Phase 4: Cluster Detection
1. Implement funding flow tracking
2. Build clustering algorithms
3. Add cluster visualization

### Phase 5: ML Integration
1. Feature extraction pipeline
2. Model training infrastructure
3. Real-time scoring updates

## Notes

- All monetary values in USD
- Prices as decimals 0-1 (not percentages)
- Timestamps in UTC
- Addresses lowercase, checksummed for display only
- Tags are additive (wallet can have multiple)
- Scores 0-100 for consistency
