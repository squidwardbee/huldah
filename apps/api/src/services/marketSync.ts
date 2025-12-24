import { Pool } from 'pg';
import { GammaClient, GammaMarket } from './polymarket/gammaClient.js';

/**
 * Market Sync Service
 * 
 * Responsibilities:
 * 1. Sync market conditions from Gamma API
 * 2. Track market resolutions
 * 3. Update wallet positions with outcome_correct when markets resolve
 */

export class MarketSyncService {
  private db: Pool;
  private gamma: GammaClient;
  private isRunning = false;

  constructor(db: Pool) {
    this.db = db;
    this.gamma = new GammaClient();
  }

  /**
   * Sync active markets from Gamma API
   */
  async syncActiveMarkets(): Promise<number> {
    console.log('[MarketSync] Syncing active markets...');
    
    try {
      const markets = await this.gamma.getAllActiveMarkets();
      console.log(`[MarketSync] Fetched ${markets.length} active markets`);

      let synced = 0;
      for (const market of markets) {
        try {
          await this.upsertMarket(market);
          synced++;
        } catch (err) {
          console.error(`[MarketSync] Error syncing market ${market.conditionId || market.question?.slice(0, 30)}:`, err);
        }
      }

      console.log(`[MarketSync] Synced ${synced} active markets`);
      return synced;
    } catch (err) {
      console.error('[MarketSync] Error syncing active markets:', err);
      return 0;
    }
  }

  /**
   * Sync recently closed markets and check for resolutions
   */
  async syncResolvedMarkets(): Promise<number> {
    console.log('[MarketSync] Checking for resolved markets...');

    try {
      const closedMarkets = await this.gamma.getRecentlyClosedMarkets(500);
      console.log(`[MarketSync] Fetched ${closedMarkets.length} closed markets`);

      let resolved = 0;
      for (const market of closedMarkets) {
        try {
          const wasNewResolution = await this.processResolution(market);
          if (wasNewResolution) resolved++;
        } catch (err) {
          console.error(`[MarketSync] Error processing resolution for ${market.conditionId || market.question?.slice(0, 30)}:`, err);
        }
      }

      if (resolved > 0) {
        console.log(`[MarketSync] Processed ${resolved} new resolutions`);
        // Update wallet position outcomes after processing resolutions
        await this.updatePositionOutcomes();
      }

      return resolved;
    } catch (err) {
      console.error('[MarketSync] Error syncing resolved markets:', err);
      return 0;
    }
  }

  /**
   * Upsert a market into the database
   */
  private async upsertMarket(market: GammaMarket): Promise<void> {
    // Skip markets without conditionId (API uses camelCase)
    if (!market.conditionId) {
      return;
    }

    // Parse outcome prices if available (outcomePrices is JSON string like "[\"0.75\", \"0.25\"]")
    let yesPrice = 0.5;
    let noPrice = 0.5;
    
    if (market.outcomePrices) {
      try {
        const prices = JSON.parse(market.outcomePrices);
        if (Array.isArray(prices) && prices.length >= 2) {
          yesPrice = parseFloat(prices[0]) || 0.5;
          noPrice = parseFloat(prices[1]) || 0.5;
        }
      } catch {
        // Ignore parse errors
      }
    }

    // Extract token_ids from clobTokenIds (JSON string like "[\"token1\", \"token2\"]")
    let yesTokenId: string | null = null;
    let noTokenId: string | null = null;
    
    if (market.clobTokenIds) {
      try {
        const tokenIds = JSON.parse(market.clobTokenIds);
        if (Array.isArray(tokenIds) && tokenIds.length >= 2) {
          yesTokenId = tokenIds[0];
          noTokenId = tokenIds[1];
        }
      } catch {
        // Ignore parse errors
      }
    }

    await this.db.query(`
      INSERT INTO markets (
        condition_id, question, slug,
        last_price_yes, last_price_no,
        volume, liquidity, end_date,
        yes_token_id, no_token_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (condition_id) DO UPDATE SET
        question = COALESCE(EXCLUDED.question, markets.question),
        slug = COALESCE(EXCLUDED.slug, markets.slug),
        last_price_yes = EXCLUDED.last_price_yes,
        last_price_no = EXCLUDED.last_price_no,
        volume = EXCLUDED.volume,
        liquidity = EXCLUDED.liquidity,
        end_date = COALESCE(EXCLUDED.end_date, markets.end_date),
        yes_token_id = COALESCE(EXCLUDED.yes_token_id, markets.yes_token_id),
        no_token_id = COALESCE(EXCLUDED.no_token_id, markets.no_token_id)
    `, [
      market.conditionId,
      market.question,
      market.slug,
      yesPrice,
      noPrice,
      parseFloat(market.volume) || 0,
      parseFloat(market.liquidity) || 0,
      market.endDateIso ? new Date(market.endDateIso) : (market.endDate ? new Date(market.endDate) : null),
      yesTokenId,
      noTokenId
    ]);
  }

