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
  outcome?: string;
}

export class TradePoller {
  private db: Pool;
  private redis: Redis;
  private lastTimestamp: number = Math.floor(Date.now() / 1000) - 60; // Unix seconds
  private pollInterval: NodeJS.Timeout | null = null;
  private recentTxHashes: Set<string> = new Set(); // Dedupe cache

  constructor(db: Pool, redis: Redis) {
    this.db = db;
    this.redis = redis;
  }

  async start() {
    this.pollInterval = setInterval(() => this.poll(), 2000);
    console.log('[Poller] Started trade polling');
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
    // Skip trades without wallet address
    if (!trade.proxyWallet) {
      return;
    }

    // Skip already processed trades
    if (this.recentTxHashes.has(trade.transactionHash)) {
      return;
    }
    this.recentTxHashes.add(trade.transactionHash);
    
    // Keep cache size bounded
    if (this.recentTxHashes.size > 1000) {
      const first = this.recentTxHashes.values().next().value;
      if (first) this.recentTxHashes.delete(first);
    }

    const usdValue = trade.size * trade.price;
    const isWhale = usdValue >= WHALE_THRESHOLD;

    // Upsert wallet
    await this.db.query(`
      INSERT INTO wallets (address, total_trades, total_volume, last_active)
      VALUES ($1, 1, $2, NOW())
      ON CONFLICT (address) DO UPDATE SET
        total_trades = wallets.total_trades + 1,
        total_volume = wallets.total_volume + $2,
        last_active = NOW()
    `, [trade.proxyWallet, usdValue]);

    // Insert trade
    await this.db.query(`
      INSERT INTO trades (tx_hash, wallet_address, market_id, token_id, side, price, size, usd_value, timestamp, is_whale)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, to_timestamp($9), $10)
      ON CONFLICT DO NOTHING
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

    if (isWhale) {
      console.log(`[WHALE] ${trade.proxyWallet} - $${usdValue.toFixed(0)} ${trade.side}`);
      
      const { rows } = await this.db.query(`
        SELECT total_trades, total_volume, win_count, loss_count
        FROM wallets WHERE address = $1
      `, [trade.proxyWallet]);

      await this.redis.publish('whale_trades', JSON.stringify({
        wallet: trade.proxyWallet,
        marketId: trade.conditionId,
        tokenId: trade.asset,
        side: trade.side,
        price: trade.price,
        size: trade.size,
        usdValue,
        timestamp: trade.timestamp * 1000, // Convert to ms for frontend
        txHash: trade.transactionHash,
        walletStats: rows[0],
        title: trade.title
      }));
    }
  }

  stop() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }
  }
}


