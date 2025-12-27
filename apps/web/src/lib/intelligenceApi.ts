import { api } from './api';
import { useAuthStore } from '../stores/authStore';

// Types
export interface WalletProfile {
  address: string;
  entityId?: string;
  clusterId?: string;
  firstSeen: string;
  lastActive: string;
  funding: {
    totalDeposited: number;
    totalWithdrawn: number;
    netFunding: number;
    fundingSourceType: string;
  };
  performance: {
    realizedPnl: number;
    unrealizedPnl: number;
    totalPnl: number;
    winCount: number;
    lossCount: number;
    winRate: number;
    profitFactor: number;
    maxDrawdown: number;
    roi: number;
  };
  activity: {
    totalVolume: number;
    totalTrades: number;
    avgTradeSize: number;
    volume24h: number;
    volume7d: number;
    volume30d: number;
    tradesLast24h: number;
    tradesLast7d: number;
  };
  holdings: {
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
  };
  specialization: {
    topCategories: CategoryPerformance[];
    marketsTraded: number;
    marketConcentration: number;
    focusedMarkets: string[];
  };
  behavior: {
    avgHoldTime: number;
    avgTimeToResolution: number;
    preResolutionRate: number;
    tradingHours: number[];
    preferredSide: 'YES' | 'NO' | 'balanced';
  };
  scores: {
    smartMoneyScore: number;
    insiderScore: number;
    whaleScore: number;
  };
  tags: string[];
  fees: {
    totalFeesPaid: number;
    avgFeePerTrade: number;
  };
  computedAt: string;
}

export interface CategoryPerformance {
  category: string;
  volume: number;
  winRate: number;
  pnl: number;
  tradeCount: number;
}

export interface WalletTrade {
  txHash: string;
  walletAddress: string;
  timestamp: string;
  marketId: string;
  marketQuestion: string;
  marketSlug?: string;
  outcome: 'YES' | 'NO';
  side: 'BUY' | 'SELL';
  price: number;
  size: number;
  usdValue: number;
  marketOdds: number;
  hoursToResolution?: number;
  outcomeCorrect?: boolean;
  profitLoss?: number;
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
  firstTradeTime: string;
  lastTradeTime: string;
}

export interface WalletSubscription {
  id: number;
  userId: number;
  walletAddress: string;
  subscribedAt: string;
  notifications: {
    onTrade: boolean;
    onWhaleTrade: boolean;
    onNewPosition: boolean;
    onPositionClosed: boolean;
  };
  nickname?: string;
  notes?: string;
}

export interface WalletActivity {
  id: number;
  walletAddress: string;
  walletNickname?: string;
  activityType: 'trade' | 'whale_trade' | 'position_opened' | 'position_closed';
  data: any;
  createdAt: string;
  delivered?: boolean;
}

