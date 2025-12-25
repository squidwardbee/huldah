import { useState, useCallback, useEffect } from 'react';
import { MarketSelector } from './MarketSelector';
import { Orderbook } from './Orderbook';
import { OrderForm } from './OrderForm';
import { Positions } from './Positions';
import { PriceChart } from './PriceChart';
import { useAuthStore } from '../../stores/authStore';
import { getCredentialsStatus } from '../../lib/tradingApi';

interface Market {
  condition_id: string;
  question: string;
  slug: string;
  volume: number;
  outcome_yes_price: number;
  outcome_no_price: number;
  resolved: boolean | null;
  yes_token_id?: string;
  no_token_id?: string;
}

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

  const handleSelectToken = (_conditionId: string, market: Market) => {
    setSelectedMarket(market);
  };

  // Get the YES token_id for orderbook (fallback to condition_id)
  const yesTokenId = selectedMarket?.yes_token_id || selectedMarket?.condition_id || '';
  const conditionId = selectedMarket?.condition_id || '';

  const handlePriceClick = (price: number) => {
    setOrderPrice(price);
  };

  return (
    <div className="grid grid-cols-12 gap-4 h-full">
      {/* Left Column - Market Selector & Positions */}
      <div className="col-span-12 lg:col-span-3 space-y-4">
        <MarketSelector 
          selectedTokenId={conditionId} 
          onSelectToken={handleSelectToken}
        />
        <div className="hidden lg:block">
          <Positions />
        </div>
      </div>

      {/* Center Column - Chart & Orderbook */}
      <div className="col-span-12 lg:col-span-5 space-y-4">
        {/* Selected Market Header */}
        {selectedMarket && (
          <div className="bg-terminal-surface/80 border border-terminal-border rounded-lg p-4">
            <div className="text-white font-semibold mb-1">{selectedMarket.question}</div>
            <div className="flex items-center gap-4 text-xs text-terminal-muted">
              <span>/{selectedMarket.slug}</span>
              <span>Vol: <span className="text-neon-amber">${((selectedMarket.volume || 0) / 1000000).toFixed(1)}M</span></span>
            </div>
          </div>
        )}

        {/* Price Chart */}
        <PriceChart 
          tokenId={yesTokenId}
          yesPrice={selectedMarket?.outcome_yes_price || 0.5}
          noPrice={selectedMarket?.outcome_no_price || 0.5}
        />

        {/* Orderbook */}
        <Orderbook 
          tokenId={yesTokenId} 
          onPriceClick={handlePriceClick}
          onBestPricesChange={handleBestPricesChange}
        />

        {/* Mobile Positions */}
        <div className="lg:hidden">
          <Positions />
        </div>
      </div>

      {/* Right Column - Order Form */}
      <div className="col-span-12 lg:col-span-4">
        <OrderForm
          yesTokenId={yesTokenId}
          noTokenId={selectedMarket?.no_token_id}
          marketName={selectedMarket?.question || 'Select a market'}
          yesPrice={selectedMarket?.outcome_yes_price}
          noPrice={selectedMarket?.outcome_no_price}
          currentPrice={orderPrice}
          bestBid={bestBid}
          bestAsk={bestAsk}
          onOrderPlaced={() => {
            // Could trigger refetch of positions/orders
          }}
        />
        
        {/* Trading Tips */}
        <div className="mt-4 bg-terminal-surface/40 border border-terminal-border/50 rounded-lg p-4">
          <h4 className="text-terminal-muted text-xs uppercase tracking-widest mb-3">Trading Tips</h4>
          <ul className="space-y-2 text-xs text-terminal-muted/70">
            <li className="flex items-start gap-2">
              <span className="text-neon-cyan">▸</span>
              <span>Click orderbook prices to auto-fill</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-neon-cyan">▸</span>
              <span>Orders route through our builder for better execution</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-neon-cyan">▸</span>
              <span>Failed transactions auto-retry with fallback</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}

