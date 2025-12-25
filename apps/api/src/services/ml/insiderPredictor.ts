import { Pool } from 'pg';
import { FeatureExtractor, TradeFeatures } from './featureExtractor.js';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

/**
 * Insider Predictor
 * 
 * Uses trained model (or rule-based fallback) to predict insider probability
 * for new trades in real-time.
 */

interface ModelInfo {
  features: string[];
  feature_importance: Record<string, number>;
  threshold: number;
}

interface DecisionRule {
  feature: string;
  importance: number;
  description: string;
}

interface PredictionResult {
  insider_probability: number;
  is_suspicious: boolean;
  confidence: 'low' | 'medium' | 'high';
  top_signals: string[];
  features_used: Record<string, number>;
}

export class InsiderPredictor {
  private db: Pool;
  private featureExtractor: FeatureExtractor;
  private modelInfo: ModelInfo | null = null;
  private decisionRules: DecisionRule[] = [];
  private modelLoaded = false;

  constructor(db: Pool) {
    this.db = db;
    this.featureExtractor = new FeatureExtractor(db);
    this.loadModel();
  }

  /**
   * Load model info and decision rules from disk
   */
  private loadModel(): void {
    try {
      const __dirname = dirname(fileURLToPath(import.meta.url));
      const modelDir = join(__dirname, '../../ml/model/trade_model');

      const modelInfoPath = join(modelDir, 'model_info.json');
      const rulesPath = join(modelDir, 'decision_rules.json');

      if (existsSync(modelInfoPath)) {
        this.modelInfo = JSON.parse(readFileSync(modelInfoPath, 'utf-8'));
        console.log('[ML] Loaded model info');
      }

      if (existsSync(rulesPath)) {
        this.decisionRules = JSON.parse(readFileSync(rulesPath, 'utf-8'));
        console.log('[ML] Loaded decision rules');
        this.modelLoaded = true;
      }
    } catch (err) {
      console.log('[ML] No trained model found, using rule-based fallback');
    }
  }

  /**
   * Predict insider probability for a trade
   */
  async predictTrade(
    walletAddress: string,
    conditionId: string,
    tradePrice: number,
    tradeSizeUsd: number,
    side: 'BUY' | 'SELL'
  ): Promise<PredictionResult> {
    // Extract features
    const features = await this.featureExtractor.extractTradeFeaturesSingle(
      walletAddress,
      conditionId,
      tradePrice,
      tradeSizeUsd,
      side
    );

    // Use trained model if available, otherwise use rule-based scoring
    if (this.modelLoaded && this.modelInfo) {
      return this.predictWithModel(features);
    } else {
      return this.predictWithRules(features);
    }
  }

  /**
   * Rule-based prediction (fallback when no model is trained)
   * Based on signals from the Polymarket insider research
   */
  private predictWithRules(features: Partial<TradeFeatures>): PredictionResult {
    let score = 0;
    const signals: string[] = [];
    const featureValues: Record<string, number> = {};

    // Signal 1: New wallet (weight: 15)
    if (features.wallet_age_days !== undefined) {
      featureValues['wallet_age_days'] = features.wallet_age_days;
      if (features.wallet_age_days < 7) {
        score += 15;
        signals.push('Very new wallet (<7 days)');
      } else if (features.wallet_age_days < 30) {
        score += 10;
        signals.push('New wallet (<30 days)');
      }
    }

    // Signal 2: Single market focus (weight: 20)
    if (features.is_single_market_wallet) {
      score += 20;
      signals.push('Trades only 1-3 markets');
      featureValues['is_single_market_wallet'] = 1;
    }

    // Signal 3: Buying underdog (weight: 15)
    if (features.is_buying_underdog) {
      score += 15;
      signals.push('Betting on <30% odds');
      featureValues['is_buying_underdog'] = 1;
    }

    // Signal 4: Large trade vs wallet average (weight: 15)
    if (features.trade_size_vs_wallet_avg !== undefined) {
      featureValues['trade_size_vs_wallet_avg'] = features.trade_size_vs_wallet_avg;
      if (features.trade_size_vs_wallet_avg > 5) {
        score += 15;
        signals.push('Trade 5x larger than average');
      } else if (features.trade_size_vs_wallet_avg > 2) {
        score += 8;
        signals.push('Trade 2x larger than average');
      }
    }

    // Signal 5: Trading in final 24h (weight: 20)
    if (features.is_final_24h) {
      score += 20;
      signals.push('Trading in final 24 hours');
      featureValues['is_final_24h'] = 1;
    }

    // Signal 6: First trade in this market (weight: 10)
    if (features.is_new_market_for_wallet) {
      score += 10;
      signals.push('First trade in this market');
      featureValues['is_new_market_for_wallet'] = 1;
    }

    // Signal 7: Large position vs liquidity (weight: 10)
    if (features.position_vs_liquidity !== undefined) {
      featureValues['position_vs_liquidity'] = features.position_vs_liquidity;
      if (features.position_vs_liquidity > 0.1) {
        score += 10;
        signals.push('Position >10% of market liquidity');
      } else if (features.position_vs_liquidity > 0.05) {
        score += 5;
        signals.push('Position >5% of market liquidity');
      }
    }

    // Signal 8: Large absolute trade size (weight: 10)
    if (features.trade_size_usd !== undefined) {
      featureValues['trade_size_usd'] = features.trade_size_usd;
      if (features.trade_size_usd > 50000) {
        score += 10;
        signals.push('Very large trade (>$50k)');
      } else if (features.trade_size_usd > 10000) {
        score += 5;
        signals.push('Large trade (>$10k)');
      }
    }

    // Normalize score to 0-1 probability
    const probability = Math.min(score / 100, 1);
    
    // Determine confidence based on number of signals
    let confidence: 'low' | 'medium' | 'high' = 'low';
    if (signals.length >= 4) confidence = 'high';
    else if (signals.length >= 2) confidence = 'medium';

    return {
      insider_probability: probability,
      is_suspicious: probability >= 0.5,
      confidence,
      top_signals: signals.slice(0, 5),
      features_used: featureValues
    };
  }

