/**
 * Pattern Matching Service
 *
 * Manages historical price data collection, pattern window generation,
 * and DTW-based pattern search for price prediction.
 */

import axios from 'axios';
import { Pool } from 'pg';
import {
  computeDTWWindowed,
  normalizeTimeSeries,
  zNormalize,
  dtwToScore,
  getDirection,
  calculateSignificance,
  lbKeogh,
  type PatternMatch,
  type PatternSearchResult,
} from '../utils/patternMatching.js';

const CLOB_API = 'https://clob.polymarket.com';

interface PricePoint {
  t: number; // Unix timestamp
  p: number; // Price
}

interface Candle {
  time: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface StoredPattern {
  id: number;
  token_id: string;
  market_id: string;
  market_question: string;
  window_start: Date;
  window_end: Date;
  pattern_data: number[];
  outcome_1h: number | null;
  outcome_4h: number | null;
  outcome_24h: number | null;
}

export class PatternService {
  private db: Pool;

  constructor(db: Pool) {
    this.db = db;
  }

  /**
   * Fetch price history from Polymarket CLOB API
   */
  async fetchPriceHistory(
    tokenId: string,
    startTs?: number,
    endTs?: number,
    fidelity: number = 5
  ): Promise<PricePoint[]> {
    try {
      const params: Record<string, string | number> = { market: tokenId };

      if (startTs && endTs) {
        params.startTs = startTs;
        params.endTs = endTs;
        params.fidelity = fidelity;
      } else {
        params.interval = 'max';
      }

      const response = await axios.get(`${CLOB_API}/prices-history`, {
        params,
        timeout: 10000,
      });

      return response.data.history || [];
    } catch (error) {
      console.error(`[PatternService] Error fetching price history for ${tokenId}:`, error);
      return [];
    }
  }

  /**
   * Convert price points to OHLC candles
   */
  aggregateToCandles(pricePoints: PricePoint[], intervalMinutes: number = 5): Candle[] {
    if (pricePoints.length === 0) return [];

    const intervalMs = intervalMinutes * 60 * 1000;
    const candles: Candle[] = [];
    let currentCandle: Candle | null = null;
    let currentBucketTime = 0;

    // Sort by timestamp
    const sorted = [...pricePoints].sort((a, b) => a.t - b.t);

    for (const point of sorted) {
      const bucketTime = Math.floor((point.t * 1000) / intervalMs) * intervalMs;

      if (!currentCandle || currentBucketTime !== bucketTime) {
        if (currentCandle) {
          candles.push(currentCandle);
        }
        currentBucketTime = bucketTime;
        currentCandle = {
          time: new Date(bucketTime),
          open: point.p,
          high: point.p,
          low: point.p,
          close: point.p,
          volume: 0,
        };
      } else {
        currentCandle.high = Math.max(currentCandle.high, point.p);
        currentCandle.low = Math.min(currentCandle.low, point.p);
        currentCandle.close = point.p;
      }
    }

    if (currentCandle) {
      candles.push(currentCandle);
    }

    return candles;
  }

