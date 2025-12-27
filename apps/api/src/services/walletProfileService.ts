import { Pool } from 'pg';
import {
  WalletProfile,
  WalletFunding,
  WalletPerformance,
  WalletActivity,
  WalletHoldings,
  WalletSpecialization,
  WalletBehavior,
  WalletScores,
  WalletFees,
  WalletTag,
  WalletTrade,
  WalletSnapshot,
  WalletCluster,
  WalletSubscription,
  WalletQueryParams,
  WalletListResponse,
  WalletDetailResponse,
  WalletPosition,
  CategoryPerformance,
  FundingSourceType,
} from '@huldah/shared';

/**
 * WalletProfileService
 *
 * Computes comprehensive wallet profiles from database data.
 * Handles wallet queries, subscriptions, and snapshot generation.
 */
export class WalletProfileService {
  private db: Pool;

  constructor(db: Pool) {
    this.db = db;
  }

  /**
   * Get a full wallet profile by address
   */
  async getWalletProfile(address: string): Promise<WalletProfile | null> {
    const normalizedAddress = address.toLowerCase();

    // Get base wallet data
    const { rows } = await this.db.query(`
      SELECT
        w.*,
        wc.cluster_id as cluster_id,
        wc.detection_method as cluster_detection_method
      FROM wallets w
      LEFT JOIN wallet_cluster_members wcm ON w.address = wcm.wallet_address
      LEFT JOIN wallet_clusters wc ON wcm.cluster_id = wc.cluster_id
      WHERE w.address = $1
    `, [normalizedAddress]);

    if (rows.length === 0) {
      return null;
    }

    const wallet = rows[0];

    // Get category stats
    const categoryStats = await this.getCategoryPerformance(normalizedAddress);

    // Build the full profile
    const profile: WalletProfile = {
      address: wallet.address,
      entityId: wallet.entity_id || undefined,
      clusterId: wallet.cluster_id || undefined,
      firstSeen: new Date(wallet.first_seen),
      lastActive: new Date(wallet.last_active),

      funding: {
        totalDeposited: parseFloat(wallet.total_deposited) || 0,
        totalWithdrawn: parseFloat(wallet.total_withdrawn) || 0,
        netFunding: (parseFloat(wallet.total_deposited) || 0) - (parseFloat(wallet.total_withdrawn) || 0),
        lastFundingSource: wallet.last_funding_source,
        fundingSourceType: (wallet.funding_source_type as FundingSourceType) || 'unknown',
      },

      performance: {
        realizedPnl: parseFloat(wallet.realized_pnl) || 0,
        unrealizedPnl: parseFloat(wallet.unrealized_pnl) || 0,
        totalPnl: (parseFloat(wallet.realized_pnl) || 0) + (parseFloat(wallet.unrealized_pnl) || 0),
        winCount: wallet.win_count || 0,
        lossCount: wallet.loss_count || 0,
        winRate: this.calculateWinRate(wallet.win_count, wallet.loss_count),
        profitFactor: parseFloat(wallet.profit_factor) || 0,
        maxDrawdown: parseFloat(wallet.max_drawdown) || 0,
        roi: parseFloat(wallet.roi) || 0,
      },

      activity: {
        totalVolume: parseFloat(wallet.total_volume) || 0,
        totalTrades: wallet.total_trades || 0,
        avgTradeSize: wallet.total_trades > 0
          ? (parseFloat(wallet.total_volume) || 0) / wallet.total_trades
          : 0,
        volume24h: parseFloat(wallet.volume_24h) || 0,
        volume7d: parseFloat(wallet.volume_7d) || 0,
        volume30d: parseFloat(wallet.volume_30d) || 0,
        tradesLast24h: wallet.trades_24h || 0,
        tradesLast7d: wallet.trades_7d || 0,
      },

      holdings: await this.getWalletHoldings(normalizedAddress),

      specialization: {
        topCategories: categoryStats,
        marketsTraded: wallet.markets_traded || 0,
        marketConcentration: parseFloat(wallet.market_concentration) || 0,
        focusedMarkets: wallet.focused_markets || [],
      },

      behavior: {
        avgHoldTime: parseFloat(wallet.avg_hold_time) || 0,
        avgTimeToResolution: parseFloat(wallet.avg_time_to_resolution) || 0,
        preResolutionRate: parseFloat(wallet.pre_resolution_correct_rate) || 0,
        tradingHours: wallet.trading_hours || new Array(24).fill(0),
        preferredSide: this.determinePreferredSide(wallet),
      },

      scores: {
        smartMoneyScore: wallet.smart_money_score || 0,
        insiderScore: wallet.insider_score || 0,
        whaleScore: wallet.whale_score || 0,
      },

      tags: this.parseTags(wallet.tags),

      fees: {
        totalFeesPaid: parseFloat(wallet.total_fees_paid) || 0,
        avgFeePerTrade: wallet.total_trades > 0
          ? (parseFloat(wallet.total_fees_paid) || 0) / wallet.total_trades
          : 0,
      },

      computedAt: new Date(wallet.computed_at || Date.now()),
    };

    return profile;
  }

