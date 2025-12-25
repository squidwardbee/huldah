# Huldah.ai - Architecture & MVP Build Guide

> ML-enabled prediction market terminal for Polymarket

## Product Vision

**Thesis**: Polymarket's native UI lacks features for sophisticated traders. As liquidity grows, demand for advanced terminals with analytics, copy trading, and speed advantages will increase.

**Core Problems Solved**:
- Lack of real-time whale activity visibility
- No insider/smart money tracking
- Slow execution vs native UI
- Missing analytics on market irregularities

---

## MVP Scope (Tonight's Build)

**Focus: Smart Wallet Tracking System** (no trading execution yet)

### What We're Building
1. **Data Ingestion Pipeline** - Pull trades/positions from Polymarket
2. **Whale Detection Engine** - Flag large trades (>$1000)
3. **Wallet Analytics Dashboard** - Track top wallets by win rate
4. **Real-time Feed** - WebSocket stream of whale activity

---

## Polymarket API Reference

### Key Endpoints

| API | Base URL | Purpose |
|-----|----------|---------|
| CLOB | `https://clob.polymarket.com` | Order book, trades, prices |
| Gamma | `https://gamma-api.polymarket.com` | Market metadata, events |
| Data API | `https://data-api.polymarket.com` | Historical trades, activity |
| WSS (Market) | `wss://ws-subscriptions-clob.polymarket.com/ws/market` | Real-time orderbook |
| WSS (User) | `wss://ws-subscriptions-clob.polymarket.com/ws/user` | User order updates |

### GraphQL Subgraphs (Goldsky)

| Subgraph | Endpoint |
|----------|----------|
| Orders | `https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/orderbook-subgraph/0.0.1/gn` |
| Positions | `https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/positions-subgraph/0.0.7/gn` |
| Activity | `https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/activity-subgraph/0.0.4/gn` |
| PNL | `https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/pnl-subgraph/0.0.14/gn` |

### Rate Limits (Key ones)

| Endpoint | Limit |
|----------|-------|
| General | 5000/10s |
| Data API | 200/10s |
| Data API /trades | 75/10s |
| Gamma /markets | 125/10s |
| Gamma /events | 100/10s |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND                                 │
│  React 18 + Zustand + TanStack Query + Lightweight Charts       │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐                │
│  │ Whale Feed  │ │ Market List │ │ Wallet View │                │
│  └─────────────┘ └─────────────┘ └─────────────┘                │
└────────────────────────┬────────────────────────────────────────┘
                         │ WebSocket + REST
┌────────────────────────▼────────────────────────────────────────┐
│                      BACKEND (Node.js)                          │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐             │
│  │ API Gateway  │ │ WS Manager   │ │ Trade Ingest │             │
│  └──────────────┘ └──────────────┘ └──────────────┘             │
└────────────────────────┬────────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────────┐
│                      DATA LAYER                                  │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐             │
│  │   Postgres   │ │    Redis     │ │  TimescaleDB │             │
│  │  (wallets,   │ │   (cache,    │ │  (time-series│             │
│  │   metadata)  │ │   pubsub)    │ │   trades)    │             │
│  └──────────────┘ └──────────────┘ └──────────────┘             │
└────────────────────────┬────────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────────┐
│                  POLYMARKET DATA SOURCES                         │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐             │
│  │  CLOB WSS    │ │ Gamma REST   │ │  Subgraph    │             │
│  │  (realtime)  │ │  (markets)   │ │  (positions) │             │
│  └──────────────┘ └──────────────┘ └──────────────┘             │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Flow for Whale Tracking

```
1. INGEST
   Polymarket WSS (market channel) 
   → Parse trade events 
   → Filter size > $1000

2. ENRICH  
   Trade event 
   → Lookup wallet in Positions Subgraph 
   → Calculate win rate, PnL
   → Store in Postgres

3. BROADCAST
   New whale trade 
   → Redis Pub/Sub 
   → WebSocket to frontend

4. DISPLAY
   Frontend receives 
   → Update whale feed 
   → Update wallet stats
```

---

## Database Schema

