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

### Trading Module (`apps/api/src/services/trading/`)

- **MultiUserExecutor** - Aggregates orders, adds builder attribution
- **UserManager** - Sessions, encrypted credentials, rate limits
- **ClobClient/RelayerClient** - Polymarket CLOB and gasless relay

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

**Trading is now functional.** See `docs/adr/001-trading-execution.md` for full architecture.

**How it works:**
1. User registers Polymarket CLOB API credentials (one-time setup from polymarket.com/settings/api)
2. Credentials encrypted with AES-256-GCM, stored in `user_api_credentials` table
3. On order: server decrypts credentials, creates CLOB client with builder attribution
4. Order submitted to Polymarket CLOB API

**Key files:**
- `apps/api/src/services/trading/credentialStore.ts` - Encrypted credential storage
- `apps/api/src/services/trading/multiUserExecutor.ts` - Order execution
- `apps/web/src/components/trading/ApiCredentialsForm.tsx` - Credential setup UI

**Market Order Validation:**
- Frontend validates price is 0.01-0.99 before submission
- Shows "NO LIQUIDITY AT VALID PRICE" if bestBid/bestAsk unavailable

**Required Environment Variables:**
```bash
# Trading - Builder attribution (required)
POLY_BUILDER_API_KEY=
POLY_BUILDER_SECRET=
POLY_BUILDER_PASSPHRASE=

# Credential encryption (required for user credential storage)
CREDENTIAL_ENCRYPTION_KEY=  # Generate: openssl rand -hex 32

# Database (defaults work with docker-compose)
DB_HOST=host.docker.internal  # for WSL Docker Desktop
REDIS_HOST=host.docker.internal
```

## Key Patterns

- All routes in `apps/api/src/index.ts` (not split into route files)
- Services lazy-initialized: `getOrderExecutor()`, `getMultiUserExecutor()`
- Express Request extended with `user` property via `authMiddleware`
- Redis for WebSocket pub/sub (`whale_trades` channel) and caching
- viem for Ethereum interactions, zod for validation
