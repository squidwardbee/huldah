# Huldah.ai - Product Requirements Document

## Executive Summary

Huldah.ai is an ML-enabled prediction market trading terminal providing 10x faster execution than Polymarket's native UI. The platform targets sophisticated traders who need professional-grade tools for position management, whale tracking, copy trading, and automated strategies.

---

## Vision & Mission

**Vision:** The most advanced trading terminal for prediction markets - instant execution, comprehensive analytics, and intelligent automation.

**Mission:** Bridge the gap between Polymarket's growing liquidity and the sophisticated tooling traders need to capitalize on opportunities.

---

## Target Users

### Primary Persona: The Professional Bettor
- Makes 10+ trades per day
- Manages positions across 20+ markets
- Needs speed, reliability, and advanced order types
- Values real-time data and whale activity insights

### Secondary Persona: The Copy Trader
- Follows successful wallets
- Needs fast execution to minimize entry delta
- Wants automated position mirroring
- Values transparency in leader performance

### Tertiary Persona: The Quantitative Trader
- Builds automated strategies
- Needs API access and webhook integrations
- Values ML signals and pattern detection
- Interested in arbitrage opportunities

---

## Phase 1: Trading Terminal MVP

### 1.1 Core Trading Features

#### Order Execution Engine
**Goal:** Guaranteed execution with automatic retries and fallback mechanisms.

| Feature | Priority | Status | Notes |
|---------|----------|--------|-------|
| Market Orders (FOK) | P0 | ✅ Done | Fill-or-kill execution |
| Limit Orders (GTC) | P0 | ✅ Done | Good-til-cancelled |
| Order Retry Logic | P0 | ✅ Done | Auto-retry on failure |
| Transaction Monitoring | P0 | 🚧 In Progress | Track pending/confirmed states |
| Take Profit Orders | P1 | ❌ TODO | Auto-close at target price |
| Stop Loss Orders | P1 | ❌ TODO | Auto-close at stop price |
| Trailing Stop | P2 | ❌ TODO | Dynamic stop based on price movement |
| OCO Orders | P2 | ❌ TODO | One-cancels-other for TP/SL combo |
| Iceberg Orders | P3 | ❌ TODO | Hidden size, partial display |

#### Order Types Technical Spec

**Take Profit (TP)**
```typescript
interface TakeProfitOrder {
  tokenId: string;
  side: 'BUY' | 'SELL';
  size: number;
  triggerPrice: number;      // Price at which to trigger
  executionPrice?: number;   // Limit price (optional, market if omitted)
  positionId?: string;       // Link to existing position
}
```
- Backend monitors price via WebSocket
- When triggerPrice crossed, submit market/limit order
- Must handle partial fills on underlying position

**Stop Loss (SL)**
```typescript
interface StopLossOrder {
  tokenId: string;
  side: 'BUY' | 'SELL';
  size: number;
  triggerPrice: number;
  executionPrice?: number;
  slippage?: number;         // Max slippage tolerance
}
```
- Server-side monitoring required (client may disconnect)
- Slippage protection for volatile markets
- Priority execution queue

**OCO (One-Cancels-Other)**
```typescript
interface OCOOrder {
  takeProfitTrigger: number;
  stopLossTrigger: number;
  size: number;
  tokenId: string;
}
```
- When either triggers, cancel the other
- Atomic operation to prevent double execution

#### Position Management

| Feature | Priority | Status | Notes |
|---------|----------|--------|-------|
| Position List | P0 | ✅ Done | View all open positions |
| P&L Tracking | P0 | ✅ Done | Realized + unrealized |
| One-Click Close | P0 | 🚧 Partial | Close entire position |
| Partial Close | P1 | ❌ TODO | Close X% of position |
| Position Averaging | P1 | ❌ TODO | Add to position, recalc avg price |
| Bulk Close | P2 | ❌ TODO | Close multiple positions at once |

#### Market Data

| Feature | Priority | Status | Notes |
|---------|----------|--------|-------|
| Real-time Orderbook | P0 | ✅ Done | WebSocket updates |
| Price Charts | P0 | ✅ Done | Lightweight Charts integration |
| Best Bid/Ask Display | P0 | ✅ Done | Top of book |
| Market Search | P0 | ✅ Done | Filter markets |
| Volume Display | P0 | ✅ Done | 24h volume |
| Spread Indicator | P1 | ❌ TODO | Bid-ask spread % |
| Depth Chart | P1 | ❌ TODO | Visual orderbook depth |
| Trade History | P1 | ❌ TODO | Recent trades feed |
| Multi-timeframe Charts | P2 | ❌ TODO | 1m, 5m, 15m, 1h, 4h, 1d |

