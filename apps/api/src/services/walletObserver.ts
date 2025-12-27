import { Pool } from 'pg';
import Redis from 'ioredis';
import { WalletActivityEvent, WalletActivityType, WalletTrade } from '@huldah/shared';

/**
 * WalletObserver Service
 *
 * Implements the Observer pattern for wallet activity monitoring.
 * When a tracked wallet performs an action (trade, position change),
 * notifications are sent to all subscribed users via Redis pub/sub.
 */

interface WalletSubscriber {
  userId: number;
  walletAddress: string;
  notifyOnTrade: boolean;
  notifyOnWhaleTrade: boolean;
  notifyOnNewPosition: boolean;
  notifyOnPositionClosed: boolean;
}

interface ActivityNotification {
  userId: number;
  walletAddress: string;
  walletNickname?: string;
  activityType: WalletActivityType;
  data: any;
  timestamp: Date;
}

export class WalletObserver {
  private db: Pool;
  private redis: Redis;
  private subscriberCache: Map<string, WalletSubscriber[]> = new Map();
  private cacheExpiry = 60 * 1000; // 1 minute cache
  private lastCacheRefresh = 0;

  constructor(db: Pool, redis: Redis) {
    this.db = db;
    this.redis = redis;
  }

  /**
   * Notify subscribers when a wallet makes a trade
   */
  async onWalletTrade(trade: {
    walletAddress: string;
    conditionId: string;
    marketQuestion?: string;
    outcome: 'YES' | 'NO';
    side: 'BUY' | 'SELL';
    price: number;
    size: number;
    usdValue: number;
    txHash?: string;
    timestamp: Date;
  }): Promise<number> {
    const normalizedAddress = trade.walletAddress.toLowerCase();
    const isWhaleTrade = trade.usdValue >= 1000;

    // Get subscribers for this wallet
    const subscribers = await this.getSubscribersForWallet(normalizedAddress);
    if (subscribers.length === 0) {
      return 0;
    }

    // Filter subscribers based on notification preferences
    const notifyList = subscribers.filter(sub => {
      if (isWhaleTrade && sub.notifyOnWhaleTrade) return true;
      if (sub.notifyOnTrade) return true;
      return false;
    });

    if (notifyList.length === 0) {
      return 0;
    }

    // Create activity event
    const activityType: WalletActivityType = isWhaleTrade ? 'whale_trade' : 'trade';
    const activityData = {
      walletAddress: normalizedAddress,
      conditionId: trade.conditionId,
      marketQuestion: trade.marketQuestion,
      outcome: trade.outcome,
      side: trade.side,
      price: trade.price,
      size: trade.size,
      usdValue: trade.usdValue,
      txHash: trade.txHash,
      isWhaleTrade,
    };

    // Send notifications and log activity
    await Promise.all([
      this.sendNotifications(notifyList, activityType, activityData, trade.timestamp),
      this.logActivity(notifyList, normalizedAddress, activityType, activityData),
    ]);

    return notifyList.length;
  }

  /**
   * Notify subscribers when a wallet opens a new position
   */
  async onNewPosition(event: {
    walletAddress: string;
    conditionId: string;
    marketQuestion?: string;
    outcome: 'YES' | 'NO';
    size: number;
    avgPrice: number;
    timestamp: Date;
  }): Promise<number> {
    const normalizedAddress = event.walletAddress.toLowerCase();

    const subscribers = await this.getSubscribersForWallet(normalizedAddress);
    const notifyList = subscribers.filter(sub => sub.notifyOnNewPosition);

    if (notifyList.length === 0) {
      return 0;
    }

    const activityData = {
      walletAddress: normalizedAddress,
      conditionId: event.conditionId,
      marketQuestion: event.marketQuestion,
      outcome: event.outcome,
      size: event.size,
      avgPrice: event.avgPrice,
    };

    await Promise.all([
      this.sendNotifications(notifyList, 'position_opened', activityData, event.timestamp),
      this.logActivity(notifyList, normalizedAddress, 'position_opened', activityData),
    ]);

    return notifyList.length;
  }

  /**
   * Notify subscribers when a wallet closes a position
   */
  async onPositionClosed(event: {
    walletAddress: string;
    conditionId: string;
    marketQuestion?: string;
    outcome: 'YES' | 'NO';
    realizedPnl: number;
    timestamp: Date;
  }): Promise<number> {
    const normalizedAddress = event.walletAddress.toLowerCase();

    const subscribers = await this.getSubscribersForWallet(normalizedAddress);
    const notifyList = subscribers.filter(sub => sub.notifyOnPositionClosed);

    if (notifyList.length === 0) {
      return 0;
    }

    const activityData = {
      walletAddress: normalizedAddress,
      conditionId: event.conditionId,
      marketQuestion: event.marketQuestion,
      outcome: event.outcome,
      realizedPnl: event.realizedPnl,
    };

    await Promise.all([
      this.sendNotifications(notifyList, 'position_closed', activityData, event.timestamp),
      this.logActivity(notifyList, normalizedAddress, 'position_closed', activityData),
    ]);

    return notifyList.length;
  }

