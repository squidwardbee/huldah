import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getMarketTrades, type MarketTrade } from '../../lib/tradingApi';

interface TradesProps {
  tokenId: string;
  compact?: boolean;
}

const MIN_SIZE_OPTIONS = [
  { value: 0, label: 'All' },
  { value: 100, label: '$100+' },
  { value: 500, label: '$500+' },
  { value: 1000, label: '$1K+' },
  { value: 5000, label: '$5K+' },
];

function formatTime(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);

  if (diffMins < 1) return 'now';
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatAmount(amount: number): string {
  if (amount >= 1000000) return `$${(amount / 1000000).toFixed(1)}M`;
  if (amount >= 1000) return `$${(amount / 1000).toFixed(1)}K`;
  return `$${amount.toFixed(0)}`;
}

export function Trades({ tokenId, compact }: TradesProps) {
  const [minSize, setMinSize] = useState(0);
  const [addressFilter, setAddressFilter] = useState('');

  const { data: trades = [], isLoading, error } = useQuery({
    queryKey: ['marketTrades', tokenId],
    queryFn: () => getMarketTrades(tokenId, 100),
    enabled: !!tokenId,
    refetchInterval: 5000,
  });

  // Filter trades by size and address
  const filteredTrades = useMemo(() => {
    return trades.filter(trade => {
      const usdValue = trade.size * trade.price;
      if (minSize > 0 && usdValue < minSize) return false;
      if (addressFilter && !trade.wallet.toLowerCase().includes(addressFilter.toLowerCase())) return false;
      return true;
    });
  }, [trades, minSize, addressFilter]);

  if (!tokenId) {
    return (
      <div className="bg-terminal-surface/80 h-full flex items-center justify-center text-terminal-muted text-xs">
        No market selected
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="bg-terminal-surface/80 h-full flex items-center justify-center">
        <div className="text-terminal-muted text-xs animate-pulse">Loading trades...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-terminal-surface/80 h-full flex items-center justify-center">
        <div className="text-neon-red text-xs">Failed to load trades</div>
      </div>
    );
  }

  return (
    <div className="bg-terminal-surface/80 h-full flex flex-col overflow-hidden">
      {/* Filters */}
      <div className="flex items-center gap-2 px-2 py-1 border-b border-terminal-border shrink-0">
        {/* Min size filter */}
        <select
          value={minSize}
          onChange={(e) => setMinSize(Number(e.target.value))}
          className="bg-terminal-bg border border-terminal-border rounded px-1 py-0.5 text-[9px] text-white font-mono focus:outline-none focus:border-neon-cyan/50"
        >
          {MIN_SIZE_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>

        {/* Address filter */}
        <div className="flex-1 relative">
          <input
            type="text"
            value={addressFilter}
            onChange={(e) => setAddressFilter(e.target.value)}
            placeholder="Filter address..."
            className="w-full bg-terminal-bg border border-terminal-border rounded px-1.5 py-0.5 text-[9px] text-white font-mono placeholder-terminal-muted focus:outline-none focus:border-neon-cyan/50"
          />
          {addressFilter && (
            <button
              onClick={() => setAddressFilter('')}
              className="absolute right-1 top-1/2 -translate-y-1/2 text-terminal-muted hover:text-white"
            >
              <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Header */}
      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-1 items-center px-2 py-1 border-b border-terminal-border/50 shrink-0">
        <span className="text-terminal-muted text-[9px] font-mono">SIZE</span>
        <span className="text-terminal-muted text-[9px] font-mono px-1">ADDR</span>
        <span className="text-terminal-muted text-[9px] font-mono">PRICE</span>
        <span className="text-terminal-muted text-[9px] font-mono">TIME</span>
      </div>

      {/* Trades list - scrollable */}
      <div className="flex-1 overflow-y-auto">
        {filteredTrades.length === 0 ? (
          <div className="p-4 text-center text-terminal-muted text-[10px]">
            {trades.length === 0 ? 'No recent trades' : 'No trades match filters'}
          </div>
        ) : (
          filteredTrades.map((trade, idx) => (
            <TradeRow
              key={`${trade.txHash}-${idx}`}
              trade={trade}
              compact={compact}
              onAddressClick={() => setAddressFilter(trade.wallet)}
              isAddressFiltered={addressFilter.toLowerCase() === trade.wallet.toLowerCase()}
            />
          ))
        )}
      </div>
    </div>
  );
}

interface TradeRowProps {
  trade: MarketTrade;
  compact?: boolean;
  onAddressClick?: () => void;
  isAddressFiltered?: boolean;
}

function formatAddress(address: string): string {
  return `${address.slice(0, 4)}···${address.slice(-3)}`;
}

function TradeRow({ trade, compact, onAddressClick, isAddressFiltered }: TradeRowProps) {
  const isBuy = trade.side === 'BUY';
  const usdValue = trade.size * trade.price;

  return (
    <div
      className={`grid grid-cols-[1fr_auto_auto_auto] gap-1 items-center px-2 ${compact ? 'py-0.5' : 'py-1'} hover:bg-white/[0.02] transition-colors border-b border-terminal-border/20`}
    >
      {/* Size with side indicator */}
      <div className="flex items-center gap-1 min-w-0">
        <span className={`text-[9px] font-mono font-bold ${isBuy ? 'text-neon-green' : 'text-neon-red'}`}>
          {isBuy ? '▲' : '▼'}
        </span>
        <span className={`font-mono ${compact ? 'text-[10px]' : 'text-xs'} ${isBuy ? 'text-neon-green' : 'text-neon-red'}`}>
          {formatAmount(usdValue)}
        </span>
      </div>

      {/* Address - clickable to filter */}
      <button
        onClick={onAddressClick}
        className={`font-mono text-[8px] px-1 py-0.5 rounded transition-colors ${
          isAddressFiltered
            ? 'bg-neon-cyan/20 text-neon-cyan'
            : 'text-terminal-muted hover:text-neon-cyan hover:bg-neon-cyan/10'
        }`}
        title={trade.wallet}
      >
        {formatAddress(trade.wallet)}
      </button>

      {/* Price */}
      <span className={`font-mono ${compact ? 'text-[10px]' : 'text-xs'} text-white`}>
        {(trade.price * 100).toFixed(1)}¢
      </span>

      {/* Time */}
      <span className={`font-mono ${compact ? 'text-[9px]' : 'text-[10px]'} text-terminal-muted`}>
        {formatTime(trade.timestamp)}
      </span>
    </div>
  );
}
