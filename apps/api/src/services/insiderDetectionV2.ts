/**
 * Enhanced Insider Detection Service v2
 *
 * Comprehensive multi-factor insider scoring system that considers:
 * 1. Temporal Signals (30%) - Pre-resolution timing, news anticipation
 * 2. Trade Quality Signals (25%) - Entry price advantage, low-odds wins
 * 3. Category Risk Signals (15%) - Performance in high-risk market categories
 * 4. Network/Cluster Signals (15%) - Correlated trading, funding patterns
 * 5. Statistical Anomaly Signals (15%) - Win streaks, profit distribution
 */

import { Pool } from 'pg';

// Category risk levels and their multipliers
const CATEGORY_RISK: Record<string, { level: string; multiplier: number }> = {
  crypto: { level: 'critical', multiplier: 1.5 },
  company: { level: 'critical', multiplier: 1.5 },
  regulatory: { level: 'critical', multiplier: 1.5 },
  politics_insider: { level: 'high', multiplier: 1.3 },
  sports_injury: { level: 'high', multiplier: 1.3 },
  legal: { level: 'high', multiplier: 1.3 },
  entertainment: { level: 'high', multiplier: 1.3 },
  elections: { level: 'medium', multiplier: 1.1 },
  geopolitical: { level: 'medium', multiplier: 1.1 },
  science: { level: 'medium', multiplier: 1.0 },
  weather: { level: 'low', multiplier: 0.7 },
  general: { level: 'low', multiplier: 0.8 },
};

// Keywords for auto-classifying markets
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  crypto: ['bitcoin', 'btc', 'ethereum', 'eth', 'crypto', 'token', 'coin', 'blockchain', 'defi', 'nft', 'solana', 'sol', 'binance', 'coinbase'],
  company: ['earnings', 'quarterly', 'revenue', 'profit', 'acquisition', 'merger', 'ipo', 'layoff', 'ceo', 'stock', 'shares', 'dividend'],
  regulatory: ['sec', 'fda', 'approval', 'ruling', 'regulation', 'antitrust', 'ftc', 'doj', 'lawsuit', 'fine', 'indictment', 'charges'],
  politics_insider: ['campaign', 'primary', 'debate', 'endorsement', 'withdraw', 'dropout', 'internal poll', 'fundraising'],
  sports_injury: ['injury', 'injured', 'lineup', 'suspended', 'trade', 'starting', 'benched', 'roster', 'out for'],
  legal: ['verdict', 'trial', 'court', 'judge', 'jury', 'ruling', 'appeal', 'settlement', 'guilty', 'convicted'],
  entertainment: ['oscar', 'grammy', 'emmy', 'award', 'winner', 'nomination', 'academy', 'golden globe'],
  elections: ['election', 'vote', 'ballot', 'poll', 'president', 'senator', 'governor', 'congress', 'electoral'],
  geopolitical: ['treaty', 'sanction', 'war', 'invasion', 'ceasefire', 'summit', 'negotiation', 'diplomat'],
  weather: ['hurricane', 'earthquake', 'temperature', 'weather', 'storm', 'flood', 'tornado', 'climate'],
  science: ['study', 'research', 'discovery', 'clinical', 'vaccine', 'drug', 'trial results', 'peer review'],
};

interface InsiderSignals {
  // Temporal
  preResolution1hAccuracy: number;
  preResolution4hAccuracy: number;
  preResolution24hAccuracy: number;
  preResolutionSampleSize: number;
  newsAnticipationScore: number;
  timingConsistencyScore: number;

  // Trade Quality
  entryPriceAdvantage: number;
  lowOddsWinRate: number;
  lowOddsSampleSize: number;
  longshotWinRate: number;
  longshotSampleSize: number;
  convictionSizingScore: number;

  // Category Risk
  highRiskCategoryWinRate: number;
  highRiskCategoryVolume: number;
  categoryConcentration: number;
  primaryCategory: string | null;

  // Network
  clusterCorrelationScore: number;
  fundingOverlapScore: number;
  timingSyncScore: number;
  isClusterLeader: boolean;
  clusterId: number | null;