```sql
-- Core tables (PostgreSQL)

CREATE TABLE wallets (
  address VARCHAR(42) PRIMARY KEY,
  first_seen TIMESTAMP DEFAULT NOW(),
  total_trades INTEGER DEFAULT 0,
  total_volume DECIMAL(20, 6) DEFAULT 0,
  win_count INTEGER DEFAULT 0,
  loss_count INTEGER DEFAULT 0,
  realized_pnl DECIMAL(20, 6) DEFAULT 0,
  last_active TIMESTAMP,
  tags TEXT[], -- ['whale', 'insider', 'bot']
  metadata JSONB
);

CREATE TABLE trades (
  id SERIAL PRIMARY KEY,
  tx_hash VARCHAR(66),
  wallet_address VARCHAR(42) REFERENCES wallets(address),
  market_id VARCHAR(66),
  token_id VARCHAR(66),
  side VARCHAR(4), -- 'BUY' or 'SELL'
  price DECIMAL(10, 4),
  size DECIMAL(20, 6),
  usd_value DECIMAL(20, 6),
  timestamp TIMESTAMP,
  outcome VARCHAR(10), -- 'YES' or 'NO'
  is_whale BOOLEAN DEFAULT FALSE
);

CREATE TABLE markets (
  condition_id VARCHAR(66) PRIMARY KEY,
  question TEXT,
  slug VARCHAR(255),
  end_date TIMESTAMP,
  volume DECIMAL(20, 6),
  liquidity DECIMAL(20, 6),
  last_price_yes DECIMAL(10, 4),
  last_price_no DECIMAL(10, 4),
  resolved BOOLEAN DEFAULT FALSE,
  resolution_outcome VARCHAR(10),
  metadata JSONB
);

-- Indexes
CREATE INDEX idx_trades_wallet ON trades(wallet_address);
CREATE INDEX idx_trades_timestamp ON trades(timestamp DESC);
CREATE INDEX idx_trades_whale ON trades(is_whale) WHERE is_whale = TRUE;
CREATE INDEX idx_wallets_volume ON wallets(total_volume DESC);
```

---

## Project Structure

```
huldah/
├── apps/
│   ├── web/                    # React frontend
│   │   ├── src/
│   │   │   ├── components/
│   │   │   │   ├── WhaleFeed.tsx
│   │   │   │   ├── MarketList.tsx
│   │   │   │   ├── WalletCard.tsx
│   │   │   │   └── TradeRow.tsx
│   │   │   ├── hooks/
│   │   │   │   ├── useWhaleFeed.ts
│   │   │   │   ├── useMarkets.ts
│   │   │   │   └── useWallet.ts
│   │   │   ├── stores/
│   │   │   │   └── appStore.ts
│   │   │   ├── lib/
│   │   │   │   ├── api.ts
│   │   │   │   └── ws.ts
│   │   │   └── App.tsx
│   │   └── package.json
│   │
│   └── api/                    # Node.js backend
│       ├── src/
│       │   ├── services/
│       │   │   ├── polymarket/
│       │   │   │   ├── wsClient.ts
│       │   │   │   ├── gammaClient.ts
│       │   │   │   └── subgraphClient.ts
│       │   │   ├── tradeIngestion.ts
│       │   │   ├── whaleDetection.ts
│       │   │   └── walletAnalytics.ts
│       │   ├── routes/
│       │   │   ├── markets.ts
│       │   │   ├── wallets.ts
│       │   │   └── whales.ts
│       │   ├── db/
│       │   │   ├── client.ts
│       │   │   └── migrations/
│       │   ├── ws/
│       │   │   └── server.ts
│       │   └── index.ts
│       └── package.json
│
├── packages/
│   └── shared/                 # Shared types
│       └── types.ts
│
├── docker-compose.yml
└── package.json
```

---

## Build Steps

### Phase 1: Setup (30 min)

```bash
# 1. Create project
mkdir huldah && cd huldah
pnpm init

# 2. Setup monorepo
pnpm add -D turbo
mkdir -p apps/web apps/api packages/shared

# 3. Docker for DB
cat > docker-compose.yml << 'EOF'
version: '3.8'
services:
  postgres:
    image: timescale/timescaledb:latest-pg15
    environment:
      POSTGRES_USER: huldah
      POSTGRES_PASSWORD: huldah
      POSTGRES_DB: huldah
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

volumes:
  pgdata:
EOF

docker-compose up -d
```

