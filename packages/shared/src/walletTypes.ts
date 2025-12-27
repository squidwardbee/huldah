/**
 * Wallet Intelligence System - Core Types
 *
 * Central type definitions for wallet analytics, tracking, and ML features.
 */

// ============================================================================
// Core Wallet Profile
// ============================================================================

export interface WalletProfile {
  // Identity
  address: string;
  entityId?: string;
  clusterId?: string;
  firstSeen: Date;
  lastActive: Date;

  // Funding & Withdrawals
  funding: WalletFunding;

  // Performance Metrics
  performance: WalletPerformance;

  // Volume & Activity
  activity: WalletActivity;

  // Holdings
  holdings: WalletHoldings;

  // Market Specialization
  specialization: WalletSpecialization;

  // Timing & Behavior
  behavior: WalletBehavior;

  // Scoring & Tags
  scores: WalletScores;
  tags: WalletTag[];

  // Fees
  fees: WalletFees;

  // Metadata
  computedAt: Date;
}

export interface WalletFunding {
  totalDeposited: number;
  totalWithdrawn: number;
  netFunding: number;
  lastFundingSource?: string;
  fundingSourceType: FundingSourceType;
}

export type FundingSourceType = 'cex' | 'dex' | 'bridge' | 'wallet' | 'unknown';

export interface WalletPerformance {
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  profitFactor: number;
  maxDrawdown: number;
  roi: number;
}

export interface WalletActivity {
  totalVolume: number;
  totalTrades: number;
  avgTradeSize: number;
  volume24h: number;
  volume7d: number;
  volume30d: number;
  tradesLast24h: number;
  tradesLast7d: number;
}

export interface WalletHoldings {
  openPositions: number;
  holdingsValue: number;
  largestPosition?: {
    marketId: string;
    marketQuestion: string;
    outcome: 'YES' | 'NO';
    size: number;
    value: number;
    unrealizedPnl: number;
  };
}

export interface WalletSpecialization {
  topCategories: CategoryPerformance[];
  marketsTraded: number;
  marketConcentration: number;
  focusedMarkets: string[];
}

export interface CategoryPerformance {
  category: string;
  volume: number;
  winRate: number;
  pnl: number;
  tradeCount: number;
}

export interface WalletBehavior {
  avgHoldTime: number;
  avgTimeToResolution: number;
  preResolutionRate: number;
  tradingHours: number[];
  preferredSide: 'YES' | 'NO' | 'balanced';
}

export interface WalletScores {
  smartMoneyScore: number;
  insiderScore: number;
  whaleScore: number;
}

export interface WalletFees {
  totalFeesPaid: number;
  avgFeePerTrade: number;
}

// ============================================================================
// Wallet Tags
// ============================================================================

export type WalletTag =
  | 'whale'
  | 'smart_money'
  | 'active'
  | 'new'
  | 'insider_suspect'
  | 'top_trader'
  | 'high_roller'
  | 'profitable'
  | 'losing'
  | 'dormant'
  | 'single_market_focus'
  | 'sniper'
  | 'bot'
  | 'fund'
  | 'exchange';

export const WALLET_TAG_INFO: Record<
  WalletTag,
  { label: string; description: string; color: string }
> = {
  whale: {
    label: 'Whale',
    description: 'Top 5% by volume',
    color: 'cyan',
  },
  smart_money: {
    label: 'Smart Money',
    description: 'Win rate >60% with 5+ resolved trades',
    color: 'green',
  },
  active: {
    label: 'Active',
    description: '>10 trades in 7 days',
    color: 'magenta',
  },
  new: {
    label: 'New',
    description: 'First seen <24 hours',
    color: 'white',
  },
  insider_suspect: {
    label: 'Insider Suspect',
    description: 'High insider score (>=60)',
    color: 'amber',
  },
  top_trader: {
    label: 'Top Trader',
    description: 'Polymarket leaderboard',
    color: 'gold',
  },
  high_roller: {
    label: 'High Roller',
    description: 'Avg trade >$10k',
    color: 'purple',
  },
  profitable: {
    label: 'Profitable',
    description: 'Positive lifetime P&L',
    color: 'green',
  },
  losing: {
    label: 'Losing',
    description: 'Negative lifetime P&L',
    color: 'red',
  },
  dormant: {
    label: 'Dormant',
    description: 'No trades in 30+ days',
    color: 'gray',
  },
  single_market_focus: {
    label: 'Focused',
    description: 'Trades only 1-3 markets',
    color: 'orange',
  },
  sniper: {
    label: 'Sniper',
    description: 'Low odds wins + timing edge',
    color: 'red',
  },
  bot: {
    label: 'Bot',
    description: 'Automated trading patterns',
    color: 'blue',
  },
  fund: {
    label: 'Fund',
    description: 'Known investment fund',
    color: 'teal',
  },
  exchange: {
    label: 'Exchange',
    description: 'Known exchange wallet',
    color: 'gray',
  },
};

// ============================================================================
// Wallet Trades
// ============================================================================

export interface WalletTrade {
  txHash: string;
  walletAddress: string;
  timestamp: Date;

  // Market
  marketId: string;
  marketQuestion: string;
  marketSlug?: string;

  // Trade
  outcome: 'YES' | 'NO';
  side: 'BUY' | 'SELL';
  price: number;
  size: number;
  usdValue: number;

  // Context
  marketOdds: number;
  hoursToResolution?: number;

  // Post-resolution
  outcomeCorrect?: boolean;
  profitLoss?: number;
}

