import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../../stores/authStore';
import { getUserPositions, getUserOrders } from '../../lib/tradingApi';

interface Position {
  tokenId: string;
  marketQuestion: string;
  outcome: string;
  size: number;
  avgPrice: number;
  currentPrice: number;
  unrealizedPnl: number;
}

interface Order {
  orderId: string;
  tokenId: string;
  marketQuestion: string;
  side: 'BUY' | 'SELL';
  price: number;
  originalSize: number;
  remainingSize: number;
  status: string;
  createdAt: string;
}

export function Positions() {
  const { token, isAuthenticated } = useAuthStore();

  const { data: positions = [], isLoading: loadingPositions } = useQuery({
    queryKey: ['positions'],
    queryFn: () => getUserPositions(token!),
    enabled: isAuthenticated && !!token,
    refetchInterval: 10000,
  });

  const { data: orders = [], isLoading: loadingOrders } = useQuery({
    queryKey: ['orders'],
    queryFn: () => getUserOrders(token!, 20),
    enabled: isAuthenticated && !!token,
    refetchInterval: 5000,
  });

  const openOrders = isAuthenticated ? orders.filter((o: Order) => o.status === 'LIVE' || o.status === 'OPEN') : [];

  return (
    <div className="space-y-4">
      {/* Open Positions */}
      <div className="bg-terminal-surface/80 border border-terminal-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-terminal-border flex items-center justify-between">
          <h3 className="text-white font-mono text-sm font-semibold">POSITIONS</h3>
          <span className="text-terminal-muted text-xs">{positions.length} open</span>
        </div>

        {loadingPositions ? (
          <div className="p-4 space-y-2">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="animate-pulse h-16 bg-terminal-border/20 rounded" />
            ))}
          </div>
        ) : positions.length === 0 ? (
          <div className="p-8 text-center">
            <div className="text-terminal-muted text-sm mb-2">No open positions</div>
            <div className="text-terminal-muted/50 text-xs">Place an order to get started</div>
          </div>
        ) : (
          <div className="divide-y divide-terminal-border/30">
            {positions.map((pos: Position) => (
              <div key={pos.tokenId} className="px-4 py-3">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-white text-sm truncate">{pos.marketQuestion}</div>
                    <div className="text-terminal-muted text-xs">{pos.outcome}</div>
                  </div>
                  <div className={`text-sm font-mono ${pos.unrealizedPnl >= 0 ? 'text-neon-green' : 'text-neon-red'}`}>
                    {pos.unrealizedPnl >= 0 ? '+' : ''}{pos.unrealizedPnl.toFixed(2)}
                  </div>
                </div>
                <div className="flex gap-4 text-xs">
                  <span className="text-terminal-muted">
                    Size: <span className="text-white">{pos.size}</span>
                  </span>
                  <span className="text-terminal-muted">
                    Avg: <span className="text-white">{(pos.avgPrice * 100).toFixed(1)}¢</span>
                  </span>
                  <span className="text-terminal-muted">
                    Now: <span className="text-neon-cyan">{(pos.currentPrice * 100).toFixed(1)}¢</span>
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Open Orders */}
      <div className="bg-terminal-surface/80 border border-terminal-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-terminal-border flex items-center justify-between">
          <h3 className="text-white font-mono text-sm font-semibold">OPEN ORDERS</h3>
          <span className="text-terminal-muted text-xs">{openOrders.length} pending</span>
        </div>

        {loadingOrders ? (
          <div className="p-4 space-y-2">
            {[...Array(2)].map((_, i) => (
              <div key={i} className="animate-pulse h-12 bg-terminal-border/20 rounded" />
            ))}
          </div>
        ) : openOrders.length === 0 ? (
          <div className="p-6 text-center text-terminal-muted text-sm">
            No open orders
          </div>
        ) : (
          <div className="divide-y divide-terminal-border/30">
            {openOrders.map((order: Order) => (
              <div key={order.orderId} className="px-4 py-3 flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`
                      px-2 py-0.5 rounded text-[10px] font-bold
                      ${order.side === 'BUY' 
                        ? 'bg-neon-green/20 text-neon-green' 
                        : 'bg-neon-red/20 text-neon-red'
                      }
                    `}>
                      {order.side}
                    </span>
                    <span className="text-white text-sm truncate">{order.marketQuestion}</span>
                  </div>
                  <div className="flex gap-3 text-xs text-terminal-muted">
                    <span>{(order.price * 100).toFixed(1)}¢</span>
                    <span>×{order.remainingSize}/{order.originalSize}</span>
                  </div>
                </div>
                <button className="text-terminal-muted hover:text-neon-red text-xs px-2 py-1 border border-terminal-border rounded hover:border-neon-red/50 transition-colors">
                  Cancel
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent Fills */}
      <div className="bg-terminal-surface/80 border border-terminal-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-terminal-border">
          <h3 className="text-white font-mono text-sm font-semibold">RECENT FILLS</h3>
        </div>

        {loadingOrders ? (
          <div className="p-4 animate-pulse">
            <div className="h-20 bg-terminal-border/20 rounded" />
          </div>
        ) : (
          <div className="max-h-48 overflow-y-auto">
            {orders.filter((o: Order) => o.status === 'MATCHED').slice(0, 10).map((order: Order) => (
              <div key={order.orderId} className="px-4 py-2 flex items-center justify-between text-xs border-b border-terminal-border/20">
                <div className="flex items-center gap-2">
                  <span className={order.side === 'BUY' ? 'text-neon-green' : 'text-neon-red'}>
                    {order.side}
                  </span>
                  <span className="text-white">{order.originalSize}</span>
                  <span className="text-terminal-muted">@</span>
                  <span className="text-white">{(order.price * 100).toFixed(1)}¢</span>
                </div>
                <span className="text-terminal-muted">
                  {new Date(order.createdAt).toLocaleTimeString()}
                </span>
              </div>
            ))}
            {orders.filter((o: Order) => o.status === 'MATCHED').length === 0 && (
              <div className="p-4 text-center text-terminal-muted text-sm">No fills yet</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

