import { useState, useCallback, useEffect } from 'react';
import { MarketGrid } from './MarketGrid';
import { Orderbook } from './Orderbook';
import { OrderForm } from './OrderForm';
import { Positions } from './Positions';
import { PriceChart } from './PriceChart';
import { useAuthStore } from '../../stores/authStore';
import { getCredentialsStatus, type Market } from '../../lib/tradingApi';

export function TradingView() {
  const { token, isAuthenticated, credentialsChecked, setHasCredentials } = useAuthStore();
  const [selectedMarket, setSelectedMarket] = useState<Market | null>(null);
  const [orderPrice, setOrderPrice] = useState<number>(0.5);
  const [bestBid, setBestBid] = useState<number | undefined>();
  const [bestAsk, setBestAsk] = useState<number | undefined>();

  // Check credentials status when authenticated
  useEffect(() => {
    if (isAuthenticated && token && !credentialsChecked) {
      getCredentialsStatus(token)
        .then((status) => {
          setHasCredentials(status.hasCredentials);
        })
        .catch((err) => {
          console.error('Failed to check credentials status:', err);
          setHasCredentials(false);
        });
    }
  }, [isAuthenticated, token, credentialsChecked, setHasCredentials]);

  const handleBestPricesChange = useCallback((bid: number | undefined, ask: number | undefined) => {
    setBestBid(bid);
    setBestAsk(ask);
  }, []);

  const handleSelectMarket = (market: Market) => {
    setSelectedMarket(market);
    // Reset order price to market price
    setOrderPrice(market.outcome_yes_price || 0.5);
  };

  const handleCloseTrading = () => {
    setSelectedMarket(null);
  };

  // Get the YES token_id for orderbook (fallback to condition_id)
  const yesTokenId = selectedMarket?.yes_token_id || selectedMarket?.condition_id || '';

  const handlePriceClick = (price: number) => {
    setOrderPrice(price);
  };

  return (
    <div className="space-y-4">
      {/* Selected Market Trading Panel */}
      {selectedMarket && (
        <div className="bg-terminal-surface/80 border border-neon-cyan/30 rounded-lg overflow-hidden animate-fade-in">
          {/* Market Header */}
          <div className="p-4 border-b border-terminal-border flex items-start justify-between gap-4">
            <div className="flex gap-4 flex-1 min-w-0">
              {/* Market Image */}
              {(selectedMarket.image_url || selectedMarket.icon_url) && (
                <img
                  src={selectedMarket.image_url || selectedMarket.icon_url || ''}
                  alt=""
                  className="w-12 h-12 rounded-lg object-cover bg-terminal-border shrink-0"
                />
              )}
              <div className="min-w-0">
                <h2 className="text-white font-semibold leading-tight mb-1">
                  {selectedMarket.question}
                </h2>
                <div className="flex items-center gap-4 text-xs text-terminal-muted">
                  <span className="font-mono">/{selectedMarket.slug}</span>
                  <span>
                    Vol: <span className="text-neon-amber">
                      ${((selectedMarket.volume || 0) / 1_000_000).toFixed(1)}M
                    </span>
                  </span>
                  {selectedMarket.category && (
                    <span className="px-1.5 py-0.5 bg-terminal-border/50 rounded text-[10px]">
                      {selectedMarket.category}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <button
              onClick={handleCloseTrading}
              className="text-terminal-muted hover:text-white transition-colors p-1"
              title="Close trading panel"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Trading Grid */}
          <div className="grid grid-cols-12 gap-4 p-4">
            {/* Chart & Orderbook */}
            <div className="col-span-12 lg:col-span-5 space-y-4">
              <PriceChart
                tokenId={yesTokenId}
                yesPrice={selectedMarket.outcome_yes_price || 0.5}
                noPrice={selectedMarket.outcome_no_price || 0.5}
              />
              <Orderbook
                tokenId={yesTokenId}
                onPriceClick={handlePriceClick}
                onBestPricesChange={handleBestPricesChange}
              />
            </div>

            {/* Order Form */}
            <div className="col-span-12 lg:col-span-4">
              <OrderForm
                yesTokenId={yesTokenId}
                noTokenId={selectedMarket.no_token_id || undefined}
                marketName={selectedMarket.question}
                yesPrice={selectedMarket.outcome_yes_price}
                noPrice={selectedMarket.outcome_no_price}
                currentPrice={orderPrice}
                bestBid={bestBid}
                bestAsk={bestAsk}
                onOrderPlaced={() => {
                  // Could trigger refetch of positions/orders
                }}
              />
            </div>

            {/* Positions */}
            <div className="col-span-12 lg:col-span-3">
              <Positions />
            </div>
          </div>
        </div>
      )}

      {/* Market Grid */}
      <MarketGrid
        onSelectMarket={handleSelectMarket}
        selectedMarketId={selectedMarket?.condition_id || null}
      />
    </div>
  );
}
