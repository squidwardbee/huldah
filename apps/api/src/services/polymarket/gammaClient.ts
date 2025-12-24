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

    console.log('[GammaClient] Fetching all active markets...');

    // Keep fetching until no more markets
    while (true) {
      try {
        const batch = await this.getActiveMarkets(limit, offset);
        if (batch.length === 0) break;
        markets.push(...batch);
        offset += limit;
        
        // Log progress every 500 markets
        if (markets.length % 500 === 0) {
          console.log(`[GammaClient] Fetched ${markets.length} markets so far...`);
        }
        
        if (batch.length < limit) break; // Last page
      } catch (err) {
        console.error('[GammaClient] Error fetching markets at offset', offset, err);
        break;
      }
    }

    console.log(`[GammaClient] Total active markets fetched: ${markets.length}`);
    return markets;
  }

  async getAllClosedMarkets(): Promise<GammaMarket[]> {
    const markets: GammaMarket[] = [];
    let offset = 0;
    const batchSize = 100;

    console.log('[GammaClient] Fetching all closed markets...');

    while (true) {
      try {
        const batch = await this.getClosedMarkets(batchSize, offset);
        if (batch.length === 0) break;
        markets.push(...batch);
        offset += batchSize;
        
        if (markets.length % 500 === 0) {
          console.log(`[GammaClient] Fetched ${markets.length} closed markets so far...`);
        }
        
        if (batch.length < batchSize) break;
      } catch (err) {
        console.error('[GammaClient] Error fetching closed markets at offset', offset, err);
        break;
      }
    }

    console.log(`[GammaClient] Total closed markets fetched: ${markets.length}`);
    return markets;
  }
}