  // Statistical
  adjustedWinRate: number;
  streakAnomalyScore: number;
  profitDistributionSkew: number;
  sharpeAnomalyScore: number;
}

interface ComponentScores {
  temporalScore: number; // 0-30
  tradeQualityScore: number; // 0-25
  categoryRiskScore: number; // 0-15
  networkScore: number; // 0-15
  statisticalScore: number; // 0-15
  totalScore: number; // 0-100
}

interface InsiderAlert {
  conditionId: string;
  marketQuestion: string;
  alertType: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  wallets: string[];
  totalVolume: number;
  betDirection: 'YES' | 'NO';
  oddsAtTime: number;
  description: string;
  riskCategory: string;
  confidenceScore: number;
}

export class InsiderDetectionServiceV2 {
  private db: Pool;

  constructor(db: Pool) {
    this.db = db;
  }

  /**
   * Classify a market into a risk category based on its question/title
   */
  classifyMarketCategory(question: string): { category: string; riskLevel: string; multiplier: number } {
    const lowerQuestion = question.toLowerCase();

    for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
      for (const keyword of keywords) {
        if (lowerQuestion.includes(keyword)) {
          const risk = CATEGORY_RISK[category] || CATEGORY_RISK.general;
          return { category, riskLevel: risk.level, multiplier: risk.multiplier };
        }
      }
    }

