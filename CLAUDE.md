# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Huldah.ai is an ML-enabled prediction market terminal for Polymarket. See `plan.md` for full architecture documentation, API references, and build guide.

**Core features:**
- Real-time whale activity tracking (trades >$1k)
- Wallet analytics with win rates and PnL
- ML-based insider trading detection
- Multi-user trading execution terminal

## Commands

### Development
```bash
# Start infrastructure (PostgreSQL + Redis)
pnpm run db:up

# Run database migrations
pnpm --filter api db:migrate

# Start API server (port 3001)
pnpm run dev:api

# Start web frontend (port 5173)
pnpm run dev:web

# Start both concurrently
pnpm run dev
```

### Testing
```bash
# Run all API tests
pnpm --filter api test

# Run tests in watch mode
pnpm --filter api test:watch

# Run specific test file
pnpm --filter api vitest run src/__tests__/auth.test.ts
```

### Building
```bash
pnpm --filter api build
pnpm --filter web build
```

## Architecture

### Monorepo Structure
- **apps/api** - Express.js backend (TypeScript, ES modules)
- **apps/web** - React frontend (Vite, Tailwind, Zustand)
- **packages/shared** - Shared TypeScript types

### Key Services (`apps/api/src/services/`)

| Service | Purpose | Interval |
|---------|---------|----------|
| TradePoller | Polls Polymarket Data API for trades, broadcasts whales | 2s |
| WalletScorer | Updates smart money scores | 5 min |
| InsiderDetector | ML-based insider detection | 10 min |
| MarketSyncService | Syncs markets from Gamma API | 15 min |

### Trading Architecture

**Client-side signing, server is read-only:**
- User's private keys NEVER touch the server
- API credentials stored in browser localStorage only
- Orders signed in browser, submitted directly to Polymarket CLOB
- Backend only aggregates market data (no trading involvement)

### Data Sources (from plan.md)

| Source | Use Case |
|--------|----------|
| Data API `/trades` | Whale tracking (has wallet addresses) |
| Gamma API | Market metadata |
| Goldsky Subgraph | Positions, PnL, historical analytics |
| CLOB WebSocket | Real-time prices (no wallet info) |

### Authentication Flow

1. Client requests challenge nonce (`POST /api/auth/challenge`)
2. Client signs message with wallet
3. Server verifies signature, creates session (`POST /api/auth/login`)
4. Bearer token for subsequent requests

## Current Development Status

### Completed
- Whale feed with real-time WebSocket updates
- Top wallets page with volume/win rate stats
- Trading terminal UI (TradingView, OrderForm, Orderbook, MarketSelector)
- Wallet authentication (connect → sign → session)
- Limit and market order UI

### Trading Implementation

**Trading is now functional.** Non-custodial, just like native Polymarket.

**Architecture (per Polymarket PRD):**
```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Frontend      │────▶│  Backend         │────▶│  Polymarket     │
│   (React)       │     │  (Read-only)     │     │  Gamma API      │
│                 │     │                  │     │  (Market Data)  │
│  - Wallet conn  │     │  - Aggregates    │     └─────────────────┘
│  - Order signing│     │    market data   │
│  - CLOB client  │     │  - Caches prices │
└────────┬────────┘     └──────────────────┘
         │
         │ Signed orders (direct)
         ▼
┌─────────────────┐
│  Polymarket     │
│  CLOB API       │
│  (Order Submit) │
└─────────────────┘
```

**Flow:**
1. User connects wallet (MetaMask, etc.)
2. First trade: sign message to derive API credentials (one-time)
3. Credentials cached in browser localStorage
4. Orders signed locally, submitted directly to Polymarket CLOB

**Key files:**
- `apps/web/src/hooks/useWalletTrading.ts` - CLOB client, wallet signing, localStorage creds

**Security:**
- Private keys NEVER leave user's browser
- API creds stored in browser localStorage only (not server)
- Server has NO access to user credentials
- All signing happens client-side

**Market Order Validation:**
- Frontend validates price is 0.01-0.99 before submission
- Shows "NO LIQUIDITY AT VALID PRICE" if bestBid/bestAsk unavailable

**Required Environment Variables:**
```bash
# Database (defaults work with docker-compose)
DB_HOST=host.docker.internal  # for WSL Docker Desktop
REDIS_HOST=host.docker.internal
```

**Geoblocking Note:**
Users in restricted regions need VPN. The browser makes direct calls to Polymarket CLOB.

## Key Patterns

- All routes in `apps/api/src/index.ts` (not split into route files)
- Services lazy-initialized: `getOrderExecutor()`, `getMultiUserExecutor()`
- Express Request extended with `user` property via `authMiddleware`
- Redis for WebSocket pub/sub (`whale_trades` channel) and caching
- viem for Ethereum interactions, zod for validation
