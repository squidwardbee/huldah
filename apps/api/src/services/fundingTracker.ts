import axios from 'axios';
import { Pool } from 'pg';

const POLYGONSCAN_API = 'https://api.polygonscan.com/api';
const USDC_CONTRACT = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'; // USDC on Polygon
const USDCE_CONTRACT = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359'; // USDC.e bridged

// Known CEX hot wallets (partial list)
const KNOWN_CEX_ADDRESSES: Record<string, string> = {
  '0x28c6c06298d514db089934071355e5743bf21d60': 'Binance',
  '0x21a31ee1afc51d94c2efccaa2092ad1028285549': 'Binance',
  '0xdfd5293d8e347dfe59e90efd55b2956a1343963d': 'Binance',
  '0x5041ed759dd4afc3a72b8192c143f72f4724081a': 'OKX',
  '0x6cc5f688a315f3dc28a7781717a9a798a59fda7b': 'OKX',
  '0x98ec059dc3adfbdd63429454aeb0c990fba4a128': 'Kraken',
  '0xa910f92acdaf488fa6ef02174fb86208ad7722ba': 'Kraken',
  '0x0d0707963952f2fba59dd06f2b425ace40b492fe': 'Gate.io',
  '0x1ab4973a48dc892cd9971ece8e01dcc7688f8f23': 'Bybit',
  '0xf89d7b9c864f589bbf53a82105107622b35eaa40': 'Bybit',
  '0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640': 'Uniswap V3',
};

// Known bridge contracts
const KNOWN_BRIDGES: Record<string, string> = {
  '0xa0c68c638235ee32657e8f720a23cec1bfc77c77': 'Polygon Bridge',
  '0x8484ef722627bf18ca5ae6bcf031c23e6e922b30': 'Polygon Bridge',
  '0x40ec5b33f54e0e8a33a975908c5ba1c14e5bbbdf': 'Polygon Bridge',
};

interface FundingEvent {
  walletAddress: string;
  direction: 'deposit' | 'withdrawal';
  counterparty: string;
  counterpartyType: 'cex' | 'dex' | 'bridge' | 'wallet' | 'unknown';
  amount: number;
  token: string;
  timestamp: Date;
  txHash: string;
}

interface PolygonscanTx {
  hash: string;
  from: string;
  to: string;
  value: string;
  tokenSymbol?: string;
  tokenDecimal?: string;
  timeStamp: string;
}

export class FundingTracker {
  private db: Pool;
  private apiKey: string;
  private isRunning = false;
  private rateLimitDelay = 250; // 4 req/sec for free tier

  constructor(db: Pool, apiKey?: string) {
    this.db = db;
    this.apiKey = apiKey || process.env.POLYGONSCAN_API_KEY || '';
  }

  /**
   * Identify the type of counterparty address
   */
  private identifyCounterpartyType(address: string): { type: string; name: string } {
    const lower = address.toLowerCase();

    if (KNOWN_CEX_ADDRESSES[lower]) {
      return { type: 'cex', name: KNOWN_CEX_ADDRESSES[lower] };
    }

    if (KNOWN_BRIDGES[lower]) {
      return { type: 'bridge', name: KNOWN_BRIDGES[lower] };
    }

    // Could add more heuristics here (contract detection, etc.)
    return { type: 'wallet', name: address };
  }

  /**
   * Fetch USDC transfers for a wallet from Polygonscan
   */
  private async fetchWalletTransfers(walletAddress: string): Promise<PolygonscanTx[]> {
    const allTransfers: PolygonscanTx[] = [];

    for (const contractAddress of [USDC_CONTRACT, USDCE_CONTRACT]) {
      try {
        const { data } = await axios.get(POLYGONSCAN_API, {
          params: {
            module: 'account',
            action: 'tokentx',
            contractaddress: contractAddress,
            address: walletAddress,
            startblock: 0,
            endblock: 99999999,
            sort: 'desc',
            apikey: this.apiKey,
          },
          timeout: 10000,
        });

        if (data.status === '1' && Array.isArray(data.result)) {
          allTransfers.push(...data.result);
        }

        await this.sleep(this.rateLimitDelay);
      } catch (err) {
        console.error(`[FundingTracker] Error fetching transfers for ${walletAddress}:`, err);
      }
    }

    return allTransfers;
  }

