import axios from 'axios';

const axiosClient = axios.create({
  baseURL: 'https://gamma-api.polymarket.com',
  timeout: 30000, // Increased timeout for large paginated requests
});

// Retry helper with exponential backoff
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelayMs = 1000
): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      const isRetryable = err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT' || err.response?.status >= 500;
      if (!isRetryable || attempt === maxRetries - 1) {
        throw err;
      }
      const delay = baseDelayMs * Math.pow(2, attempt);
      console.log(`[GammaClient] Retry ${attempt + 1}/${maxRetries} after ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

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
  // Additional fields for UI
  image?: string;                 // Market image URL
  icon?: string;                  // Market icon URL
  volume24hr?: string;            // 24h trading volume
  oneDayPriceChange?: string;     // 24h price change (decimal, e.g., "0.05" = 5%)
  bestBid?: string;               // Current best bid
  bestAsk?: string;               // Current best ask
  description?: string;           // Market description
}

export class GammaClient {
  private axios = axiosClient;

  async getMarkets(params: {
    active?: boolean;
    closed?: boolean;
    limit?: number;
    offset?: number;
  } = {}): Promise<GammaMarket[]> {
    return withRetry(async () => {
      const { data } = await this.axios.get('/markets', { params });
      return data;
    });
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
    let consecutiveErrors = 0;
    const maxConsecutiveErrors = 3;

    console.log('[GammaClient] Fetching all active markets...');

    // Keep fetching until no more markets
    while (true) {
      try {
        const batch = await this.getActiveMarkets(limit, offset);
        consecutiveErrors = 0; // Reset on success

        if (batch.length === 0) break;
        markets.push(...batch);
        offset += limit;

        // Log progress every 500 markets
        if (markets.length % 500 === 0) {
          console.log(`[GammaClient] Fetched ${markets.length} markets so far...`);
        }

        if (batch.length < limit) break; // Last page

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (err) {
        consecutiveErrors++;
        console.error(`[GammaClient] Error fetching markets at offset ${offset} (attempt ${consecutiveErrors}/${maxConsecutiveErrors})`, err);

        if (consecutiveErrors >= maxConsecutiveErrors) {
          console.error('[GammaClient] Too many consecutive errors, stopping fetch');
          break;
        }

        // Wait before retrying the same offset
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    console.log(`[GammaClient] Total active markets fetched: ${markets.length}`);
    return markets;
  }

  async getAllClosedMarkets(): Promise<GammaMarket[]> {
    const markets: GammaMarket[] = [];
    let offset = 0;
    const batchSize = 100;
    let consecutiveErrors = 0;
    const maxConsecutiveErrors = 3;

    console.log('[GammaClient] Fetching all closed markets...');

    while (true) {
      try {
        const batch = await this.getClosedMarkets(batchSize, offset);
        consecutiveErrors = 0; // Reset on success

        if (batch.length === 0) break;
        markets.push(...batch);
        offset += batchSize;

        if (markets.length % 500 === 0) {
          console.log(`[GammaClient] Fetched ${markets.length} closed markets so far...`);
        }

        if (batch.length < batchSize) break;

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (err) {
        consecutiveErrors++;
        console.error(`[GammaClient] Error fetching closed markets at offset ${offset} (attempt ${consecutiveErrors}/${maxConsecutiveErrors})`, err);

        if (consecutiveErrors >= maxConsecutiveErrors) {
          console.error('[GammaClient] Too many consecutive errors, stopping fetch');
          break;
        }

        // Wait before retrying the same offset
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    console.log(`[GammaClient] Total closed markets fetched: ${markets.length}`);
    return markets;
  }
}