  /**
   * List wallets with filters and pagination
   */
  async listWallets(params: WalletQueryParams): Promise<WalletListResponse> {
    const {
      tags,
      minVolume,
      maxVolume,
      minWinRate,
      minInsiderScore,
      minSmartMoneyScore,
      sortBy = 'volume',
      sortOrder = 'desc',
      limit = 50,
      offset = 0,
    } = params;

    // Build WHERE clauses
    const conditions: string[] = ['1=1'];
    const values: any[] = [];
    let paramIndex = 1;

    if (tags && tags.length > 0) {
      conditions.push(`tags && $${paramIndex}::text[]`);
      values.push(tags);
      paramIndex++;
    }

    if (minVolume !== undefined) {
      conditions.push(`total_volume >= $${paramIndex}`);
      values.push(minVolume);
      paramIndex++;
    }

    if (maxVolume !== undefined) {
      conditions.push(`total_volume <= $${paramIndex}`);
      values.push(maxVolume);
      paramIndex++;
    }

    if (minWinRate !== undefined) {
      conditions.push(`
        CASE WHEN (win_count + loss_count) > 0
          THEN win_count::float / (win_count + loss_count)
          ELSE 0
        END >= $${paramIndex}
      `);
      values.push(minWinRate);
      paramIndex++;
    }

    if (minInsiderScore !== undefined) {
      conditions.push(`insider_score >= $${paramIndex}`);
      values.push(minInsiderScore);
      paramIndex++;
    }

    if (minSmartMoneyScore !== undefined) {
      conditions.push(`smart_money_score >= $${paramIndex}`);
      values.push(minSmartMoneyScore);
      paramIndex++;
    }

    // Build ORDER BY
    const sortColumn = this.getSortColumn(sortBy);
    const orderDirection = sortOrder === 'asc' ? 'ASC' : 'DESC';

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM wallets
      WHERE ${conditions.join(' AND ')}
    `;
    const countResult = await this.db.query(countQuery, values);
    const total = parseInt(countResult.rows[0].total);

    // Get wallets
    const query = `
      SELECT *
      FROM wallets
      WHERE ${conditions.join(' AND ')}
      ORDER BY ${sortColumn} ${orderDirection} NULLS LAST
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    values.push(limit, offset);

    const { rows } = await this.db.query(query, values);

    // Convert to WalletProfile objects
    const wallets = await Promise.all(
      rows.map(row => this.rowToProfile(row))
    );

    return {
      wallets,
      pagination: {
        offset,
        limit,
        total,
        hasMore: offset + rows.length < total,
      },
    };
  }

