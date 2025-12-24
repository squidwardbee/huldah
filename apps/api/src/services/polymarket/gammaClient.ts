import axios from 'axios';

const GAMMA_URL = 'https://gamma-api.polymarket.com';

// Interface matches actual Gamma API response (camelCase)
export interface GammaMarket {
  conditionId: string;            // Was condition_id
  question: string;
  slug: string;
  endDate?: string;               // ISO date string
  endDateIso?: string;
  volume: string;
  liquidity: string;
  active: boolean;
  closed: boolean;
  archived?: boolean;
  category?: string;
  outcomePrices?: string;         // JSON array string like "[\"0.75\", \"0.25\"]"
  clobTokenIds?: string;          // JSON array string of token IDs
  outcomes?: string;              // JSON array like "[\"Yes\", \"No\"]"
  // For resolved markets
  resolved?: boolean;
}

export class GammaClient {
  private axios = axios.create({
    baseURL: GAMMA_URL,
    timeout: 15000
  });

  async getMarkets(params: {
    active?: boolean;
    closed?: boolean;
    limit?: number;
    offset?: number;
  } = {}): Promise<GammaMarket[]> {
    const { data } = await this.axios.get('/markets', { params });
    return data;
  }

  async getActiveMarkets(limit = 100, offset = 0): Promise<GammaMarket[]> {
    return this.getMarkets({ active: true, closed: false, limit, offset });
  }

  async getClosedMarkets(limit = 100, offset = 0): Promise<GammaMarket[]> {
    return this.getMarkets({ closed: true, limit, offset });
  }

  async getMarket(conditionId: string): Promise<GammaMarket | null> {
    try {
      const { data } = await this.axios.get(`/markets/${conditionId}`);
      return data;
    } catch (err: any) {
      if (err.response?.status === 404) return null;
      throw err;
    }
  }

  async getAllActiveMarkets(): Promise<GammaMarket[]> {
    const markets: GammaMarket[] = [];
    let offset = 0;
    const limit = 100;
    const maxMarkets = 500; // Limit total to avoid too many requests

    while (markets.length < maxMarkets) {
      try {
        const batch = await this.getActiveMarkets(limit, offset);
        if (batch.length === 0) break;
        markets.push(...batch);
        offset += limit;
        if (batch.length < limit) break;
      } catch (err) {
        console.error('[GammaClient] Error fetching markets:', err);
        break;
      }
    }

    return markets;
  }

  async getRecentlyClosedMarkets(limit = 200): Promise<GammaMarket[]> {
    const markets: GammaMarket[] = [];
    let offset = 0;
    const batchSize = 100;

    while (markets.length < limit) {
      try {
        const batch = await this.getClosedMarkets(batchSize, offset);
        if (batch.length === 0) break;
        markets.push(...batch);
        offset += batchSize;
        if (batch.length < batchSize) break;
      } catch (err) {
        console.error('[GammaClient] Error fetching closed markets:', err);
        break;
      }
    }

    return markets.slice(0, limit);
  }
}
