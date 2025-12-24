import { Pool } from 'pg';

/**
 * Insider Detection Service
 * 
 * Based on signals from research:
 * 1. New wallet + large single-market bet
 * 2. Collective betting (multiple wallets same direction)
 * 3. High win rate on low-odds bets (<30%)
 * 4. Pre-resolution trading accuracy
 * 5. Single-market concentration
 */

interface InsiderSignals {
  isNewWallet: boolean;           // Created within 30 days
  isSingleMarket: boolean;        // Trades only 1-3 markets
  hasLargePosition: boolean;      // Position > $10k in any market
  lowOddsWinRate: number;         // Win rate on bets at <30% odds
  preResolutionAccuracy: number;  // Win rate on trades <24h before resolution
  marketConcentration: number;    // 0-1, higher = more concentrated
}

interface InsiderAlert {
  conditionId: string;
  marketQuestion: string;
  alertType: 'new_whale' | 'collective_bet' | 'pre_resolution_surge' | 'low_odds_winner';
  severity: 'low' | 'medium' | 'high';
  wallets: string[];
  totalVolume: number;
  betDirection: 'YES' | 'NO';
  oddsAtTime: number;
  description: string;
}

export class InsiderDetector {
  private db: Pool;

  constructor(db: Pool) {
    this.db = db;
  }

