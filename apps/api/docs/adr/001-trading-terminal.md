# ADR-001: Multi-User Polymarket Aggregation Terminal

**Status**: Implemented  
**Date**: 2025-12-24  
**Author**: System  

---

## Context

We're building a **multi-user aggregation terminal** where:
- Multiple users trade through our platform
- Users connect their wallets (MetaMask, etc.)
- We deploy Safe proxy wallets for gasless trading
- All orders are attributed to our Builder account
- We earn Builder Program rewards on user volume

This is the Polymarket Builder Program use case for building trading interfaces.

## Decision

### Architecture Overview

```
┌────────────────────────────────────────────────────────────────────────┐
│                         USERS (Many)                                    │
│  User A (wallet)    User B (wallet)    User C (wallet)                 │
└──────────┬──────────────────┬────────────────────┬─────────────────────┘
           │                  │                    │
           ▼                  ▼                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                    AGGREGATION TERMINAL API                            │
│                                                                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                 │
│  │ UserManager  │  │ MultiUser    │  │ Builder      │                 │
│  │ (auth/users) │  │ Executor     │  │ Signer       │                 │
│  └──────────────┘  └──────────────┘  └──────────────┘                 │
│         │                  │                  │                        │
│         ▼                  ▼                  ▼                        │
│  ┌─────────────────────────────────────────────────────────┐          │
│  │              Order Routing + Rate Limiting              │          │
│  └─────────────────────────────────────────────────────────┘          │
└────────────────────────────────────────────────────────────────────────┘
           │
           ▼
┌────────────────────────────────────────────────────────────────────────┐
│                         POLYMARKET                                      │
│  CLOB API (orders) + Relayer (gasless) + Builder Attribution           │
└────────────────────────────────────────────────────────────────────────┘
```

### Files Created

| File | Purpose |
|------|---------|
| `apps/api/src/services/trading/builderSigner.ts` | HMAC signature for builder auth |
| `apps/api/src/services/trading/relayerClient.ts` | Gasless transaction relay |
| `apps/api/src/services/trading/clobClient.ts` | CLOB order management |
| `apps/api/src/services/trading/orderExecutor.ts` | Single-user orchestration |
| `apps/api/src/services/trading/onChainExecutor.ts` | Direct on-chain fallback |
| `apps/api/src/services/trading/userManager.ts` | User registration, auth, sessions |
| `apps/api/src/services/trading/multiUserExecutor.ts` | Multi-user order execution |
| `apps/api/src/services/trading/index.ts` | Module exports |
| `apps/api/src/types/trading.ts` | TypeScript interfaces |
| `apps/api/src/db/migrations/004_trading_orders.sql` | Order tracking schema |
| `apps/api/src/db/migrations/005_multi_user_trading.sql` | Multi-user schema |

### Key Design Decisions

#### 1. Layered Execution Strategy

**Decision**: Implement a 3-tier execution strategy:
1. **CLOB via Relayer** (Primary) - Gasless, fastest
2. **CLOB via Direct** (Secondary) - User pays gas
3. **On-chain CTF** (Fallback) - Direct contract interaction

**Rationale**: Maximizes reliability while preferring gasless execution.

#### 2. Builder Signing

**Decision**: Use local signing (server-side) rather than remote signing.

**Rationale**: 
- We control the server and can secure credentials
- Lower latency than remote signing
- Simpler architecture for single-tenant use

#### 3. Retry Logic

**Decision**: Exponential backoff with jitter:
```typescript
retryDelays = [1000, 2000, 4000] // ms
maxRetries = 3
```

**Rationale**: Prevents thundering herd on transient failures.

#### 4. Transaction State Machine

```
PENDING → SUBMITTED → EXECUTED → MINED → CONFIRMED
                ↓           ↓        ↓
             FAILED     FAILED   FAILED
                ↓
            RETRYING → (back to SUBMITTED or FALLBACK)
```

#### 5. Order Validation

**Decision**: Validate before submission:
- Price must be 0.01 - 0.99
- Size must be > 0
- Token ID must be valid
- Tick size must match market

**Rationale**: Prevents wasted gas and API calls.

### Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@polymarket/clob-client` | ^5.1.2 | CLOB operations |
| `@polymarket/builder-relayer-client` | ^0.0.8 | Gasless relay |
| `@polymarket/builder-signing-sdk` | latest | HMAC auth |
| `viem` | ^2.x | On-chain execution |
| `@ethersproject/wallet` | ^5.x | Ethers signer for CLOB |

---

## Challenges Encountered

### 1. Mixed Library Ecosystem

**Challenge**: CLOB client uses ethers v5, relayer client uses viem.

**Solution**: Maintain both signers, create adapter layer.

### 2. Rate Limiting

**Challenge**: Unverified builders limited to 100 relayer tx/day.

**Solution**: 
- Track daily usage in Redis
- Queue orders when approaching limit
- Fall back to on-chain when limit exceeded

### 3. Transaction Finality

**Challenge**: Polygon reorganizations can revert transactions.

**Solution**: Wait for sufficient confirmations (5 blocks) before marking CONFIRMED.

### 4. Order Matching Uncertainty

**Challenge**: Orders may partially fill or not match at all.

**Solution**: Return order ID, provide polling endpoint for fill status.

---

## Security Considerations

### Private Key Management

```typescript
// ✅ DO: Load from environment
const privateKey = process.env.TRADING_PRIVATE_KEY;

// ❌ DON'T: Log or expose
console.log(privateKey); // NEVER
res.json({ key: privateKey }); // NEVER
```

### Builder Credentials

- Stored server-side only
- Never sent to frontend
- Used only for HMAC signing

### Input Validation

All trading endpoints validate:
- Token ID format (hex string)
- Price range (0.01-0.99)
- Size positive number
- Side enum (BUY/SELL)

---

## Future Considerations

### 1. Multi-Wallet Support

Current design uses single configured wallet. Future: support user-specific wallets.

### 2. Order Book Analysis

Integrate with existing market data to provide better execution recommendations.

### 3. Insider Detection Integration

Cross-reference trades with insider detection system to avoid suspicious markets.

### 4. MEV Protection

Consider private mempools or MEV-protected submission for large orders.

### 5. Position Hedging

Automatic hedging when insider signals detect high risk.

---

## Alternatives Considered

### 1. TypeScript SDK Only

**Rejected**: SDKs may have bugs or lag behind API changes. Direct API calls provide more control.

### 2. Python Implementation

**Rejected**: Existing codebase is TypeScript. Consistency preferred.

### 3. External Trading Bot

**Rejected**: Want integrated solution with insider detection.

---

## References

- [Polymarket CLOB Client](https://github.com/Polymarket/clob-client)
- [Polymarket Builder Relayer Client](https://github.com/Polymarket/builder-relayer-client)
- [Polymarket Builder Program Docs](https://docs.polymarket.com/developers/builder-program)
- [CTF Contract](https://polygonscan.com/address/0x4d97dcd97ec945f40cf65f87097ace5ea0476045)