export interface WalletQueryParams {
  tags?: string[];
  minVolume?: number;
  maxVolume?: number;
  minWinRate?: number;
  minInsiderScore?: number;
  minSmartMoneyScore?: number;
  sortBy?: 'volume' | 'pnl' | 'win_rate' | 'insider_score' | 'smart_money_score' | 'last_active';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface WalletListResponse {
  wallets: WalletProfile[];
  pagination: {
    offset: number;
    limit: number;
    total: number;
    hasMore: boolean;
  };
}

// Helper to get auth headers
function getAuthHeaders() {
  const token = useAuthStore.getState().token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ============ WALLET INTELLIGENCE API ============

export async function getWalletList(params: WalletQueryParams = {}): Promise<WalletListResponse> {
  const queryParams = new URLSearchParams();

  if (params.tags?.length) queryParams.set('tags', params.tags.join(','));
  if (params.minVolume !== undefined) queryParams.set('minVolume', String(params.minVolume));
  if (params.maxVolume !== undefined) queryParams.set('maxVolume', String(params.maxVolume));
  if (params.minWinRate !== undefined) queryParams.set('minWinRate', String(params.minWinRate));
  if (params.minInsiderScore !== undefined) queryParams.set('minInsiderScore', String(params.minInsiderScore));
  if (params.minSmartMoneyScore !== undefined) queryParams.set('minSmartMoneyScore', String(params.minSmartMoneyScore));
  if (params.sortBy) queryParams.set('sortBy', params.sortBy);
  if (params.sortOrder) queryParams.set('sortOrder', params.sortOrder);
  if (params.limit !== undefined) queryParams.set('limit', String(params.limit));
  if (params.offset !== undefined) queryParams.set('offset', String(params.offset));

  const { data } = await api.get(`/api/intelligence/wallets?${queryParams.toString()}`);
  return data;
}

export async function getWalletProfile(address: string): Promise<WalletProfile | null> {
  try {
    const { data } = await api.get(`/api/intelligence/wallets/${address}`);
    return data;
  } catch (err: any) {
    if (err.response?.status === 404) return null;
    throw err;
  }
}

export async function getWalletDetail(address: string): Promise<{
  wallet: WalletProfile;
  recentTrades: WalletTrade[];
  positions: WalletPosition[];
} | null> {
  try {
    const { data } = await api.get(`/api/intelligence/wallets/${address}/detail`);
    return data;
  } catch (err: any) {
    if (err.response?.status === 404) return null;
    throw err;
  }
}

export async function getWalletTrades(address: string, limit = 100): Promise<WalletTrade[]> {
  const { data } = await api.get(`/api/intelligence/wallets/${address}/trades?limit=${limit}`);
  return data;
}

export async function getWalletPositions(address: string): Promise<WalletPosition[]> {
  const { data } = await api.get(`/api/intelligence/wallets/${address}/positions`);
  return data;
}

export async function getWalletCategories(address: string): Promise<CategoryPerformance[]> {
  const { data } = await api.get(`/api/intelligence/wallets/${address}/categories`);
  return data;
}

// ============ SUBSCRIPTION API ============

export async function subscribeToWallet(
  address: string,
  options: {
    nickname?: string;
    notes?: string;
    notifyOnTrade?: boolean;
    notifyOnWhaleTrade?: boolean;
    notifyOnNewPosition?: boolean;
    notifyOnPositionClosed?: boolean;
  } = {}
): Promise<WalletSubscription> {
  const { data } = await api.post(
    `/api/intelligence/wallets/${address}/subscribe`,
    options,
    { headers: getAuthHeaders() }
  );
  return data;
}

export async function unsubscribeFromWallet(address: string): Promise<{ success: boolean }> {
  const { data } = await api.delete(
    `/api/intelligence/wallets/${address}/subscribe`,
    { headers: getAuthHeaders() }
  );
  return data;
}

export async function getUserSubscriptions(): Promise<WalletSubscription[]> {
  const { data } = await api.get('/api/user/subscriptions', { headers: getAuthHeaders() });
  return data;
}

export async function getUserSubscriptionsDetailed(): Promise<Array<{
  subscription: WalletSubscription;
  wallet: WalletProfile | null;
}>> {
  const { data } = await api.get('/api/user/subscriptions/detailed', { headers: getAuthHeaders() });
  return data;
}

// ============ ACTIVITY FEED API ============

export async function getSubscriptionActivity(limit = 50): Promise<WalletActivity[]> {
  const { data } = await api.get(`/api/user/subscriptions/activity?limit=${limit}`, { headers: getAuthHeaders() });
  return data;
}

export async function getUnreadNotifications(limit = 100): Promise<WalletActivity[]> {
  const { data } = await api.get(`/api/user/notifications/unread?limit=${limit}`, { headers: getAuthHeaders() });
  return data;
}

export async function markNotificationsRead(ids: number[]): Promise<{ success: boolean; marked: number }> {
  const { data } = await api.post('/api/user/notifications/mark-read', { ids }, { headers: getAuthHeaders() });
  return data;
}

// ============ STATS API ============

export async function getSubscriptionStats(): Promise<{
  totalSubscriptions: number;
  activeWallets: number;
  usersWithSubscriptions: number;
}> {
  const { data } = await api.get('/api/intelligence/subscriptions/stats');
  return data;
}
