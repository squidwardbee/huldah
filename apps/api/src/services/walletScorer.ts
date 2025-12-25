import axios from 'axios';
import { Pool } from 'pg';

const GAMMA_API = 'https://gamma-api.polymarket.com';

interface MarketData {
  conditionId: string;
  question: string;
  closed: boolean;
  resolutionSource: string;
}

export class WalletScorer {
  private db: Pool;
  private isRunning = false;

  constructor(db: Pool) {
    this.db = db;
  }

  /**
   * Compute tags for all wallets based on their trading behavior
   * Tags: whale, smart_money, active, new
   */
  async computeAllTags() {
    if (this.isRunning) return;
    this.isRunning = true;

    console.log('[Scorer] Starting wallet tag computation...');
    const startTime = Date.now();

    try {
      // Tag whales: top 5% by volume
      await this.db.query(`
        UPDATE wallets SET tags = array_remove(tags, 'whale')
      `);
      
      await this.db.query(`
        UPDATE wallets 
        SET tags = array_append(COALESCE(tags, '{}'), 'whale')
        WHERE total_volume > (
          SELECT PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY total_volume)
          FROM wallets
        )
      `);

      // Tag active traders: >10 trades in last 7 days
      await this.db.query(`
        UPDATE wallets SET tags = array_remove(tags, 'active')
      `);
      
      await this.db.query(`
        UPDATE wallets
        SET tags = array_append(COALESCE(tags, '{}'), 'active')
        WHERE address IN (
          SELECT wallet_address FROM whale_trades
          WHERE timestamp > NOW() - INTERVAL '7 days'
          GROUP BY wallet_address
          HAVING COUNT(*) > 10
        )
      `);

      // Tag smart money: win rate > 60% with at least 5 resolved trades
      await this.db.query(`
        UPDATE wallets SET tags = array_remove(tags, 'smart_money')
      `);
      
      await this.db.query(`
        UPDATE wallets
        SET tags = array_append(COALESCE(tags, '{}'), 'smart_money'),
            smart_money_score = CASE 
              WHEN (win_count + loss_count) > 0 
              THEN ROUND(win_count::numeric / (win_count + loss_count) * 100)
              ELSE 0 
            END
        WHERE (win_count + loss_count) >= 5
        AND win_count::float / NULLIF(win_count + loss_count, 0) > 0.6
      `);

      // Tag new wallets: first seen in last 24 hours
      await this.db.query(`
        UPDATE wallets SET tags = array_remove(tags, 'new')
      `);
      
      await this.db.query(`
        UPDATE wallets
        SET tags = array_append(COALESCE(tags, '{}'), 'new')
        WHERE first_seen > NOW() - INTERVAL '24 hours'
      `);

      // Update computed timestamp
      await this.db.query(`
        UPDATE wallets SET computed_at = NOW()
      `);

      // Compute average trade size
      await this.db.query(`
        UPDATE wallets
        SET avg_trade_size = total_volume / NULLIF(total_trades, 0)
        WHERE total_trades > 0
      `);

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[Scorer] Tag computation complete in ${elapsed}s`);

    } catch (err) {
      console.error('[Scorer] Error computing tags:', err);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Get tags for a specific wallet
   */
  async getWalletTags(address: string): Promise<string[]> {
    const { rows } = await this.db.query(`
      SELECT tags FROM wallets WHERE address = $1
    `, [address]);
    
    return rows[0]?.tags || [];
  }

  /**
   * Get wallet stats for enriching trades
   */
  async getWalletStats(address: string) {
    const { rows } = await this.db.query(`
      SELECT 
        total_trades, 
        total_volume, 
        win_count, 
        loss_count,
        tags,
        insider_score,
        smart_money_score
      FROM wallets WHERE address = $1
    `, [address]);
    
    return rows[0] || null;
  }

  /**
   * Scheduled job: run every 5 minutes
   */
  startScheduled(intervalMs = 5 * 60 * 1000) {
    // Run immediately
    this.computeAllTags();
    
    // Then run on interval
    setInterval(() => {
      this.computeAllTags();
    }, intervalMs);
    
    console.log(`[Scorer] Scheduled to run every ${intervalMs / 1000}s`);
  }
}


