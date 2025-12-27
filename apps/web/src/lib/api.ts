import axios from 'axios';

// Use environment variable for API URL, fallback to localhost for development
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export const api = axios.create({
  baseURL: API_URL,
  timeout: 10000
});

export async function getTopWallets() {
  const { data } = await api.get('/api/wallets/top');
  return data;
}

export async function getRecentWhales() {
  const { data } = await api.get('/api/whales');
  return data;
}

export async function getWalletDetails(address: string) {
  const { data } = await api.get(`/api/wallets/${address}`);
  return data;
}

// News types
export interface NewsArticle {
  title: string;
  description: string | null;
  url: string;
  urlToImage: string | null;
  source: string;
  publishedAt: string;
  author: string | null;
}

// Fetch global news
export async function getNews(options?: { category?: string; query?: string; limit?: number }) {
  const params = new URLSearchParams();
  if (options?.category) params.append('category', options.category);
  if (options?.query) params.append('q', options.query);
  if (options?.limit) params.append('limit', options.limit.toString());

  const { data } = await api.get<NewsArticle[]>(`/api/news?${params.toString()}`);
  return data;
}

// Featured market type
export interface FeaturedMarket {
  condition_id: string;
  question: string;
  slug: string;
  outcome_yes_price: number;
  outcome_no_price: number;
  volume: number;
  liquidity: number;
  yes_token_id: string;
  no_token_id: string;
  image_url: string | null;
  icon_url: string | null;
  category: string | null;
  volume_24h: number;
  price_change_24h: number;
  best_bid: number | null;
  best_ask: number | null;
  end_date: string | null;
}

// Fetch featured/trending markets
export async function getFeaturedMarkets() {
  const { data } = await api.get<FeaturedMarket[]>('/api/markets/featured');
  return data;
}

