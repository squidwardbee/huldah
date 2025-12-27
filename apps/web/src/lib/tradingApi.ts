import { api } from './api';

// Auth endpoints
export async function getAuthChallenge(address: string) {
  const { data } = await api.post('/api/auth/challenge', { address });
  return data as { nonce: string; message: string; expiresAt: string };
}

export async function login(address: string, signature: string) {
  const { data } = await api.post('/api/auth/login', { address, signature });
  return data as {
    token: string;
    userId: number;
    eoaAddress: string;
    proxyAddress: string | null;
    expiresAt: string;
  };
}

export async function logout(token: string) {
  await api.post('/api/auth/logout', {}, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

// User endpoints
export async function getMe(token: string) {
  const { data } = await api.get('/api/user/me', {
    headers: { Authorization: `Bearer ${token}` },
  });
  return data;
}

export async function getUserPositions(token: string, proxyWallet?: string) {
  const params = proxyWallet ? `?proxyWallet=${proxyWallet}` : '';
  const { data } = await api.get(`/api/user/positions${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return data;
}

export async function getUserOrders(token: string, limit = 50) {
  const { data } = await api.get(`/api/user/orders?limit=${limit}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return data;
}

export async function getUserRateLimit(token: string) {
  const { data } = await api.get('/api/user/rate-limit', {
    headers: { Authorization: `Bearer ${token}` },
  });
  return data;
}

// Credential endpoints
export async function getCredentialsStatus(token: string) {
  const { data } = await api.get('/api/user/credentials/status', {
    headers: { Authorization: `Bearer ${token}` },
  });
  return data as {
    hasCredentials: boolean;
    encryptionConfigured: boolean;
    canTrade: boolean;
  };
}

export async function registerCredentials(
  token: string,
  credentials: {
    apiKey: string;
    apiSecret: string;
    apiPassphrase: string;
  }
) {
  const { data } = await api.post('/api/user/credentials', credentials, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return data as { success: boolean; message: string };
}

export async function deleteCredentials(token: string) {
  const { data } = await api.delete('/api/user/credentials', {
    headers: { Authorization: `Bearer ${token}` },
  });
  return data as { success: boolean; message: string };
}

// Trading endpoints
export async function placeOrder(
  token: string,
  order: {
    tokenId: string;
    side: 'BUY' | 'SELL';
    price: number;
    size: number;
    orderType?: string;
    tickSize?: string;
    negRisk?: boolean;
  }
) {
  const { data } = await api.post('/api/user/order', order, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return data;
}

export async function getOrderbook(tokenId: string) {
  const { data } = await api.get(`/api/trading/orderbook/${tokenId}`);
  return data;
}

export async function getMarket(tokenId: string) {
  const { data } = await api.get(`/api/trading/market/${tokenId}`);
  return data;
}

export async function getTradingStats(token: string) {
  const { data } = await api.get('/api/trading/stats', {
    headers: { Authorization: `Bearer ${token}` },
  });
  return data;
}

// Platform endpoints
export async function getPlatformStats() {
  const { data } = await api.get('/api/platform/stats');
  return data;
}

export interface Market {
  condition_id: string;
  question: string;
  slug: string;
  outcome_yes_price: number;
  outcome_no_price: number;
  volume: number;
  liquidity: number;
  resolved: boolean;
  resolution_outcome: number | null;
  end_date: string | null;
  yes_token_id: string | null;
  no_token_id: string | null;
  image_url: string | null;
  icon_url: string | null;
  category: string | null;
  volume_24h: number;
  price_change_24h: number;
  best_bid: number | null;
  best_ask: number | null;
}

export interface MarketCategory {
  category: string;
  count: number;
}

export interface MarketsResponse {
  markets: Market[];
  pagination: {
    offset: number;
    limit: number;
    count: number;
    total: number;
    hasMore: boolean;
  };
}

export type SortBy = 'volume' | 'volume_24h' | 'ending_soon' | 'liquidity' | 'newest';

export interface GetMarketsOptions {
  limit?: number;
  offset?: number;
  category?: string;
  sortBy?: SortBy;
}

export async function getMarkets(
  limitOrOptions: number | GetMarketsOptions = 50,
  category?: string,
  offset = 0
): Promise<MarketsResponse> {
  // Handle both old signature (limit, category, offset) and new options object
  let options: GetMarketsOptions;
  if (typeof limitOrOptions === 'number') {
    options = { limit: limitOrOptions, category, offset };
  } else {
    options = limitOrOptions;
  }

  const params = new URLSearchParams({
    limit: String(options.limit ?? 50),
    offset: String(options.offset ?? 0),
  });
  if (options.category) params.append('category', options.category);
  if (options.sortBy) params.append('sortBy', options.sortBy);

  const { data } = await api.get(`/api/markets?${params}`);
  // Handle legacy response format (array) for backwards compatibility
  if (Array.isArray(data)) {
    return {
      markets: data,
      pagination: { offset: 0, limit: options.limit ?? 50, count: data.length, total: data.length, hasMore: false }
    };
  }
  return data;
}

// Simple fetch for backwards compatibility (returns flat array)
export async function getMarketsSimple(limit = 50, category?: string): Promise<Market[]> {
  const response = await getMarkets(limit, category, 0);
  return response.markets;
}

export async function getCategories(): Promise<MarketCategory[]> {
  const { data } = await api.get('/api/markets/categories');
  return data;
}

export async function getMarketHolders(conditionId: string, limit = 50) {
  const { data } = await api.get(`/api/markets/${conditionId}/holders?limit=${limit}`);
  return data as {
    address: string;
    outcome: 'Yes' | 'No';
    balance: number;
    avgPrice: number;
    value: number;
  }[];
}

// Market trades from Polymarket Data API
export interface MarketTrade {
  txHash: string;
  wallet: string;
  side: 'BUY' | 'SELL';
  price: number;
  size: number;
  timestamp: number;
  outcome?: string;
}

export async function getMarketTrades(tokenId: string, limit = 50): Promise<MarketTrade[]> {
  try {
    // Polymarket Data API endpoint for trades
    const response = await fetch(
      `https://data-api.polymarket.com/trades?asset=${tokenId}&limit=${limit}`
    );
    if (!response.ok) {
      console.warn(`Trades fetch failed: ${response.status}`);
      return [];
    }
    const data = await response.json();
    return data.map((trade: any) => ({
      txHash: trade.transactionHash,
      wallet: trade.proxyWallet,
      side: trade.side,
      price: trade.price,
      size: trade.size,
      timestamp: trade.timestamp,
      outcome: trade.outcome,
    }));
  } catch (err) {
    console.error('Error fetching market trades:', err);
    return [];
  }
}

// Polymarket CLOB price history endpoint
export interface PriceHistoryPoint {
  t: number; // Unix timestamp
  p: number; // Price
}

export async function getPriceHistory(
  tokenId: string,
  interval: '1h' | '6h' | '1d' | '1w' | 'max' = '1d'
): Promise<PriceHistoryPoint[]> {
  try {
    const response = await fetch(
      `https://clob.polymarket.com/prices-history?market=${tokenId}&interval=${interval}`
    );
    if (!response.ok) {
      console.warn(`Price history fetch failed: ${response.status}`);
      return [];
    }
    const data = await response.json();
    return data.history || [];
  } catch (err) {
    console.error('Error fetching price history:', err);
    return [];
  }
}

