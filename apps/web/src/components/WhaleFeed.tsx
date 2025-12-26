import { useQuery } from '@tanstack/react-query';
import { useAppStore, WhaleTrade } from '../stores/appStore';
import { getRecentWhales } from '../lib/api';
import { useEffect, useMemo } from 'react';

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', { 
    hour: '2-digit', 
    minute: '2-digit', 
    second: '2-digit',
    hour12: false 
  });
}

function formatAddress(address: string): string {
  return `${address.slice(0, 6)}···${address.slice(-4)}`;
}

function formatVolume(volume: number): string {
  if (volume >= 1000000) return `$${(volume / 1000000).toFixed(1)}M`;
  if (volume >= 1000) return `$${(volume / 1000).toFixed(0)}K`;
  return `$${volume.toFixed(0)}`;
}

const TAG_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  whale: { bg: 'bg-neon-cyan/20', text: 'text-neon-cyan', label: '🐋' },
  smart_money: { bg: 'bg-neon-green/20', text: 'text-neon-green', label: '🧠' },
  insider: { bg: 'bg-neon-amber/20', text: 'text-neon-amber', label: '👁' },
  active: { bg: 'bg-neon-magenta/20', text: 'text-neon-magenta', label: '⚡' },
  new: { bg: 'bg-white/10', text: 'text-white', label: '✨' },
};

function WalletTag({ tag }: { tag: string }) {
  const style = TAG_STYLES[tag] || { bg: 'bg-white/10', text: 'text-white', label: tag };
  return (
    <span 
      className={`${style.bg} ${style.text} text-xs px-1.5 py-0.5 rounded font-mono`}
      title={tag}
    >
      {style.label}
    </span>
  );
}

// Transform DB record to WhaleTrade format
interface DbWhaleTrade {
  tx_hash: string;
  wallet_address: string;
  market_question?: string;
  market_slug?: string;
  side: string;
  price: string;
  size: string;
  usd_value: string;
  timestamp: string;
  wallet_tags?: string[];
  wallet_volume?: string;
  wallet_trade_count?: number;
}

function transformDbTrade(dbTrade: DbWhaleTrade): WhaleTrade {
  return {
    txHash: dbTrade.tx_hash,
    wallet: dbTrade.wallet_address,
    marketQuestion: dbTrade.market_question,
    marketSlug: dbTrade.market_slug,
    side: dbTrade.side,
    price: parseFloat(dbTrade.price),
    size: parseFloat(dbTrade.size),
    usdValue: parseFloat(dbTrade.usd_value),
    timestamp: new Date(dbTrade.timestamp).getTime(),
    walletTags: dbTrade.wallet_tags || [],
    walletVolume: dbTrade.wallet_volume ? parseFloat(dbTrade.wallet_volume) : 0,
    walletTradeCount: dbTrade.wallet_trade_count || 0,
  };
}

export function WhaleFeed() {
  const { whaleTrades, connected, addWhaleTrade } = useAppStore();

  // Load initial trades from API
  const { data: initialTrades, isLoading, error } = useQuery<DbWhaleTrade[]>({
    queryKey: ['whaleTrades'],
    queryFn: getRecentWhales,
    staleTime: 30000,
    refetchInterval: 10000,
  });

  // Add initial trades to store (only once)
  useEffect(() => {
    if (initialTrades && initialTrades.length > 0) {
      initialTrades.forEach(trade => {
        addWhaleTrade(transformDbTrade(trade));
      });
    }
  }, [initialTrades, addWhaleTrade]);

  // Combine API data with WebSocket data, deduplicated
  const allTrades = useMemo(() => {
    const apiTrades = (initialTrades || []).map(transformDbTrade);
    const combined = [...whaleTrades];

    // Add API trades that aren't already in store
    apiTrades.forEach(trade => {
      if (!combined.some(t => t.txHash === trade.txHash)) {
        combined.push(trade);
      }
    });

    // Sort by timestamp descending
    return combined.sort((a, b) => b.timestamp - a.timestamp).slice(0, 100);
  }, [initialTrades, whaleTrades]);

  return (
    <div className="bg-terminal-surface/80 backdrop-blur border border-terminal-border rounded-lg overflow-hidden card-glow">
      {/* Header */}
      <div className="px-5 py-4 border-b border-terminal-border flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🐋</span>
          <h2 className="font-display text-xl text-neon-cyan tracking-wide">WHALE FEED</h2>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`w-2.5 h-2.5 rounded-full ${connected ? 'bg-neon-green live-indicator' : 'bg-neon-red'}`}
          />
          <span className={`text-xs font-mono uppercase tracking-widest ${connected ? 'text-neon-green' : 'text-neon-red'}`}>
            {connected ? 'LIVE' : 'OFFLINE'}
          </span>
        </div>
      </div>

      {/* Trade List */}
      <div className="max-h-[480px] overflow-y-auto">
        {isLoading ? (
          <div className="p-8 text-center">
            <div className="text-terminal-muted text-sm animate-pulse">[ LOADING WHALE DATA ]</div>
          </div>
        ) : error ? (
          <div className="p-8 text-center">
            <div className="text-neon-red text-sm">[ CONNECTION ERROR ]</div>
            <div className="text-terminal-muted/60 text-xs mt-2">Unable to fetch whale data</div>
          </div>
        ) : allTrades.length === 0 ? (
          <div className="p-8 text-center">
            <div className="text-terminal-muted text-sm mb-2">[ AWAITING WHALE ACTIVITY ]</div>
            <div className="text-terminal-muted/60 text-xs">Large trades (&gt;$1000) will appear here</div>
          </div>
        ) : (
          <div className="divide-y divide-terminal-border/50">
            {allTrades.map((trade, i) => (
              <div 
                key={trade.txHash || `${trade.timestamp}-${i}`}
                className="px-5 py-3 hover:bg-white/[0.02] transition-colors animate-slide-up"
                style={{ animationDelay: `${Math.min(i, 5) * 20}ms` }}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <span 
                      className={`font-mono text-sm font-semibold px-2 py-0.5 rounded ${
                        trade.side === 'BUY' 
                          ? 'bg-neon-green/10 text-neon-green' 
                          : 'bg-neon-red/10 text-neon-red'
                      }`}
                    >
                      {trade.side}
                    </span>
                    <span className="text-white font-mono font-bold text-lg">
                      ${trade.usdValue.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                    </span>
                  </div>
                  <span className="text-terminal-muted text-xs font-mono">
                    {formatTime(trade.timestamp)}
                  </span>
                </div>

                {/* Market title */}
                {trade.marketQuestion && (
                  <div className="text-terminal-muted text-xs mb-2 truncate max-w-[320px]">
                    {trade.marketQuestion}
                  </div>
                )}

                {/* Wallet row with tags */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <a 
                      href={`https://polygonscan.com/address/${trade.wallet}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-neon-cyan/70 hover:text-neon-cyan text-sm font-mono transition-colors"
                    >
                      {formatAddress(trade.wallet)}
                    </a>
                    
                    {/* Tags */}
                    {trade.walletTags && trade.walletTags.length > 0 && (
                      <div className="flex items-center gap-1">
                        {trade.walletTags.slice(0, 3).map(tag => (
                          <WalletTag key={tag} tag={tag} />
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-3 text-xs">
                    {trade.walletVolume && trade.walletVolume > 0 && (
                      <span className="text-terminal-muted/60" title="Wallet total volume">
                        {formatVolume(trade.walletVolume)}
                      </span>
                    )}
                    <span className="text-terminal-muted/60">
                      @ {trade.price.toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