  /**
   * Get wallet detail with recent trades and positions
   */
  async getWalletDetail(address: string): Promise<WalletDetailResponse | null> {
    const profile = await this.getWalletProfile(address);
    if (!profile) {
      return null;
    }

    const [recentTrades, positions] = await Promise.all([
      this.getWalletTrades(address, 50),
      this.getWalletPositions(address),
    ]);

    return {
      wallet: profile,
      recentTrades,
      positions,
    };
  }

  /**
   * Get wallet's trade history
   */
  async getWalletTrades(address: string, limit = 100): Promise<WalletTrade[]> {
    const normalizedAddress = address.toLowerCase();

    const { rows } = await this.db.query(`
      SELECT
        wt.tx_hash,
        wt.wallet_address,
        wt.timestamp,
        wt.condition_id as market_id,
        m.question as market_question,
        m.slug as market_slug,
        wt.outcome,
        wt.side,
        wt.price,
        wt.size,
        wt.usd_value,
        wt.market_odds,
        wt.hours_to_resolution,
        wt.outcome_correct,
        wt.profit_loss
      FROM whale_trades wt
      LEFT JOIN markets m ON wt.condition_id = m.condition_id
      WHERE wt.wallet_address = $1
      ORDER BY wt.timestamp DESC
      LIMIT $2
    `, [normalizedAddress, limit]);

    return rows.map(row => ({
      txHash: row.tx_hash,
      walletAddress: row.wallet_address,
      timestamp: new Date(row.timestamp),
      marketId: row.market_id,
      marketQuestion: row.market_question || '',
      marketSlug: row.market_slug,
      outcome: row.outcome as 'YES' | 'NO',
      side: row.side as 'BUY' | 'SELL',
      price: parseFloat(row.price) || 0,
      size: parseFloat(row.size) || 0,
      usdValue: parseFloat(row.usd_value) || 0,
      marketOdds: parseFloat(row.market_odds) || 0,
      hoursToResolution: row.hours_to_resolution ? parseFloat(row.hours_to_resolution) : undefined,
      outcomeCorrect: row.outcome_correct,
      profitLoss: row.profit_loss ? parseFloat(row.profit_loss) : undefined,
    }));
  }

  /**
   * Get wallet's current positions
   */
  async getWalletPositions(address: string): Promise<WalletPosition[]> {
    const normalizedAddress = address.toLowerCase();

    const { rows } = await this.db.query(`
      SELECT
        wp.condition_id as market_id,
        m.question as market_question,
        wp.outcome_index,
        wp.net_position as size,
        wp.avg_entry_price,
        COALESCE(
          CASE WHEN wp.outcome_index = 1 THEN m.last_price_yes ELSE m.last_price_no END,
          0.5
        ) as current_price,
        wp.unrealized_pnl,
        wp.first_trade_time,
        wp.last_trade_time
      FROM wallet_positions wp
      LEFT JOIN markets m ON wp.condition_id = m.condition_id
      WHERE wp.wallet_address = $1
        AND wp.net_position > 0.001
      ORDER BY wp.net_position DESC
    `, [normalizedAddress]);

    return rows.map(row => ({
      marketId: row.market_id,
      marketQuestion: row.market_question || '',
      outcome: row.outcome_index === 1 ? 'YES' as const : 'NO' as const,
      size: parseFloat(row.size) || 0,
      avgEntryPrice: parseFloat(row.avg_entry_price) || 0,
      currentPrice: parseFloat(row.current_price) || 0.5,
      value: (parseFloat(row.size) || 0) * (parseFloat(row.current_price) || 0.5),
      unrealizedPnl: parseFloat(row.unrealized_pnl) || 0,
      firstTradeTime: new Date(row.first_trade_time),
      lastTradeTime: new Date(row.last_trade_time),
    }));
  }

