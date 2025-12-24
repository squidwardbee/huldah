import { useState } from 'react';
import { MarketSelector } from './MarketSelector';
import { Orderbook } from './Orderbook';
import { OrderForm } from './OrderForm';
import { Positions } from './Positions';
import { PriceChart } from './PriceChart';

interface Market {
  condition_id: string;
  question: string;
  slug: string;
  volume: number;
  outcome_yes_price: number;
  outcome_no_price: number;
  resolved: boolean;
  yes_token_id?: string;
  no_token_id?: string;
}

export function TradingView() {
  const [selectedMarket, setSelectedMarket] = useState<Market | null>(null);
  const [orderPrice, setOrderPrice] = useState<number>(0.5);

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
        />

        {/* Mobile Positions */}
        <div className="lg:hidden">
          <Positions />
        </div>
      </div>

      {/* Right Column - Order Form */}
      <div className="col-span-12 lg:col-span-4">
        <OrderForm
          tokenId={yesTokenId}
          marketName={selectedMarket?.question || 'Select a market'}
          currentPrice={orderPrice}
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

