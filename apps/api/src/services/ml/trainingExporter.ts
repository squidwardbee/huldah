import { Pool } from 'pg';
import { createWriteStream } from 'fs';
import { FeatureExtractor, TradeFeatures, WalletFeatures } from './featureExtractor.js';

/**
 * Training Data Exporter
 * 
 * Exports feature data to CSV for training ML models in Python
 */

export class TrainingExporter {
  private db: Pool;
  private featureExtractor: FeatureExtractor;

  constructor(db: Pool) {
    this.db = db;
    this.featureExtractor = new FeatureExtractor(db);
  }

  /**
   * Export trade-level features to CSV
   */
  async exportTradeFeatures(outputPath: string): Promise<number> {
    console.log(`[ML Export] Exporting trade features to ${outputPath}...`);

    const features = await this.featureExtractor.extractAllTradeFeatures();
    
    // Filter to only resolved trades with labels
    const labeled = features.filter(f => f.is_suspicious !== null);
    
    if (labeled.length === 0) {
      console.log('[ML Export] No labeled data available');
      return 0;
    }

    const headers = [
      'trade_id',
      'wallet_address',
      'condition_id',
      'wallet_age_days',
      'wallet_total_trades',
      'wallet_total_volume',
      'wallet_markets_traded',
      'wallet_market_concentration',
      'wallet_avg_trade_size',
      'wallet_win_rate',
      'trade_size_usd',
      'trade_size_vs_wallet_avg',
      'odds_at_trade',
      'is_buying_underdog',
      'hours_to_resolution',
      'is_final_24h',
      'position_vs_liquidity',
      'is_new_market_for_wallet',
      'is_single_market_wallet',
      'outcome_correct',
      'is_suspicious'
    ];

    const stream = createWriteStream(outputPath);
    stream.write(headers.join(',') + '\n');

    for (const row of labeled) {
      const values = [
        row.trade_id,
        `"${row.wallet_address}"`,
        `"${row.condition_id}"`,
        row.wallet_age_days?.toFixed(2) ?? '',
        row.wallet_total_trades ?? '',
        row.wallet_total_volume?.toFixed(2) ?? '',
        row.wallet_markets_traded ?? '',
        row.wallet_market_concentration?.toFixed(4) ?? '',
        row.wallet_avg_trade_size?.toFixed(2) ?? '',
        row.wallet_win_rate?.toFixed(4) ?? '',
        row.trade_size_usd?.toFixed(2) ?? '',
        row.trade_size_vs_wallet_avg?.toFixed(4) ?? '',
        row.odds_at_trade?.toFixed(4) ?? '',
        row.is_buying_underdog ? 1 : 0,
        row.hours_to_resolution?.toFixed(2) ?? '',
        row.is_final_24h ? 1 : 0,
        row.position_vs_liquidity?.toFixed(6) ?? '',
        row.is_new_market_for_wallet ? 1 : 0,
        row.is_single_market_wallet ? 1 : 0,
        row.outcome_correct === null ? '' : (row.outcome_correct ? 1 : 0),
        row.is_suspicious ? 1 : 0
      ];
      stream.write(values.join(',') + '\n');
    }

    stream.end();
    
    const positives = labeled.filter(f => f.is_suspicious).length;
    console.log(`[ML Export] Exported ${labeled.length} trades (${positives} suspicious, ${labeled.length - positives} normal)`);
    
    return labeled.length;
  }

  /**
   * Export wallet-level features to CSV
   */
  async exportWalletFeatures(outputPath: string): Promise<number> {
    console.log(`[ML Export] Exporting wallet features to ${outputPath}...`);

    const features = await this.featureExtractor.extractWalletFeatures();

    const headers = [
      'address',
      'age_days',
      'total_trades',
      'total_volume',
      'markets_traded',
      'market_concentration',
      'avg_trade_size',
      'win_rate',
      'low_odds_win_rate',
      'low_odds_wins',
      'low_odds_attempts',
      'avg_hours_to_resolution',
      'final_24h_trade_rate',
      'final_24h_win_rate',
      'single_market_focus',
      'contrarian_rate',
      'is_suspicious'
    ];

    const stream = createWriteStream(outputPath);
    stream.write(headers.join(',') + '\n');

    for (const row of features) {
      const values = [
        `"${row.address}"`,
        row.age_days?.toFixed(2) ?? '',
        row.total_trades ?? '',
        row.total_volume?.toFixed(2) ?? '',
        row.markets_traded ?? '',
        row.market_concentration?.toFixed(4) ?? '',
        row.avg_trade_size?.toFixed(2) ?? '',
        row.win_rate?.toFixed(4) ?? '',
        row.low_odds_win_rate?.toFixed(4) ?? '',
        row.low_odds_wins ?? '',
        row.low_odds_attempts ?? '',
        row.avg_hours_to_resolution?.toFixed(2) ?? '',
        row.final_24h_trade_rate?.toFixed(4) ?? '',
        row.final_24h_win_rate?.toFixed(4) ?? '',
        row.single_market_focus ? 1 : 0,
        row.contrarian_rate?.toFixed(4) ?? '',
        row.is_suspicious ? 1 : 0
      ];
      stream.write(values.join(',') + '\n');
    }

    stream.end();
    
    const positives = features.filter(f => f.is_suspicious).length;
    console.log(`[ML Export] Exported ${features.length} wallets (${positives} suspicious, ${features.length - positives} normal)`);
    
    return features.length;
  }

  /**
   * Get training data statistics
   */
  async getTrainingStats(): Promise<{
    totalTrades: number;
    labeledTrades: number;
    suspiciousTrades: number;
    totalWallets: number;
    suspiciousWallets: number;
  }> {
    const tradeFeatures = await this.featureExtractor.extractAllTradeFeatures();
    const walletFeatures = await this.featureExtractor.extractWalletFeatures();

    const labeled = tradeFeatures.filter(f => f.is_suspicious !== null);

    return {
      totalTrades: tradeFeatures.length,
      labeledTrades: labeled.length,
      suspiciousTrades: labeled.filter(f => f.is_suspicious).length,
      totalWallets: walletFeatures.length,
      suspiciousWallets: walletFeatures.filter(f => f.is_suspicious).length
    };
  }
}

