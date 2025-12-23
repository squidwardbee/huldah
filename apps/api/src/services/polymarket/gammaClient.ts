import axios from 'axios';

const GAMMA_URL = 'https://gamma-api.polymarket.com';

export interface GammaMarket {
  condition_id: string;
  question_id: string;
  tokens: { token_id: string; outcome: string }[];
  question: string;
  slug: string;
  end_date_iso: string;
  volume: string;
  liquidity: string;
  active: boolean;
}

export class GammaClient {
  private axios = axios.create({
    baseURL: GAMMA_URL,
    timeout: 10000
  });

  async getActiveMarkets(limit = 100, offset = 0): Promise<GammaMarket[]> {
    const { data } = await this.axios.get('/markets', {
      params: { active: true, closed: false, limit, offset }
    });
    return data;
  }

  async getMarket(conditionId: string): Promise<GammaMarket> {
    const { data } = await this.axios.get(`/markets/${conditionId}`);
    return data;
  }

  async getAllActiveMarkets(): Promise<GammaMarket[]> {
    const markets: GammaMarket[] = [];
    let offset = 0;
    const limit = 100;

    while (true) {
      const batch = await this.getActiveMarkets(limit, offset);
      if (batch.length === 0) break;
      markets.push(...batch);
      offset += limit;
      if (batch.length < limit) break;
    }

    return markets;
  }
}


