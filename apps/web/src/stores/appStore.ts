import { create } from 'zustand';

export interface WhaleTrade {
  wallet: string;
  marketId: string;
  side: string;
  price: number;
  size: number;
  usdValue: number;
  timestamp: number;
  txHash: string;
  title?: string;
}

export interface Wallet {
  address: string;
  total_trades: number;
  total_volume: number;
  win_rate: number;
  win_count: number;
  loss_count: number;
}

interface AppState {
  whaleTrades: WhaleTrade[];
  connected: boolean;
  addWhaleTrade: (trade: WhaleTrade) => void;
  setConnected: (status: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  whaleTrades: [],
  connected: false,
  
  addWhaleTrade: (trade) => set((state) => {
    // Deduplicate by txHash
    if (state.whaleTrades.some(t => t.txHash === trade.txHash)) {
      return state;
    }
    return {
      whaleTrades: [trade, ...state.whaleTrades].slice(0, 100)
    };
  }),
  
  setConnected: (status) => set({ connected: status })
}));


