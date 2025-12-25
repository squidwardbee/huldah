import { Pool } from 'pg';

/**
 * Feature Extractor for Insider Detection ML Model
 * 
 * Extracts features at two levels:
 * 1. Trade-level: Features for a specific trade event
 * 2. Wallet-level: Aggregate features for a wallet
 */

export interface TradeFeatures {
  // Identifiers (not used in model, but needed for joining)
  trade_id: number;
  wallet_address: string;
  condition_id: string;
  
  // Wallet context features
  wallet_age_days: number;
  wallet_total_trades: number;
  wallet_total_volume: number;
  wallet_markets_traded: number;
  wallet_market_concentration: number;  // Herfindahl index 0-1
  wallet_avg_trade_size: number;
  wallet_win_rate: number;
  
  // Trade-specific features
  trade_size_usd: number;
  trade_size_vs_wallet_avg: number;  // Ratio of this trade to wallet avg
  odds_at_trade: number;  // Price when trading (0-1)
  is_buying_underdog: boolean;  // Betting on <30% odds
  hours_to_resolution: number | null;
  is_final_24h: boolean;  // Trade in last 24h before resolution
  position_vs_liquidity: number;  // Trade size / market liquidity
  is_new_market_for_wallet: boolean;
  is_single_market_wallet: boolean;
  
  // Outcome (for training, null for inference)
  outcome_correct: boolean | null;
  
  // Proxy label (computed from outcome + context)
  is_suspicious: boolean | null;
}

export interface WalletFeatures {
  address: string;
  
  // Activity metrics
  age_days: number;
  total_trades: number;
  total_volume: number;
  markets_traded: number;
  market_concentration: number;
  avg_trade_size: number;
  
  // Performance metrics
  win_rate: number;
  low_odds_win_rate: number;
  low_odds_wins: number;
  low_odds_attempts: number;
  
  // Timing metrics
  avg_hours_to_resolution: number | null;
  final_24h_trade_rate: number;  // % of trades in final 24h
  final_24h_win_rate: number;
  
  // Behavioral metrics
  single_market_focus: boolean;
  contrarian_rate: number;  // How often betting against crowd
  
  // Proxy label
  is_suspicious: boolean;
}

export class FeatureExtractor {
  private db: Pool;

  constructor(db: Pool) {
    this.db = db;
  }

