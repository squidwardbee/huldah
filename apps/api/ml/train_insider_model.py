#!/usr/bin/env python3
"""
Insider Detection Model Training Script

Trains an XGBoost classifier to detect potential insider trading patterns.
Uses proxy labels based on statistically anomalous outcomes.

Usage:
    python train_insider_model.py --trades data/trades.csv --wallets data/wallets.csv
"""

import argparse
import json
import os
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.metrics import (
    classification_report, 
    confusion_matrix, 
    roc_auc_score,
    precision_recall_curve,
    average_precision_score
)
from sklearn.preprocessing import StandardScaler
import xgboost as xgb
import joblib


# Feature columns for trade-level model
TRADE_FEATURES = [
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
]

# Feature columns for wallet-level model
WALLET_FEATURES = [
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
]


def load_and_preprocess(filepath: str, features: list, target: str = 'is_suspicious') -> tuple:
    """Load CSV and prepare for training."""
    print(f"Loading {filepath}...")
    df = pd.read_csv(filepath)
    
    # Fill missing values
    df = df.fillna(0)
    
    # Ensure target exists
    if target not in df.columns:
        raise ValueError(f"Target column '{target}' not found in data")
    
    # Select features that exist
    available_features = [f for f in features if f in df.columns]
    missing_features = set(features) - set(available_features)
    if missing_features:
        print(f"Warning: Missing features: {missing_features}")
    
    X = df[available_features].values
    y = df[target].values
    
    print(f"Loaded {len(df)} samples, {sum(y)} positive ({100*sum(y)/len(y):.1f}%)")
    
    return X, y, available_features, df


def train_xgboost(X: np.ndarray, y: np.ndarray, feature_names: list) -> tuple:
    """Train XGBoost classifier with class balancing."""
    
    # Split data
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )
    
    # Calculate class weight for imbalanced data
    scale_pos_weight = (len(y_train) - sum(y_train)) / max(sum(y_train), 1)
    
    print(f"\nTraining XGBoost (scale_pos_weight={scale_pos_weight:.2f})...")
    
    # Train model
    model = xgb.XGBClassifier(
        n_estimators=100,
        max_depth=5,
        learning_rate=0.1,
        scale_pos_weight=scale_pos_weight,
        use_label_encoder=False,
        eval_metric='logloss',
        random_state=42
    )
    
    model.fit(
        X_train, y_train,
        eval_set=[(X_test, y_test)],
        verbose=False
    )
    
    # Evaluate
    y_pred = model.predict(X_test)
    y_prob = model.predict_proba(X_test)[:, 1]
    
    print("\n=== Model Performance ===")
    print(classification_report(y_test, y_pred, target_names=['Normal', 'Suspicious']))
    
    if sum(y_test) > 0:
        roc_auc = roc_auc_score(y_test, y_prob)
        avg_precision = average_precision_score(y_test, y_prob)
        print(f"ROC AUC: {roc_auc:.4f}")
        print(f"Average Precision: {avg_precision:.4f}")
    
    # Cross-validation
    print("\n=== Cross-Validation ===")
    cv_scores = cross_val_score(model, X, y, cv=5, scoring='roc_auc')
    print(f"CV ROC AUC: {cv_scores.mean():.4f} (+/- {cv_scores.std()*2:.4f})")
    
    # Feature importance
    print("\n=== Feature Importance ===")
    importance = dict(zip(feature_names, model.feature_importances_))
    for feat, imp in sorted(importance.items(), key=lambda x: -x[1])[:10]:
        print(f"  {feat}: {imp:.4f}")
    
    return model, feature_names


