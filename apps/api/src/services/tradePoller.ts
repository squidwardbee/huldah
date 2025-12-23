import axios from 'axios';
import { Pool } from 'pg';
import Redis from 'ioredis';

const DATA_API = 'https://data-api.polymarket.com';
const WHALE_THRESHOLD = 1000;

interface DataTrade {
  id: string;
  taker_order_id: string;
  market: string;
  asset_id: string;
  side: string;
  size: string;
  price: string;
  maker_address: string;
  taker_address: string;
  timestamp: number;
  transaction_hash: string;
}

export class TradePoller {
  private db: Pool;
  private redis: Redis;
  private lastTimestamp: number = Date.now() - 60000;
  private pollInterval: NodeJS.Timeout | null = null;

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
    if (!trade.taker_address) {
      return;
    }

    const size = parseFloat(trade.size);
    const price = parseFloat(trade.price);
    const usdValue = size * price;
    const isWhale = usdValue >= WHALE_THRESHOLD;

    // Upsert wallet
    await this.db.query(`
      INSERT INTO wallets (address, total_trades, total_volume, last_active)
      VALUES ($1, 1, $2, NOW())
      ON CONFLICT (address) DO UPDATE SET
        total_trades = wallets.total_trades + 1,
        total_volume = wallets.total_volume + $2,
        last_active = NOW()
    `, [trade.taker_address, usdValue]);

    // Insert trade
    await this.db.query(`
      INSERT INTO trades (tx_hash, wallet_address, market_id, token_id, side, price, size, usd_value, timestamp, is_whale)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, to_timestamp($9), $10)
      ON CONFLICT DO NOTHING
    `, [
      trade.transaction_hash,
      trade.taker_address,
      trade.market,
      trade.asset_id,
      trade.side,
      price,
      size,
      usdValue,
      trade.timestamp / 1000,
      isWhale
    ]);

    if (isWhale) {
      console.log(`[WHALE] ${trade.taker_address} - $${usdValue.toFixed(0)} ${trade.side}`);
      
      const { rows } = await this.db.query(`
        SELECT total_trades, total_volume, win_count, loss_count
        FROM wallets WHERE address = $1
      `, [trade.taker_address]);

      await this.redis.publish('whale_trades', JSON.stringify({
        wallet: trade.taker_address,
        marketId: trade.market,
        tokenId: trade.asset_id,
        side: trade.side,
        price,
        size,
        usdValue,
        timestamp: trade.timestamp,
        txHash: trade.transaction_hash,
        walletStats: rows[0]
      }));
    }
  }

  stop() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }
  }
}