### 1.2 User Experience

#### Speed Optimizations

| Feature | Priority | Status | Notes |
|---------|----------|--------|-------|
| Keyboard Shortcuts | P1 | ❌ TODO | B=Buy, S=Sell, Esc=Cancel |
| One-Click Trading | P0 | ✅ Done | Direct from orderbook |
| Quick Size Buttons | P0 | ✅ Done | 10, 50, 100, 500 shares |
| Quick Price Buttons | P0 | ✅ Done | 25¢, 50¢, 75¢, current |
| Hot Keys for Markets | P2 | ❌ TODO | Number keys for watchlist |
| Order Templates | P2 | ❌ TODO | Save common order configs |

#### Keyboard Shortcuts Spec
```
Trading:
  B         - Focus Buy, pre-fill best ask
  S         - Focus Sell, pre-fill best bid
  M         - Toggle Market/Limit mode
  Enter     - Submit order
  Escape    - Cancel/Clear form

Navigation:
  1-9       - Select watchlist market 1-9
  ↑/↓       - Navigate market list
  Tab       - Cycle through panels

Quick Actions:
  Ctrl+C    - Close selected position
  Ctrl+A    - Close all positions
  Ctrl+R    - Refresh data
```

#### Feedback & Status

| Feature | Priority | Status | Notes |
|---------|----------|--------|-------|
| Order Confirmation | P0 | ✅ Done | Success/error messages |
| Transaction Status | P1 | 🚧 Partial | Pending/confirmed/failed |
| Sound Alerts | P2 | ❌ TODO | Audio for fills, errors |
| Desktop Notifications | P2 | ❌ TODO | Browser notifications |
| Order History | P1 | ❌ TODO | Past orders with status |

### 1.3 Authentication & Security

| Feature | Priority | Status | Notes |
|---------|----------|--------|-------|
| Wallet Connect | P0 | ✅ Done | Connect EOA wallet |
| API Key Storage | P0 | ✅ Done | Encrypted in DB |
| Session Management | P0 | ✅ Done | JWT tokens |
| 2FA | P2 | ❌ TODO | TOTP authentication |
| API Rate Limiting | P0 | ✅ Done | Protect endpoints |
| Withdrawal Whitelist | P3 | ❌ TODO | Approved addresses only |

---

## Phase 2: Whale Tracking

### 2.1 Core Features

| Feature | Priority | Status | Notes |
|---------|----------|--------|-------|
| Trade Feed | P0 | ✅ Done | Real-time large trades |
| Whale Wallet List | P0 | ✅ Done | Top traders by volume/PnL |
| Wallet Profiles | P1 | ❌ TODO | Detailed analytics per wallet |
| Trade Alerts | P1 | ❌ TODO | Push notifications for whale activity |
| Whale Impact Score | P2 | ❌ TODO | Measure market impact of trades |

### 2.2 Whale Analytics

| Feature | Priority | Notes |
|---------|----------|-------|
| Win Rate | P1 | Percentage of profitable trades |
| Avg Position Size | P1 | Typical bet size |
| Market Preferences | P2 | Categories they trade |
| Timing Analysis | P2 | When they typically trade |
| Entry Accuracy | P2 | How close to local min/max |

### 2.3 Alert System

```typescript
interface WhaleAlert {
  type: 'LARGE_TRADE' | 'NEW_POSITION' | 'POSITION_CLOSE' | 'UNUSUAL_ACTIVITY';
  wallet: string;
  market: string;
  side: 'BUY' | 'SELL';
  size: number;
  price: number;
  timestamp: Date;
  marketImpact?: number;  // Price change after trade
}
```

**Alert Delivery:**
- In-app toast notifications
- WebSocket push to connected clients
- Optional: Discord/Telegram webhooks
- Optional: Email digests

---

## Phase 3: Copy Trading

### 3.1 Core Features

| Feature | Priority | Notes |
|---------|----------|-------|
| Follow Wallet | P0 | Subscribe to wallet's trades |
| Auto-Copy Settings | P0 | Position size, max allocation |
| Copy Delay Analytics | P1 | Show execution delta |
| Performance Attribution | P1 | P&L from copied trades |
| Pause/Resume | P1 | Temporarily stop copying |

### 3.2 Copy Settings

