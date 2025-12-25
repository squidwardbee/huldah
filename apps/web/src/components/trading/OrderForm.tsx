import { useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { useWalletTrading } from '../../hooks/useWalletTrading';
import { useDirectTrading } from '../../hooks/useDirectTrading';
import { useBackendTrading } from '../../hooks/useBackendTrading';
import { DirectCredentialsForm } from './DirectCredentialsForm';

interface OrderFormProps {
  yesTokenId: string;
  noTokenId?: string;
  marketName: string;
  yesPrice?: number;
  noPrice?: number;
  currentPrice?: number;
  bestBid?: number;
  bestAsk?: number;
  onOrderPlaced?: () => void;
}

type OrderMode = 'LIMIT' | 'MARKET';
type TradingMethod = 'SERVER' | 'WALLET' | 'API';
type OutcomeToken = 'YES' | 'NO';

export function OrderForm({
  yesTokenId,
  noTokenId,
  marketName,
  yesPrice = 0.5,
  noPrice = 0.5,
  currentPrice = 0.5,
  bestBid,
  bestAsk,
  onOrderPlaced
}: OrderFormProps) {
  const { isConnected } = useAccount();

  // Primary method: Wallet-based signing, relayed through backend (native Polymarket experience)
  const walletTrading = useWalletTrading();

  // Alternative: Backend server credentials
  const serverTrading = useBackendTrading();

  // Alternative: Direct API credentials (may have CORS issues)
  const apiTrading = useDirectTrading();

  const [tradingMethod, setTradingMethod] = useState<TradingMethod>('WALLET');
  const [showCredentialsForm, setShowCredentialsForm] = useState(false);
  const [outcomeToken, setOutcomeToken] = useState<OutcomeToken>('YES');
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [orderMode, setOrderMode] = useState<OrderMode>('LIMIT');
  const [price, setPrice] = useState(currentPrice.toString());
  const [size, setSize] = useState('10');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Get the active token ID based on selection
  const activeTokenId = outcomeToken === 'YES' ? yesTokenId : (noTokenId || yesTokenId);
  const hasNoToken = !!noTokenId;

  // Update price when currentPrice changes (from orderbook click)
  useEffect(() => {
    if (currentPrice && currentPrice !== parseFloat(price)) {
      setPrice(currentPrice.toString());
    }
  }, [currentPrice]);

  // For market orders, use best bid/ask price
  const marketPrice = side === 'BUY'
    ? (bestAsk || currentPrice)
    : (bestBid || currentPrice);

  const effectivePrice = orderMode === 'MARKET' ? marketPrice : (parseFloat(price) || 0);
  const priceNum = effectivePrice;

  // Validate price is in valid range (0.01 - 0.99)
  const isPriceValid = priceNum >= 0.01 && priceNum <= 0.99;

  // For market orders, check if we have orderbook data
  const hasOrderbookData = bestBid !== undefined || bestAsk !== undefined;
  const canPlaceMarketOrder = orderMode !== 'MARKET' || (
    (side === 'BUY' && bestAsk !== undefined && bestAsk >= 0.01 && bestAsk <= 0.99) ||
    (side === 'SELL' && bestBid !== undefined && bestBid >= 0.01 && bestBid <= 0.99)
  );

  // Determine why market order can't be placed
  const marketOrderBlockedReason = orderMode === 'MARKET' && !canPlaceMarketOrder
    ? (!hasOrderbookData
        ? 'LOADING ORDERBOOK...'
        : side === 'BUY' && bestAsk === undefined
        ? 'NO ASKS AVAILABLE'
        : side === 'SELL' && bestBid === undefined
        ? 'NO BIDS AVAILABLE'
        : 'PRICE OUT OF RANGE')
    : null;
  const sizeNum = parseFloat(size) || 0;
  const cost = priceNum * sizeNum;
  const potentialProfit = side === 'BUY'
    ? sizeNum * (1 - priceNum)
    : sizeNum * priceNum;

  // Get current trading state based on method
  const currentTrading = tradingMethod === 'WALLET'
    ? walletTrading
    : tradingMethod === 'SERVER'
      ? serverTrading
      : apiTrading;
  const isTradeLoading = currentTrading.isLoading || (tradingMethod === 'WALLET' && walletTrading.isInitializing);
  const tradeError = currentTrading.error;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isConnected) return;

    // Frontend validation
    if (!isPriceValid) {
      setError(`Invalid price: ${effectivePrice}. Price must be between 1¢ and 99¢`);
      return;
    }

    if (!canPlaceMarketOrder) {
      const reason = !hasOrderbookData
        ? 'Orderbook not loaded. Try again or use a limit order.'
        : side === 'BUY'
        ? 'No ask prices available. Try a limit order instead.'
        : 'No bid prices available. Try a limit order instead.';
      setError(`Cannot place market order: ${reason}`);
      return;
    }

    if (!activeTokenId) {
      setError('Please select a market first');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      console.log(`[OrderForm] Submitting via ${tradingMethod}:`, {
        tokenId: activeTokenId,
        outcome: outcomeToken,
        side,
        price: effectivePrice,
        size: sizeNum,
        orderType: orderMode === 'MARKET' ? 'FOK' : 'GTC'
      });

      const result = await currentTrading.placeOrder({
        tokenId: activeTokenId,
        side,
        price: effectivePrice,
        size: sizeNum,
        orderType: orderMode === 'MARKET' ? 'FOK' : 'GTC',
      });

      console.log('[OrderForm] Result:', result);

      if (!result.success) {
        setError(result.errorMessage || 'Order failed');
        return;
      }

      const orderTypeLabel = orderMode === 'MARKET' ? 'Market' : 'Limit';
      setSuccess(`${orderTypeLabel} order placed! ID: ${result.orderId?.slice(0, 8)}...`);
      onOrderPlaced?.();

      // Clear after 3 seconds
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      console.error('Order error:', err);
      setError(err.message || 'Order failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isProcessing = isSubmitting || isTradeLoading;

  return (
    <div className="bg-terminal-surface/80 border border-terminal-border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-terminal-border">
        <div className="flex items-center justify-between">
          <h3 className="text-white font-mono text-sm font-semibold">PLACE ORDER</h3>
          {/* Trading Method Selector */}
          <div className="flex gap-1">
            <button
              onClick={() => setTradingMethod('WALLET')}
              className={`
                px-2 py-0.5 text-xs font-mono rounded transition-all
                ${tradingMethod === 'WALLET'
                  ? 'bg-neon-green/20 text-neon-green'
                  : 'text-terminal-muted hover:text-white'
                }
              `}
              title="Sign with wallet (recommended)"
            >
              WALLET
            </button>
            <button
              onClick={() => setTradingMethod('SERVER')}
              className={`
                px-2 py-0.5 text-xs font-mono rounded transition-all
                ${tradingMethod === 'SERVER'
                  ? 'bg-neon-amber/20 text-neon-amber'
                  : 'text-terminal-muted hover:text-white'
                }
              `}
              title="Use server-stored credentials"
            >
              SERVER
            </button>
            <button
              onClick={() => setTradingMethod('API')}
              className={`
                px-2 py-0.5 text-xs font-mono rounded transition-all
                ${tradingMethod === 'API'
                  ? 'bg-neon-cyan/20 text-neon-cyan'
                  : 'text-terminal-muted hover:text-white'
                }
              `}
              title="Use local API credentials"
            >
              API
            </button>
          </div>
        </div>
        <div className="text-terminal-muted text-xs truncate mt-1">{marketName}</div>
      </div>

      {/* YES/NO Token Toggle */}
      {hasNoToken && (
        <div className="flex border-b border-terminal-border">
          <button
            onClick={() => setOutcomeToken('YES')}
            className={`
              flex-1 py-2 font-mono font-bold text-xs transition-all
              ${outcomeToken === 'YES'
                ? 'bg-neon-cyan/20 text-neon-cyan border-b-2 border-neon-cyan'
                : 'text-terminal-muted hover:text-white hover:bg-terminal-surface'
              }
            `}
          >
            YES @ {(yesPrice * 100).toFixed(0)}¢
          </button>
          <button
            onClick={() => setOutcomeToken('NO')}
            className={`
              flex-1 py-2 font-mono font-bold text-xs transition-all
              ${outcomeToken === 'NO'
                ? 'bg-neon-magenta/20 text-neon-magenta border-b-2 border-neon-magenta'
                : 'text-terminal-muted hover:text-white hover:bg-terminal-surface'
              }
            `}
          >
            NO @ {(noPrice * 100).toFixed(0)}¢
          </button>
        </div>
      )}

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
          BUY {outcomeToken}
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
          SELL {outcomeToken}
        </button>
      </div>

      <form onSubmit={handleSubmit} className="p-4 space-y-4">
        {/* Order Type Toggle */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setOrderMode('LIMIT')}
            className={`
              flex-1 py-2 text-xs font-mono font-bold rounded-lg border transition-all
              ${orderMode === 'LIMIT'
                ? 'border-neon-cyan text-neon-cyan bg-neon-cyan/10'
                : 'border-terminal-border text-terminal-muted hover:border-terminal-muted'
              }
            `}
          >
            LIMIT
          </button>
          <button
            type="button"
            onClick={() => setOrderMode('MARKET')}
            className={`
              flex-1 py-2 text-xs font-mono font-bold rounded-lg border transition-all
              ${orderMode === 'MARKET'
                ? 'border-neon-amber text-neon-amber bg-neon-amber/10'
                : 'border-terminal-border text-terminal-muted hover:border-terminal-muted'
              }
            `}
          >
            MARKET
          </button>
        </div>

        {/* Price Input (only for limit orders) */}
        {orderMode === 'LIMIT' ? (
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
        ) : (
          <div className="bg-terminal-bg rounded-lg p-3">
            <div className="text-terminal-muted text-xs uppercase tracking-wider mb-1">
              Market Price
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-mono text-neon-amber">
                {(marketPrice * 100).toFixed(1)}¢
              </span>
              <span className="text-terminal-muted text-xs">
                ({side === 'BUY' ? 'Best Ask' : 'Best Bid'})
              </span>
            </div>
            <div className="text-terminal-muted text-xs mt-2">
              Executes immediately at best available price
            </div>
          </div>
        )}

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

        {/* Network Warning */}
        {tradingMethod === 'WALLET' && isConnected && !walletTrading.isOnPolygon && (
          <div className="bg-neon-amber/10 border border-neon-amber/30 rounded-lg p-3 text-sm">
            <div className="text-neon-amber font-mono text-xs mb-1">WRONG NETWORK</div>
            <div className="text-terminal-muted text-xs">
              Please switch to Polygon network. Trading will prompt you to switch automatically.
            </div>
          </div>
        )}

        {/* Wallet Method Info */}
        {tradingMethod === 'WALLET' && isConnected && walletTrading.isOnPolygon && (
          <div className={`
            rounded-lg p-3 text-sm border
            ${walletTrading.isReady
              ? 'bg-neon-green/10 border-neon-green/30'
              : 'bg-neon-cyan/10 border-neon-cyan/30'
            }
          `}>
            <div className={`font-mono text-xs mb-1 ${walletTrading.isReady ? 'text-neon-green' : 'text-neon-cyan'}`}>
              {walletTrading.isReady ? 'READY TO TRADE' :
               walletTrading.hasCredentials ? 'INITIALIZING...' : 'SIGN TO ENABLE TRADING'}
            </div>
            <div className="text-terminal-muted text-xs">
              {walletTrading.isReady
                ? 'Connected. Orders signed locally and sent directly to Polymarket.'
                : 'First trade will prompt a signature to derive your trading credentials.'}
            </div>
          </div>
        )}

        {/* Error/Success Messages */}
        {(error || tradeError) && (
          <div className="bg-neon-red/10 border border-neon-red/30 rounded-lg p-3 text-neon-red text-sm">
            {error || tradeError}
          </div>
        )}
        {success && (
          <div className="bg-neon-green/10 border border-neon-green/30 rounded-lg p-3 text-neon-green text-sm">
            {success}
          </div>
        )}

        {/* Submit Button */}
        {!isConnected ? (
          <button
            type="button"
            disabled
            className="w-full py-4 rounded-lg font-mono font-bold text-sm bg-terminal-muted text-white opacity-50 cursor-not-allowed"
          >
            CONNECT WALLET TO TRADE
          </button>
        ) : tradingMethod === 'API' && !apiTrading.hasCredentials ? (
          <button
            type="button"
            onClick={() => setShowCredentialsForm(true)}
            className="
              w-full py-4 rounded-lg font-mono font-bold text-sm
              bg-neon-cyan text-black hover:bg-neon-cyan/80
              transition-all duration-200
            "
          >
            SET UP API CREDENTIALS
          </button>
        ) : (
          <button
            type="submit"
            disabled={isProcessing || !isPriceValid || !canPlaceMarketOrder || sizeNum <= 0}
            className={`
              w-full py-4 rounded-lg font-mono font-bold text-sm
              transition-all duration-200
              disabled:opacity-50 disabled:cursor-not-allowed
              ${orderMode === 'MARKET'
                ? 'bg-neon-amber text-black hover:bg-neon-amber/80'
                : side === 'BUY'
                ? 'bg-neon-green text-black hover:bg-neon-green/80'
                : 'bg-neon-red text-white hover:bg-neon-red/80'
              }
            `}
          >
            {isProcessing ? (
              <span className="animate-pulse">
                {walletTrading.isInitializing ? 'ENABLING TRADING...' : 'PLACING ORDER...'}
              </span>
            ) : marketOrderBlockedReason ? (
              marketOrderBlockedReason
            ) : orderMode === 'MARKET' ? (
              `${side} ${outcomeToken} ${sizeNum} @ ${(effectivePrice * 100).toFixed(1)}¢`
            ) : (
              `${side} ${outcomeToken} ${sizeNum} @ ${(effectivePrice * 100).toFixed(0)}¢`
            )}
          </button>
        )}
      </form>

      {/* API Credentials Setup Modal */}
      {showCredentialsForm && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="max-w-md w-full">
            <DirectCredentialsForm
              onSuccess={() => setShowCredentialsForm(false)}
              onCancel={() => setShowCredentialsForm(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
