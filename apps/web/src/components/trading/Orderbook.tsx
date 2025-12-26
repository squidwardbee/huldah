import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getOrderbook } from '../../lib/tradingApi';

interface OrderbookProps {
  tokenId: string;
  onPriceClick?: (price: number) => void;
  onBestPricesChange?: (bestBid: number | undefined, bestAsk: number | undefined) => void;
  compact?: boolean;
}

interface OrderLevel {
  price: string;
  size: string;
}

export function Orderbook({ tokenId, onPriceClick, onBestPricesChange, compact = false }: OrderbookProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['orderbook', tokenId],
    queryFn: () => getOrderbook(tokenId),
    refetchInterval: 2000,
    enabled: !!tokenId,
  });

  // Notify parent of best bid/ask changes
  useEffect(() => {
    if (data && onBestPricesChange) {
      const rawBid = data.bids?.[0]?.price;
      const rawAsk = data.asks?.[0]?.price;
      const bestBid = rawBid ? parseFloat(rawBid) : undefined;
      const bestAsk = rawAsk ? parseFloat(rawAsk) : undefined;

      console.log('[Orderbook] Best prices:', {
        rawBid, rawAsk, bestBid, bestAsk,
        bidsCount: data.bids?.length || 0,
        asksCount: data.asks?.length || 0
      });

      onBestPricesChange(bestBid, bestAsk);
    }
  }, [data, onBestPricesChange]);

  if (!tokenId) {
    return (
      <div className="bg-terminal-surface/80 border border-terminal-border rounded-lg p-6">
        <div className="text-terminal-muted text-center text-sm">Select a market to view orderbook</div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="bg-terminal-surface/80 border border-terminal-border rounded-lg p-6">
        <div className="animate-pulse space-y-2">
          {[...Array(10)].map((_, i) => (
            <div key={i} className="h-6 bg-terminal-border/50 rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-terminal-surface/80 border border-terminal-border rounded-lg p-6">
        <div className="text-neon-red text-center text-sm">Failed to load orderbook</div>
      </div>
    );
  }

  const maxLevels = compact ? 4 : 8;
  const asks: OrderLevel[] = data?.asks?.slice(0, maxLevels) || [];
  const bids: OrderLevel[] = data?.bids?.slice(0, maxLevels) || [];

  // Find max size for bar width calculation
  const maxSize = Math.max(
    ...asks.map(a => parseFloat(a.size)),
    ...bids.map(b => parseFloat(b.size)),
    1
  );

  const spread = asks[0] && bids[0]
    ? (parseFloat(asks[0].price) - parseFloat(bids[0].price)) * 100
    : 0;

  // Compact mode: minimal height orderbook
  if (compact) {
    return (
      <div className="bg-terminal-surface/80 overflow-hidden flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between px-2 py-1 border-b border-terminal-border shrink-0">
          <span className="text-white font-mono text-[10px] font-semibold">BOOK</span>
          <span className="text-terminal-muted text-[10px]">
            <span className="text-neon-amber">{spread.toFixed(1)}¢</span>
          </span>
        </div>

        {/* Asks */}
        <div className="flex-1 flex flex-col justify-end overflow-hidden">
          {asks.slice().reverse().map((ask, i) => {
            const size = parseFloat(ask.size);
            const price = parseFloat(ask.price);
            const barWidth = (size / maxSize) * 100;
            return (
              <button key={`ask-${i}`} onClick={() => onPriceClick?.(price)}
                className="w-full grid grid-cols-2 px-2 py-0.5 relative hover:bg-neon-red/10 text-left">
                <div className="absolute right-0 top-0 bottom-0 bg-neon-red/10" style={{ width: `${barWidth}%` }} />
                <span className="relative text-neon-red font-mono text-[10px]">{(price * 100).toFixed(1)}¢</span>
                <span className="relative text-right text-white/60 font-mono text-[10px]">{size.toFixed(0)}</span>
              </button>
            );
          })}
        </div>

        {/* Spread */}
        <div className="px-2 py-1 bg-terminal-bg/50 border-y border-terminal-border text-center shrink-0">
          <span className="text-white font-mono font-bold text-[10px]">
            {asks[0] && bids[0] ? (((parseFloat(asks[0].price) + parseFloat(bids[0].price)) / 2) * 100).toFixed(1) : '—'}¢
          </span>
        </div>

        {/* Bids */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {bids.map((bid, i) => {
            const size = parseFloat(bid.size);
            const price = parseFloat(bid.price);
            const barWidth = (size / maxSize) * 100;
            return (
              <button key={`bid-${i}`} onClick={() => onPriceClick?.(price)}
                className="w-full grid grid-cols-2 px-2 py-0.5 relative hover:bg-neon-green/10 text-left">
                <div className="absolute right-0 top-0 bottom-0 bg-neon-green/10" style={{ width: `${barWidth}%` }} />
                <span className="relative text-neon-green font-mono text-[10px]">{(price * 100).toFixed(1)}¢</span>
                <span className="relative text-right text-white/60 font-mono text-[10px]">{size.toFixed(0)}</span>
              </button>
            );
          })}
        </div>

        {asks.length === 0 && bids.length === 0 && (
          <div className="p-2 text-center text-terminal-muted text-[10px]">Empty</div>
        )}
      </div>
    );
  }

  return (
    <div className="bg-terminal-surface/80 border border-terminal-border overflow-hidden flex flex-col rounded-lg">
      {/* Header */}
      <div className="flex items-center justify-between py-3 px-4 border-b border-terminal-border shrink-0">
        <h3 className="text-white font-mono text-xs font-semibold">ORDERBOOK</h3>
        <div className="text-terminal-muted text-[10px]">
          Spread: <span className="text-neon-amber">{spread.toFixed(1)}¢</span>
        </div>
      </div>

      {/* Column Headers */}
      <div className="grid grid-cols-2 px-4 py-2 border-b border-terminal-border text-[10px] uppercase tracking-widest text-terminal-muted">
        <span>Price</span>
        <span className="text-right">Size</span>
      </div>

      {/* Asks (sells) - reversed so lowest is at bottom */}
      <div className="divide-y divide-terminal-border/30">
        {asks.slice().reverse().map((ask, i) => {
          const size = parseFloat(ask.size);
          const price = parseFloat(ask.price);
          const barWidth = (size / maxSize) * 100;

          return (
            <button
              key={`ask-${i}`}
              onClick={() => onPriceClick?.(price)}
              className="
                w-full grid grid-cols-2 px-4 py-2 relative
                hover:bg-neon-red/5 transition-colors
                text-left
              "
            >
              {/* Background bar */}
              <div
                className="absolute right-0 top-0 bottom-0 bg-neon-red/10"
                style={{ width: `${barWidth}%` }}
              />

              <span className="relative text-neon-red font-mono text-sm">
                {(price * 100).toFixed(1)}¢
              </span>
              <span className="relative text-right text-white/70 font-mono text-sm">
                {size.toFixed(0)}
              </span>
            </button>
          );
        })}
      </div>

      {/* Spread indicator */}
      <div className="px-4 py-2 bg-terminal-bg/50 border-y border-terminal-border">
        <div className="flex items-center justify-center gap-2 text-xs">
          <span className="text-terminal-muted">MID</span>
          <span className="text-white font-mono font-bold">
            {asks[0] && bids[0]
              ? (((parseFloat(asks[0].price) + parseFloat(bids[0].price)) / 2) * 100).toFixed(1)
              : '—'
            }¢
          </span>
        </div>
      </div>

      {/* Bids (buys) */}
      <div className="divide-y divide-terminal-border/30">
        {bids.map((bid, i) => {
          const size = parseFloat(bid.size);
          const price = parseFloat(bid.price);
          const barWidth = (size / maxSize) * 100;

          return (
            <button
              key={`bid-${i}`}
              onClick={() => onPriceClick?.(price)}
              className="
                w-full grid grid-cols-2 px-4 py-2 relative
                hover:bg-neon-green/5 transition-colors
                text-left
              "
            >
              {/* Background bar */}
              <div
                className="absolute right-0 top-0 bottom-0 bg-neon-green/10"
                style={{ width: `${barWidth}%` }}
              />

              <span className="relative text-neon-green font-mono text-sm">
                {(price * 100).toFixed(1)}¢
              </span>
              <span className="relative text-right text-white/70 font-mono text-sm">
                {size.toFixed(0)}
              </span>
            </button>
          );
        })}
      </div>

      {/* Empty state */}
      {asks.length === 0 && bids.length === 0 && (
        <div className="p-8 text-center text-terminal-muted text-sm">
          No orders in book
        </div>
      )}
    </div>
  );
}