  /**
   * Process a market resolution
   * Returns true if this was a new resolution
   */
  private async processResolution(market: GammaMarket): Promise<boolean> {
    // Skip markets without conditionId
    if (!market.conditionId) {
      return false;
    }

    // Check if we already have this resolution
    const existing = await this.db.query(
      `SELECT resolved, resolution_outcome FROM markets WHERE condition_id = $1`,
      [market.conditionId]
    );

    if (existing.rows[0]?.resolved) {
      return false; // Already processed
    }

    // Determine the resolution outcome from prices (closed markets have 1.0 for winner)
    let resolutionOutcome: number | null = null;

    if (market.outcomePrices) {
      try {
        const prices = JSON.parse(market.outcomePrices);
        if (Array.isArray(prices)) {
          if (parseFloat(prices[0]) >= 0.99) resolutionOutcome = 1;  // Yes won
          else if (parseFloat(prices[1]) >= 0.99) resolutionOutcome = 0;  // No won
        }
      } catch {
        // Ignore parse errors
      }
    }

    if (resolutionOutcome === null && !market.closed) {
      return false; // Not actually resolved
    }

    // Upsert market with resolution
    await this.db.query(`
      INSERT INTO markets (
        condition_id, question, slug,
        last_price_yes, last_price_no,
        volume, liquidity,
        resolved, resolution_outcome
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (condition_id) DO UPDATE SET
        resolved = true,
        resolution_outcome = EXCLUDED.resolution_outcome
    `, [
      market.conditionId,
      market.question,
      market.slug,
      0.5, 0.5,  // Prices don't matter for resolved
      parseFloat(market.volume) || 0,
      parseFloat(market.liquidity) || 0,
      true,
      resolutionOutcome
    ]);

    console.log(`[MarketSync] Resolved: ${market.question?.slice(0, 50)}... => ${resolutionOutcome === 1 ? 'YES' : 'NO'}`);
    return true;
  }

  /**
   * Update wallet positions with outcome_correct based on resolved markets
   */
  private async updatePositionOutcomes(): Promise<void> {
    console.log('[MarketSync] Updating position outcomes...');

    // Update positions where the outcome matches the resolution
    const result = await this.db.query(`
      UPDATE wallet_positions wp
      SET 
        outcome_correct = (wp.outcome_index = m.resolution_outcome),
        profit_loss = CASE 
          WHEN wp.outcome_index = m.resolution_outcome 
          THEN wp.net_position * (1 - wp.avg_entry_price)
          ELSE -wp.net_position * wp.avg_entry_price
        END
      FROM markets m
      WHERE wp.condition_id = m.condition_id
        AND m.resolved = true
        AND m.resolution_outcome IS NOT NULL
        AND wp.outcome_correct IS NULL
    `);

    if (result.rowCount && result.rowCount > 0) {
      console.log(`[MarketSync] Updated ${result.rowCount} position outcomes`);
    }

    // Update wallet win/loss counts based on positions
    await this.db.query(`
      WITH position_stats AS (
        SELECT 
          wallet_address,
          COUNT(*) FILTER (WHERE outcome_correct = true) as wins,
          COUNT(*) FILTER (WHERE outcome_correct = false) as losses
        FROM wallet_positions
        WHERE outcome_correct IS NOT NULL
        GROUP BY wallet_address
      )
      UPDATE wallets w
      SET 
        win_count = COALESCE(ps.wins, 0),
        loss_count = COALESCE(ps.losses, 0)
      FROM position_stats ps
      WHERE w.address = ps.wallet_address
    `);
  }

  /**
   * Extract category from market data
   */
  private extractCategory(market: GammaMarket): string {
    if (market.category) return market.category;
    if (market.tags && market.tags.length > 0) return market.tags[0];
    
    // Try to infer from question
    const q = market.question?.toLowerCase() || '';
    if (q.includes('bitcoin') || q.includes('btc') || q.includes('crypto') || q.includes('eth')) {
      return 'Crypto';
    }
    if (q.includes('trump') || q.includes('biden') || q.includes('election') || q.includes('president')) {
      return 'Politics';
    }
    if (q.includes('nfl') || q.includes('nba') || q.includes('game') || q.includes('match')) {
      return 'Sports';
    }
    
    return 'Other';
  }

  /**
   * Full sync: active markets + resolutions
   */
  async fullSync(): Promise<void> {
    if (this.isRunning) {
      console.log('[MarketSync] Sync already in progress, skipping');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      await this.syncActiveMarkets();
      await this.syncResolvedMarkets();

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[MarketSync] Full sync complete in ${elapsed}s`);
    } catch (err) {
      console.error('[MarketSync] Error during full sync:', err);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Get market stats
   */
  async getStats(): Promise<{
    totalMarkets: number;
    activeMarkets: number;
    resolvedMarkets: number;
    lastSync: Date | null;
  }> {
    const { rows } = await this.db.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE resolved = false OR resolved IS NULL) as active,
        COUNT(*) FILTER (WHERE resolved = true) as resolved_count
      FROM markets
    `);

    return {
      totalMarkets: parseInt(rows[0].total) || 0,
      activeMarkets: parseInt(rows[0].active) || 0,
      resolvedMarkets: parseInt(rows[0].resolved_count) || 0,
      lastSync: new Date() // Just return current time since we don't track it
    };
  }

  /**
   * Scheduled job: run every 15 minutes
   */
  startScheduled(intervalMs = 15 * 60 * 1000): void {
    // Run immediately
    this.fullSync();

    // Then run on interval
    setInterval(() => {
      this.fullSync();
    }, intervalMs);

    console.log(`[MarketSync] Scheduled to run every ${intervalMs / 60000} minutes`);
  }
}

