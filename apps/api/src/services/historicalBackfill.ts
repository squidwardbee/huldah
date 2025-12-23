import axios from 'axios';
import { Pool } from 'pg';

const DATA_API = 'https://data-api.polymarket.com';
const GAMMA_API = 'https://gamma-api.polymarket.com';

// Rate limit: 75 req/10s = 7.5/s, so wait ~150ms between requests
const REQUEST_DELAY_MS = 150;
const BATCH_SIZE = 100;

interface DataTrade {
  proxyWallet: string;
  side: string;
  asset: string;
  conditionId: string;
  size: number;
  price: number;
  timestamp: number; // Unix seconds
  transactionHash: string;
  title?: string;
  outcome?: string;
}

interface GammaMarket {
  conditionId: string;
  question: string;
  slug: string;
  endDateIso: string;
  volume: string;
  liquidity: string;
  active: boolean;
  closed: boolean;
  clobTokenIds?: string;
  outcomes?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class HistoricalBackfill {
  private db: Pool;
  private isRunning = false;
  private processedCount = 0;
  private whaleCount = 0;

  constructor(db: Pool) {
    this.db = db;
  }

  async backfillTrades(daysBack: number = 30): Promise<void> {
    if (this.isRunning) {
      console.log('[Backfill] Already running');
      return;
    }

    this.isRunning = true;
    this.processedCount = 0;
    this.whaleCount = 0;

    // Timestamps in seconds for this API
    const endTimestamp = Math.floor(Date.now() / 1000);
    const startTimestamp = endTimestamp - (daysBack * 24 * 60 * 60);
    
    console.log(`[Backfill] Starting trade backfill for last ${daysBack} days`);
    console.log(`[Backfill] Date range: ${new Date(startTimestamp * 1000).toISOString()} to ${new Date(endTimestamp * 1000).toISOString()}`);

    let cursor = endTimestamp;
    let hasMore = true;

    try {
      while (hasMore && cursor > startTimestamp && this.isRunning) {
        const trades = await this.fetchTrades(cursor);
        
        if (trades.length === 0) {
          hasMore = false;
          break;
        }

        // Process trades in batch
        await this.processTradeBatch(trades);
        
        // Update cursor to oldest trade in batch
        cursor = Math.min(...trades.map(t => t.timestamp)) - 1;
        
        // Log progress every 1000 trades
        if (this.processedCount % 1000 === 0) {
          console.log(`[Backfill] Processed ${this.processedCount} trades, ${this.whaleCount} whales, cursor at ${new Date(cursor * 1000).toISOString()}`);
        }

        // Rate limiting
        await sleep(REQUEST_DELAY_MS);
      }

      console.log(`[Backfill] Complete! Processed ${this.processedCount} trades, ${this.whaleCount} whale trades`);
    } catch (err) {
      console.error('[Backfill] Error:', err);
    } finally {
      this.isRunning = false;
    }
  }

  private async fetchTrades(before: number): Promise<DataTrade[]> {
    try {
      const { data } = await axios.get<DataTrade[]>(`${DATA_API}/trades`, {
        params: {
          before,
          limit: BATCH_SIZE
        },
        timeout: 10000
      });
      return data;
    } catch (err) {
      console.error('[Backfill] Fetch error, retrying...', err);
      await sleep(2000);
      return this.fetchTrades(before);
    }
  }

  private async processTradeBatch(trades: DataTrade[]): Promise<void> {
    for (const trade of trades) {
      if (!trade.proxyWallet) continue;

      const usdValue = trade.size * trade.price;
      const isWhale = usdValue >= 1000;

      if (isWhale) this.whaleCount++;
      this.processedCount++;

      // Upsert wallet
      await this.db.query(`
        INSERT INTO wallets (address, total_trades, total_volume, last_active)
        VALUES ($1, 1, $2, to_timestamp($3))
        ON CONFLICT (address) DO UPDATE SET
          total_trades = wallets.total_trades + 1,
          total_volume = wallets.total_volume + $2,
          last_active = GREATEST(wallets.last_active, to_timestamp($3))
      `, [trade.proxyWallet, usdValue, trade.timestamp]);

      // Insert trade (ignore duplicates)
      await this.db.query(`
        INSERT INTO trades (tx_hash, wallet_address, market_id, token_id, side, price, size, usd_value, timestamp, is_whale)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, to_timestamp($9), $10)
        ON CONFLICT (tx_hash) DO NOTHING
      `, [
        trade.transactionHash,
        trade.proxyWallet,
        trade.conditionId,
        trade.asset,
        trade.side,
        trade.price,
        trade.size,
        usdValue,
        trade.timestamp,
        isWhale
      ]);
    }
  }

  async backfillMarkets(): Promise<void> {
    console.log('[Backfill] Starting market backfill...');
    
    let offset = 0;
    const limit = 100;
    let totalMarkets = 0;
    let resolvedCount = 0;

    while (true) {
      try {
        const { data: markets } = await axios.get<GammaMarket[]>(`${GAMMA_API}/markets`, {
          params: { limit, offset, closed: true },
          timeout: 10000
        });

        if (markets.length === 0) break;

        for (const market of markets) {
          // Skip markets without conditionId
          if (!market.conditionId) continue;

          await this.db.query(`
            INSERT INTO markets (condition_id, question, slug, end_date, volume, liquidity, resolved)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (condition_id) DO UPDATE SET
              volume = EXCLUDED.volume,
              liquidity = EXCLUDED.liquidity,
              resolved = EXCLUDED.resolved
          `, [
            market.conditionId,
            market.question,
            market.slug,
            market.endDateIso || null,
            market.volume || 0,
            market.liquidity || 0,
            market.closed
          ]);

          totalMarkets++;
          if (market.closed) resolvedCount++;
        }

        offset += limit;
        await sleep(100); // Rate limit for Gamma API

        if (markets.length < limit) break;
      } catch (err) {
        console.error('[Backfill] Market fetch error:', err);
        await sleep(2000);
      }
    }

    console.log(`[Backfill] Markets complete! ${totalMarkets} markets, ${resolvedCount} resolved`);
  }

  async calculateWinRates(): Promise<void> {
    console.log('[Backfill] Calculating win rates from resolved markets...');

    // For each wallet, check their trades on resolved markets
    const result = await this.db.query(`
      WITH resolved_trades AS (
        SELECT 
          t.wallet_address,
          t.market_id,
          t.token_id,
          t.side,
          t.usd_value,
          m.resolution_outcome,
          -- Determine if this was a winning trade
          CASE 
            WHEN t.side = 'BUY' AND m.resolution_outcome IS NOT NULL THEN
              CASE WHEN EXISTS (
                SELECT 1 FROM markets m2 
                WHERE m2.condition_id = t.market_id 
                -- This is simplified - would need token->outcome mapping
              ) THEN true ELSE false END
            ELSE false
          END as is_win
        FROM trades t
        JOIN markets m ON t.market_id = m.condition_id
        WHERE m.resolved = true AND m.resolution_outcome IS NOT NULL
      )
      SELECT 
        wallet_address,
        COUNT(*) FILTER (WHERE side = 'BUY') as total_positions,
        SUM(usd_value) as total_wagered
      FROM resolved_trades
      GROUP BY wallet_address
    `);

    console.log(`[Backfill] Found ${result.rows.length} wallets with resolved trades`);
    
    // Note: Full win rate calculation requires mapping token_id to outcome
    // This would need the token->outcome mapping from market data
  }

  stop(): void {
    console.log('[Backfill] Stopping...');
    this.isRunning = false;
  }

  getStatus(): { isRunning: boolean; processedCount: number; whaleCount: number } {
    return {
      isRunning: this.isRunning,
      processedCount: this.processedCount,
      whaleCount: this.whaleCount
    };
  }
}

