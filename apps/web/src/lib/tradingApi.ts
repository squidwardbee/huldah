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

export async function getUserPositions(token: string) {
  const { data } = await api.get('/api/user/positions', {
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

export async function getMarkets(limit = 50) {
  const { data } = await api.get(`/api/markets?limit=${limit}`);
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