### Phase 2: Backend Core (1.5 hr)

#### 2.1 Initialize API

```bash
cd apps/api
pnpm init
pnpm add express ws axios pg ioredis dotenv zod
pnpm add -D typescript @types/express @types/ws @types/node tsx
```

#### 2.2 Polymarket WebSocket Client

```typescript
// apps/api/src/services/polymarket/wsClient.ts
import WebSocket from 'ws';
import { EventEmitter } from 'events';

const WS_URL = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';

export class PolymarketWSClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private assetIds: string[] = [];
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private pingInterval: NodeJS.Timeout | null = null;

  connect(assetIds: string[]) {
    this.assetIds = assetIds;
    this.ws = new WebSocket(WS_URL);

    this.ws.on('open', () => {
      console.log('[WS] Connected to Polymarket');
      this.reconnectAttempts = 0;
      this.subscribe(assetIds);
      this.startPing();
    });

    this.ws.on('message', (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        this.handleMessage(msg);
      } catch (e) {
        console.error('[WS] Parse error:', e);
      }
    });

    this.ws.on('close', () => {
      console.log('[WS] Disconnected');
      this.stopPing();
      this.reconnect();
    });

    this.ws.on('error', (err) => {
      console.error('[WS] Error:', err);
    });
  }

  private subscribe(assetIds: string[]) {
    if (!this.ws) return;
    this.ws.send(JSON.stringify({
      assets_ids: assetIds,
      type: 'market'
    }));
  }

  subscribeMore(assetIds: string[]) {
    if (!this.ws) return;
    this.ws.send(JSON.stringify({
      assets_ids: assetIds,
      operation: 'subscribe'
    }));
  }

  private handleMessage(msg: any) {
    const eventType = msg.event_type;
    
    switch (eventType) {
      case 'last_trade_price':
        // Trade occurred
        this.emit('trade', {
          assetId: msg.asset_id,
          price: parseFloat(msg.price),
          side: msg.side,
          size: parseFloat(msg.size),
          timestamp: msg.timestamp
        });
        break;
      
      case 'book':
        // Order book update
        this.emit('book', {
          assetId: msg.asset_id,
          bids: msg.bids,
          asks: msg.asks
        });
        break;
        
      case 'price_change':
        this.emit('price', msg.price_changes);
        break;
    }
  }

  private startPing() {
    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, 30000);
  }

  private stopPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private reconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[WS] Max reconnect attempts reached');
      return;
    }
    
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;
    
    console.log(`[WS] Reconnecting in ${delay}ms...`);
    setTimeout(() => this.connect(this.assetIds), delay);
  }

  disconnect() {
    this.stopPing();
    this.ws?.close();
  }
}
```

#### 2.3 Gamma Client (Market Data)

```typescript
// apps/api/src/services/polymarket/gammaClient.ts
import axios from 'axios';

const GAMMA_URL = 'https://gamma-api.polymarket.com';

export interface GammaMarket {
  condition_id: string;
  question_id: string;
  tokens: { token_id: string; outcome: string }[];
  question: string;
  slug: string;
  end_date_iso: string;
  volume: string;
  liquidity: string;
  active: boolean;
}

export class GammaClient {
  private axios = axios.create({
    baseURL: GAMMA_URL,
    timeout: 10000
  });

  async getActiveMarkets(limit = 100, offset = 0): Promise<GammaMarket[]> {
    const { data } = await this.axios.get('/markets', {
      params: { active: true, closed: false, limit, offset }
    });
    return data;
  }

  async getMarket(conditionId: string): Promise<GammaMarket> {
    const { data } = await this.axios.get(`/markets/${conditionId}`);
    return data;
  }

  async getAllActiveMarkets(): Promise<GammaMarket[]> {
    const markets: GammaMarket[] = [];
    let offset = 0;
    const limit = 100;

    while (true) {
      const batch = await this.getActiveMarkets(limit, offset);
      if (batch.length === 0) break;
      markets.push(...batch);
      offset += limit;
      if (batch.length < limit) break;
    }

    return markets;
  }
}
```