  /**
   * Extract features for all trades (for training data export)
   */
  async extractAllTradeFeatures(): Promise<TradeFeatures[]> {
    console.log('[ML] Extracting trade features for training...');

    const { rows } = await this.db.query(`
      WITH wallet_stats AS (
        SELECT 
          address,
          EXTRACT(EPOCH FROM (NOW() - first_seen)) / 86400 as age_days,
          total_trades,
          total_volume,
          COALESCE(markets_traded, 1) as markets_traded,
          COALESCE(market_concentration, 1) as market_concentration,
          COALESCE(total_volume / NULLIF(total_trades, 0), 0) as avg_trade_size,
          CASE WHEN (win_count + loss_count) > 0 
               THEN win_count::float / (win_count + loss_count) 
               ELSE 0.5 END as win_rate
        FROM wallets
        WHERE total_trades > 0
      ),
      trade_market_info AS (
        SELECT 
          wt.id as trade_id,
          wt.wallet_address,
          wt.condition_id,
          wt.usd_value,
          wt.price as trade_price,
          wt.side,
          wt.timestamp as trade_time,
          m.resolution_time,
          m.liquidity,
          m.outcome_yes_price,
          m.resolution_outcome,
          EXTRACT(EPOCH FROM (m.resolution_time - wt.timestamp)) / 3600 as hours_to_resolution
        FROM whale_trades wt
        LEFT JOIN markets m ON wt.condition_id = m.condition_id
        WHERE wt.condition_id IS NOT NULL
      ),
      wallet_market_counts AS (
        SELECT 
          wallet_address,
          condition_id,
          COUNT(*) as trades_in_market,
          MIN(timestamp) as first_trade_in_market
        FROM whale_trades
        WHERE condition_id IS NOT NULL
        GROUP BY wallet_address, condition_id
      )
      SELECT 
        tmi.trade_id,
        tmi.wallet_address,
        tmi.condition_id,
        
        -- Wallet features
        COALESCE(ws.age_days, 0) as wallet_age_days,
        COALESCE(ws.total_trades, 1) as wallet_total_trades,
        COALESCE(ws.total_volume, 0) as wallet_total_volume,
        COALESCE(ws.markets_traded, 1) as wallet_markets_traded,
        COALESCE(ws.market_concentration, 1) as wallet_market_concentration,
        COALESCE(ws.avg_trade_size, 0) as wallet_avg_trade_size,
        COALESCE(ws.win_rate, 0.5) as wallet_win_rate,
        
        -- Trade features
        COALESCE(tmi.usd_value, 0) as trade_size_usd,
        CASE WHEN ws.avg_trade_size > 0 
             THEN tmi.usd_value / ws.avg_trade_size 
             ELSE 1 END as trade_size_vs_wallet_avg,
        COALESCE(tmi.trade_price, 0.5) as odds_at_trade,
        (tmi.trade_price < 0.30 AND tmi.side = 'BUY') as is_buying_underdog,
        tmi.hours_to_resolution,
        (tmi.hours_to_resolution IS NOT NULL AND tmi.hours_to_resolution < 24) as is_final_24h,
        CASE WHEN tmi.liquidity > 0 
             THEN tmi.usd_value / tmi.liquidity 
             ELSE 0 END as position_vs_liquidity,
        (wmc.trades_in_market = 1 AND wmc.first_trade_in_market = tmi.trade_time) as is_new_market_for_wallet,
        (ws.markets_traded <= 3) as is_single_market_wallet,
        
        -- Outcome (for resolved markets)
        CASE 
          WHEN tmi.resolution_outcome IS NULL THEN NULL
          WHEN tmi.side = 'BUY' AND tmi.resolution_outcome = 1 THEN true
          WHEN tmi.side = 'SELL' AND tmi.resolution_outcome = 0 THEN true
          ELSE false
        END as outcome_correct,
        
        -- Proxy label: suspicious if won on low odds or in final 24h
        CASE 
          WHEN tmi.resolution_outcome IS NULL THEN NULL
          -- Won on <25% odds
          WHEN tmi.trade_price < 0.25 
               AND tmi.side = 'BUY' 
               AND tmi.resolution_outcome = 1 THEN true
          -- Won in final 24h with significant size
          WHEN tmi.hours_to_resolution < 24 
               AND tmi.usd_value > 5000
               AND ((tmi.side = 'BUY' AND tmi.resolution_outcome = 1) 
                    OR (tmi.side = 'SELL' AND tmi.resolution_outcome = 0)) THEN true
          -- New wallet, single market, large bet, won
          WHEN ws.age_days < 30 
               AND ws.markets_traded <= 2 
               AND tmi.usd_value > 10000
               AND ((tmi.side = 'BUY' AND tmi.resolution_outcome = 1) 
                    OR (tmi.side = 'SELL' AND tmi.resolution_outcome = 0)) THEN true
          ELSE false
        END as is_suspicious
        
      FROM trade_market_info tmi
      LEFT JOIN wallet_stats ws ON tmi.wallet_address = ws.address
      LEFT JOIN wallet_market_counts wmc ON tmi.wallet_address = wmc.wallet_address 
                                         AND tmi.condition_id = wmc.condition_id
      ORDER BY tmi.trade_id
    `);

    console.log(`[ML] Extracted ${rows.length} trade features`);
    return rows;
  }

  /**
   * Extract features for wallet-level prediction
   */
  async extractWalletFeatures(): Promise<WalletFeatures[]> {
    console.log('[ML] Extracting wallet features...');

    const { rows } = await this.db.query(`
      WITH wallet_trade_stats AS (
        SELECT 
          wt.wallet_address,
          COUNT(*) as total_whale_trades,
          COUNT(DISTINCT wt.condition_id) as unique_markets,
          AVG(wt.usd_value) as avg_trade_size,
          -- Final 24h stats
          COUNT(*) FILTER (WHERE wt.hours_to_resolution < 24) as final_24h_trades,
          COUNT(*) FILTER (
            WHERE wt.hours_to_resolution < 24 
            AND wt.outcome_correct = true
          ) as final_24h_wins
        FROM whale_trades wt
        GROUP BY wt.wallet_address
      ),
      low_odds_stats AS (
        SELECT 
          wt.wallet_address,
          COUNT(*) FILTER (WHERE wt.price < 0.30 AND wt.side = 'BUY') as low_odds_attempts,
          COUNT(*) FILTER (
            WHERE wt.price < 0.30 
            AND wt.side = 'BUY' 
            AND wt.outcome_correct = true
          ) as low_odds_wins
        FROM whale_trades wt
        GROUP BY wt.wallet_address
      )
      SELECT 
        w.address,
        EXTRACT(EPOCH FROM (NOW() - w.first_seen)) / 86400 as age_days,
        w.total_trades,
        w.total_volume,
        COALESCE(w.markets_traded, wts.unique_markets, 1) as markets_traded,
        COALESCE(w.market_concentration, 1) as market_concentration,
        COALESCE(wts.avg_trade_size, w.total_volume / NULLIF(w.total_trades, 0), 0) as avg_trade_size,
        
        -- Performance
        CASE WHEN (w.win_count + w.loss_count) > 0 
             THEN w.win_count::float / (w.win_count + w.loss_count) 
             ELSE 0.5 END as win_rate,
        COALESCE(w.low_odds_win_rate, 0) as low_odds_win_rate,
        COALESCE(los.low_odds_wins, 0) as low_odds_wins,
        COALESCE(los.low_odds_attempts, 0) as low_odds_attempts,
        
        -- Timing
        w.avg_time_to_resolution_hours as avg_hours_to_resolution,
        CASE WHEN wts.total_whale_trades > 0 
             THEN wts.final_24h_trades::float / wts.total_whale_trades 
             ELSE 0 END as final_24h_trade_rate,
        CASE WHEN wts.final_24h_trades > 0 
             THEN wts.final_24h_wins::float / wts.final_24h_trades 
             ELSE 0 END as final_24h_win_rate,
        
        -- Behavioral
        COALESCE(w.single_market_wallet, false) as single_market_focus,
        0 as contrarian_rate,  -- TODO: compute this
        
        -- Proxy label: suspicious wallet
        (
          -- High low-odds win rate with enough attempts
          (COALESCE(los.low_odds_wins, 0) >= 2 
           AND COALESCE(w.low_odds_win_rate, 0) > 0.5)
          OR
          -- High final 24h win rate
          (wts.final_24h_trades >= 3 
           AND wts.final_24h_wins::float / NULLIF(wts.final_24h_trades, 0) > 0.7)
          OR
          -- New wallet, single market, large volume
          (EXTRACT(EPOCH FROM (NOW() - w.first_seen)) / 86400 < 30
           AND COALESCE(w.markets_traded, 1) <= 2
           AND w.total_volume > 50000)
        ) as is_suspicious
        
      FROM wallets w
      LEFT JOIN wallet_trade_stats wts ON w.address = wts.wallet_address
      LEFT JOIN low_odds_stats los ON w.address = los.wallet_address
      WHERE w.total_trades > 0
      ORDER BY w.total_volume DESC
    `);

    console.log(`[ML] Extracted ${rows.length} wallet features`);
    return rows;
  }