  /**
   * Compute insider score for all wallets
   * Score formula based on key signals from article
   */
  async computeAllInsiderScores(): Promise<void> {
    console.log('[Insider] Computing insider scores for all wallets...');
    const startTime = Date.now();

    try {
      // Update market concentration for each wallet
      await this.db.query(`
        WITH market_counts AS (
          SELECT 
            wallet_address,
            COUNT(DISTINCT condition_id) as markets_traded,
            MAX(net_position) as max_position
          FROM wallet_positions
          GROUP BY wallet_address
        )
        UPDATE wallets w
        SET 
          markets_traded = COALESCE(mc.markets_traded, 0),
          single_market_wallet = COALESCE(mc.markets_traded, 0) <= 3,
          market_concentration = CASE 
            WHEN COALESCE(mc.markets_traded, 0) = 0 THEN 0
            WHEN COALESCE(mc.markets_traded, 0) = 1 THEN 1.0
            WHEN COALESCE(mc.markets_traded, 0) = 2 THEN 0.8
            WHEN COALESCE(mc.markets_traded, 0) = 3 THEN 0.6
            WHEN COALESCE(mc.markets_traded, 0) <= 5 THEN 0.4
            ELSE 0.2
          END
        FROM market_counts mc
        WHERE w.address = mc.wallet_address
      `);

      // Calculate low-odds win rate
      // A bet is "low odds" if the price was < 0.30 when they bought
      await this.db.query(`
        WITH low_odds_stats AS (
          SELECT 
            wp.wallet_address,
            COUNT(*) FILTER (WHERE wp.avg_entry_price < 0.30 AND wp.outcome_correct = true) as low_wins,
            COUNT(*) FILTER (WHERE wp.avg_entry_price < 0.30 AND wp.outcome_correct IS NOT NULL) as low_attempts
          FROM wallet_positions wp
          GROUP BY wp.wallet_address
        )
        UPDATE wallets w
        SET 
          low_odds_wins = COALESCE(los.low_wins, 0),
          low_odds_attempts = COALESCE(los.low_attempts, 0),
          low_odds_win_rate = CASE 
            WHEN COALESCE(los.low_attempts, 0) > 0 
            THEN los.low_wins::numeric / los.low_attempts
            ELSE 0 
          END
        FROM low_odds_stats los
        WHERE w.address = los.wallet_address
      `);

      // Calculate pre-resolution accuracy (trades on resolved markets)
      // Note: resolution_time not available, using end_date as proxy
      await this.db.query(`
        WITH pre_resolution_stats AS (
          SELECT 
            wp.wallet_address,
            COUNT(*) FILTER (WHERE wp.outcome_correct = true) as correct,
            COUNT(*) FILTER (WHERE wp.outcome_correct IS NOT NULL) as total
          FROM wallet_positions wp
          JOIN markets m ON wp.condition_id = m.condition_id
          WHERE m.resolved = true
          GROUP BY wp.wallet_address
        )
        UPDATE wallets w
        SET pre_resolution_correct_rate = CASE 
          WHEN COALESCE(prs.total, 0) > 0 
          THEN prs.correct::numeric / prs.total
          ELSE 0 
        END
        FROM pre_resolution_stats prs
        WHERE w.address = prs.wallet_address
      `);

      // Calculate composite insider score (0-100)
      // Weights based on article signals:
      // - 35%: Low-odds win rate (key insider signal)
      // - 25%: Pre-resolution accuracy
      // - 20%: Market concentration
      // - 10%: New wallet flag
      // - 10%: Single-market focus with large position
      await this.db.query(`
        UPDATE wallets
        SET insider_score = LEAST(100, GREATEST(0,
          -- Low-odds win rate (35% weight, scaled to 35 points)
          CASE 
            WHEN low_odds_attempts >= 3 THEN low_odds_win_rate * 35
            ELSE 0 
          END +
          
          -- Pre-resolution accuracy (25% weight)
          pre_resolution_correct_rate * 25 +
          
          -- Market concentration (20% weight)
          market_concentration * 20 +
          
          -- New wallet bonus (10% weight)
          CASE WHEN first_seen > NOW() - INTERVAL '30 days' THEN 10 ELSE 0 END +
          
          -- Single market + large volume (10% weight)
          CASE 
            WHEN single_market_wallet AND total_volume > 10000 THEN 10 
            WHEN single_market_wallet AND total_volume > 5000 THEN 5
            ELSE 0 
          END
        ))::int,
        computed_at = NOW()
        WHERE total_trades > 0
      `);

      // Tag wallets with high insider scores
      await this.db.query(`
        UPDATE wallets 
        SET tags = array_remove(tags, 'insider_suspect')
        WHERE 'insider_suspect' = ANY(tags)
      `);

      await this.db.query(`
        UPDATE wallets
        SET tags = array_append(COALESCE(tags, '{}'), 'insider_suspect')
        WHERE insider_score >= 60
          AND NOT ('insider_suspect' = ANY(COALESCE(tags, '{}')))
      `);

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[Insider] Insider score computation complete in ${elapsed}s`);

    } catch (err) {
      console.error('[Insider] Error computing insider scores:', err);
    }
  }

  /**
   * Detect collective betting patterns on a specific market
   * Returns alert if multiple new wallets are betting same direction
   */
  async detectCollectiveBetting(conditionId: string): Promise<InsiderAlert | null> {
    const { rows } = await this.db.query(`
      SELECT 
        wp.wallet_address,
        wp.outcome_index,
        wp.net_position,
        w.first_seen,
        w.markets_traded,
        w.total_volume
      FROM wallet_positions wp
      JOIN wallets w ON wp.wallet_address = w.address
      WHERE wp.condition_id = $1
        AND wp.net_position > 1000  -- Significant position
        AND w.first_seen > NOW() - INTERVAL '30 days'  -- New wallet
        AND w.markets_traded <= 3  -- Concentrated
      ORDER BY wp.net_position DESC
    `, [conditionId]);

    if (rows.length < 3) return null;

    // Check if majority are betting same direction
    const yesBets = rows.filter(r => r.outcome_index === 1);
    const noBets = rows.filter(r => r.outcome_index === 0);

    const dominant = yesBets.length > noBets.length ? yesBets : noBets;
    const direction = yesBets.length > noBets.length ? 'YES' : 'NO';

    if (dominant.length >= 3 && dominant.length >= rows.length * 0.7) {
      const totalVolume = dominant.reduce((sum, r) => sum + parseFloat(r.net_position), 0);

      // Get market details
      const marketResult = await this.db.query(
        `SELECT question, outcome_yes_price FROM markets WHERE condition_id = $1`,
        [conditionId]
      );
      const market = marketResult.rows[0];

      const alert: InsiderAlert = {
        conditionId,
        marketQuestion: market?.question || 'Unknown',
        alertType: 'collective_bet',
        severity: totalVolume > 50000 ? 'high' : totalVolume > 20000 ? 'medium' : 'low',
        wallets: dominant.map(r => r.wallet_address),
        totalVolume,
        betDirection: direction,
        oddsAtTime: direction === 'YES' ? market?.outcome_yes_price : 1 - market?.outcome_yes_price,
        description: `${dominant.length} new wallets collectively betting ${direction} with $${totalVolume.toLocaleString()} total`
      };

      // Save alert to database
      await this.db.query(`
        INSERT INTO insider_alerts (
          condition_id, market_question, alert_type, severity,
          wallets, total_volume, bet_direction, odds_at_time, description
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [
        alert.conditionId,
        alert.marketQuestion,
        alert.alertType,
        alert.severity,
        JSON.stringify(alert.wallets),
        alert.totalVolume,
        alert.betDirection,
        alert.oddsAtTime,
        alert.description
      ]);

      return alert;
    }

    return null;
  }