```typescript
interface CopySettings {
  walletAddress: string;
  enabled: boolean;

  // Position Sizing
  sizeMode: 'FIXED' | 'PROPORTIONAL' | 'PERCENTAGE';
  fixedSize?: number;           // Fixed USDC per trade
  proportionalMultiplier?: number;  // 0.1x, 1x, 2x of leader
  maxPositionSize?: number;     // Cap per trade

  // Risk Management
  maxAllocation: number;        // Max total USDC allocated
  maxOpenPositions: number;     // Limit concurrent positions
  stopLossPercent?: number;     // Auto SL on copied positions

  // Filters
  minTradeSize?: number;        // Ignore small trades
  marketWhitelist?: string[];   // Only copy certain markets
  marketBlacklist?: string[];   // Exclude certain markets

  // Execution
  maxSlippage: number;          // Max acceptable slippage
  retryAttempts: number;        // Retry on failure
}
```

### 3.3 Leaderboard

| Metric | Description |
|--------|-------------|
| Total P&L | Lifetime profit/loss |
| Win Rate | % of profitable trades |
| Sharpe Ratio | Risk-adjusted returns |
| Max Drawdown | Largest peak-to-trough loss |
| Avg Hold Time | Typical position duration |
| Copiers Count | Number of followers |
| 7d/30d/90d Returns | Rolling performance |

---

## Phase 4: ML Analytics

### 4.1 Market Intelligence

| Feature | Priority | Notes |
|---------|----------|-------|
| Insider Activity Detection | P1 | Unusual trading patterns |
| Resolution Risk Score | P1 | Likelihood of disputed resolution |
| Price Prediction | P2 | ML-based price forecasting |
| Category Momentum | P2 | Sector rotation signals |
| Sentiment Analysis | P2 | Social/news sentiment |

### 4.2 Pattern Detection

**Dynamic Time Warping (DTW) Signals**
- Compare current price action to historical patterns
- Identify similar market conditions
- Generate similarity scores

**Insider Detection Heuristics**
```typescript
interface InsiderSignal {
  market: string;
  confidence: number;       // 0-100
  signals: {
    unusualVolume: boolean;
    priceVelocity: boolean;
    whaleClustering: boolean;
    timingAnomaly: boolean;
  };
  explanation: string;
}
```

### 4.3 Market Summaries

AI-generated market analysis including:
- Recent price action summary
- Key whale activity
- Resolution timeline/risks
- Related markets correlation
- Suggested strategies

---

## Phase 5: Automation

### 5.1 Trading Bots

| Feature | Priority | Notes |
|---------|----------|-------|
| Grid Bot | P2 | Buy/sell at intervals |
| DCA Bot | P2 | Dollar cost averaging |
| Arbitrage Bot | P2 | Cross-venue opportunities |
| Rebalancing Bot | P3 | Maintain target allocations |

### 5.2 Strategy Builder

```typescript
interface TradingStrategy {
  name: string;
  conditions: Condition[];
  actions: Action[];
  riskLimits: RiskLimits;
}

interface Condition {
  type: 'PRICE_ABOVE' | 'PRICE_BELOW' | 'WHALE_ACTIVITY' | 'VOLUME_SPIKE' | 'ML_SIGNAL';
  params: Record<string, any>;
}

interface Action {
  type: 'BUY' | 'SELL' | 'ALERT' | 'WEBHOOK';
  params: Record<string, any>;
}
```

---

## Technical Architecture

### Current Stack

**Frontend:**
- React 18 with TypeScript
- Zustand for state management
- TanStack Query for data fetching
- Socket.io for real-time updates
- Lightweight Charts for charting
- Tailwind CSS with terminal theme

**Backend:**
- Node.js/TypeScript API
- Polymarket SDK integration
- PostgreSQL + TimescaleDB
- Redis for caching
- WebSocket for real-time

**Infrastructure:**
- Frontend: Vercel
- Backend: Railway/Render
- Database: Managed Postgres
- Redis: Upstash

### Key Technical Constraints

1. **Polymarket SDK Limitations**
   - No Rust integration (JS/TS only)
   - Must use their CLOB (no direct market making)
   - Rate limits on API calls
   - WebSocket connection limits

2. **Execution Latency Goals**
   - Order submission: <100ms
   - WebSocket updates: <50ms
   - Page load: <2s
   - Chart render: <500ms

3. **Reliability Requirements**
   - Order retry with exponential backoff
   - Fallback execution paths
   - Transaction monitoring
   - Error recovery

---

## Database Schema (Key Tables)

