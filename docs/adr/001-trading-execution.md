# ADR-001: Trading Execution Implementation

**Status**: Proposed
**Date**: 2024-12-24
**Author**: Claude Code

## Overview of Functionality

Implement end-to-end order execution on Polymarket's CLOB (Central Limit Order Book) so users can place real trades through the Huldah trading terminal.

### High-Level Flow

1. User registers their Polymarket CLOB API credentials (one-time setup)
2. Credentials are encrypted (AES-256-GCM) and stored in database
3. User places order through trading UI
4. Server decrypts user's credentials, creates CLOB client
5. Server adds builder attribution headers
6. Server submits order to Polymarket CLOB
7. Order status tracked and positions updated

### Files to Create

| File | Purpose |
|------|---------|
| `apps/api/src/services/trading/credentialStore.ts` | Encrypted credential storage/retrieval |
| `apps/web/src/components/trading/ApiCredentialsForm.tsx` | UI for entering CLOB API credentials |

### Files to Modify

| File | Changes |
|------|---------|
| `apps/api/src/services/trading/multiUserExecutor.ts` | Implement `executeViaClob()` with real CLOB submission |
| `apps/api/src/services/trading/userManager.ts` | Add credential check method |
| `apps/api/src/index.ts` | Add credential registration endpoints |
| `apps/web/src/components/trading/OrderForm.tsx` | Check credentials before order, show setup if missing |
| `apps/web/src/components/trading/TradingView.tsx` | Integrate credential setup flow |
| `apps/web/src/lib/tradingApi.ts` | Add credential registration API calls |
| `apps/web/src/stores/authStore.ts` | Track credential registration status |

## Design Decisions

### 1. Credential Storage Architecture

**Decision**: Store encrypted CLOB API credentials server-side

**Alternatives Considered**:
- Client-side signing (more secure but complex EIP-712 implementation)
- No storage, require credentials per session (poor UX)

**Rationale**:
- Polymarket CLOB uses API key auth, not wallet signatures for orders
- Users generate credentials once at polymarket.com
- Server-side storage enables seamless trading experience
- Builder attribution requires server-side header injection anyway

### 2. Encryption Method

**Decision**: AES-256-GCM with per-credential IV

**Rationale**:
- Industry standard for symmetric encryption
- GCM provides authenticated encryption (integrity + confidentiality)
- Per-credential IV prevents pattern analysis
- Encryption key from `CREDENTIAL_ENCRYPTION_KEY` env var

### 3. Order Execution Flow

**Decision**: Create per-user CLOB client on each order

**Alternatives Considered**:
- Cache CLOB clients per user (memory concerns, stale credentials)
- Single platform CLOB client (can't attribute orders to users)

**Rationale**:
- Each user has unique credentials
- Builder attribution requires user-specific headers
- CLOB client creation is lightweight (~10ms)
- Ensures fresh credentials on each order

### 4. Error Handling Strategy

**Decision**: Fail gracefully with clear messages, no automatic retries for user errors

**Rationale**:
- Financial operations should not auto-retry without user consent
- Clear error messages help users understand issues
- Server errors (network, rate limit) can retry with exponential backoff
- User errors (insufficient funds, invalid price) return immediately

## Challenges Encountered

### 1. Multi-User Credential Management

**Challenge**: Each user needs their own CLOB API credentials, but the existing `TradingClobClient` is designed for single-wallet operation.

**Solution**: Create credentials per-user with encrypted storage, instantiate CLOB client dynamically per order using user's decrypted credentials.

### 2. Builder Attribution with User Credentials

**Challenge**: Builder attribution headers must be added by the platform, but orders are signed with user credentials.

**Solution**: Create CLOB client with user credentials + platform's builder config:
```typescript
new ClobClient(url, chainId, signer, userCreds, sigType, funder, undefined, false, builderConfig)
```

### 3. Credential Security

**Challenge**: Storing API credentials is inherently risky.

**Solution**:
- AES-256-GCM encryption with environment-sourced key
- Never log credentials or include in error messages
- Credentials only decrypted at order execution time
- Database column for encrypted blob, not plaintext

### 4. Order Status Synchronization

**Challenge**: CLOB order status may change after submission (filled, cancelled, etc.)

**Solution**:
- Record initial status from CLOB response
- Future: WebSocket subscription to order updates
- Future: Periodic polling for open order status

## Solutions Implemented

### Phase 1: Credential Storage

```typescript
// credentialStore.ts
export class CredentialStore {
  encrypt(credentials: UserApiCredentials): string
  decrypt(encrypted: string): UserApiCredentials
  store(userId: number, credentials: UserApiCredentials): Promise<void>
  retrieve(userId: number): Promise<UserApiCredentials | null>
  delete(userId: number): Promise<void>
}
```

### Phase 2: Credential Registration

New API endpoints:
- `POST /api/user/credentials` - Register CLOB credentials
- `GET /api/user/credentials/status` - Check if registered
- `DELETE /api/user/credentials` - Remove credentials

### Phase 3: Order Execution

Updated `executeViaClob()`:
1. Retrieve user's encrypted credentials
2. Decrypt credentials
3. Create CLOB client with credentials + builder config
4. Create and sign order
5. Submit to CLOB
6. Return result with order ID and status

### Phase 4: Position Tracking

After successful order:
1. Record order in `trading_orders` table
2. Update user stats (volume, order count)
3. Trigger position refresh (if order filled)

## Future Considerations

### 1. Client-Side Order Signing

For higher security, implement EIP-712 typed data signing where:
- User signs order data client-side
- Server adds builder headers
- Server submits pre-signed order

This removes need to store credentials but requires significant frontend work.

### 2. Order Status WebSocket

Subscribe to Polymarket's order WebSocket for real-time status updates instead of polling.

### 3. Smart Order Routing

Implement fallback paths:
1. CLOB via relayer (primary, gasless)
2. CLOB direct (user pays gas)
3. On-chain CTF exchange (emergency fallback)

### 4. Risk Controls

- Daily volume limits per user
- Maximum order size limits
- Price deviation warnings (order price vs mid-market)
- Position size warnings

## Environment Variables Required

```bash
# Existing - Builder attribution
POLY_BUILDER_API_KEY=xxx
POLY_BUILDER_SECRET=xxx
POLY_BUILDER_PASSPHRASE=xxx

# New - Credential encryption
CREDENTIAL_ENCRYPTION_KEY=xxx  # 32-byte hex string
```

## Database Changes

Uses existing `user_api_credentials` table from migration 005:
```sql
CREATE TABLE user_api_credentials (
  user_id INTEGER PRIMARY KEY REFERENCES trading_users(id),
  encrypted_credentials TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Testing Strategy

1. **Unit Tests**:
   - Credential encryption/decryption
   - Order validation
   - Error handling

2. **Integration Tests**:
   - Mock CLOB API responses
   - Full order flow with test credentials

3. **Manual Testing**:
   - Small real orders on Polymarket
   - Error scenarios (insufficient funds, invalid token)

## Rollback Plan

If issues arise:
1. Revert to `PENDING` status response (current behavior)
2. Keep credential storage but don't use for execution
3. Clear communication to users that trading is temporarily disabled