// ============================================================================
// Wallet Snapshots (for ML)
// ============================================================================

export interface WalletSnapshot {
  walletAddress: string;
  snapshotDate: Date;

  // Metrics
  totalVolume: number;
  realizedPnl: number;
  unrealizedPnl: number;
  openPositionsValue: number;
  winCount: number;
  lossCount: number;

  // Scores
  smartMoneyScore: number;
  insiderScore: number;

  // Tags
  tags: WalletTag[];
}

// ============================================================================
// Wallet Clusters (Sybil Detection)
// ============================================================================

export interface WalletCluster {
  clusterId: string;
  detectionMethod: ClusterDetectionMethod;
  confidence: number;

  members: ClusterMember[];

  aggregateMetrics: {
    totalVolume: number;
    totalPnl: number;
    memberCount: number;
  };

  createdAt: Date;
  metadata?: Record<string, unknown>;
}

export type ClusterDetectionMethod =
  | 'funding_pattern'
  | 'timing'
  | 'behavior'
  | 'manual';

export interface ClusterMember {
  address: string;
  role: 'primary' | 'funding' | 'receiving' | 'unknown';
  joinedCluster: Date;
}

// ============================================================================
// Funding Events
// ============================================================================

export interface FundingEvent {
  id: number;
  walletAddress: string;
  direction: 'deposit' | 'withdrawal';

  counterparty: string;
  counterpartyType: FundingSourceType;

  amount: number;
  token: string;
  timestamp: Date;
  txHash: string;
}

// ============================================================================
// Wallet Subscriptions (Observer Pattern)
// ============================================================================

export interface WalletSubscription {
  id: number;
  userId: number;
  walletAddress: string;
  subscribedAt: Date;

  notifications: {
    onTrade: boolean;
    onWhaleTrade: boolean;
    onNewPosition: boolean;
    onPositionClosed: boolean;
  };

  nickname?: string;
  notes?: string;
}

export interface WalletActivityEvent {
  type: WalletActivityType;
  walletAddress: string;
  timestamp: Date;
  data: WalletTrade | FundingEvent;
}

export type WalletActivityType =
  | 'trade'
  | 'whale_trade'
  | 'position_opened'
  | 'position_closed'
  | 'funding';

// ============================================================================
// Insider Alerts
// ============================================================================

export interface InsiderAlert {
  id: number;
  marketId: string;
  marketQuestion: string;
  alertType: InsiderAlertType;
  severity: AlertSeverity;

  involvedWallets: AlertWallet[];
  totalVolume: number;
  betDirection: 'YES' | 'NO';
  oddsAtTime: number;

  description: string;
  createdAt: Date;

  resolved?: boolean;
  resolutionOutcome?: 'YES' | 'NO';
  alertAccuracy?: boolean;
}

export type InsiderAlertType =
  | 'new_whale'
  | 'collective_bet'
  | 'pre_resolution_surge'
  | 'low_odds_accumulation'
  | 'unusual_timing'
  | 'cluster_activity';

export type AlertSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface AlertWallet {
  address: string;
  volume: number;
  direction: 'YES' | 'NO';
}

// ============================================================================
// ML Features
// ============================================================================

export interface WalletMLFeatures {
  // Static features
  accountAge: number;
  totalVolume: number;
  avgTradeSize: number;

  // Performance features
  winRate: number;
  profitFactor: number;
  roi: number;

  // Behavioral features
  marketConcentration: number;
  avgTimeToResolution: number;
  preResolutionRate: number;
  lowOddsWinRate: number;

  // Temporal features
  tradingHourEntropy: number;
  tradeVelocity: number;

  // Network features
  clusterSize: number;
  fundingSourceDiversity: number;

  // Labels (for supervised learning)
  isInsider?: boolean;
  isSmartMoney?: boolean;
  isProfitable?: boolean;
}

// ============================================================================
// API Response Types
// ============================================================================

export interface WalletListResponse {
  wallets: WalletProfile[];
  pagination: {
    offset: number;
    limit: number;
    total: number;
    hasMore: boolean;
  };
}

export interface WalletDetailResponse {
  wallet: WalletProfile;
  recentTrades: WalletTrade[];
  positions: WalletPosition[];
}

export interface WalletPosition {
  marketId: string;
  marketQuestion: string;
  outcome: 'YES' | 'NO';
  size: number;
  avgEntryPrice: number;
  currentPrice: number;
  value: number;
  unrealizedPnl: number;
  firstTradeTime: Date;
  lastTradeTime: Date;
}

export interface AlertListResponse {
  alerts: InsiderAlert[];
  pagination: {
    offset: number;
    limit: number;
    total: number;
    hasMore: boolean;
  };
}

// ============================================================================
// Query/Filter Types
// ============================================================================

export interface WalletQueryParams {
  tags?: WalletTag[];
  minVolume?: number;
  maxVolume?: number;
  minWinRate?: number;
  minInsiderScore?: number;
  minSmartMoneyScore?: number;
  sortBy?: WalletSortField;
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export type WalletSortField =
  | 'volume'
  | 'volume_24h'
  | 'pnl'
  | 'win_rate'
  | 'insider_score'
  | 'smart_money_score'
  | 'last_active'
  | 'first_seen';

export interface AlertQueryParams {
  type?: InsiderAlertType;
  severity?: AlertSeverity;
  marketId?: string;
  resolved?: boolean;
  limit?: number;
  offset?: number;
}
