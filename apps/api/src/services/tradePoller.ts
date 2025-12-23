import axios from 'axios';
import { Pool } from 'pg';
import Redis from 'ioredis';

const DATA_API = 'https://data-api.polymarket.com';
const WHALE_THRESHOLD = 1000;

interface DataTrade {
  proxyWallet: string;
  side: string;
  asset: string;
  conditionId: string;
  size: number;
  price: number;
  timestamp: number;
  transactionHash: string;
  title?: string;
  slug?: string;
  outcome?: string;
}

export class TradePoller {
  private db: Pool;
  private redis: Redis;
  private lastTimestamp: number = Math.floor(Date.now() / 1000) - 60;
  private pollInterval: NodeJS.Timeout | null = null;
  private recentTxHashes: Set<string> = new Set();

  constructor(db: Pool, redis: Redis) {
    this.db = db;
    this.redis = redis;
  }

  async start() {
    this.pollInterval = setInterval(() => this.poll(), 2000);
    console.log('[Poller] Started trade polling (lean mode)');
  }

  private async poll() {
    try {
      const { data: trades } = await axios.get<DataTrade[]>(`${DATA_API}/trades`, {
        params: {
          after: this.lastTimestamp,
          limit: 100
        }
      });

      if (trades.length === 0) return;

      this.lastTimestamp = Math.max(...trades.map(t => t.timestamp));

      for (const trade of trades) {
        await this.processTrade(trade);
      }
    } catch (err) {
      console.error('[Poller] Error:', err);
    }
  }

  private async processTrade(trade: DataTrade) {
    if (!trade.proxyWallet) return;

    // Dedupe
    if (this.recentTxHashes.has(trade.transactionHash)) return;
    this.recentTxHashes.add(trade.transactionHash);
    if (this.recentTxHashes.size > 1000) {
      const first = this.recentTxHashes.values().next().value;
      if (first) this.recentTxHashes.delete(first);
    }

    const usdValue = trade.size * trade.price;
    const isWhale = usdValue >= WHALE_THRESHOLD;

    // Always update wallet stats (aggregated)
    await this.db.query(`
      INSERT INTO wallets (address, total_trades, total_volume, last_active, first_seen)
      VALUES ($1, 1, $2, NOW(), NOW())
      ON CONFLICT (address) DO UPDATE SET
        total_trades = wallets.total_trades + 1,
        total_volume = wallets.total_volume + $2,
        last_active = NOW()
    `, [trade.proxyWallet, usdValue]);

    // Only store whale trades (>$1000)
    if (isWhale) {
      // Get wallet stats for enrichment
      const { rows } = await this.db.query(`
        SELECT total_trades, total_volume, tags
        FROM wallets WHERE address = $1
      `, [trade.proxyWallet]);

      const walletStats = rows[0] || { total_trades: 0, total_volume: 0, tags: [] };

      // Store in whale_trades
      await this.db.query(`
        INSERT INTO whale_trades (
          tx_hash, wallet_address, market_slug, market_question, side, 
          price, size, usd_value, timestamp, wallet_tags, wallet_volume, wallet_trade_count
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, to_timestamp($9), $10, $11, $12)
        ON CONFLICT (tx_hash) DO NOTHING
      `, [
        trade.transactionHash,
        trade.proxyWallet,
        trade.slug || null,
        trade.title || null,
        trade.side,
        trade.price,
        trade.size,
        usdValue,
        trade.timestamp,
        walletStats.tags || [],
        walletStats.total_volume || 0,
        walletStats.total_trades || 0
      ]);

      console.log(`[WHALE] ${trade.proxyWallet} - $${usdValue.toFixed(0)} ${trade.side}`);

      // Broadcast to WebSocket clients
      await this.redis.publish('whale_trades', JSON.stringify({
        wallet: trade.proxyWallet,
        side: trade.side,
        price: trade.price,
        size: trade.size,
        usdValue,
        timestamp: trade.timestamp * 1000,
        txHash: trade.transactionHash,
        marketQuestion: trade.title,
        marketSlug: trade.slug,
        walletTags: walletStats.tags || [],
        walletVolume: walletStats.total_volume || 0,
        walletTradeCount: walletStats.total_trades || 0
      }));
    }
  }

  stop() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }
  }
}