#### 2.4 Subgraph Client (Positions/PnL)

```typescript
// apps/api/src/services/polymarket/subgraphClient.ts
import axios from 'axios';

const ENDPOINTS = {
  positions: 'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/positions-subgraph/0.0.7/gn',
  pnl: 'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/pnl-subgraph/0.0.14/gn',
  activity: 'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/activity-subgraph/0.0.4/gn'
};

export interface Position {
  condition: string;
  outcomeIndex: number;
  balance: string;
  averagePrice: string;
  realizedPnl: string;
}

export class SubgraphClient {
  async query<T>(endpoint: string, query: string, variables?: Record<string, any>): Promise<T> {
    const { data } = await axios.post(endpoint, { query, variables });
    if (data.errors) {
      throw new Error(data.errors[0].message);
    }
    return data.data;
  }

  async getWalletPositions(walletAddress: string, first = 100): Promise<Position[]> {
    const query = `
      query GetPositions($wallet: String!, $first: Int!) {
        positions(where: { user: $wallet }, first: $first) {
          condition
          outcomeIndex
          balance
          averagePrice
          realizedPnl
        }
      }
    `;
    
    const result = await this.query<{ positions: Position[] }>(
      ENDPOINTS.positions,
      query,
      { wallet: walletAddress.toLowerCase(), first }
    );
    
    return result.positions;
  }

  async getTopWalletsByPnL(first = 100): Promise<{ id: string; realizedPnl: string }[]> {
    const query = `
      query TopWallets($first: Int!) {
        users(first: $first, orderBy: realizedPnl, orderDirection: desc) {
          id
          realizedPnl
        }
      }
    `;
    
    const result = await this.query<{ users: { id: string; realizedPnl: string }[] }>(
      ENDPOINTS.pnl,
      query,
      { first }
    );
    
    return result.users;
  }
}
```

#### 2.5 Trade Ingestion Service

```typescript
// apps/api/src/services/tradeIngestion.ts
import { Pool } from 'pg';
import Redis from 'ioredis';
import { PolymarketWSClient } from './polymarket/wsClient';
import { GammaClient } from './polymarket/gammaClient';

const WHALE_THRESHOLD = 1000; // $1000

interface TradeEvent {
  assetId: string;
  price: number;
  side: string;
  size: number;
  timestamp: string;
}

export class TradeIngestionService {
  private ws: PolymarketWSClient;
  private gamma: GammaClient;
  private db: Pool;
  private redis: Redis;
  private tokenToMarket: Map<string, string> = new Map();

  constructor(db: Pool, redis: Redis) {
    this.db = db;
    this.redis = redis;
    this.ws = new PolymarketWSClient();
    this.gamma = new GammaClient();
  }

  async start() {
    // Load all active markets
    console.log('[Ingest] Loading markets...');
    const markets = await this.gamma.getAllActiveMarkets();
    
    const tokenIds: string[] = [];
    for (const market of markets) {
      for (const token of market.tokens) {
        tokenIds.push(token.token_id);
        this.tokenToMarket.set(token.token_id, market.condition_id);
      }
      
      // Upsert market
      await this.db.query(`
        INSERT INTO markets (condition_id, question, slug, end_date, volume, liquidity)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (condition_id) DO UPDATE SET
          volume = EXCLUDED.volume,
          liquidity = EXCLUDED.liquidity
      `, [
        market.condition_id,
        market.question,
        market.slug,
        market.end_date_iso,
        market.volume,
        market.liquidity
      ]);
    }

    console.log(`[Ingest] Loaded ${markets.length} markets, ${tokenIds.length} tokens`);

    // Connect WebSocket
    this.ws.on('trade', (trade: TradeEvent) => this.handleTrade(trade));
    this.ws.connect(tokenIds);
  }

  private async handleTrade(trade: TradeEvent) {
    const usdValue = trade.price * trade.size;
    const isWhale = usdValue >= WHALE_THRESHOLD;
    const marketId = this.tokenToMarket.get(trade.assetId);

    // For now we don't have wallet address from WS - need to poll trades endpoint
    // This is a limitation - real implementation needs to correlate with on-chain data
    
    if (isWhale) {
      console.log(`[WHALE] $${usdValue.toFixed(2)} trade on ${trade.assetId}`);
      
      // Publish to Redis for real-time feed
      await this.redis.publish('whale_trades', JSON.stringify({
        assetId: trade.assetId,
        marketId,
        price: trade.price,
        size: trade.size,
        usdValue,
        side: trade.side,
        timestamp: trade.timestamp
      }));
    }
  }

  stop() {
    this.ws.disconnect();
  }
}
```

