import { useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { placeOrder } from '../../lib/tradingApi';

interface OrderFormProps {
  tokenId: string;
  marketName: string;
  currentPrice?: number;
  onOrderPlaced?: () => void;
}

export function OrderForm({ tokenId, marketName, currentPrice = 0.5, onOrderPlaced }: OrderFormProps) {
  const { token, isAuthenticated } = useAuthStore();
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [price, setPrice] = useState(currentPrice.toString());
  const [size, setSize] = useState('10');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const priceNum = parseFloat(price) || 0;
  const sizeNum = parseFloat(size) || 0;
  const cost = priceNum * sizeNum;
  const potentialProfit = side === 'BUY' 
    ? sizeNum * (1 - priceNum) 
    : sizeNum * priceNum;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !isAuthenticated) return;

    setIsSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const result = await placeOrder(token, {
        tokenId,
        side,
        price: priceNum,
        size: sizeNum,
      });

      setSuccess(`Order placed! ID: ${result.orderId?.slice(0, 8)}...`);
      onOrderPlaced?.();
      
      // Clear after 3 seconds
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      console.error('Order error:', err);
      setError(err instanceof Error ? err.message : 'Order failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-terminal-surface/80 border border-terminal-border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-terminal-border">
        <h3 className="text-white font-mono text-sm font-semibold">PLACE ORDER</h3>
        <div className="text-terminal-muted text-xs truncate mt-1">{marketName}</div>
      </div>

      {/* Buy/Sell Toggle */}
      <div className="flex border-b border-terminal-border">
        <button
          onClick={() => setSide('BUY')}
          className={`
            flex-1 py-3 font-mono font-bold text-sm transition-all
            ${side === 'BUY'
              ? 'bg-neon-green/20 text-neon-green border-b-2 border-neon-green'
              : 'text-terminal-muted hover:text-white hover:bg-terminal-surface'
            }
          `}
        >
          BUY YES
        </button>
        <button
          onClick={() => setSide('SELL')}
          className={`
            flex-1 py-3 font-mono font-bold text-sm transition-all
            ${side === 'SELL'
              ? 'bg-neon-red/20 text-neon-red border-b-2 border-neon-red'
              : 'text-terminal-muted hover:text-white hover:bg-terminal-surface'
            }
          `}
        >
          SELL YES
        </button>
      </div>

      <form onSubmit={handleSubmit} className="p-4 space-y-4">
        {/* Price Input */}
        <div>
          <label className="block text-terminal-muted text-xs uppercase tracking-wider mb-2">
            Price (¢)
          </label>
          <div className="relative">
            <input
              type="number"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              step="0.01"
              min="0.01"
              max="0.99"
              className="
                w-full bg-terminal-bg border border-terminal-border rounded-lg
                px-4 py-3 font-mono text-white text-lg
                focus:outline-none focus:border-neon-cyan
                transition-colors
              "
              placeholder="0.50"
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2 text-terminal-muted text-sm">
              ¢
            </div>
          </div>
          {/* Quick price buttons */}
          <div className="flex gap-2 mt-2">
            {[0.25, 0.50, 0.75, currentPrice].filter((v, i, a) => a.indexOf(v) === i).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPrice(p.toString())}
                className={`
                  flex-1 py-1 text-xs font-mono rounded border transition-all
                  ${parseFloat(price) === p 
                    ? 'border-neon-cyan text-neon-cyan bg-neon-cyan/10' 
                    : 'border-terminal-border text-terminal-muted hover:border-terminal-muted'
                  }
                `}
              >
                {(p * 100).toFixed(0)}¢
              </button>
            ))}
          </div>
        </div>

        {/* Size Input */}
        <div>
          <label className="block text-terminal-muted text-xs uppercase tracking-wider mb-2">
            Shares
          </label>
          <input
            type="number"
            value={size}
            onChange={(e) => setSize(e.target.value)}
            step="1"
            min="1"
            className="
              w-full bg-terminal-bg border border-terminal-border rounded-lg
              px-4 py-3 font-mono text-white text-lg
              focus:outline-none focus:border-neon-cyan
              transition-colors
            "
            placeholder="10"
          />
          {/* Quick size buttons */}
          <div className="flex gap-2 mt-2">
            {[10, 50, 100, 500].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSize(s.toString())}
                className={`
                  flex-1 py-1 text-xs font-mono rounded border transition-all
                  ${parseInt(size) === s 
                    ? 'border-neon-cyan text-neon-cyan bg-neon-cyan/10' 
                    : 'border-terminal-border text-terminal-muted hover:border-terminal-muted'
                  }
                `}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Order Summary */}
        <div className="bg-terminal-bg rounded-lg p-3 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-terminal-muted">Cost</span>
            <span className="text-white font-mono">${cost.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-terminal-muted">Potential Profit</span>
            <span className="text-neon-green font-mono">+${potentialProfit.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-sm pt-2 border-t border-terminal-border">
            <span className="text-terminal-muted">Return</span>
            <span className="text-neon-amber font-mono">
              {cost > 0 ? ((potentialProfit / cost) * 100).toFixed(0) : 0}%
            </span>
          </div>
        </div>

        {/* Error/Success Messages */}
        {error && (
          <div className="bg-neon-red/10 border border-neon-red/30 rounded-lg p-3 text-neon-red text-sm">
            {error}
          </div>
        )}
        {success && (
          <div className="bg-neon-green/10 border border-neon-green/30 rounded-lg p-3 text-neon-green text-sm">
            {success}
          </div>
        )}

        {/* Submit Button */}
        <button
          type="submit"
          disabled={!isAuthenticated || isSubmitting || priceNum <= 0 || sizeNum <= 0}
          className={`
            w-full py-4 rounded-lg font-mono font-bold text-sm
            transition-all duration-200
            disabled:opacity-50 disabled:cursor-not-allowed
            ${!isAuthenticated 
              ? 'bg-terminal-muted text-white'
              : side === 'BUY'
              ? 'bg-neon-green text-black hover:bg-neon-green/80'
              : 'bg-neon-red text-white hover:bg-neon-red/80'
            }
          `}
        >
          {!isAuthenticated ? (
            '⚡ CONNECT WALLET TO TRADE'
          ) : isSubmitting ? (
            <span className="animate-pulse">PLACING ORDER...</span>
          ) : (
            `${side} ${sizeNum} @ ${(priceNum * 100).toFixed(0)}¢`
          )}
        </button>
      </form>
    </div>
  );
}