  /**
   * Get all subscribers for a wallet address
   */
  private async getSubscribersForWallet(walletAddress: string): Promise<WalletSubscriber[]> {
    // Check cache first
    const now = Date.now();
    if (now - this.lastCacheRefresh < this.cacheExpiry) {
      const cached = this.subscriberCache.get(walletAddress);
      if (cached !== undefined) {
        return cached;
      }
    }

    // Query database
    const { rows } = await this.db.query(`
      SELECT
        ws.user_id,
        ws.wallet_address,
        ws.notify_on_trade,
        ws.notify_on_whale_trade,
        ws.notify_on_new_position,
        ws.notify_on_position_closed,
        ws.nickname
      FROM wallet_subscriptions ws
      WHERE ws.wallet_address = $1
    `, [walletAddress]);

    const subscribers: WalletSubscriber[] = rows.map(row => ({
      userId: row.user_id,
      walletAddress: row.wallet_address,
      notifyOnTrade: row.notify_on_trade,
      notifyOnWhaleTrade: row.notify_on_whale_trade,
      notifyOnNewPosition: row.notify_on_new_position,
      notifyOnPositionClosed: row.notify_on_position_closed,
      nickname: row.nickname,
    }));

    // Update cache
    this.subscriberCache.set(walletAddress, subscribers);
    this.lastCacheRefresh = now;

    return subscribers;
  }

  /**
   * Send notifications via Redis pub/sub
   */
  private async sendNotifications(
    subscribers: WalletSubscriber[],
    activityType: WalletActivityType,
    data: any,
    timestamp: Date
  ): Promise<void> {
    const notifications = subscribers.map(sub => ({
      userId: sub.userId,
      walletAddress: sub.walletAddress,
      activityType,
      data,
      timestamp: timestamp.toISOString(),
    }));

    // Publish to subscription_activity channel
    // Frontend can filter by userId
    await this.redis.publish('subscription_activity', JSON.stringify({
      type: 'wallet_activity',
      notifications,
    }));

    // Also publish per-user for targeted delivery
    for (const notification of notifications) {
      await this.redis.publish(
        `user_notifications:${notification.userId}`,
        JSON.stringify(notification)
      );
    }
  }

  /**
   * Log activity for later retrieval
   */
  private async logActivity(
    subscribers: WalletSubscriber[],
    walletAddress: string,
    activityType: WalletActivityType,
    data: any
  ): Promise<void> {
    // Get subscription IDs for these subscribers
    const userIds = subscribers.map(s => s.userId);

    try {
      await this.db.query(`
        INSERT INTO subscription_activity_log (
          subscription_id,
          wallet_address,
          activity_type,
          activity_data,
          created_at
        )
        SELECT
          ws.id,
          $1,
          $2,
          $3,
          NOW()
        FROM wallet_subscriptions ws
        WHERE ws.wallet_address = $1
          AND ws.user_id = ANY($4)
      `, [walletAddress, activityType, JSON.stringify(data), userIds]);
    } catch (err) {
      console.error('[WalletObserver] Error logging activity:', err);
    }
  }

  /**
   * Get activity feed for a user's subscribed wallets
   */
  async getUserActivityFeed(userId: number, limit = 50): Promise<any[]> {
    const { rows } = await this.db.query(`
      SELECT
        sal.id,
        sal.wallet_address,
        sal.activity_type,
        sal.activity_data,
        sal.created_at,
        sal.delivered,
        ws.nickname as wallet_nickname
      FROM subscription_activity_log sal
      JOIN wallet_subscriptions ws ON sal.subscription_id = ws.id
      WHERE ws.user_id = $1
      ORDER BY sal.created_at DESC
      LIMIT $2
    `, [userId, limit]);

    return rows.map(row => ({
      id: row.id,
      walletAddress: row.wallet_address,
      walletNickname: row.wallet_nickname,
      activityType: row.activity_type,
      data: row.activity_data,
      createdAt: new Date(row.created_at),
      delivered: row.delivered,
    }));
  }

  /**
   * Mark activity as delivered
   */
  async markDelivered(activityIds: number[]): Promise<void> {
    await this.db.query(`
      UPDATE subscription_activity_log
      SET delivered = true, delivered_at = NOW()
      WHERE id = ANY($1)
    `, [activityIds]);
  }

  /**
   * Get undelivered notifications for a user
   */
  async getUndeliveredNotifications(userId: number, limit = 100): Promise<any[]> {
    const { rows } = await this.db.query(`
      SELECT
        sal.id,
        sal.wallet_address,
        sal.activity_type,
        sal.activity_data,
        sal.created_at,
        ws.nickname as wallet_nickname
      FROM subscription_activity_log sal
      JOIN wallet_subscriptions ws ON sal.subscription_id = ws.id
      WHERE ws.user_id = $1
        AND sal.delivered = false
      ORDER BY sal.created_at DESC
      LIMIT $2
    `, [userId, limit]);

    return rows.map(row => ({
      id: row.id,
      walletAddress: row.wallet_address,
      walletNickname: row.wallet_nickname,
      activityType: row.activity_type,
      data: row.activity_data,
      createdAt: new Date(row.created_at),
    }));
  }

  /**
   * Get count of subscriptions for monitoring
   */
  async getSubscriptionStats(): Promise<{
    totalSubscriptions: number;
    activeWallets: number;
    usersWithSubscriptions: number;
  }> {
    const { rows } = await this.db.query(`
      SELECT
        COUNT(*) as total_subscriptions,
        COUNT(DISTINCT wallet_address) as active_wallets,
        COUNT(DISTINCT user_id) as users_with_subscriptions
      FROM wallet_subscriptions
    `);

    return {
      totalSubscriptions: parseInt(rows[0].total_subscriptions) || 0,
      activeWallets: parseInt(rows[0].active_wallets) || 0,
      usersWithSubscriptions: parseInt(rows[0].users_with_subscriptions) || 0,
    };
  }

  /**
   * Clear subscriber cache (call when subscriptions change)
   */
  clearCache(): void {
    this.subscriberCache.clear();
    this.lastCacheRefresh = 0;
  }

  /**
   * Refresh cache for a specific wallet
   */
  async refreshWalletCache(walletAddress: string): Promise<void> {
    this.subscriberCache.delete(walletAddress.toLowerCase());
  }
}