  /**
   * Model-based prediction using feature importance weights
   */
  private predictWithModel(features: Partial<TradeFeatures>): PredictionResult {
    const featureValues: Record<string, number> = {};
    const signals: string[] = [];
    let weightedSum = 0;
    let totalWeight = 0;

    if (!this.modelInfo) {
      return this.predictWithRules(features);
    }

    // Score based on feature importance from trained model
    for (const [feature, importance] of Object.entries(this.modelInfo.feature_importance)) {
      const value = (features as any)[feature];
      if (value !== undefined && value !== null) {
        featureValues[feature] = value;
        
        // Normalize and weight the feature
        let normalizedValue = 0;
        
        // Boolean features
        if (typeof value === 'boolean') {
          normalizedValue = value ? 1 : 0;
          if (value) {
            signals.push(this.getSignalDescription(feature));
          }
        }
        // Numeric features (apply thresholds)
        else if (typeof value === 'number') {
          normalizedValue = this.normalizeFeature(feature, value);
          if (normalizedValue > 0.5) {
            signals.push(this.getSignalDescription(feature, value));
          }
        }
        
        weightedSum += normalizedValue * importance;
        totalWeight += importance;
      }
    }

    // Calculate probability
    const probability = totalWeight > 0 ? Math.min(weightedSum / totalWeight, 1) : 0;
    
    let confidence: 'low' | 'medium' | 'high' = 'low';
    if (signals.length >= 4) confidence = 'high';
    else if (signals.length >= 2) confidence = 'medium';

    return {
      insider_probability: probability,
      is_suspicious: probability >= (this.modelInfo.threshold || 0.5),
      confidence,
      top_signals: signals.slice(0, 5),
      features_used: featureValues
    };
  }

  /**
   * Normalize a numeric feature to 0-1 range
   */
  private normalizeFeature(feature: string, value: number): number {
    const thresholds: Record<string, [number, number]> = {
      'wallet_age_days': [30, 0],  // Lower is more suspicious
      'wallet_markets_traded': [5, 0],  // Lower is more suspicious
      'wallet_market_concentration': [0, 1],  // Higher is more suspicious
      'trade_size_usd': [0, 50000],
      'trade_size_vs_wallet_avg': [0, 5],
      'odds_at_trade': [0.3, 0],  // Lower is more suspicious
      'hours_to_resolution': [168, 0],  // Lower is more suspicious
      'position_vs_liquidity': [0, 0.1],
    };

    const [low, high] = thresholds[feature] || [0, 1];
    
    if (low < high) {
      return Math.min(Math.max((value - low) / (high - low), 0), 1);
    } else {
      return Math.min(Math.max((low - value) / (low - high), 0), 1);
    }
  }

  /**
   * Get human-readable signal description
   */
  private getSignalDescription(feature: string, value?: number): string {
    const descriptions: Record<string, string> = {
      'wallet_age_days': value !== undefined ? `New wallet (${value.toFixed(0)} days old)` : 'New wallet',
      'wallet_markets_traded': 'Low market diversity',
      'wallet_market_concentration': 'Highly concentrated trading',
      'is_single_market_wallet': 'Single-market wallet',
      'trade_size_usd': value !== undefined ? `Large trade ($${value.toLocaleString()})` : 'Large trade',
      'trade_size_vs_wallet_avg': 'Trade larger than usual',
      'odds_at_trade': 'Betting on underdog',
      'is_buying_underdog': 'Buying low-odds outcome',
      'hours_to_resolution': 'Trading near resolution',
      'is_final_24h': 'Trading in final 24 hours',
      'position_vs_liquidity': 'Large position vs liquidity',
      'is_new_market_for_wallet': 'First trade in this market',
    };

    return descriptions[feature] || feature;
  }

  /**
   * Batch predict for multiple wallets
   */
  async predictWallets(limit = 100): Promise<Array<{
    address: string;
    insider_probability: number;
    is_suspicious: boolean;
    top_signals: string[];
  }>> {
    const walletFeatures = await this.featureExtractor.extractWalletFeatures();
    
    return walletFeatures.slice(0, limit).map(wallet => {
      const signals: string[] = [];
      let score = 0;

      // Apply wallet-level rules
      if (wallet.age_days < 30) {
        score += 15;
        signals.push('New wallet');
      }
      if (wallet.single_market_focus) {
        score += 20;
        signals.push('Single-market focus');
      }
      if (wallet.low_odds_win_rate > 0.5 && wallet.low_odds_attempts >= 2) {
        score += 25;
        signals.push(`High low-odds win rate (${(wallet.low_odds_win_rate * 100).toFixed(0)}%)`);
      }
      if (wallet.final_24h_win_rate > 0.7 && wallet.final_24h_trade_rate > 0.3) {
        score += 20;
        signals.push('High final-24h accuracy');
      }
      if (wallet.market_concentration > 0.8) {
        score += 10;
        signals.push('Very concentrated');
      }

      return {
        address: wallet.address,
        insider_probability: Math.min(score / 100, 1),
        is_suspicious: score >= 50,
        top_signals: signals
      };
    });
  }

  /**
   * Check if model is loaded
   */
  isModelLoaded(): boolean {
    return this.modelLoaded;
  }
}