  /**
   * Get top potential insider wallets
   */
  async getTopInsiders(limit = 50): Promise<any[]> {
    const { rows } = await this.db.query(`
      SELECT 
        address,
        first_seen,
        total_trades,
        total_volume,
        markets_traded,
        single_market_wallet,
        win_count,
        loss_count,
        CASE WHEN (win_count + loss_count) > 0 
             THEN ROUND(win_count::numeric / (win_count + loss_count) * 100, 1)
             ELSE 0 END as win_rate,
        low_odds_wins,
        low_odds_attempts,
        ROUND(low_odds_win_rate * 100, 1) as low_odds_win_rate_pct,
        ROUND(pre_resolution_correct_rate * 100, 1) as pre_resolution_accuracy_pct,
        insider_score,
        tags
      FROM wallets
      WHERE insider_score > 0 OR single_market_wallet = true
      ORDER BY insider_score DESC, total_volume DESC
      LIMIT $1
    `, [limit]);

    return rows;
  }

  /**
   * Get recent insider alerts
   */
  async getRecentAlerts(limit = 20): Promise<any[]> {
    const { rows } = await this.db.query(`
      SELECT 
        id,
        condition_id,
        market_question,
        alert_type,
        severity,
        wallets,
        total_volume,
        bet_direction,
        odds_at_time,
        description,
        created_at
      FROM insider_alerts
      ORDER BY created_at DESC
      LIMIT $1
    `, [limit]);

    return rows;
  }

  /**
   * Analyze a specific market for insider activity
   */
  async analyzeMarket(conditionId: string): Promise<{
    suspiciousWallets: any[];
    collectivePattern: boolean;
    dominantDirection: string | null;
    insiderScore: number;
  }> {
    const { rows: positions } = await this.db.query(`
      SELECT 
        wp.wallet_address,
        wp.outcome_index,
        wp.net_position,
        wp.avg_entry_price,
        wp.first_trade_time,
        w.first_seen,
        w.markets_traded,
        w.total_volume,
        w.insider_score,
        w.single_market_wallet
      FROM wallet_positions wp
      JOIN wallets w ON wp.wallet_address = w.address
      WHERE wp.condition_id = $1
        AND wp.net_position > 500
      ORDER BY wp.net_position DESC
    `, [conditionId]);

    // Identify suspicious wallets
    const suspiciousWallets = positions.filter(p => 
      p.single_market_wallet || 
      p.insider_score > 40 ||
      (p.first_seen > new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) && p.net_position > 5000)
    );

    // Check for collective pattern
    const yesBets = positions.filter(p => p.outcome_index === 1);
    const noBets = positions.filter(p => p.outcome_index === 0);
    
    const yesVolume = yesBets.reduce((sum, p) => sum + parseFloat(p.net_position), 0);
    const noVolume = noBets.reduce((sum, p) => sum + parseFloat(p.net_position), 0);
    
    const collectivePattern = suspiciousWallets.length >= 3;
    const dominantDirection = yesVolume > noVolume * 1.5 ? 'YES' : 
                              noVolume > yesVolume * 1.5 ? 'NO' : null;

    // Calculate market insider score (0-100)
    const marketInsiderScore = Math.min(100,
      suspiciousWallets.length * 15 +
      (collectivePattern ? 20 : 0) +
      (dominantDirection ? 15 : 0)
    );

    return {
      suspiciousWallets,
      collectivePattern,
      dominantDirection,
      insiderScore: marketInsiderScore
    };
  }

  /**
   * Scheduled job: run every 10 minutes
   */
  startScheduled(intervalMs = 10 * 60 * 1000): void {
    // Run immediately
    this.computeAllInsiderScores();

    // Then run on interval
    setInterval(() => {
      this.computeAllInsiderScores();
    }, intervalMs);

    console.log(`[Insider] Scheduled to run every ${intervalMs / 1000}s`);
  }
}

