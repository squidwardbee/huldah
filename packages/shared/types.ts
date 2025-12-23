export interface WhaleTrade {
  wallet: string;
  marketId: string;
  tokenId: string;
  side: string;
  price: number;
  size: number;
  usdValue: number;
  timestamp: number;
  txHash: string;
  question?: string;
  walletStats?: WalletStats;
}

export interface WalletStats {
  total_trades: number;
  total_volume: number;
  win_count: number;
  loss_count: number;
}

export interface Wallet {
  address: string;
  first_seen: string;
  total_trades: number;
  total_volume: number;
  win_count: number;
  loss_count: number;
  realized_pnl: number;
  last_active: string;
  win_rate?: number;
}

export interface Market {
  condition_id: string;
  question: string;
  slug: string;
  end_date: string;
  volume: number;
  liquidity: number;
  last_price_yes: number;
  last_price_no: number;
  resolved: boolean;
}

export interface Trade {
  id: number;
  tx_hash: string;
  wallet_address: string;
  market_id: string;
  token_id: string;
  side: string;
  price: number;
  size: number;
  usd_value: number;
  timestamp: string;
  outcome: string;
  is_whale: boolean;
  question?: string;
}