#### 2.6 Alternative: Poll Data API for Trades with Wallet

```typescript
// apps/api/src/services/tradePoller.ts
import axios from 'axios';
import { Pool } from 'pg';
import Redis from 'ioredis';

const DATA_API = 'https://data-api.polymarket.com';
const WHALE_THRESHOLD = 1000;

interface DataTrade {
  id: string;
  taker_order_id: string;
  market: string;
  asset_id: string;
  side: string;
  size: string;
  price: string;
  maker_address: string;
  taker_address: string;
  timestamp: number;
  transaction_hash: string;
}

export class TradePoller {
  private db: Pool;
  private redis: Redis;
  private lastTimestamp: number = Date.now() - 60000; // Start 1 min ago
  private pollInterval: NodeJS.Timeout | null = null;

  constructor(db: Pool, redis: Redis) {
    this.db = db;
    this.redis = redis;
  }

  async start() {
    // Poll every 2 seconds
    this.pollInterval = setInterval(() => this.poll(), 2000);
    console.log('[Poller] Started trade polling');
  }

  private async poll() {
    try {
      const { data: trades } = await axios.get<DataTrade[]>(`${DATA_API}/trades`, {
        params: {
          after: this.lastTimestamp,
          limit: 100
        }
      });

      if (trades.length === 0) return;

      this.lastTimestamp = Math.max(...trades.map(t => t.timestamp));

      for (const trade of trades) {
        await this.processTrade(trade);
      }
    } catch (err) {
      console.error('[Poller] Error:', err);
    }
  }

  private async processTrade(trade: DataTrade) {
    const size = parseFloat(trade.size);
    const price = parseFloat(trade.price);
    const usdValue = size * price;
    const isWhale = usdValue >= WHALE_THRESHOLD;

    // Upsert wallet
    await this.db.query(`
      INSERT INTO wallets (address, total_trades, total_volume, last_active)
      VALUES ($1, 1, $2, NOW())
      ON CONFLICT (address) DO UPDATE SET
        total_trades = wallets.total_trades + 1,
        total_volume = wallets.total_volume + $2,
        last_active = NOW()
    `, [trade.taker_address, usdValue]);

    // Insert trade
    await this.db.query(`
      INSERT INTO trades (tx_hash, wallet_address, market_id, token_id, side, price, size, usd_value, timestamp, is_whale)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, to_timestamp($9), $10)
      ON CONFLICT DO NOTHING
    `, [
      trade.transaction_hash,
      trade.taker_address,
      trade.market,
      trade.asset_id,
      trade.side,
      price,
      size,
      usdValue,
      trade.timestamp / 1000,
      isWhale
    ]);

    if (isWhale) {
      console.log(`[WHALE] ${trade.taker_address} - $${usdValue.toFixed(0)} ${trade.side}`);
      
      // Get wallet stats
      const { rows } = await this.db.query(`
        SELECT total_trades, total_volume, win_count, loss_count
        FROM wallets WHERE address = $1
      `, [trade.taker_address]);

      await this.redis.publish('whale_trades', JSON.stringify({
        wallet: trade.taker_address,
        marketId: trade.market,
        tokenId: trade.asset_id,
        side: trade.side,
        price,
        size,
        usdValue,
        timestamp: trade.timestamp,
        txHash: trade.transaction_hash,
        walletStats: rows[0]
      }));
    }
  }

  stop() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }
  }
}
```

#### 2.7 Express Server

