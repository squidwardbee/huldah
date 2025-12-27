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

interface Wallet24hData {
  address: string;
  pnl24h: number;
  volume24h: number;
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
  async fetchTopWalletsByPnL(limit = 50): Promise<WalletPnL[]> {
    console.log('[Polymarket] Fetching top wallets by PnL from data API...');

    try {
      // Max limit per request is 50
      const { data } = await axios.get<LeaderboardEntry[]>(
        `${POLYMARKET_DATA_API}/v1/leaderboard`,
        {
          params: {
            timePeriod: 'ALL',
            orderBy: 'PNL',
            limit: Math.min(limit, 50),
            offset: 0,
            category: 'OVERALL'
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

  /**
   * Fetch 24h leaderboard data from Polymarket's data API
   * and update the pnl_24h column in the wallets table.
   * Also fetches all-time data to update realized_pnl and total_volume.
   */
  async sync24hPnL(): Promise<number> {
    console.log('[Polymarket] Syncing PnL from leaderboard API...');

    try {
      // Fetch 24h PnL leaderboard (top wallets by 24h PnL)
      // Valid timePeriod values: 'DAY', 'WEEK', 'MONTH', 'ALL' (uppercase per API docs)
      // Max limit is 50, so we fetch 2 pages
      const [dayData1, dayData2, allTimeData1, allTimeData2] = await Promise.all([
        axios.get<LeaderboardEntry[]>(`${POLYMARKET_DATA_API}/v1/leaderboard`, {
          params: { timePeriod: 'DAY', orderBy: 'PNL', limit: 50, offset: 0, category: 'OVERALL' }
        }),
        axios.get<LeaderboardEntry[]>(`${POLYMARKET_DATA_API}/v1/leaderboard`, {
          params: { timePeriod: 'DAY', orderBy: 'PNL', limit: 50, offset: 50, category: 'OVERALL' }
        }),
        axios.get<LeaderboardEntry[]>(`${POLYMARKET_DATA_API}/v1/leaderboard`, {
          params: { timePeriod: 'ALL', orderBy: 'PNL', limit: 50, offset: 0, category: 'OVERALL' }
        }),
        axios.get<LeaderboardEntry[]>(`${POLYMARKET_DATA_API}/v1/leaderboard`, {
          params: { timePeriod: 'ALL', orderBy: 'PNL', limit: 50, offset: 50, category: 'OVERALL' }
        })
      ]);

      const dayData = { data: [...dayData1.data, ...dayData2.data] };
      const allTimeData = { data: [...allTimeData1.data, ...allTimeData2.data] };

      // Build a map of all-time data by address (lowercase for consistent lookup)
      const allTimeMap = new Map<string, { pnl: number; vol: number }>();
      for (const entry of allTimeData.data) {
        allTimeMap.set(entry.proxyWallet.toLowerCase(), { pnl: entry.pnl, vol: entry.vol });
      }

      const wallets: Wallet24hData[] = dayData.data.map(entry => ({
        address: entry.proxyWallet.toLowerCase(),
        pnl24h: entry.pnl,
        volume24h: entry.vol,
      }));

      console.log(`[Polymarket] Found ${wallets.length} wallets with 24h data`);
      if (wallets[0]) {
        console.log(`[Polymarket] Top 24h PnL: ${wallets[0].address.slice(0, 10)}... with $${wallets[0].pnl24h.toLocaleString()}`);
      }

      // For 24h wallets not in all-time top, fetch their individual all-time data
      const walletsNeedingAllTime = wallets.filter(w => !allTimeMap.has(w.address));
      if (walletsNeedingAllTime.length > 0) {
        console.log(`[Polymarket] Fetching all-time data for ${walletsNeedingAllTime.length} additional wallets...`);
        // Fetch in batches to avoid overwhelming the API - prioritize top 24h wallets
        const toFetch = walletsNeedingAllTime.slice(0, 30);
        console.log(`[Polymarket] Fetching all-time data for top ${toFetch.length} wallets...`);
        for (const wallet of toFetch) {
          try {
            const { data } = await axios.get<LeaderboardEntry[]>(`${POLYMARKET_DATA_API}/v1/leaderboard`, {
              params: { timePeriod: 'ALL', user: wallet.address, limit: 1, category: 'OVERALL' }
            });
            if (data.length > 0) {
              allTimeMap.set(wallet.address.toLowerCase(), { pnl: data[0].pnl, vol: data[0].vol });
              console.log(`[Polymarket]   ${wallet.address.slice(0, 10)}... all-time PnL: $${data[0].pnl.toLocaleString()}`);
            }
          } catch (err) {
            // Individual lookup failed, continue
          }
        }
      }

      // Upsert wallets with 24h PnL data (insert if not exists)
      let updated = 0;
      for (const wallet of wallets) {
        try {
          const allTime = allTimeMap.get(wallet.address);
          await this.db.query(`
            INSERT INTO wallets (address, pnl_24h, volume_24h, realized_pnl, total_volume, first_seen, last_active)
            VALUES ($1, $2::decimal, $3::decimal, COALESCE($4::decimal, 0), COALESCE($5::decimal, 0), NOW(), NOW())
            ON CONFLICT (address) DO UPDATE SET
              pnl_24h = $2::decimal,
              volume_24h = $3::decimal,
              realized_pnl = COALESCE($4::decimal, wallets.realized_pnl),
              total_volume = GREATEST(wallets.total_volume, COALESCE($5::decimal, 0)),
              last_active = NOW()
          `, [
            wallet.address,
            wallet.pnl24h,
            wallet.volume24h,
            allTime?.pnl ?? null,
            allTime?.vol ?? null
          ]);
          updated++;
        } catch (err) {
          console.error(`[Polymarket] Error upserting wallet ${wallet.address.slice(0, 10)}...:`, err);
        }
      }

      // Also update all-time wallets that might not be in the 24h list
      for (const entry of allTimeData.data) {
        try {
          await this.db.query(`
            UPDATE wallets
            SET realized_pnl = $2,
                total_volume = GREATEST(total_volume, $3)
            WHERE address = $1
          `, [entry.proxyWallet.toLowerCase(), entry.pnl, entry.vol]);
        } catch (err) {
          // Wallet might not exist
        }
      }

      console.log(`[Polymarket] Updated ${updated} wallets with 24h PnL`);
      return updated;
    } catch (err) {
      console.error('[Polymarket] Error syncing PnL:', err);
      return 0;
    }
  }
}