  /**
   * Get category performance breakdown
   */
  async getCategoryPerformance(address: string): Promise<CategoryPerformance[]> {
    const normalizedAddress = address.toLowerCase();

    // Try to get from category_stats JSONB column first
    const { rows } = await this.db.query(`
      SELECT category_stats FROM wallets WHERE address = $1
    `, [normalizedAddress]);

    if (rows.length > 0 && rows[0].category_stats) {
      const stats = rows[0].category_stats;
      if (Array.isArray(stats)) {
        return stats as CategoryPerformance[];
      }
      // Convert object to array if needed
      if (typeof stats === 'object') {
        return Object.entries(stats).map(([category, data]: [string, any]) => ({
          category,
          volume: data.volume || 0,
          winRate: data.winRate || 0,
          pnl: data.pnl || 0,
          tradeCount: data.tradeCount || 0,
        }));
      }
    }

    // Fallback: compute from trades
    const tradeStats = await this.db.query(`
      SELECT
        m.category,
        SUM(wt.usd_value) as volume,
        COUNT(*) as trade_count,
        SUM(CASE WHEN wt.outcome_correct = true THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN wt.outcome_correct IS NOT NULL THEN 1 ELSE 0 END) as resolved,
        SUM(COALESCE(wt.profit_loss, 0)) as pnl
      FROM whale_trades wt
      JOIN markets m ON wt.condition_id = m.condition_id
      WHERE wt.wallet_address = $1
        AND m.category IS NOT NULL
      GROUP BY m.category
      ORDER BY volume DESC
      LIMIT 10
    `, [normalizedAddress]);

    return tradeStats.rows.map(row => ({
      category: row.category,
      volume: parseFloat(row.volume) || 0,
      winRate: row.resolved > 0 ? row.wins / row.resolved : 0,
      pnl: parseFloat(row.pnl) || 0,
      tradeCount: parseInt(row.trade_count) || 0,
    }));
  }

  /**
   * Get wallet holdings summary
   */
  private async getWalletHoldings(address: string): Promise<WalletHoldings> {
    const positions = await this.getWalletPositions(address);

    if (positions.length === 0) {
      return {
        openPositions: 0,
        holdingsValue: 0,
      };
    }

    const holdingsValue = positions.reduce((sum, p) => sum + p.value, 0);
    const largest = positions[0]; // Already sorted by size DESC

    return {
      openPositions: positions.length,
      holdingsValue,
      largestPosition: largest ? {
        marketId: largest.marketId,
        marketQuestion: largest.marketQuestion,
        outcome: largest.outcome,
        size: largest.size,
        value: largest.value,
        unrealizedPnl: largest.unrealizedPnl,
      } : undefined,
    };
  }

  // ============ SUBSCRIPTION METHODS ============

  /**
   * Subscribe a user to a wallet
   */
  async subscribe(
    userId: number,
    walletAddress: string,
    options: {
      nickname?: string;
      notes?: string;
      notifyOnTrade?: boolean;
      notifyOnWhaleTrade?: boolean;
      notifyOnNewPosition?: boolean;
      notifyOnPositionClosed?: boolean;
    } = {}
  ): Promise<WalletSubscription> {
    const normalizedAddress = walletAddress.toLowerCase();

    const { rows } = await this.db.query(`
      INSERT INTO wallet_subscriptions (
        user_id, wallet_address, nickname, notes,
        notify_on_trade, notify_on_whale_trade,
        notify_on_new_position, notify_on_position_closed
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (user_id, wallet_address) DO UPDATE SET
        nickname = COALESCE(EXCLUDED.nickname, wallet_subscriptions.nickname),
        notes = COALESCE(EXCLUDED.notes, wallet_subscriptions.notes),
        notify_on_trade = COALESCE(EXCLUDED.notify_on_trade, wallet_subscriptions.notify_on_trade),
        notify_on_whale_trade = COALESCE(EXCLUDED.notify_on_whale_trade, wallet_subscriptions.notify_on_whale_trade),
        notify_on_new_position = COALESCE(EXCLUDED.notify_on_new_position, wallet_subscriptions.notify_on_new_position),
        notify_on_position_closed = COALESCE(EXCLUDED.notify_on_position_closed, wallet_subscriptions.notify_on_position_closed)
      RETURNING *
    `, [
      userId,
      normalizedAddress,
      options.nickname || null,
      options.notes || null,
      options.notifyOnTrade ?? false,
      options.notifyOnWhaleTrade ?? true,
      options.notifyOnNewPosition ?? false,
      options.notifyOnPositionClosed ?? false,
    ]);

    return this.rowToSubscription(rows[0]);
  }