```typescript
// apps/api/src/index.ts
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { Pool } from 'pg';
import Redis from 'ioredis';
import cors from 'cors';
import { TradePoller } from './services/tradePoller';

const app = express();
app.use(cors());
app.use(express.json());

// Database
const db = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: 5432,
  user: 'huldah',
  password: 'huldah',
  database: 'huldah'
});

// Redis
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const redisSub = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

// Routes
app.get('/api/whales', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
  
  const { rows } = await db.query(`
    SELECT t.*, m.question, m.slug
    FROM trades t
    LEFT JOIN markets m ON t.market_id = m.condition_id
    WHERE t.is_whale = true
    ORDER BY t.timestamp DESC
    LIMIT $1
  `, [limit]);
  
  res.json(rows);
});

app.get('/api/wallets/top', async (req, res) => {
  const { rows } = await db.query(`
    SELECT address, total_trades, total_volume, win_count, loss_count, realized_pnl,
           CASE WHEN (win_count + loss_count) > 0 
                THEN win_count::float / (win_count + loss_count) 
                ELSE 0 END as win_rate
    FROM wallets
    ORDER BY total_volume DESC
    LIMIT 50
  `);
  
  res.json(rows);
});

app.get('/api/wallets/:address', async (req, res) => {
  const { address } = req.params;
  
  const wallet = await db.query(`SELECT * FROM wallets WHERE address = $1`, [address]);
  const trades = await db.query(`
    SELECT t.*, m.question
    FROM trades t
    LEFT JOIN markets m ON t.market_id = m.condition_id
    WHERE t.wallet_address = $1
    ORDER BY t.timestamp DESC
    LIMIT 100
  `, [address]);
  
  res.json({
    wallet: wallet.rows[0],
    trades: trades.rows
  });
});

app.get('/api/markets', async (req, res) => {
  const { rows } = await db.query(`
    SELECT * FROM markets
    WHERE resolved = false
    ORDER BY volume DESC
    LIMIT 100
  `);
  res.json(rows);
});

// HTTP + WebSocket server
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// Track connected clients
const clients = new Set<WebSocket>();

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log(`[WS] Client connected (${clients.size} total)`);
  
  ws.on('close', () => {
    clients.delete(ws);
  });
});

// Broadcast whale trades to all clients
redisSub.subscribe('whale_trades');
redisSub.on('message', (channel, message) => {
  if (channel === 'whale_trades') {
    const payload = JSON.stringify({ type: 'whale_trade', data: JSON.parse(message) });
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }
});

// Start services
const poller = new TradePoller(db, redis);

server.listen(3001, async () => {
  console.log('[Server] Running on http://localhost:3001');
  await poller.start();
});
```

### Phase 3: Frontend (1.5 hr)

#### 3.1 Initialize

```bash
cd apps/web
pnpm create vite . --template react-ts
pnpm add zustand @tanstack/react-query axios
pnpm add -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
```

#### 3.2 Zustand Store

```typescript
// apps/web/src/stores/appStore.ts
import { create } from 'zustand';

interface WhaleTrade {
  wallet: string;
  marketId: string;
  side: string;
  price: number;
  size: number;
  usdValue: number;
  timestamp: number;
  question?: string;
}

interface Wallet {
  address: string;
  total_trades: number;
  total_volume: number;
  win_rate: number;
}

interface AppState {
  whaleTrades: WhaleTrade[];
  topWallets: Wallet[];
  connected: boolean;
  addWhaleTrade: (trade: WhaleTrade) => void;
  setTopWallets: (wallets: Wallet[]) => void;
  setConnected: (status: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  whaleTrades: [],
  topWallets: [],
  connected: false,
  
  addWhaleTrade: (trade) => set((state) => ({
    whaleTrades: [trade, ...state.whaleTrades].slice(0, 100)
  })),
  
  setTopWallets: (wallets) => set({ topWallets: wallets }),
  
  setConnected: (status) => set({ connected: status })
}));
```

#### 3.3 WebSocket Hook