  /**
   * Extract features for a single trade (for real-time inference)
   */
  async extractTradeFeaturesSingle(
    walletAddress: string,
    conditionId: string,
    tradePrice: number,
    tradeSizeUsd: number,
    side: 'BUY' | 'SELL'
  ): Promise<Partial<TradeFeatures>> {
    // Get wallet stats
    const walletResult = await this.db.query(`
      SELECT 
        EXTRACT(EPOCH FROM (NOW() - first_seen)) / 86400 as age_days,
        total_trades,
        total_volume,
        COALESCE(markets_traded, 1) as markets_traded,
        COALESCE(market_concentration, 1) as market_concentration,
        COALESCE(total_volume / NULLIF(total_trades, 0), 0) as avg_trade_size,
        CASE WHEN (win_count + loss_count) > 0 
             THEN win_count::float / (win_count + loss_count) 
             ELSE 0.5 END as win_rate
      FROM wallets
      WHERE address = $1
    `, [walletAddress]);

    const wallet = walletResult.rows[0] || {
      age_days: 0,
      total_trades: 0,
      total_volume: 0,
      markets_traded: 1,
      market_concentration: 1,
      avg_trade_size: 0,
      win_rate: 0.5
    };

    // Get market stats
    const marketResult = await this.db.query(`
      SELECT 
        liquidity,
        outcome_yes_price,
        end_date,
        EXTRACT(EPOCH FROM (end_date - NOW())) / 3600 as hours_to_resolution
      FROM markets
      WHERE condition_id = $1
    `, [conditionId]);

    const market = marketResult.rows[0] || {
      liquidity: 0,
      hours_to_resolution: null
    };

    // Check if first trade in this market
    const priorTradesResult = await this.db.query(`
      SELECT COUNT(*) as count FROM whale_trades
      WHERE wallet_address = $1 AND condition_id = $2
    `, [walletAddress, conditionId]);

    const isNewMarket = parseInt(priorTradesResult.rows[0]?.count || '0') === 0;

    return {
      wallet_address: walletAddress,
      condition_id: conditionId,
      
      wallet_age_days: wallet.age_days,
      wallet_total_trades: wallet.total_trades,
      wallet_total_volume: wallet.total_volume,
      wallet_markets_traded: wallet.markets_traded,
      wallet_market_concentration: wallet.market_concentration,
      wallet_avg_trade_size: wallet.avg_trade_size,
      wallet_win_rate: wallet.win_rate,
      
      trade_size_usd: tradeSizeUsd,
      trade_size_vs_wallet_avg: wallet.avg_trade_size > 0 
        ? tradeSizeUsd / wallet.avg_trade_size 
        : 1,
      odds_at_trade: tradePrice,
      is_buying_underdog: tradePrice < 0.30 && side === 'BUY',
      hours_to_resolution: market.hours_to_resolution,
      is_final_24h: market.hours_to_resolution != null && market.hours_to_resolution < 24,
      position_vs_liquidity: market.liquidity > 0 
        ? tradeSizeUsd / parseFloat(market.liquidity) 
        : 0,
      is_new_market_for_wallet: isNewMarket,
      is_single_market_wallet: wallet.markets_traded <= 3,
      
      outcome_correct: null,
      is_suspicious: null
    };
  }
}


