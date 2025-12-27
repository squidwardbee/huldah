import axios from 'axios';
import { Pool } from 'pg';
import {
  computeDTW,
  normalizeDTWDistance,
  dtwToScore,
  createTradeSignal,
  createPriceChangeSeries,
  normalizeTimeSeries,
  pearsonCorrelation,
} from '../utils/dtw.js';

const DATA_API = 'https://data-api.polymarket.com';
const CLOB_API = 'https://clob.polymarket.com';

interface MarketTrade {
  proxyWallet: string;
  side: 'BUY' | 'SELL';
  price: number;
  size: number;
  timestamp: number;
}

interface PricePoint {
  t: number;
  p: number;
}

interface WalletDTWScore {
  walletAddress: string;
  dtwScore: number;
  correlation: number;
  tradeCount: number;
  totalVolume: number;
  avgTradeSize: number;
  profitDirection: 'YES' | 'NO' | 'MIXED';
}

export class DTWService {
  private db: Pool;

  constructor(db: Pool) {
    this.db = db;
  }

  /**
   * Fetch recent trades for a market
   */
  private async fetchMarketTrades(tokenId: string, limit = 500): Promise<MarketTrade[]> {
    try {
      const { data } = await axios.get<MarketTrade[]>(`${DATA_API}/trades`, {
        params: { asset: tokenId, limit }
      });
      return data;
    } catch (err) {
      console.error('[DTW] Error fetching trades:', err);
      return [];
    }
  }

  /**
   * Fetch price history for a market
   */
  private async fetchPriceHistory(tokenId: string, interval = '1d'): Promise<PricePoint[]> {
    try {
      const { data } = await axios.get(`${CLOB_API}/prices-history`, {
        params: { market: tokenId, interval }
      });
      return data.history || [];
    } catch (err) {
      console.error('[DTW] Error fetching price history:', err);
      return [];
    }
  }

  /**
   * Compute DTW scores for all wallets in a market
   * This identifies wallets whose trades correlate with future price moves
   */
  async computeMarketDTWScores(tokenId: string): Promise<WalletDTWScore[]> {
    console.log(`[DTW] Computing scores for market ${tokenId.slice(0, 10)}...`);

    // Fetch data in parallel
    const [trades, priceHistory] = await Promise.all([
      this.fetchMarketTrades(tokenId, 1000),
      this.fetchPriceHistory(tokenId, '1d')
    ]);

    if (trades.length < 10 || priceHistory.length < 5) {
      console.log('[DTW] Insufficient data for analysis');
      return [];
    }

    // Create price change series with 1-period lag (looking at future price changes)
    const { timestamps, changes } = createPriceChangeSeries(
      priceHistory.map(p => ({ timestamp: p.t, price: p.p })),
      1
    );

    if (timestamps.length < 5) {
      return [];
    }

    // Normalize price changes for comparison
    const normalizedPriceChanges = normalizeTimeSeries(changes);

    // Group trades by wallet
    const walletTrades = new Map<string, MarketTrade[]>();
    for (const trade of trades) {
      const wallet = trade.proxyWallet.toLowerCase();
      if (!walletTrades.has(wallet)) {
        walletTrades.set(wallet, []);
      }
      walletTrades.get(wallet)!.push(trade);
    }

    const results: WalletDTWScore[] = [];

    for (const [walletAddress, walletTradeList] of walletTrades) {
      // Need minimum trades for meaningful analysis
      if (walletTradeList.length < 3) continue;

      // Create trade signal
      const tradeSignal = createTradeSignal(
        walletTradeList.map(t => ({
          timestamp: t.timestamp,
          side: t.side,
          usdValue: t.size * t.price
        })),
        timestamps
      );

      // Skip if no signal overlaps with price data
      const nonZeroSignal = tradeSignal.filter(s => s !== 0);
      if (nonZeroSignal.length < 2) continue;

      // Normalize trade signal
      const normalizedSignal = normalizeTimeSeries(tradeSignal);

      // Compute DTW distance
      const { distance } = computeDTW(normalizedSignal, normalizedPriceChanges);
      const normalizedDistance = normalizeDTWDistance(distance, timestamps.length);
      const dtwScore = dtwToScore(normalizedDistance);

      // Also compute simple correlation as sanity check
      const correlation = pearsonCorrelation(normalizedSignal, normalizedPriceChanges);

      // Compute wallet stats
      const totalVolume = walletTradeList.reduce((sum, t) => sum + t.size * t.price, 0);
      const avgTradeSize = totalVolume / walletTradeList.length;

      // Determine net direction
      const buyVolume = walletTradeList
        .filter(t => t.side === 'BUY')
        .reduce((sum, t) => sum + t.size * t.price, 0);
      const sellVolume = walletTradeList
        .filter(t => t.side === 'SELL')
        .reduce((sum, t) => sum + t.size * t.price, 0);

      let profitDirection: 'YES' | 'NO' | 'MIXED';
      if (buyVolume > sellVolume * 1.5) {
        profitDirection = 'YES';
      } else if (sellVolume > buyVolume * 1.5) {
        profitDirection = 'NO';
      } else {
        profitDirection = 'MIXED';
      }

      results.push({
        walletAddress,
        dtwScore,
        correlation: Math.round(correlation * 100) / 100,
        tradeCount: walletTradeList.length,
        totalVolume,
        avgTradeSize,
        profitDirection
      });
    }

    // Sort by DTW score (higher = more predictive)
    results.sort((a, b) => b.dtwScore - a.dtwScore);

    console.log(`[DTW] Computed scores for ${results.length} wallets`);
    if (results[0]) {
      console.log(`[DTW] Top scorer: ${results[0].walletAddress.slice(0, 10)}... (score: ${results[0].dtwScore})`);
    }

    return results;
  }