def export_model_for_js(model, feature_names: list, output_dir: str):
    """Export model in formats usable from JavaScript."""
    os.makedirs(output_dir, exist_ok=True)
    
    # Save as joblib (for Python inference)
    joblib.dump(model, f"{output_dir}/insider_model.joblib")
    print(f"Saved model to {output_dir}/insider_model.joblib")
    
    # Export feature names and basic info
    model_info = {
        'features': feature_names,
        'n_features': len(feature_names),
        'model_type': 'xgboost',
        'threshold': 0.5,
        'feature_importance': dict(zip(feature_names, model.feature_importances_.tolist()))
    }
    
    with open(f"{output_dir}/model_info.json", 'w') as f:
        json.dump(model_info, f, indent=2)
    print(f"Saved model info to {output_dir}/model_info.json")
    
    # Export as simple decision rules (for lightweight JS inference)
    # Get the trees and convert to simple if-else rules
    rules = extract_top_rules(model, feature_names, top_n=10)
    
    with open(f"{output_dir}/decision_rules.json", 'w') as f:
        json.dump(rules, f, indent=2)
    print(f"Saved decision rules to {output_dir}/decision_rules.json")
    
    # Export as ONNX for portable inference (optional)
    try:
        from skl2onnx import convert_sklearn
        from skl2onnx.common.data_types import FloatTensorType
        
        initial_type = [('input', FloatTensorType([None, len(feature_names)]))]
        onnx_model = convert_sklearn(model, initial_types=initial_type)
        
        with open(f"{output_dir}/insider_model.onnx", 'wb') as f:
            f.write(onnx_model.SerializeToString())
        print(f"Saved ONNX model to {output_dir}/insider_model.onnx")
    except ImportError:
        print("Note: skl2onnx not installed, skipping ONNX export")


def extract_top_rules(model, feature_names: list, top_n: int = 10) -> list:
    """Extract simple decision rules from feature importance."""
    importance = dict(zip(feature_names, model.feature_importances_))
    sorted_features = sorted(importance.items(), key=lambda x: -x[1])[:top_n]
    
    rules = []
    for feature, imp in sorted_features:
        rules.append({
            'feature': feature,
            'importance': float(imp),
            'description': get_feature_description(feature)
        })
    
    return rules


def get_feature_description(feature: str) -> str:
    """Get human-readable description for a feature."""
    descriptions = {
        'wallet_age_days': 'Days since wallet first seen',
        'wallet_markets_traded': 'Number of unique markets traded',
        'wallet_market_concentration': 'How focused on few markets (0-1)',
        'trade_size_usd': 'Size of trade in USD',
        'odds_at_trade': 'Market odds when trading',
        'is_buying_underdog': 'Betting on <30% outcome',
        'hours_to_resolution': 'Hours until market resolution',
        'is_final_24h': 'Trading in final 24 hours',
        'is_new_market_for_wallet': 'First trade in this market',
        'is_single_market_wallet': 'Wallet trades <= 3 markets total',
        'low_odds_win_rate': 'Win rate on low-odds bets',
        'final_24h_trade_rate': 'Fraction of trades in final 24h',
    }
    return descriptions.get(feature, feature)


def main():
    parser = argparse.ArgumentParser(description='Train insider detection model')
    parser.add_argument('--trades', type=str, help='Path to trades CSV')
    parser.add_argument('--wallets', type=str, help='Path to wallets CSV')
    parser.add_argument('--output', type=str, default='./model', help='Output directory')
    args = parser.parse_args()
    
    output_dir = args.output
    
    # Train trade-level model if data provided
    if args.trades and Path(args.trades).exists():
        print("\n" + "="*50)
        print("TRADE-LEVEL MODEL")
        print("="*50)
        
        X, y, features, df = load_and_preprocess(args.trades, TRADE_FEATURES)
        
        if sum(y) >= 10:  # Need enough positive samples
            model, feature_names = train_xgboost(X, y, features)
            export_model_for_js(model, feature_names, f"{output_dir}/trade_model")
        else:
            print(f"Not enough positive samples ({sum(y)}), need at least 10")
    
    # Train wallet-level model if data provided
    if args.wallets and Path(args.wallets).exists():
        print("\n" + "="*50)
        print("WALLET-LEVEL MODEL")
        print("="*50)
        
        X, y, features, df = load_and_preprocess(args.wallets, WALLET_FEATURES)
        
        if sum(y) >= 10:
            model, feature_names = train_xgboost(X, y, features)
            export_model_for_js(model, feature_names, f"{output_dir}/wallet_model")
        else:
            print(f"Not enough positive samples ({sum(y)}), need at least 10")
    
    print("\n✅ Training complete!")


if __name__ == '__main__':
    main()

