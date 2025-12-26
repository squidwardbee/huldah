import { useState, useCallback, useEffect } from 'react';
import { MarketGrid } from './MarketGrid';
import { Orderbook } from './Orderbook';
import { OrderForm } from './OrderForm';
import { Positions } from './Positions';
import { PriceChart } from './PriceChart';
import { useAuthStore } from '../../stores/authStore';
import { getCredentialsStatus, type Market } from '../../lib/tradingApi';

type BottomTab = 'positions' | 'orders' | 'fills';

export function TradingView() {
  const { token, isAuthenticated, credentialsChecked, setHasCredentials } = useAuthStore();
  const [selectedMarket, setSelectedMarket] = useState<Market | null>(null);
  const [orderPrice, setOrderPrice] = useState<number>(0.5);
  const [bestBid, setBestBid] = useState<number | undefined>();
  const [bestAsk, setBestAsk] = useState<number | undefined>();
  const [bottomTab, setBottomTab] = useState<BottomTab>('positions');

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
    setOrderPrice(market.outcome_yes_price || 0.5);
  };

  const handleCloseTrading = () => {
    setSelectedMarket(null);
  };

  const yesTokenId = selectedMarket?.yes_token_id || selectedMarket?.condition_id || '';

  const handlePriceClick = (price: number) => {
    setOrderPrice(price);
  };

  // If no market selected, show market grid
  if (!selectedMarket) {
    return (
      <div className="h-full p-4">
        <MarketGrid
          onSelectMarket={handleSelectMarket}
          selectedMarketId={null}
        />
      </div>
    );
  }

  // Full-screen trading terminal layout
  return (
    <div className="h-full flex flex-col bg-terminal-bg">
      {/* Market Header Bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-terminal-border bg-terminal-surface/50">
        <div className="flex items-center gap-4">
          {/* Back button */}
          <button
            onClick={handleCloseTrading}
            className="text-terminal-muted hover:text-white transition-colors p-1.5 hover:bg-terminal-border/30 rounded"
            title="Back to markets"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          {/* Market Info */}
          <div className="flex items-center gap-3">
            {(selectedMarket.image_url || selectedMarket.icon_url) && (
              <img
                src={selectedMarket.image_url || selectedMarket.icon_url || ''}
                alt=""
                className="w-8 h-8 rounded object-cover bg-terminal-border"
              />
            )}
            <div>
              <h2 className="text-white font-semibold text-sm leading-tight line-clamp-1 max-w-md">
                {selectedMarket.question}
              </h2>
              <div className="flex items-center gap-3 text-[10px] text-terminal-muted">
                <span className="font-mono">/{selectedMarket.slug?.slice(0, 30)}</span>
                {selectedMarket.category && (
                  <span className="px-1.5 py-0.5 bg-terminal-border/50 rounded">
                    {selectedMarket.category}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Price Display */}
        <div className="flex items-center gap-6">
          <div className="text-center">
            <div className="text-[10px] text-terminal-muted uppercase">Yes</div>
            <div className="text-neon-green font-mono font-bold">
              {((selectedMarket.outcome_yes_price || 0.5) * 100).toFixed(1)}¢
            </div>
          </div>
          <div className="text-center">
            <div className="text-[10px] text-terminal-muted uppercase">No</div>
            <div className="text-neon-red font-mono font-bold">
              {((selectedMarket.outcome_no_price || 0.5) * 100).toFixed(1)}¢
            </div>
          </div>
          <div className="text-center border-l border-terminal-border pl-6">
            <div className="text-[10px] text-terminal-muted uppercase">Volume</div>
            <div className="text-neon-amber font-mono font-bold">
              ${((selectedMarket.volume || 0) / 1_000_000).toFixed(2)}M
            </div>
          </div>
        </div>
      </div>

      {/* Main Trading Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Chart (takes most space) */}
        <div className="flex-1 flex flex-col border-r border-terminal-border">
          {/* Chart Area */}
          <div className="flex-1 p-4">
            <PriceChart
              tokenId={yesTokenId}
              yesPrice={selectedMarket.outcome_yes_price || 0.5}
              noPrice={selectedMarket.outcome_no_price || 0.5}
              fullHeight
            />
          </div>

          {/* Bottom Panel: Positions/Orders/Fills */}
          <div className="h-48 border-t border-terminal-border bg-terminal-surface/30">
            {/* Tabs */}
            <div className="flex border-b border-terminal-border">
              {(['positions', 'orders', 'fills'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setBottomTab(tab)}
                  className={`px-4 py-2 text-xs font-mono uppercase transition-colors ${
                    bottomTab === tab
                      ? 'text-neon-cyan border-b-2 border-neon-cyan bg-neon-cyan/5'
                      : 'text-terminal-muted hover:text-white'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            {/* Tab Content */}
            <div className="h-[calc(100%-37px)] overflow-auto p-2">
              {bottomTab === 'positions' && <Positions compact />}
              {bottomTab === 'orders' && <OpenOrders />}
              {bottomTab === 'fills' && <RecentFills />}
            </div>
          </div>
        </div>

        {/* Right Sidebar: Orderbook + Order Form */}
        <div className="w-80 flex flex-col bg-terminal-surface/20">
          {/* Orderbook - Top half */}
          <div className="flex-1 overflow-hidden border-b border-terminal-border">
            <Orderbook
              tokenId={yesTokenId}
              onPriceClick={handlePriceClick}
              onBestPricesChange={handleBestPricesChange}
              compact
            />
          </div>

          {/* Order Form - Bottom half */}
          <div className="flex-1 overflow-auto">
            <OrderForm
              yesTokenId={yesTokenId}
              noTokenId={selectedMarket.no_token_id || undefined}
              marketName={selectedMarket.question}
              yesPrice={selectedMarket.outcome_yes_price}
              noPrice={selectedMarket.outcome_no_price}
              currentPrice={orderPrice}
              bestBid={bestBid}
              bestAsk={bestAsk}
              onOrderPlaced={() => {}}
              compact
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// Placeholder components for orders and fills
function OpenOrders() {
  return (
    <div className="text-center text-terminal-muted text-sm py-4">
      <div className="text-xs">No open orders</div>
    </div>
  );
}

function RecentFills() {
  return (
    <div className="text-center text-terminal-muted text-sm py-4">
      <div className="text-xs">No recent fills</div>
    </div>
  );
}
