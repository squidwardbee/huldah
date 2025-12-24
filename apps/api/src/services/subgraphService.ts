import axios from 'axios';
import { Pool } from 'pg';

// Use Polymarket's official data API for leaderboard data
const POLYMARKET_DATA_API = 'https://data-api.polymarket.com';

interface LeaderboardEntry {
  rank: string;
  proxyWallet: string;
  userName: string;
  xUsername: string;
  verifiedBadge: boolean;
  vol: number;
  pnl: number;
  profileImage: string;
}

interface WalletPnL {
  address: string;
  userName: string;
  realizedPnl: number;
  volume: number;
}

export class SubgraphService {
  private db: Pool;

  constructor(db: Pool) {
    this.db = db;
  }

  /**
   * Fetch top wallets by realized PnL from Polymarket's official data API
   * This is the same API that powers the leaderboard on polymarket.com
   */
  async fetchTopWalletsByPnL(limit = 100): Promise<WalletPnL[]> {
    console.log('[Polymarket] Fetching top wallets by PnL from data API...');

    try {
      const { data } = await axios.get<LeaderboardEntry[]>(
        `${POLYMARKET_DATA_API}/v1/leaderboard`,
        {
          params: {
            timePeriod: 'all',
            orderBy: 'PNL',
            limit,
            offset: 0,
            category: 'overall'
          }
        }
      );

      const wallets: WalletPnL[] = data.map(entry => ({
        address: entry.proxyWallet,
        userName: entry.userName || entry.proxyWallet.slice(0, 10),
        realizedPnl: entry.pnl,
        volume: entry.vol,
      }));

      console.log(`[Polymarket] Found ${wallets.length} wallets`);
      if (wallets[0]) {
        console.log(`[Polymarket] Top wallet: ${wallets[0].userName} (${wallets[0].address.slice(0, 10)}...) with $${wallets[0].realizedPnl.toLocaleString()} PnL`);
      }
      
      return wallets;
    } catch (err) {
      console.error('[Polymarket] Error fetching wallets:', err);
      return [];
    }
  }

  /**
   * Seed database with top wallets from Polymarket's official data API
   */
  async seedTopWallets(): Promise<number> {
    const wallets = await this.fetchTopWalletsByPnL(100);

    if (wallets.length === 0) {
      console.log('[Polymarket] No wallets to seed');
      return 0;
    }

    console.log(`[Polymarket] Seeding ${wallets.length} top wallets...`);

    let seeded = 0;
    for (const wallet of wallets) {
      try {
        // Update realized PnL and volume from Polymarket data API
        await this.db.query(`
          INSERT INTO wallets (address, realized_pnl, total_trades, total_volume, first_seen, tags)
          VALUES ($1, $2, 0, $3, NOW(), $4)
          ON CONFLICT (address) DO UPDATE SET
            realized_pnl = $2,
            total_volume = GREATEST(COALESCE(wallets.total_volume, 0), $3),
            tags = CASE 
              WHEN $2 > 1000000 THEN array_append(array_remove(COALESCE(wallets.tags, '{}'), 'top_trader'), 'top_trader')
              ELSE COALESCE(wallets.tags, '{}')
            END
        `, [
          wallet.address,
          wallet.realizedPnl,
          wallet.volume,
          wallet.realizedPnl > 1000000 ? ['top_trader'] : []
        ]);
        seeded++;
      } catch (err) {
        console.error(`[Polymarket] Error seeding wallet ${wallet.address}:`, err);
      }
    }

    console.log(`[Polymarket] Seeded ${seeded} wallets`);
    return seeded;
  }

  /**
   * Get top wallets combining subgraph PnL + our volume tracking
   */
  async getTopWallets(limit = 50) {
    const { rows } = await this.db.query(`
      SELECT 
        address, 
        total_trades, 
        total_volume, 
        win_count, 
        loss_count, 
        realized_pnl,
        tags,
        CASE WHEN (win_count + loss_count) > 0 
             THEN win_count::float / (win_count + loss_count) 
             ELSE 0 END as win_rate,
        last_active
      FROM wallets
      ORDER BY 
        CASE WHEN realized_pnl > 0 THEN realized_pnl ELSE 0 END DESC,
        total_volume DESC
      LIMIT $1
    `, [limit]);

    return rows;
  }
}