```typescript
// apps/web/src/hooks/useWhaleFeed.ts
import { useEffect, useRef } from 'react';
import { useAppStore } from '../stores/appStore';

const WS_URL = 'ws://localhost:3001/ws';

export function useWhaleFeed() {
  const ws = useRef<WebSocket | null>(null);
  const { addWhaleTrade, setConnected } = useAppStore();

  useEffect(() => {
    const connect = () => {
      ws.current = new WebSocket(WS_URL);
      
      ws.current.onopen = () => {
        console.log('[WS] Connected');
        setConnected(true);
      };
      
      ws.current.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'whale_trade') {
          addWhaleTrade(msg.data);
        }
      };
      
      ws.current.onclose = () => {
        setConnected(false);
        setTimeout(connect, 3000);
      };
    };

    connect();

    return () => {
      ws.current?.close();
    };
  }, []);
}
```

#### 3.4 Main Components

```tsx
// apps/web/src/components/WhaleFeed.tsx
import { useAppStore } from '../stores/appStore';

export function WhaleFeed() {
  const { whaleTrades, connected } = useAppStore();

  return (
    <div className="bg-gray-900 rounded-lg p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-white">🐋 Whale Activity</h2>
        <span className={`px-2 py-1 rounded text-sm ${connected ? 'bg-green-600' : 'bg-red-600'}`}>
          {connected ? 'LIVE' : 'DISCONNECTED'}
        </span>
      </div>
      
      <div className="space-y-2 max-h-96 overflow-y-auto">
        {whaleTrades.length === 0 ? (
          <p className="text-gray-400">Waiting for whale trades...</p>
        ) : (
          whaleTrades.map((trade, i) => (
            <div key={i} className="bg-gray-800 rounded p-3 flex justify-between items-center">
              <div>
                <span className={`font-mono text-sm ${trade.side === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>
                  {trade.side}
                </span>
                <span className="text-gray-300 ml-2">
                  ${trade.usdValue.toFixed(0)}
                </span>
              </div>
              <a 
                href={`https://polygonscan.com/address/${trade.wallet}`}
                target="_blank"
                className="text-blue-400 text-sm hover:underline"
              >
                {trade.wallet.slice(0, 6)}...{trade.wallet.slice(-4)}
              </a>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
```

```tsx
// apps/web/src/components/TopWallets.tsx
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';

export function TopWallets() {
  const { data: wallets, isLoading } = useQuery({
    queryKey: ['topWallets'],
    queryFn: async () => {
      const { data } = await axios.get('http://localhost:3001/api/wallets/top');
      return data;
    },
    refetchInterval: 30000
  });

  if (isLoading) return <div className="text-gray-400">Loading...</div>;

  return (
    <div className="bg-gray-900 rounded-lg p-4">
      <h2 className="text-xl font-bold text-white mb-4">📊 Top Wallets</h2>
      
      <table className="w-full text-sm">
        <thead>
          <tr className="text-gray-400 text-left">
            <th className="pb-2">Wallet</th>
            <th className="pb-2">Volume</th>
            <th className="pb-2">Trades</th>
            <th className="pb-2">Win Rate</th>
          </tr>
        </thead>
        <tbody>
          {wallets?.slice(0, 20).map((w: any) => (
            <tr key={w.address} className="border-t border-gray-800">
              <td className="py-2 text-blue-400 font-mono">
                {w.address.slice(0, 8)}...
              </td>
              <td className="py-2 text-white">
                ${(w.total_volume / 1000).toFixed(1)}k
              </td>
              <td className="py-2 text-gray-300">{w.total_trades}</td>
              <td className="py-2">
                <span className={w.win_rate > 0.5 ? 'text-green-400' : 'text-red-400'}>
                  {(w.win_rate * 100).toFixed(0)}%
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

```tsx
// apps/web/src/App.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WhaleFeed } from './components/WhaleFeed';
import { TopWallets } from './components/TopWallets';
import { useWhaleFeed } from './hooks/useWhaleFeed';

const queryClient = new QueryClient();

function Dashboard() {
  useWhaleFeed();

  return (
    <div className="min-h-screen bg-black text-white p-6">
      <header className="mb-8">
        <h1 className="text-3xl font-bold">Huldah.ai</h1>
        <p className="text-gray-400">ML-enabled prediction market terminal</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <WhaleFeed />
        <TopWallets />
      </div>
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Dashboard />
    </QueryClientProvider>
  );
}
```

### Phase 4: Database Migration

```bash
# Run in psql or via migration tool
psql -h localhost -U huldah -d huldah -f apps/api/src/db/migrations/001_init.sql
```

```sql
-- apps/api/src/db/migrations/001_init.sql
CREATE TABLE IF NOT EXISTS wallets (
  address VARCHAR(42) PRIMARY KEY,
  first_seen TIMESTAMP DEFAULT NOW(),
  total_trades INTEGER DEFAULT 0,
  total_volume DECIMAL(20, 6) DEFAULT 0,
  win_count INTEGER DEFAULT 0,
  loss_count INTEGER DEFAULT 0,
  realized_pnl DECIMAL(20, 6) DEFAULT 0,
  last_active TIMESTAMP,
  tags TEXT[],
  metadata JSONB
);

CREATE TABLE IF NOT EXISTS trades (
  id SERIAL PRIMARY KEY,
  tx_hash VARCHAR(66) UNIQUE,
  wallet_address VARCHAR(42) REFERENCES wallets(address),
  market_id VARCHAR(66),
  token_id VARCHAR(66),
  side VARCHAR(4),
  price DECIMAL(10, 4),
  size DECIMAL(20, 6),
  usd_value DECIMAL(20, 6),
  timestamp TIMESTAMP,
  outcome VARCHAR(10),
  is_whale BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS markets (
  condition_id VARCHAR(66) PRIMARY KEY,
  question TEXT,
  slug VARCHAR(255),
  end_date TIMESTAMP,
  volume DECIMAL(20, 6),
  liquidity DECIMAL(20, 6),
  last_price_yes DECIMAL(10, 4),
  last_price_no DECIMAL(10, 4),
  resolved BOOLEAN DEFAULT FALSE,
  resolution_outcome VARCHAR(10),
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_trades_wallet ON trades(wallet_address);
CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_trades_whale ON trades(is_whale) WHERE is_whale = TRUE;
CREATE INDEX IF NOT EXISTS idx_wallets_volume ON wallets(total_volume DESC);
```

---

## Running the MVP

```bash
# Terminal 1: Start databases
docker-compose up -d

# Terminal 2: Run migration
psql -h localhost -U huldah -d huldah -f apps/api/src/db/migrations/001_init.sql

# Terminal 3: Start backend
cd apps/api
pnpm dev

# Terminal 4: Start frontend
cd apps/web
pnpm dev
```

---

## Data Ingestion Strategy Decision

### Option A: WebSocket (Real-time, no wallet info)
- **Pros**: Instant updates, low latency
- **Cons**: No taker/maker address in trade events
- **Use for**: Price updates, order book

### Option B: Poll Data API (Wallet info, 2-3s delay)
- **Pros**: Has wallet addresses, tx hashes
- **Cons**: 2-3 second delay, rate limited (75 req/10s)
- **Use for**: Whale tracking with wallet attribution

### Option C: Subgraph (Complete on-chain data)
- **Pros**: Full position data, PnL, historical
- **Cons**: ~30s block delay
- **Use for**: Wallet analytics, win rate calculation

**Recommendation for MVP**: Use Option B (Poll Data API) for whale tracking since we need wallet addresses. Supplement with Option C (Subgraph) for wallet stats.

---

## Next Steps (Post-MVP)

1. **ML Features**
   - Anomaly detection on trade patterns
   - Wallet clustering (identify bot networks)
   - Win rate prediction models

2. **Trading Integration**
   - CLOB SDK integration
   - One-click copy trading
   - Keyboard shortcuts


3. **Advanced Analytics**
   - Market sentiment from trade flow
   - Insider detection heuristics
   - Correlation with news/events

---

## Environment Variables

```bash
# apps/api/.env
DB_HOST=localhost
DB_PORT=5432
DB_USER=huldah
DB_PASSWORD=huldah
DB_NAME=huldah
REDIS_URL=redis://localhost:6379
PORT=3001
```

```bash
# apps/web/.env
VITE_API_URL=http://localhost:3001
VITE_WS_URL=ws://localhost:3001/ws
```