  /**
   * Unsubscribe a user from a wallet
   */
  async unsubscribe(userId: number, walletAddress: string): Promise<boolean> {
    const normalizedAddress = walletAddress.toLowerCase();

    const result = await this.db.query(`
      DELETE FROM wallet_subscriptions
      WHERE user_id = $1 AND wallet_address = $2
    `, [userId, normalizedAddress]);

    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Get user's subscriptions
   */
  async getUserSubscriptions(userId: number): Promise<WalletSubscription[]> {
    const { rows } = await this.db.query(`
      SELECT * FROM wallet_subscriptions
      WHERE user_id = $1
      ORDER BY subscribed_at DESC
    `, [userId]);

    return rows.map(row => this.rowToSubscription(row));
  }

  /**
   * Get users subscribed to a wallet
   */
  async getWalletSubscribers(walletAddress: string): Promise<number[]> {
    const normalizedAddress = walletAddress.toLowerCase();

    const { rows } = await this.db.query(`
      SELECT user_id FROM wallet_subscriptions
      WHERE wallet_address = $1
    `, [normalizedAddress]);

    return rows.map(row => row.user_id);
  }

  // ============ SNAPSHOT METHODS ============

  /**
   * Create daily snapshots for all active wallets
   */
  async createDailySnapshots(): Promise<number> {
    console.log('[Snapshots] Creating daily snapshots...');
    const startTime = Date.now();

    const result = await this.db.query(`
      INSERT INTO wallet_snapshots (
        wallet_address, snapshot_date,
        total_volume, realized_pnl, unrealized_pnl,
        open_positions_value, open_positions_count,
        win_count, loss_count, total_trades,
        smart_money_score, insider_score, whale_score,
        tags, category_stats
      )
      SELECT
        w.address,
        CURRENT_DATE,
        w.total_volume,
        w.realized_pnl,
        w.unrealized_pnl,
        w.holdings_value,
        w.open_positions_count,
        w.win_count,
        w.loss_count,
        w.total_trades,
        w.smart_money_score,
        w.insider_score,
        w.whale_score,
        w.tags,
        w.category_stats
      FROM wallets w
      WHERE w.last_active > NOW() - INTERVAL '30 days'
        AND w.total_trades > 0
      ON CONFLICT (wallet_address, snapshot_date) DO UPDATE SET
        total_volume = EXCLUDED.total_volume,
        realized_pnl = EXCLUDED.realized_pnl,
        unrealized_pnl = EXCLUDED.unrealized_pnl,
        open_positions_value = EXCLUDED.open_positions_value,
        open_positions_count = EXCLUDED.open_positions_count,
        win_count = EXCLUDED.win_count,
        loss_count = EXCLUDED.loss_count,
        total_trades = EXCLUDED.total_trades,
        smart_money_score = EXCLUDED.smart_money_score,
        insider_score = EXCLUDED.insider_score,
        whale_score = EXCLUDED.whale_score,
        tags = EXCLUDED.tags,
        category_stats = EXCLUDED.category_stats
    `);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[Snapshots] Created ${result.rowCount} snapshots in ${elapsed}s`);

    return result.rowCount ?? 0;
  }

  /**
   * Get wallet snapshot history
   */
  async getWalletSnapshots(address: string, days = 30): Promise<WalletSnapshot[]> {
    const normalizedAddress = address.toLowerCase();

    const { rows } = await this.db.query(`
      SELECT * FROM wallet_snapshots
      WHERE wallet_address = $1
        AND snapshot_date > CURRENT_DATE - $2
      ORDER BY snapshot_date DESC
    `, [normalizedAddress, days]);

    return rows.map(row => ({
      walletAddress: row.wallet_address,
      snapshotDate: new Date(row.snapshot_date),
      totalVolume: parseFloat(row.total_volume) || 0,
      realizedPnl: parseFloat(row.realized_pnl) || 0,
      unrealizedPnl: parseFloat(row.unrealized_pnl) || 0,
      openPositionsValue: parseFloat(row.open_positions_value) || 0,
      winCount: row.win_count || 0,
      lossCount: row.loss_count || 0,
      smartMoneyScore: row.smart_money_score || 0,
      insiderScore: row.insider_score || 0,
      tags: this.parseTags(row.tags),
    }));
  }

  // ============ CLUSTER METHODS ============

  /**
   * Get wallet's cluster if any
   */
  async getWalletCluster(address: string): Promise<WalletCluster | null> {
    const normalizedAddress = address.toLowerCase();

    const { rows } = await this.db.query(`
      SELECT
        wc.*,
        (
          SELECT json_agg(json_build_object(
            'address', wcm2.wallet_address,
            'role', wcm2.role,
            'joinedCluster', wcm2.joined_at
          ))
          FROM wallet_cluster_members wcm2
          WHERE wcm2.cluster_id = wc.cluster_id
        ) as members
      FROM wallet_clusters wc
      JOIN wallet_cluster_members wcm ON wc.cluster_id = wcm.cluster_id
      WHERE wcm.wallet_address = $1
    `, [normalizedAddress]);

    if (rows.length === 0) {
      return null;
    }

    const cluster = rows[0];
    return {
      clusterId: cluster.cluster_id,
      detectionMethod: cluster.detection_method as any,
      confidence: parseFloat(cluster.confidence) || 0,
      members: cluster.members || [],
      aggregateMetrics: {
        totalVolume: parseFloat(cluster.total_volume) || 0,
        totalPnl: 0, // Would need to sum from members
        memberCount: cluster.member_count || 0,
      },
      createdAt: new Date(cluster.created_at),
      metadata: cluster.metadata,
    };
  }

  // ============ HELPER METHODS ============

  private calculateWinRate(wins: number, losses: number): number {
    const total = (wins || 0) + (losses || 0);
    return total > 0 ? (wins || 0) / total : 0;
  }

  private parseTags(tags: any): WalletTag[] {
    if (!tags) return [];
    if (Array.isArray(tags)) return tags as WalletTag[];
    return [];
  }

  private determinePreferredSide(wallet: any): 'YES' | 'NO' | 'balanced' {
    const yesVolume = parseFloat(wallet.yes_volume) || 0;
    const noVolume = parseFloat(wallet.no_volume) || 0;
    const total = yesVolume + noVolume;

    if (total === 0) return 'balanced';
    if (yesVolume / total > 0.6) return 'YES';
    if (noVolume / total > 0.6) return 'NO';
    return 'balanced';
  }

  private getSortColumn(sortBy: string | undefined): string {
    const sortMap: Record<string, string> = {
      'volume': 'total_volume',
      'volume_24h': 'volume_24h',
      'pnl': 'realized_pnl',
      'win_rate': 'CASE WHEN (win_count + loss_count) > 0 THEN win_count::float / (win_count + loss_count) ELSE 0 END',
      'insider_score': 'insider_score',
      'smart_money_score': 'smart_money_score',
      'last_active': 'last_active',
      'first_seen': 'first_seen',
    };
    return sortMap[sortBy || 'volume'] || 'total_volume';
  }

  private async rowToProfile(row: any): Promise<WalletProfile> {
    return {
      address: row.address,
      entityId: row.entity_id || undefined,
      clusterId: row.cluster_id || undefined,
      firstSeen: new Date(row.first_seen),
      lastActive: new Date(row.last_active),
      funding: {
        totalDeposited: parseFloat(row.total_deposited) || 0,
        totalWithdrawn: parseFloat(row.total_withdrawn) || 0,
        netFunding: (parseFloat(row.total_deposited) || 0) - (parseFloat(row.total_withdrawn) || 0),
        fundingSourceType: 'unknown',
      },
      performance: {
        realizedPnl: parseFloat(row.realized_pnl) || 0,
        unrealizedPnl: parseFloat(row.unrealized_pnl) || 0,
        totalPnl: (parseFloat(row.realized_pnl) || 0) + (parseFloat(row.unrealized_pnl) || 0),
        winCount: row.win_count || 0,
        lossCount: row.loss_count || 0,
        winRate: this.calculateWinRate(row.win_count, row.loss_count),
        profitFactor: parseFloat(row.profit_factor) || 0,
        maxDrawdown: parseFloat(row.max_drawdown) || 0,
        roi: parseFloat(row.roi) || 0,
      },
      activity: {
        totalVolume: parseFloat(row.total_volume) || 0,
        totalTrades: row.total_trades || 0,
        avgTradeSize: row.total_trades > 0 ? (parseFloat(row.total_volume) || 0) / row.total_trades : 0,
        volume24h: parseFloat(row.volume_24h) || 0,
        volume7d: parseFloat(row.volume_7d) || 0,
        volume30d: parseFloat(row.volume_30d) || 0,
        tradesLast24h: row.trades_24h || 0,
        tradesLast7d: row.trades_7d || 0,
      },
      holdings: {
        openPositions: row.open_positions_count || 0,
        holdingsValue: parseFloat(row.holdings_value) || 0,
      },
      specialization: {
        topCategories: [],
        marketsTraded: row.markets_traded || 0,
        marketConcentration: parseFloat(row.market_concentration) || 0,
        focusedMarkets: [],
      },
      behavior: {
        avgHoldTime: 0,
        avgTimeToResolution: 0,
        preResolutionRate: parseFloat(row.pre_resolution_correct_rate) || 0,
        tradingHours: new Array(24).fill(0),
        preferredSide: 'balanced',
      },
      scores: {
        smartMoneyScore: row.smart_money_score || 0,
        insiderScore: row.insider_score || 0,
        whaleScore: row.whale_score || 0,
      },
      tags: this.parseTags(row.tags),
      fees: {
        totalFeesPaid: 0,
        avgFeePerTrade: 0,
      },
      computedAt: new Date(row.computed_at || Date.now()),
    };
  }

  private rowToSubscription(row: any): WalletSubscription {
    return {
      id: row.id,
      userId: row.user_id,
      walletAddress: row.wallet_address,
      subscribedAt: new Date(row.subscribed_at),
      notifications: {
        onTrade: row.notify_on_trade,
        onWhaleTrade: row.notify_on_whale_trade,
        onNewPosition: row.notify_on_new_position,
        onPositionClosed: row.notify_on_position_closed,
      },
      nickname: row.nickname || undefined,
      notes: row.notes || undefined,
    };
  }

  /**
   * Start scheduled snapshot job
   */
  startScheduledSnapshots(intervalMs = 24 * 60 * 60 * 1000): void {
    // Run at startup if we haven't run today
    this.runSnapshotIfNeeded();

    // Then run on interval
    setInterval(() => {
      this.runSnapshotIfNeeded();
    }, intervalMs);

    console.log(`[Snapshots] Scheduled daily snapshots`);
  }

  private async runSnapshotIfNeeded(): Promise<void> {
    // Check if we've already run today
    const { rows } = await this.db.query(`
      SELECT COUNT(*) as count
      FROM wallet_snapshots
      WHERE snapshot_date = CURRENT_DATE
    `);

    if (parseInt(rows[0].count) === 0) {
      await this.createDailySnapshots();
    }
  }
}
