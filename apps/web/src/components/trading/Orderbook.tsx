import { useQuery } from '@tanstack/react-query';
import { getOrderbook } from '../../lib/tradingApi';

interface OrderbookProps {
  tokenId: string;
  onPriceClick?: (price: number) => void;
}

interface OrderLevel {
  price: string;
  size: string;
}

export function Orderbook({ tokenId, onPriceClick }: OrderbookProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['orderbook', tokenId],
    queryFn: () => getOrderbook(tokenId),
    refetchInterval: 2000,
    enabled: !!tokenId,
  });

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

  const asks: OrderLevel[] = data?.asks?.slice(0, 8) || [];
  const bids: OrderLevel[] = data?.bids?.slice(0, 8) || [];

  // Find max size for bar width calculation
  const maxSize = Math.max(
    ...asks.map(a => parseFloat(a.size)),
    ...bids.map(b => parseFloat(b.size)),
    1
  );

  const spread = asks[0] && bids[0] 
    ? (parseFloat(asks[0].price) - parseFloat(bids[0].price)) * 100
    : 0;

  return (
    <div className="bg-terminal-surface/80 border border-terminal-border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-terminal-border">
        <h3 className="text-white font-mono text-sm font-semibold">ORDERBOOK</h3>
        <div className="text-terminal-muted text-xs">
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