  /**
   * Track funding history for a specific wallet
   */
  async trackWalletFunding(walletAddress: string): Promise<FundingEvent[]> {
    const transfers = await this.fetchWalletTransfers(walletAddress);
    const events: FundingEvent[] = [];
    const lowerWallet = walletAddress.toLowerCase();

    for (const tx of transfers) {
      const isDeposit = tx.to.toLowerCase() === lowerWallet;
      const counterpartyAddr = isDeposit ? tx.from : tx.to;
      const { type, name } = this.identifyCounterpartyType(counterpartyAddr);

      const decimals = parseInt(tx.tokenDecimal || '6');
      const amount = parseFloat(tx.value) / Math.pow(10, decimals);

      // Skip very small transfers
      if (amount < 10) continue;

      const event: FundingEvent = {
        walletAddress: walletAddress.toLowerCase(),
        direction: isDeposit ? 'deposit' : 'withdrawal',
        counterparty: name,
        counterpartyType: type as FundingEvent['counterpartyType'],
        amount,
        token: tx.tokenSymbol || 'USDC',
        timestamp: new Date(parseInt(tx.timeStamp) * 1000),
        txHash: tx.hash,
      };

      events.push(event);

      // Store in database
      await this.storeFundingEvent(event);
    }

    // Update wallet totals
    await this.updateWalletFundingTotals(walletAddress);

    return events;
  }

  /**
   * Store a funding event in the database
   */
  private async storeFundingEvent(event: FundingEvent): Promise<void> {
    try {
      await this.db.query(`
        INSERT INTO funding_events (
          wallet_address, direction, counterparty, counterparty_type,
          amount, token, timestamp, tx_hash
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (tx_hash) DO NOTHING
      `, [
        event.walletAddress,
        event.direction,
        event.counterparty,
        event.counterpartyType,
        event.amount,
        event.token,
        event.timestamp,
        event.txHash,
      ]);
    } catch (err) {
      // Ignore duplicate key errors
      if (!(err instanceof Error && err.message.includes('duplicate'))) {
        console.error('[FundingTracker] Error storing event:', err);
      }
    }
  }

  /**
   * Update wallet's total deposited/withdrawn amounts
   */
  private async updateWalletFundingTotals(walletAddress: string): Promise<void> {
    await this.db.query(`
      UPDATE wallets w
      SET
        total_deposited = COALESCE((
          SELECT SUM(amount) FROM funding_events
          WHERE wallet_address = $1 AND direction = 'deposit'
        ), 0),
        total_withdrawn = COALESCE((
          SELECT SUM(amount) FROM funding_events
          WHERE wallet_address = $1 AND direction = 'withdrawal'
        ), 0)
      WHERE w.address = $1
    `, [walletAddress.toLowerCase()]);
  }

  /**
   * Get the initial funding source for a wallet
   */
  async getInitialFundingSource(walletAddress: string): Promise<{
    source: string;
    type: string;
    amount: number;
    date: Date;
  } | null> {
    const { rows } = await this.db.query(`
      SELECT counterparty, counterparty_type, amount, timestamp
      FROM funding_events
      WHERE wallet_address = $1 AND direction = 'deposit'
      ORDER BY timestamp ASC
      LIMIT 1
    `, [walletAddress.toLowerCase()]);

    if (rows.length === 0) return null;

    return {
      source: rows[0].counterparty,
      type: rows[0].counterparty_type,
      amount: parseFloat(rows[0].amount),
      date: rows[0].timestamp,
    };
  }