  /**
   * Get top predictive wallets for a market
   * These are wallets whose past trades correlate with subsequent price moves
   */
  async getMarketInsiders(tokenId: string, limit = 10): Promise<WalletDTWScore[]> {
    const scores = await this.computeMarketDTWScores(tokenId);

    // Filter for high-scoring wallets with meaningful activity
    const filtered = scores.filter(s =>
      s.dtwScore >= 60 &&      // At least 60% predictive score
      s.tradeCount >= 3 &&     // Minimum trades
      s.totalVolume >= 100     // Minimum volume
    );

    return filtered.slice(0, limit);
  }

  /**
   * Store DTW scores in the database for historical tracking
   */
  async storeDTWScores(
    tokenId: string,
    marketQuestion: string,
    scores: WalletDTWScore[]
  ): Promise<void> {
    const client = await this.db.connect();

    try {
      await client.query('BEGIN');

      // Delete old scores for this market
      await client.query(
        'DELETE FROM wallet_market_dtw WHERE token_id = $1',
        [tokenId]
      );

      // Insert new scores
      for (const score of scores) {
        await client.query(`
          INSERT INTO wallet_market_dtw (
            wallet_address, token_id, market_question,
            dtw_score, correlation, trade_count,
            total_volume, avg_trade_size, profit_direction,
            computed_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
        `, [
          score.walletAddress,
          tokenId,
          marketQuestion,
          score.dtwScore,
          score.correlation,
          score.tradeCount,
          score.totalVolume,
          score.avgTradeSize,
          score.profitDirection
        ]);
      }

      await client.query('COMMIT');
      console.log(`[DTW] Stored ${scores.length} scores for market ${tokenId.slice(0, 10)}...`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[DTW] Error storing scores:', err);
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Get stored DTW scores for a market (cached from last computation)
   */
  async getStoredScores(tokenId: string, limit = 10): Promise<WalletDTWScore[]> {
    const { rows } = await this.db.query(`
      SELECT
        wallet_address as "walletAddress",
        dtw_score as "dtwScore",
        correlation,
        trade_count as "tradeCount",
        total_volume as "totalVolume",
        avg_trade_size as "avgTradeSize",
        profit_direction as "profitDirection"
      FROM wallet_market_dtw
      WHERE token_id = $1
      ORDER BY dtw_score DESC
      LIMIT $2
    `, [tokenId, limit]);

    return rows;
  }
}