```sql
-- User and authentication
users (id, eoa_address, proxy_address, created_at)
user_credentials (id, user_id, api_key_encrypted, api_secret_encrypted)
sessions (id, user_id, token, expires_at)

-- Trading
orders (id, user_id, market_id, token_id, side, price, size, type, status, created_at)
positions (id, user_id, market_id, token_id, size, avg_price, realized_pnl)
trades (id, order_id, price, size, fee, tx_hash, executed_at)

-- Conditional orders (TP/SL)
conditional_orders (id, user_id, position_id, type, trigger_price, size, status)

-- Whale tracking
whale_wallets (id, address, label, win_rate, total_volume, total_pnl)
whale_trades (id, wallet_id, market_id, side, price, size, timestamp)
whale_subscriptions (id, user_id, wallet_id, alert_enabled)

-- Copy trading
copy_settings (id, user_id, leader_wallet, enabled, size_mode, max_allocation)
copied_trades (id, copy_setting_id, leader_trade_id, our_order_id, slippage)
```

---

## API Endpoints (Core)

### Trading
```
POST /api/trading/orders           - Place order
GET  /api/trading/orders           - List orders
DELETE /api/trading/orders/:id     - Cancel order
GET  /api/trading/positions        - List positions
POST /api/trading/positions/:id/close - Close position

POST /api/trading/conditional      - Create TP/SL order
GET  /api/trading/conditional      - List conditional orders
DELETE /api/trading/conditional/:id - Cancel conditional
```

### Market Data
```
GET  /api/markets                  - List markets
GET  /api/markets/:id              - Market details
GET  /api/markets/:id/orderbook    - Orderbook snapshot
WS   /ws/orderbook/:tokenId        - Orderbook stream
WS   /ws/trades/:tokenId           - Trade stream
```

### Whale Tracking
```
GET  /api/whales                   - Top whale wallets
GET  /api/whales/:address          - Wallet profile
GET  /api/whales/:address/trades   - Wallet trade history
POST /api/whales/:address/subscribe - Subscribe to wallet
WS   /ws/whale-trades              - Real-time whale feed
```

### Copy Trading
```
POST /api/copy/settings            - Create copy config
GET  /api/copy/settings            - List copy configs
PUT  /api/copy/settings/:id        - Update config
DELETE /api/copy/settings/:id      - Stop copying
GET  /api/copy/performance         - Copy trading stats
```

---

## Success Metrics

### Phase 1: Trading Terminal
- Order success rate > 99%
- Order-to-confirmation latency < 2s
- Daily active traders
- Orders per user per day
- User retention (7-day, 30-day)

### Phase 2: Whale Tracking
- Whale feed engagement
- Alert click-through rate
- Whale trade correlation with user trades

### Phase 3: Copy Trading
- Copy traders count
- Copy trade execution delta (vs leader)
- Copied position P&L

### Phase 4: ML Analytics
- Signal accuracy (backtested)
- User engagement with ML features
- Premium conversion rate

---

## Immediate Next Steps (Priority Order)

### This Week
1. **Take Profit / Stop Loss Orders**
   - Backend: conditional order table + price monitoring service
   - Frontend: TP/SL inputs in OrderForm
   - WebSocket price monitoring for triggers

2. **Order History View**
   - Backend: query orders with pagination
   - Frontend: orders tab in Positions component

3. **Keyboard Shortcuts**
   - Global keydown listener
   - Focus management for order form
   - Visual shortcut hints

### Next Week
4. **Transaction Status Tracking**
   - Poll transaction status after order
   - Show pending/confirmed/failed states
   - Retry UI for failed orders

5. **Spread & Depth Visualization**
   - Calculate and display spread %
   - Add depth chart component

6. **Trade History Feed**
   - WebSocket subscription for trades
   - Recent trades panel

---

## Open Questions

1. **TP/SL Execution:** Should we use market orders or limit orders for TP/SL execution?
   - Market: Guaranteed fill, potential slippage
   - Limit: Price guarantee, might not fill

2. **Copy Trade Sizing:** What's the best default sizing mode?
   - Fixed: Simple but ignores leader sizing
   - Proportional: Scales with leader, harder to understand

3. **Whale Threshold:** What trade size qualifies as "whale"?
   - Current: $1,000
   - Consider: Dynamic based on market volume

4. **Alert Fatigue:** How to balance timely alerts vs. notification spam?
   - Aggregation windows
   - Importance scoring
   - User-configurable thresholds

---

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2024-12-24 | Claude | Initial PRD |