  /**
   * Find wallets funded from the same source
   */
  async findWalletsWithSameFundingSource(source: string): Promise<string[]> {
    const { rows } = await this.db.query(`
      SELECT DISTINCT wallet_address
      FROM funding_events
      WHERE counterparty = $1 AND direction = 'deposit'
    `, [source]);

    return rows.map(r => r.wallet_address);
  }

  /**
   * Backfill funding data for existing high-value wallets
   */
  async backfillExistingWallets(minVolume = 10000, limit = 100): Promise<void> {
    if (this.isRunning) {
      console.log('[FundingTracker] Backfill already in progress');
      return;
    }

    this.isRunning = true;
    console.log(`[FundingTracker] Starting backfill for wallets with volume > $${minVolume}`);

    try {
      // Get wallets that haven't been tracked yet
      const { rows: wallets } = await this.db.query(`
        SELECT w.address
        FROM wallets w
        LEFT JOIN (
          SELECT wallet_address, COUNT(*) as event_count
          FROM funding_events
          GROUP BY wallet_address
        ) fe ON w.address = fe.wallet_address
        WHERE w.total_volume >= $1
          AND COALESCE(fe.event_count, 0) = 0
        ORDER BY w.total_volume DESC
        LIMIT $2
      `, [minVolume, limit]);

      console.log(`[FundingTracker] Found ${wallets.length} wallets to process`);

      let processed = 0;
      for (const wallet of wallets) {
        try {
          const events = await this.trackWalletFunding(wallet.address);
          processed++;
          console.log(`[FundingTracker] Processed ${processed}/${wallets.length}: ${wallet.address} (${events.length} events)`);
        } catch (err) {
          console.error(`[FundingTracker] Error processing ${wallet.address}:`, err);
        }

        // Rate limiting
        await this.sleep(500);
      }

      console.log(`[FundingTracker] Backfill complete: ${processed} wallets processed`);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Get funding summary for a wallet
   */
  async getFundingSummary(walletAddress: string): Promise<{
    totalDeposited: number;
    totalWithdrawn: number;
    netFunding: number;
    primarySource: string | null;
    primarySourceType: string | null;
    depositCount: number;
    withdrawalCount: number;
  }> {
    const { rows } = await this.db.query(`
      SELECT
        COALESCE(SUM(CASE WHEN direction = 'deposit' THEN amount ELSE 0 END), 0) as total_deposited,
        COALESCE(SUM(CASE WHEN direction = 'withdrawal' THEN amount ELSE 0 END), 0) as total_withdrawn,
        COUNT(*) FILTER (WHERE direction = 'deposit') as deposit_count,
        COUNT(*) FILTER (WHERE direction = 'withdrawal') as withdrawal_count
      FROM funding_events
      WHERE wallet_address = $1
    `, [walletAddress.toLowerCase()]);

    // Get primary funding source
    const { rows: sources } = await this.db.query(`
      SELECT counterparty, counterparty_type, SUM(amount) as total
      FROM funding_events
      WHERE wallet_address = $1 AND direction = 'deposit'
      GROUP BY counterparty, counterparty_type
      ORDER BY total DESC
      LIMIT 1
    `, [walletAddress.toLowerCase()]);

    const stats = rows[0];
    return {
      totalDeposited: parseFloat(stats.total_deposited),
      totalWithdrawn: parseFloat(stats.total_withdrawn),
      netFunding: parseFloat(stats.total_deposited) - parseFloat(stats.total_withdrawn),
      primarySource: sources[0]?.counterparty || null,
      primarySourceType: sources[0]?.counterparty_type || null,
      depositCount: parseInt(stats.deposit_count),
      withdrawalCount: parseInt(stats.withdrawal_count),
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Start scheduled tracking for new wallets
   */
  startScheduled(intervalMs = 30 * 60 * 1000): void {
    // Run backfill on startup
    this.backfillExistingWallets();

    // Then run periodically
    setInterval(() => {
      this.backfillExistingWallets(10000, 50);
    }, intervalMs);

    console.log(`[FundingTracker] Scheduled to run every ${intervalMs / 1000 / 60} minutes`);
  }
}