  /**
   * Store candles in database
   */
  async storeCandles(tokenId: string, marketId: string | null, candles: Candle[]): Promise<void> {
    if (candles.length === 0) return;

    const client = await this.db.connect();
    try {
      await client.query('BEGIN');

      for (const candle of candles) {
        await client.query(
          `INSERT INTO price_candles (token_id, market_id, time, open, high, low, close, volume)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (token_id, time) DO UPDATE SET
             open = EXCLUDED.open,
             high = EXCLUDED.high,
             low = EXCLUDED.low,
             close = EXCLUDED.close,
             volume = EXCLUDED.volume`,
          [tokenId, marketId, candle.time, candle.open, candle.high, candle.low, candle.close, candle.volume]
        );
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get candles from database
   */
  async getCandles(tokenId: string, limit: number = 500): Promise<Candle[]> {
    const result = await this.db.query(
      `SELECT time, open, high, low, close, volume
       FROM price_candles
       WHERE token_id = $1
       ORDER BY time DESC
       LIMIT $2`,
      [tokenId, limit]
    );

    return result.rows
      .map((row) => ({
        time: new Date(row.time),
        open: parseFloat(row.open),
        high: parseFloat(row.high),
        low: parseFloat(row.low),
        close: parseFloat(row.close),
        volume: parseFloat(row.volume || 0),
      }))
      .reverse(); // Return in chronological order
  }

  /**
   * Generate pattern windows from candles and store them
   */
  async generatePatternWindows(
    tokenId: string,
    marketId: string | null,
    marketQuestion: string | null,
    windowSize: number = 20
  ): Promise<number> {
    const candles = await this.getCandles(tokenId, 1000);
    if (candles.length < windowSize + 48) {
      // Need enough data for window + outcome period
      return 0;
    }

    const closePrices = candles.map((c) => c.close);
    let storedCount = 0;

    // Sliding window
    for (let i = 0; i <= closePrices.length - windowSize - 48; i++) {
      const window = closePrices.slice(i, i + windowSize);
      const normalized = normalizeTimeSeries(window);

      const windowStart = candles[i].time;
      const windowEnd = candles[i + windowSize - 1].time;
      const endPrice = window[window.length - 1];

      // Calculate outcomes (price changes after window)
      const price1h = i + windowSize + 12 < closePrices.length ? closePrices[i + windowSize + 12] : null;
      const price4h = i + windowSize + 48 < closePrices.length ? closePrices[i + windowSize + 48] : null;

      const outcome1h = price1h !== null ? price1h - endPrice : null;
      const outcome4h = price4h !== null ? price4h - endPrice : null;

      try {
        await this.db.query(
          `INSERT INTO pattern_windows
           (token_id, market_id, market_question, window_start, window_end, pattern_length, pattern_data, outcome_1h, outcome_4h)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (token_id, window_start, pattern_length) DO UPDATE SET
             outcome_1h = EXCLUDED.outcome_1h,
             outcome_4h = EXCLUDED.outcome_4h`,
          [tokenId, marketId, marketQuestion, windowStart, windowEnd, windowSize, normalized, outcome1h, outcome4h]
        );
        storedCount++;
      } catch (error) {
        // Skip duplicates
      }
    }

    return storedCount;
  }

  /**
   * Get stored pattern windows for searching
   * For larger candle intervals (15m, 60m), we re-aggregate from stored 5-min candles at runtime
   */
  async getPatternWindows(
    patternLength: number = 20,
    excludeTokenId?: string,
    limit: number = 5000,
    candleInterval: 5 | 15 | 60 = 5
  ): Promise<StoredPattern[]> {
    // For 5-minute candles, use stored pattern windows directly
    if (candleInterval === 5) {
      const result = await this.db.query(
        `SELECT id, token_id, market_id, market_question, window_start, window_end,
                pattern_data, outcome_1h, outcome_4h, outcome_24h
         FROM pattern_windows
         WHERE pattern_length = $1
           AND ($2::text IS NULL OR token_id != $2)
           AND (outcome_1h IS NOT NULL OR outcome_4h IS NOT NULL)
         ORDER BY window_start DESC
         LIMIT $3`,
        [patternLength, excludeTokenId || null, limit]
      );

      return result.rows.map((row) => ({
        id: row.id,
        token_id: row.token_id,
        market_id: row.market_id,
        market_question: row.market_question,
        window_start: new Date(row.window_start),
        window_end: new Date(row.window_end),
        pattern_data: row.pattern_data.map((v: string) => parseFloat(v)),
        outcome_1h: row.outcome_1h ? parseFloat(row.outcome_1h) : null,
        outcome_4h: row.outcome_4h ? parseFloat(row.outcome_4h) : null,
        outcome_24h: row.outcome_24h ? parseFloat(row.outcome_24h) : null,
      }));
    }

    // For 15m or 60m intervals, we need to generate patterns from raw candles
    // Get unique tokens that have enough candle data
    const tokensResult = await this.db.query(
      `SELECT DISTINCT token_id, market_id,
              (SELECT question FROM markets WHERE condition_id = price_candles.market_id LIMIT 1) as market_question
       FROM price_candles
       GROUP BY token_id, market_id
       HAVING COUNT(*) > $1
       LIMIT 50`,
      [patternLength * (candleInterval / 5) * 2] // Need enough 5-min candles
    );

    const patterns: StoredPattern[] = [];
    const aggregationFactor = candleInterval / 5; // How many 5-min candles per larger candle
    const outcomeCandles1h = Math.ceil(60 / candleInterval); // Candles for 1h outcome
    const outcomeCandles4h = Math.ceil(240 / candleInterval); // Candles for 4h outcome

    for (const tokenRow of tokensResult.rows) {
      // Get all 5-min candles for this token
      const candlesResult = await this.db.query(
        `SELECT time, close FROM price_candles
         WHERE token_id = $1
         ORDER BY time ASC`,
        [tokenRow.token_id]
      );

      if (candlesResult.rows.length < patternLength * aggregationFactor + outcomeCandles4h * aggregationFactor) {
        continue;
      }

      // Aggregate to larger candles
      const aggregatedCandles: { time: Date; close: number }[] = [];
      for (let i = 0; i < candlesResult.rows.length; i += aggregationFactor) {
        const chunk = candlesResult.rows.slice(i, i + aggregationFactor);
        if (chunk.length === aggregationFactor) {
          aggregatedCandles.push({
            time: new Date(chunk[0].time),
            close: parseFloat(chunk[chunk.length - 1].close), // Use closing price of chunk
          });
        }
      }

      // Generate sliding window patterns
      const closePrices = aggregatedCandles.map(c => c.close);

      for (let i = 0; i <= closePrices.length - patternLength - outcomeCandles4h; i++) {
        const window = closePrices.slice(i, i + patternLength);
        const normalized = normalizeTimeSeries(window);
        const endPrice = window[window.length - 1];

        // Calculate outcomes
        const price1h = i + patternLength + outcomeCandles1h < closePrices.length
          ? closePrices[i + patternLength + outcomeCandles1h]
          : null;
        const price4h = i + patternLength + outcomeCandles4h < closePrices.length
          ? closePrices[i + patternLength + outcomeCandles4h]
          : null;

        patterns.push({
          id: patterns.length,
          token_id: tokenRow.token_id,
          market_id: tokenRow.market_id,
          market_question: tokenRow.market_question || 'Unknown',
          window_start: aggregatedCandles[i].time,
          window_end: aggregatedCandles[i + patternLength - 1].time,
          pattern_data: normalized,
          outcome_1h: price1h !== null ? price1h - endPrice : null,
          outcome_4h: price4h !== null ? price4h - endPrice : null,
          outcome_24h: null,
        });

        if (patterns.length >= limit) break;
      }

      if (patterns.length >= limit) break;
    }

    return patterns;
  }

  /**
   * Search for similar patterns using DTW
   * @param tokenId - The token to analyze
   * @param windowSize - Number of candles in the pattern window (default 20)
   * @param horizon - Prediction horizon: '1h' or '4h'
   * @param maxDistance - Maximum DTW distance threshold
   * @param topK - Return top K matches
   * @param candleInterval - Candle interval in minutes: 5, 15, or 60 (default 5)
   */
  async searchPatterns(
    tokenId: string,
    windowSize: number = 20,
    horizon: '1h' | '4h' = '4h',
    maxDistance: number = 5.0,
    topK: number = 100,
    candleInterval: 5 | 15 | 60 = 5
  ): Promise<PatternSearchResult> {
    // Get current price data for this token
    const priceHistory = await this.fetchPriceHistory(tokenId);
    if (priceHistory.length < windowSize) {
      throw new Error('Not enough price history for pattern matching');
    }

    const candles = this.aggregateToCandles(priceHistory, candleInterval);
    if (candles.length < windowSize) {
      throw new Error('Not enough candles for pattern matching');
    }

    // Get the most recent window as query
    const recentCandles = candles.slice(-windowSize);
    const queryRaw = recentCandles.map((c) => c.close);
    const queryNormalized = normalizeTimeSeries(queryRaw);
    const queryZNorm = zNormalize(queryRaw);

    const startTime = recentCandles[0].time;
    const endTime = recentCandles[recentCandles.length - 1].time;

    // Get historical patterns (include same token's history for self-similar pattern matching)
    const historicalPatterns = await this.getPatternWindows(windowSize, undefined, 5000, candleInterval);

    if (historicalPatterns.length === 0) {
      return {
        query: {
          startTime,
          endTime,
          data: queryRaw,
          normalized: queryNormalized,
        },
        matches: [],
        statistics: {
          totalMatches: 0,
          upCount: 0,
          downCount: 0,
          flatCount: 0,
          upPercentage: 0,
          downPercentage: 0,
          avgUpMove: 0,
          avgDownMove: 0,
          avgDistance: 0,
        },
        prediction: {
          direction: 'NEUTRAL',
          confidence: 0,
          expectedMove: 0,
        },
      };
    }

    // Search for matches using DTW - use normalized patterns directly (already normalized in DB)
    const matches: PatternMatch[] = [];
    const dtwWindow = Math.floor(windowSize / 2); // Wider Sakoe-Chiba band for flexibility
    const effectiveMaxDistance = 50; // Very permissive for testing

    console.log(`[PatternService] Searching ${historicalPatterns.length} patterns, query length: ${queryNormalized.length}`);

    let debugCount = 0;
    for (const pattern of historicalPatterns) {
      // Use min-max normalized data directly (patterns stored as normalized)
      const distance = computeDTWWindowed(
        queryNormalized,
        pattern.pattern_data,
        dtwWindow,
        effectiveMaxDistance
      );

      if (debugCount < 5) {
        console.log(`[PatternService] Pattern ${debugCount}: distance=${distance}, threshold=${effectiveMaxDistance}`);
        debugCount++;
      }

      if (distance < effectiveMaxDistance && isFinite(distance)) {
        const outcomeValue = horizon === '1h' ? pattern.outcome_1h : pattern.outcome_4h;

        matches.push({
          tokenId: pattern.token_id,
          marketId: pattern.market_id,
          marketQuestion: pattern.market_question,
          windowStart: pattern.window_start,
          windowEnd: pattern.window_end,
          distance,
          similarity: dtwToScore(distance, effectiveMaxDistance),
          outcome1h: pattern.outcome_1h ?? undefined,
          outcome4h: pattern.outcome_4h ?? undefined,
          direction: outcomeValue !== null ? getDirection(outcomeValue) : undefined,
          patternData: pattern.pattern_data, // Include pattern data for visualization
        });
      }
    }

    console.log(`[PatternService] Found ${matches.length} matches`);

    // Sort by distance and take top K
    matches.sort((a, b) => a.distance - b.distance);
    const topMatches = matches.slice(0, topK);

    // Calculate statistics
    const outcomeKey = horizon === '1h' ? 'outcome1h' : 'outcome4h';
    const withOutcome = topMatches.filter((m) => m[outcomeKey] !== undefined);

    const upMatches = withOutcome.filter((m) => getDirection(m[outcomeKey]!) === 'UP');
    const downMatches = withOutcome.filter((m) => getDirection(m[outcomeKey]!) === 'DOWN');
    const flatMatches = withOutcome.filter((m) => getDirection(m[outcomeKey]!) === 'FLAT');

    const upMoves = upMatches.map((m) => m[outcomeKey]!);
    const downMoves = downMatches.map((m) => m[outcomeKey]!);

    const avgDistance =
      topMatches.length > 0
        ? topMatches.reduce((sum, m) => sum + m.distance, 0) / topMatches.length
        : 0;

    const upPercentage = withOutcome.length > 0 ? (upMatches.length / withOutcome.length) * 100 : 0;
    const downPercentage = withOutcome.length > 0 ? (downMatches.length / withOutcome.length) * 100 : 0;

    // Prediction
    const direction: 'UP' | 'DOWN' | 'NEUTRAL' =
      upPercentage > 55 ? 'UP' : downPercentage > 55 ? 'DOWN' : 'NEUTRAL';

    const confidence = Math.abs(upPercentage - 50) / 50; // 0 to 1 scale
    const pValue = calculateSignificance(upMatches.length, withOutcome.length);

    const expectedMove =
      withOutcome.length > 0
        ? withOutcome.reduce((sum, m) => sum + (m[outcomeKey] || 0), 0) / withOutcome.length
        : 0;

    return {
      query: {
        startTime,
        endTime,
        data: queryRaw,
        normalized: queryNormalized,
      },
      matches: topMatches.slice(0, 10), // Return top 10 examples
      statistics: {
        totalMatches: topMatches.length,
        upCount: upMatches.length,
        downCount: downMatches.length,
        flatCount: flatMatches.length,
        upPercentage: Math.round(upPercentage * 10) / 10,
        downPercentage: Math.round(downPercentage * 10) / 10,
        avgUpMove: upMoves.length > 0 ? upMoves.reduce((a, b) => a + b, 0) / upMoves.length : 0,
        avgDownMove: downMoves.length > 0 ? downMoves.reduce((a, b) => a + b, 0) / downMoves.length : 0,
        avgDistance: Math.round(avgDistance * 1000) / 1000,
      },
      prediction: {
        direction,
        confidence: Math.round(confidence * 100) / 100,
        expectedMove: Math.round(expectedMove * 10000) / 10000,
      },
    };
  }

  /**
   * Backfill historical data for a market
   */
  async backfillMarket(
    tokenId: string,
    marketId: string | null,
    marketQuestion: string | null
  ): Promise<{ candles: number; patterns: number }> {
    console.log(`[PatternService] Backfilling ${tokenId}...`);

    // Fetch full price history
    const priceHistory = await this.fetchPriceHistory(tokenId);
    if (priceHistory.length === 0) {
      return { candles: 0, patterns: 0 };
    }

    // Convert to candles and store
    const candles = this.aggregateToCandles(priceHistory, 5);
    await this.storeCandles(tokenId, marketId, candles);

    // Generate pattern windows
    const patternCount = await this.generatePatternWindows(tokenId, marketId, marketQuestion, 20);

    console.log(`[PatternService] Backfilled ${tokenId}: ${candles.length} candles, ${patternCount} patterns`);
    return { candles: candles.length, patterns: patternCount };
  }

  /**
   * Get pattern matching statistics
   */
  async getStatistics(): Promise<{
    totalCandles: number;
    totalPatterns: number;
    uniqueMarkets: number;
  }> {
    const [candleResult, patternResult, marketResult] = await Promise.all([
      this.db.query('SELECT COUNT(*) FROM price_candles'),
      this.db.query('SELECT COUNT(*) FROM pattern_windows'),
      this.db.query('SELECT COUNT(DISTINCT token_id) FROM pattern_windows'),
    ]);

    return {
      totalCandles: parseInt(candleResult.rows[0].count),
      totalPatterns: parseInt(patternResult.rows[0].count),
      uniqueMarkets: parseInt(marketResult.rows[0].count),
    };
  }
}