    // Check existing category field from Polymarket
    return { category: 'general', riskLevel: 'low', multiplier: 0.8 };
  }

  /**
   * Update market risk classifications
   */
  async classifyAllMarkets(): Promise<number> {
    console.log('[InsiderV2] Classifying market risk categories...');

    const { rows: markets } = await this.db.query(`
      SELECT condition_id, question, category
      FROM markets
      WHERE insider_risk_category IS NULL OR insider_risk_category = ''
    `);

    let updated = 0;
    for (const market of markets) {
      const classification = this.classifyMarketCategory(market.question || '');

      await this.db.query(`
        UPDATE markets
        SET insider_risk_category = $1,
            insider_risk_level = $2,
            insider_risk_multiplier = $3
        WHERE condition_id = $4
      `, [classification.category, classification.riskLevel, classification.multiplier, market.condition_id]);

      updated++;
    }

    console.log(`[InsiderV2] Classified ${updated} markets`);
    return updated;
  }

  /**
   * Compute temporal signals for a wallet
   */
  async computeTemporalSignals(walletAddress: string): Promise<Partial<InsiderSignals>> {
    // Get trades with resolution timing
    const { rows } = await this.db.query(`
      SELECT
        wtt.minutes_before_resolution,
        wtt.outcome_correct,
        wtt.position_size,
        wtt.price_before_trade,
        wtt.price_after_1h,
        wtt.price_after_4h
      FROM wallet_trade_timing wtt
      WHERE wtt.wallet_address = $1
        AND wtt.resolution_time IS NOT NULL
    `, [walletAddress]);

    if (rows.length === 0) {
      return {
        preResolution1hAccuracy: 0,
        preResolution4hAccuracy: 0,
        preResolution24hAccuracy: 0,
        preResolutionSampleSize: 0,
        newsAnticipationScore: 0,
        timingConsistencyScore: 0,
      };
    }

    // Calculate pre-resolution accuracy at different windows
    const within1h = rows.filter(r => r.minutes_before_resolution <= 60);
    const within4h = rows.filter(r => r.minutes_before_resolution <= 240);
    const within24h = rows.filter(r => r.minutes_before_resolution <= 1440);

    const accuracy1h = within1h.length > 0
      ? within1h.filter(r => r.outcome_correct).length / within1h.length
      : 0;
    const accuracy4h = within4h.length > 0
      ? within4h.filter(r => r.outcome_correct).length / within4h.length
      : 0;
    const accuracy24h = within24h.length > 0
      ? within24h.filter(r => r.outcome_correct).length / within24h.length
      : 0;

    // News anticipation: Did price move significantly after their trade?
    const priceMoveTrades = rows.filter(r =>
      r.price_before_trade && r.price_after_1h &&
      Math.abs(r.price_after_1h - r.price_before_trade) > 0.1
    );
    const anticipationWins = priceMoveTrades.filter(r => r.outcome_correct).length;
    const newsAnticipationScore = priceMoveTrades.length >= 3
      ? anticipationWins / priceMoveTrades.length
      : 0;

    // Timing consistency: Standard deviation of minutes before resolution
    const timings = rows.map(r => r.minutes_before_resolution).filter(t => t > 0);
    const avgTiming = timings.reduce((a, b) => a + b, 0) / timings.length;
    const variance = timings.reduce((sum, t) => sum + Math.pow(t - avgTiming, 2), 0) / timings.length;
    const stdDev = Math.sqrt(variance);
    // Lower std dev = more consistent timing = more suspicious
    const timingConsistencyScore = timings.length >= 5 && stdDev < 120 ? (120 - stdDev) / 120 : 0;

    return {
      preResolution1hAccuracy: accuracy1h,
      preResolution4hAccuracy: accuracy4h,
      preResolution24hAccuracy: accuracy24h,
      preResolutionSampleSize: rows.length,
      newsAnticipationScore,
      timingConsistencyScore,
    };
  }

  /**
   * Compute trade quality signals for a wallet
   */
  async computeTradeQualitySignals(walletAddress: string): Promise<Partial<InsiderSignals>> {
    // Entry price advantage vs VWAP
    const { rows: entryRows } = await this.db.query(`
      SELECT
        wp.avg_entry_price,
        m.outcome_yes_price as current_price,
        wp.outcome_index,
        wp.outcome_correct,
        wp.net_position
      FROM wallet_positions wp
      JOIN markets m ON wp.condition_id = m.condition_id
      WHERE wp.wallet_address = $1
        AND wp.outcome_correct IS NOT NULL
    `, [walletAddress]);

    // Calculate entry price advantage
    let entryAdvantage = 0;
    if (entryRows.length > 0) {
      const advantages = entryRows.filter(r => r.outcome_correct).map(r => {
        // If they won, their entry was better than resolution price
        const resolutionPrice = r.outcome_index === 1 ? 1 : 0;
        return resolutionPrice - r.avg_entry_price;
      });
      entryAdvantage = advantages.length > 0
        ? advantages.reduce((a, b) => a + b, 0) / advantages.length
        : 0;
    }

    // Low odds win rate (<30% odds = >70% against)
    const lowOdds = entryRows.filter(r =>
      (r.outcome_index === 1 && r.avg_entry_price < 0.30) ||
      (r.outcome_index === 0 && r.avg_entry_price > 0.70)
    );
    const lowOddsWins = lowOdds.filter(r => r.outcome_correct).length;
    const lowOddsWinRate = lowOdds.length >= 3 ? lowOddsWins / lowOdds.length : 0;

    // Longshot win rate (<15% odds)
    const longshots = entryRows.filter(r =>
      (r.outcome_index === 1 && r.avg_entry_price < 0.15) ||
      (r.outcome_index === 0 && r.avg_entry_price > 0.85)
    );
    const longshotWins = longshots.filter(r => r.outcome_correct).length;
    const longshotWinRate = longshots.length >= 2 ? longshotWins / longshots.length : 0;

    // Conviction sizing: Do they bet bigger on trades they win?
    const winningPositions = entryRows.filter(r => r.outcome_correct).map(r => parseFloat(r.net_position));
    const losingPositions = entryRows.filter(r => !r.outcome_correct).map(r => parseFloat(r.net_position));
    const avgWinSize = winningPositions.length > 0
      ? winningPositions.reduce((a, b) => a + b, 0) / winningPositions.length
      : 0;
    const avgLossSize = losingPositions.length > 0
      ? losingPositions.reduce((a, b) => a + b, 0) / losingPositions.length
      : 0;
    const convictionScore = avgLossSize > 0 && avgWinSize > avgLossSize * 1.5
      ? Math.min(1, (avgWinSize / avgLossSize - 1) / 2)
      : 0;

    return {
      entryPriceAdvantage: entryAdvantage,
      lowOddsWinRate,
      lowOddsSampleSize: lowOdds.length,
      longshotWinRate,
      longshotSampleSize: longshots.length,
      convictionSizingScore: convictionScore,
    };
  }

  /**
   * Compute category risk signals for a wallet
   */
  async computeCategoryRiskSignals(walletAddress: string): Promise<Partial<InsiderSignals>> {
    const { rows } = await this.db.query(`
      SELECT
        m.insider_risk_category,
        m.insider_risk_level,
        m.insider_risk_multiplier,
        wp.outcome_correct,
        wp.net_position
      FROM wallet_positions wp
      JOIN markets m ON wp.condition_id = m.condition_id
      WHERE wp.wallet_address = $1
        AND m.insider_risk_category IS NOT NULL
    `, [walletAddress]);

    if (rows.length === 0) {
      return {
        highRiskCategoryWinRate: 0,
        highRiskCategoryVolume: 0,
        categoryConcentration: 0,
        primaryCategory: null,
      };
    }

    // High risk categories: critical + high
    const highRisk = rows.filter(r =>
      r.insider_risk_level === 'critical' || r.insider_risk_level === 'high'
    );
    const highRiskResolved = highRisk.filter(r => r.outcome_correct !== null);
    const highRiskWins = highRiskResolved.filter(r => r.outcome_correct).length;
    const highRiskWinRate = highRiskResolved.length >= 3
      ? highRiskWins / highRiskResolved.length
      : 0;
    const highRiskVolume = highRisk.reduce((sum, r) => sum + parseFloat(r.net_position || 0), 0);

    // Category concentration
    const categoryCounts: Record<string, { count: number; volume: number }> = {};
    for (const row of rows) {
      const cat = row.insider_risk_category || 'general';
      if (!categoryCounts[cat]) {
        categoryCounts[cat] = { count: 0, volume: 0 };
      }
      categoryCounts[cat].count++;
      categoryCounts[cat].volume += parseFloat(row.net_position || 0);
    }

    const sortedCategories = Object.entries(categoryCounts)
      .sort((a, b) => b[1].volume - a[1].volume);
    const primaryCategory = sortedCategories[0]?.[0] || null;
    const totalVolume = rows.reduce((sum, r) => sum + parseFloat(r.net_position || 0), 0);
    const primaryCategoryVolume = sortedCategories[0]?.[1].volume || 0;
    const categoryConcentration = totalVolume > 0 ? primaryCategoryVolume / totalVolume : 0;

    return {
      highRiskCategoryWinRate: highRiskWinRate,
      highRiskCategoryVolume: highRiskVolume,
      categoryConcentration,
      primaryCategory,
    };
  }

  /**
   * Compute statistical anomaly signals for a wallet
   */
  async computeStatisticalSignals(walletAddress: string): Promise<Partial<InsiderSignals>> {
    const { rows } = await this.db.query(`
      SELECT
        win_count,
        loss_count,
        total_volume,
        total_trades,
        realized_pnl
      FROM wallets
      WHERE address = $1
    `, [walletAddress]);

    if (rows.length === 0 || !rows[0]) {
      return {
        adjustedWinRate: 0,
        streakAnomalyScore: 0,
        profitDistributionSkew: 0,
        sharpeAnomalyScore: 0,
      };
    }

    const wallet = rows[0];
    const wins = wallet.win_count || 0;
    const losses = wallet.loss_count || 0;
    const total = wins + losses;

    // Bayesian adjusted win rate (with prior of 50%)
    // Using Jeffrey's prior (0.5, 0.5) for beta distribution
    const adjustedWinRate = total > 0
      ? (wins + 0.5) / (total + 1)
      : 0.5;

    // Win streak anomaly - probability of observed streak under random 50% win rate
    // Simplified: just check if win rate is suspiciously high given sample size
    const expectedWins = total * 0.5;
    const stdDev = Math.sqrt(total * 0.5 * 0.5);
    const zScore = stdDev > 0 ? (wins - expectedWins) / stdDev : 0;
    const streakAnomaly = zScore > 2 ? Math.min(1, (zScore - 2) / 3) : 0;

    // Profit distribution skew - are profits unusually positive?
    const pnl = parseFloat(wallet.realized_pnl || 0);
    const volume = parseFloat(wallet.total_volume || 1);
    const profitRatio = pnl / volume;
    const profitSkew = profitRatio > 0.1 ? Math.min(1, profitRatio / 0.3) : 0;

    // Sharpe-like ratio (simplified)
    const roi = volume > 0 ? pnl / volume : 0;
    // Assume market average ROI is ~0, std is ~0.3
    const sharpeAnomaly = roi > 0.15 ? Math.min(1, roi / 0.4) : 0;

    return {
      adjustedWinRate,
      streakAnomalyScore: streakAnomaly,
      profitDistributionSkew: profitSkew,
      sharpeAnomalyScore: sharpeAnomaly,
    };
  }

  /**
   * Calculate component scores and total insider score
   */
  calculateComponentScores(signals: InsiderSignals): ComponentScores {
    // Temporal Score (0-30)
    // Weight: 1h accuracy is most suspicious (15), 4h (10), 24h (5)
    const temporalScore =
      (signals.preResolutionSampleSize >= 3 ?
        signals.preResolution1hAccuracy * 15 +
        signals.preResolution4hAccuracy * 5 +
        signals.newsAnticipationScore * 5 +
        signals.timingConsistencyScore * 5
        : 0);

    // Trade Quality Score (0-25)
    const tradeQualityScore =
      signals.entryPriceAdvantage * 8 +
      (signals.lowOddsSampleSize >= 3 ? signals.lowOddsWinRate * 8 : 0) +
      (signals.longshotSampleSize >= 2 ? signals.longshotWinRate * 6 : 0) +
      signals.convictionSizingScore * 3;

    // Category Risk Score (0-15)
    // High win rate in risky categories is very suspicious
    const categoryRiskScore =
      (signals.highRiskCategoryVolume > 5000 ?
        signals.highRiskCategoryWinRate * 10 +
        signals.categoryConcentration * 5
        : 0);

    // Network Score (0-15)
    const networkScore =
      signals.clusterCorrelationScore * 5 +
      signals.fundingOverlapScore * 4 +
      signals.timingSyncScore * 4 +
      (signals.isClusterLeader ? 2 : 0);

    // Statistical Score (0-15)
    const statisticalScore =
      signals.adjustedWinRate * 5 +
      signals.streakAnomalyScore * 4 +
      signals.profitDistributionSkew * 3 +
      signals.sharpeAnomalyScore * 3;

    const totalScore = Math.min(100, Math.max(0,
      temporalScore +
      tradeQualityScore +
      categoryRiskScore +
      networkScore +
      statisticalScore
    ));

    return {
      temporalScore: Math.round(temporalScore * 10) / 10,
      tradeQualityScore: Math.round(tradeQualityScore * 10) / 10,
      categoryRiskScore: Math.round(categoryRiskScore * 10) / 10,
      networkScore: Math.round(networkScore * 10) / 10,
      statisticalScore: Math.round(statisticalScore * 10) / 10,
      totalScore: Math.round(totalScore * 10) / 10,
    };
  }

  /**
   * Compute full insider score for a single wallet
   */
  async computeWalletInsiderScore(walletAddress: string): Promise<ComponentScores> {
    const [temporal, tradeQuality, categoryRisk, statistical] = await Promise.all([
      this.computeTemporalSignals(walletAddress),
      this.computeTradeQualitySignals(walletAddress),
      this.computeCategoryRiskSignals(walletAddress),
      this.computeStatisticalSignals(walletAddress),
    ]);

    // For now, network signals are computed separately in batch
    const networkSignals = {
      clusterCorrelationScore: 0,
      fundingOverlapScore: 0,
      timingSyncScore: 0,
      isClusterLeader: false,
      clusterId: null,
    };

    const signals: InsiderSignals = {
      ...temporal,
      ...tradeQuality,
      ...categoryRisk,
      ...networkSignals,
      ...statistical,
    } as InsiderSignals;

    const scores = this.calculateComponentScores(signals);

    // Store signals and scores
    await this.db.query(`
      INSERT INTO wallet_insider_signals (
        wallet_address,
        pre_resolution_1h_accuracy, pre_resolution_4h_accuracy, pre_resolution_24h_accuracy,
        pre_resolution_sample_size, news_anticipation_score, timing_consistency_score,
        entry_price_advantage, low_odds_win_rate, low_odds_sample_size,
        longshot_win_rate, longshot_sample_size, conviction_sizing_score,
        high_risk_category_win_rate, high_risk_category_volume, category_concentration, primary_category,
        cluster_correlation_score, funding_overlap_score, timing_sync_score, is_cluster_leader, cluster_id,
        adjusted_win_rate, streak_anomaly_score, profit_distribution_skew, sharpe_anomaly_score,
        temporal_score, trade_quality_score, category_risk_score, network_score, statistical_score,
        total_insider_score, last_computed
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
        $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, NOW()
      )
      ON CONFLICT (wallet_address) DO UPDATE SET
        pre_resolution_1h_accuracy = EXCLUDED.pre_resolution_1h_accuracy,
        pre_resolution_4h_accuracy = EXCLUDED.pre_resolution_4h_accuracy,
        pre_resolution_24h_accuracy = EXCLUDED.pre_resolution_24h_accuracy,
        pre_resolution_sample_size = EXCLUDED.pre_resolution_sample_size,
        news_anticipation_score = EXCLUDED.news_anticipation_score,
        timing_consistency_score = EXCLUDED.timing_consistency_score,
        entry_price_advantage = EXCLUDED.entry_price_advantage,
        low_odds_win_rate = EXCLUDED.low_odds_win_rate,
        low_odds_sample_size = EXCLUDED.low_odds_sample_size,
        longshot_win_rate = EXCLUDED.longshot_win_rate,
        longshot_sample_size = EXCLUDED.longshot_sample_size,
        conviction_sizing_score = EXCLUDED.conviction_sizing_score,
        high_risk_category_win_rate = EXCLUDED.high_risk_category_win_rate,
        high_risk_category_volume = EXCLUDED.high_risk_category_volume,
        category_concentration = EXCLUDED.category_concentration,
        primary_category = EXCLUDED.primary_category,
        cluster_correlation_score = EXCLUDED.cluster_correlation_score,
        funding_overlap_score = EXCLUDED.funding_overlap_score,
        timing_sync_score = EXCLUDED.timing_sync_score,
        is_cluster_leader = EXCLUDED.is_cluster_leader,
        cluster_id = EXCLUDED.cluster_id,
        adjusted_win_rate = EXCLUDED.adjusted_win_rate,
        streak_anomaly_score = EXCLUDED.streak_anomaly_score,
        profit_distribution_skew = EXCLUDED.profit_distribution_skew,
        sharpe_anomaly_score = EXCLUDED.sharpe_anomaly_score,
        temporal_score = EXCLUDED.temporal_score,
        trade_quality_score = EXCLUDED.trade_quality_score,
        category_risk_score = EXCLUDED.category_risk_score,
        network_score = EXCLUDED.network_score,
        statistical_score = EXCLUDED.statistical_score,
        total_insider_score = EXCLUDED.total_insider_score,
        last_computed = NOW()
    `, [
      walletAddress,
      signals.preResolution1hAccuracy, signals.preResolution4hAccuracy, signals.preResolution24hAccuracy,
      signals.preResolutionSampleSize, signals.newsAnticipationScore, signals.timingConsistencyScore,
      signals.entryPriceAdvantage, signals.lowOddsWinRate, signals.lowOddsSampleSize,
      signals.longshotWinRate, signals.longshotSampleSize, signals.convictionSizingScore,
      signals.highRiskCategoryWinRate, signals.highRiskCategoryVolume, signals.categoryConcentration, signals.primaryCategory,
      signals.clusterCorrelationScore, signals.fundingOverlapScore, signals.timingSyncScore, signals.isClusterLeader, signals.clusterId,
      signals.adjustedWinRate, signals.streakAnomalyScore, signals.profitDistributionSkew, signals.sharpeAnomalyScore,
      scores.temporalScore, scores.tradeQualityScore, scores.categoryRiskScore, scores.networkScore, scores.statisticalScore,
      scores.totalScore,
    ]);

    // Update main wallets table insider_score too
    await this.db.query(`
      UPDATE wallets SET insider_score = $1, computed_at = NOW() WHERE address = $2
    `, [Math.round(scores.totalScore), walletAddress]);

    return scores;
  }

  /**
   * Batch compute insider scores for all wallets
   */
  async computeAllInsiderScores(): Promise<void> {
    console.log('[InsiderV2] Starting batch insider score computation...');
    const startTime = Date.now();

    // First, classify markets
    await this.classifyAllMarkets();

    // Get wallets with significant activity
    const { rows: wallets } = await this.db.query(`
      SELECT address FROM wallets
      WHERE total_trades >= 5 AND total_volume >= 1000
      ORDER BY total_volume DESC
      LIMIT 5000
    `);

    console.log(`[InsiderV2] Computing scores for ${wallets.length} wallets...`);

    let processed = 0;
    for (const wallet of wallets) {
      try {
        await this.computeWalletInsiderScore(wallet.address);
        processed++;

        if (processed % 100 === 0) {
          console.log(`[InsiderV2] Processed ${processed}/${wallets.length} wallets`);
        }
      } catch (err) {
        console.error(`[InsiderV2] Error processing ${wallet.address}:`, err);
      }
    }

    // Tag high-score wallets
    await this.db.query(`
      UPDATE wallets
      SET tags = array_remove(tags, 'insider_suspect')
      WHERE 'insider_suspect' = ANY(tags)
    `);

    await this.db.query(`
      UPDATE wallets w
      SET tags = array_append(COALESCE(tags, '{}'), 'insider_suspect')
      FROM wallet_insider_signals wis
      WHERE w.address = wis.wallet_address
        AND wis.total_insider_score >= 60
        AND NOT ('insider_suspect' = ANY(COALESCE(w.tags, '{}')))
    `);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[InsiderV2] Batch computation complete in ${elapsed}s - processed ${processed} wallets`);
  }

  /**
   * Get top insider suspects with full breakdown
   */
  async getTopInsiders(limit = 50): Promise<any[]> {
    const { rows } = await this.db.query(`
      SELECT
        w.address,
        w.polymarket_username,
        w.first_seen,
        w.total_trades,
        w.total_volume,
        w.win_count,
        w.loss_count,
        ROUND(w.win_count::numeric / NULLIF(w.win_count + w.loss_count, 0) * 100, 1) as win_rate,

        wis.temporal_score,
        wis.trade_quality_score,
        wis.category_risk_score,
        wis.network_score,
        wis.statistical_score,
        wis.total_insider_score,

        wis.pre_resolution_1h_accuracy,
        wis.pre_resolution_24h_accuracy,
        wis.low_odds_win_rate,
        wis.low_odds_sample_size,
        wis.high_risk_category_win_rate,
        wis.primary_category,
        wis.is_cluster_leader,

        w.tags,
        wis.last_computed

      FROM wallets w
      JOIN wallet_insider_signals wis ON w.address = wis.wallet_address
      WHERE wis.total_insider_score > 20
      ORDER BY wis.total_insider_score DESC
      LIMIT $1
    `, [limit]);

    return rows;
  }

  /**
   * Get insider score breakdown for a specific wallet
   */
  async getWalletInsiderBreakdown(walletAddress: string): Promise<any> {
    const { rows } = await this.db.query(`
      SELECT * FROM wallet_insider_signals WHERE wallet_address = $1
    `, [walletAddress]);

    if (rows.length === 0) {
      // Compute on-demand if not cached
      await this.computeWalletInsiderScore(walletAddress);
      const { rows: newRows } = await this.db.query(`
        SELECT * FROM wallet_insider_signals WHERE wallet_address = $1
      `, [walletAddress]);
      return newRows[0] || null;
    }

    return rows[0];
  }

  /**
   * Detect and create alerts for suspicious activity on a market
   */
  async detectMarketInsiderActivity(conditionId: string): Promise<InsiderAlert[]> {
    const alerts: InsiderAlert[] = [];

    // Get market info
    const { rows: marketRows } = await this.db.query(`
      SELECT question, insider_risk_category, insider_risk_level, outcome_yes_price
      FROM markets WHERE condition_id = $1
    `, [conditionId]);

    if (marketRows.length === 0) return alerts;
    const market = marketRows[0];

    // Get positions from suspicious wallets
    const { rows: positions } = await this.db.query(`
      SELECT
        wp.wallet_address,
        wp.outcome_index,
        wp.net_position,
        wp.first_trade_time,
        wis.total_insider_score,
        w.first_seen,
        w.markets_traded
      FROM wallet_positions wp
      JOIN wallets w ON wp.wallet_address = w.address
      LEFT JOIN wallet_insider_signals wis ON wp.wallet_address = wis.wallet_address
      WHERE wp.condition_id = $1
        AND wp.net_position > 1000
      ORDER BY wp.net_position DESC
    `, [conditionId]);

    // Check for collective betting by suspicious wallets
    const suspiciousPositions = positions.filter(p =>
      (p.total_insider_score || 0) > 40 ||
      (new Date(p.first_seen) > new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) && p.markets_traded <= 3)
    );

    if (suspiciousPositions.length >= 3) {
      const yesBets = suspiciousPositions.filter(p => p.outcome_index === 1);
      const noBets = suspiciousPositions.filter(p => p.outcome_index === 0);

      const dominant = yesBets.length > noBets.length ? yesBets : noBets;
      const direction = yesBets.length > noBets.length ? 'YES' : 'NO';

      if (dominant.length >= 3) {
        const totalVolume = dominant.reduce((sum, p) => sum + parseFloat(p.net_position), 0);
        const avgScore = dominant.reduce((sum, p) => sum + (p.total_insider_score || 0), 0) / dominant.length;

        const alert: InsiderAlert = {
          conditionId,
          marketQuestion: market.question,
          alertType: 'collective_bet',
          severity: totalVolume > 100000 ? 'critical' :
                    totalVolume > 50000 ? 'high' :
                    totalVolume > 20000 ? 'medium' : 'low',
          wallets: dominant.map(p => p.wallet_address),
          totalVolume,
          betDirection: direction,
          oddsAtTime: direction === 'YES' ? market.outcome_yes_price : 1 - market.outcome_yes_price,
          description: `${dominant.length} suspicious wallets collectively betting ${direction} with $${totalVolume.toLocaleString()}`,
          riskCategory: market.insider_risk_category || 'general',
          confidenceScore: Math.min(1, avgScore / 100),
        };

        alerts.push(alert);

        // Store alert
        await this.db.query(`
          INSERT INTO insider_alerts (
            condition_id, market_question, alert_type, severity,
            wallets, total_volume, bet_direction, odds_at_time, description,
            risk_category, confidence_score
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        `, [
          alert.conditionId, alert.marketQuestion, alert.alertType, alert.severity,
          JSON.stringify(alert.wallets), alert.totalVolume, alert.betDirection,
          alert.oddsAtTime, alert.description, alert.riskCategory, alert.confidenceScore,
        ]);
      }
    }

    return alerts;
  }

  /**
   * Get recent insider alerts
   */
  async getRecentAlerts(limit = 50): Promise<any[]> {
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
        risk_category,
        confidence_score,
        verified_outcome,
        resolution_result,
        created_at
      FROM insider_alerts
      ORDER BY created_at DESC
      LIMIT $1
    `, [limit]);

    return rows;
  }

  /**
   * Start scheduled insider detection
   */
  startScheduled(intervalMs = 15 * 60 * 1000): void {
    console.log(`[InsiderV2] Starting scheduled detection every ${intervalMs / 1000}s`);

    // Run immediately
    this.computeAllInsiderScores().catch(console.error);

    // Then run on interval
    setInterval(() => {
      this.computeAllInsiderScores().catch(console.error);
    }, intervalMs);
  }
}
