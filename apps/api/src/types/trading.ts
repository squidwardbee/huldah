/**
 * Trading Types for Polymarket Integration
 */

// Order Side
export type OrderSide = 'BUY' | 'SELL';

// Order Type
export type OrderType = 'GTC' | 'GTD' | 'FOK' | 'IOC';

// Transaction State Machine
export type TransactionState = 
  | 'PENDING'      // Order created, not yet submitted
  | 'SUBMITTED'    // Sent to CLOB/Relayer
  | 'EXECUTED'     // Executed on-chain
  | 'MINED'        // Included in a block
  | 'CONFIRMED'    // Sufficient confirmations
  | 'FAILED'       // Terminal failure
  | 'RETRYING'     // Attempting retry
  | 'CANCELLED';   // User cancelled

// Execution Path
export type ExecutionPath = 
  | 'CLOB_RELAYER'   // Primary: CLOB via gasless relayer
  | 'CLOB_DIRECT'    // Secondary: CLOB with user paying gas
  | 'ONCHAIN_CTF';   // Fallback: Direct CTF contract interaction

/**
 * Order Request - what the user submits
 */
export interface OrderRequest {
  tokenId: string;       // Polymarket token ID
  side: OrderSide;       // BUY or SELL
  price: number;         // 0.01 - 0.99
  size: number;          // Amount in shares
  orderType?: OrderType; // Default: GTC
  tickSize?: string;     // Default: "0.01"
  negRisk?: boolean;     // Whether market uses neg risk
}

/**
 * Order Response - returned after submission
 */
export interface OrderResponse {
  orderId: string;
  status: TransactionState;
  executionPath: ExecutionPath;
  timestamp: number;
  order: OrderRequest;
  transactionHash?: string;
  errorMessage?: string;
  fills?: OrderFill[];
}

/**
 * Order Fill - partial or complete fill
 */
export interface OrderFill {
  price: number;
  size: number;
  timestamp: number;
  side: OrderSide;
  transactionHash: string;
}

/**
 * Market Info - from Gamma API / CLOB
 */
export interface MarketInfo {
  conditionId: string;
  questionId: string;
  question: string;
  slug: string;
  tokens: TokenInfo[];
  endDate: string;
  volume: string;
  liquidity: string;
  active: boolean;
  negRisk: boolean;
  tickSize: string;
}

/**
 * Token Info - YES/NO tokens
 */
export interface TokenInfo {
  tokenId: string;
  outcome: string;   // "Yes" or "No"
  price: number;     // Current price 0-1
}

/**
 * Orderbook Entry
 */
export interface OrderbookEntry {
  price: string;
  size: string;
}

/**
 * Orderbook - for a token
 */
export interface Orderbook {
  tokenId: string;
  bids: OrderbookEntry[];
  asks: OrderbookEntry[];
  timestamp: number;
}

/**
 * Position - user's current position
 */
export interface Position {
  tokenId: string;
  conditionId: string;
  outcome: string;
  size: number;
  avgPrice: number;
  currentPrice: number;
  unrealizedPnl: number;
  realizedPnl: number;
}

/**
 * Builder Credentials
 */
export interface BuilderCredentials {
  key: string;
  secret: string;
  passphrase: string;
}

/**
 * User API Credentials (for CLOB authentication)
 */
export interface UserApiCredentials {
  apiKey: string;
  apiSecret: string;
  apiPassphrase: string;
}

/**
 * Execution Result
 */
export interface ExecutionResult {
  success: boolean;
  orderId?: string;
  transactionHash?: string;
  error?: string;
  path: ExecutionPath;
  retryCount: number;
  timestamp: number;
}

/**
 * Retry Configuration
 */
export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterMs: number;
}

/**
 * Rate Limit Status
 */
export interface RateLimitStatus {
  dailyLimit: number;
  used: number;
  remaining: number;
  resetAt: Date;
}

/**
 * Trading Config
 */
export interface TradingConfig {
  chainId: number;
  clobUrl: string;
  relayerUrl: string;
  rpcUrl: string;
  builderCredentials: BuilderCredentials;
  privateKey: string;
  funderAddress: string;
  signatureType: 0 | 1 | 2;  // 0=EOA, 1=Magic, 2=Safe
}

/**
 * Contract Addresses (Polygon)
 */
export const POLYGON_CONTRACTS = {
  USDC: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
  CTF: '0x4d97dcd97ec945f40cf65f87097ace5ea0476045',
  CTF_EXCHANGE: '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E',
  NEG_RISK_CTF_EXCHANGE: '0xC5d563A36AE78145C45a50134d48A1215220f80a',
  NEG_RISK_ADAPTER: '0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296',
} as const;

/**
 * Default Retry Config
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
  jitterMs: 500,
};

