import { useState, useCallback, useEffect } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { MarketGrid } from './MarketGrid';
import { Orderbook } from './Orderbook';
import { Trades } from './Trades';
import { OrderForm } from './OrderForm';
import { Positions } from './Positions';
import { PriceChart } from './PriceChart';
import { useAuthStore } from '../../stores/authStore';
import { useWalletTrading } from '../../hooks/useWalletTrading';
import { getCredentialsStatus, type Market } from '../../lib/tradingApi';

type BottomTab = 'positions' | 'orders' | 'fills';
type OutcomeView = 'YES' | 'NO';
type RightPanelView = 'book' | 'trades';

// Custom resize handle component - larger hit area, subtle line on hover
function ResizeHandle({ direction = 'horizontal' }: { direction?: 'horizontal' | 'vertical' }) {
  return (
    <PanelResizeHandle
      className={`
        ${direction === 'horizontal' ? 'h-2 cursor-row-resize' : 'w-2 cursor-col-resize'}
        bg-terminal-border/20
        hover:bg-neon-cyan/40
        active:bg-neon-cyan/60
        transition-colors
        data-[resize-handle-active]:bg-neon-cyan/60
      `}
    />
  );
}

// Collapsible panel header
function PanelHeader({
  title,
  collapsed,
  onToggle,
}: {
  title: string;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between px-2 py-1 border-b border-terminal-border bg-terminal-surface/50 shrink-0">
      <span className="text-[9px] font-mono font-bold text-terminal-muted uppercase">{title}</span>
      <button
        onClick={onToggle}
        className="text-terminal-muted hover:text-white transition-colors p-0.5"
        title={collapsed ? 'Expand' : 'Collapse'}
      >
        <svg
          className={`w-3 h-3 transition-transform ${collapsed ? 'rotate-90' : '-rotate-90'}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
      </button>
    </div>
  );
}

interface TradingViewProps {
  initialMarket?: Market | null;
  onMarketCleared?: () => void;
}

export function TradingView({ initialMarket, onMarketCleared }: TradingViewProps) {
  const { token, isAuthenticated, credentialsChecked, setHasCredentials, user } = useAuthStore();
  const { balance } = useWalletTrading();
  const [selectedMarket, setSelectedMarket] = useState<Market | null>(null);
  const [orderPrice, setOrderPrice] = useState<number>(0.5);
  const [bestBid, setBestBid] = useState<number | undefined>();
  const [bestAsk, setBestAsk] = useState<number | undefined>();
  const [bottomTab, setBottomTab] = useState<BottomTab>('positions');
  const [outcomeView, setOutcomeView] = useState<OutcomeView>('YES');
  const [showAnalysis, setShowAnalysis] = useState(false);

  // Collapsed states for right panels
  const [orderbookCollapsed, setOrderbookCollapsed] = useState(false);
  const [orderFormCollapsed, setOrderFormCollapsed] = useState(false);
  const [rightPanelView, setRightPanelView] = useState<RightPanelView>('book');

  // Format balance for display
  const formattedBalance = balance ? `$${(parseFloat(balance) / 1e6).toFixed(2)}` : '-';

  // Handle initial market from search
  useEffect(() => {
    if (initialMarket) {
      setSelectedMarket(initialMarket);
      setOrderPrice(initialMarket.outcome_yes_price || 0.5);
    }
  }, [initialMarket]);

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
    onMarketCleared?.();
  };

  const yesTokenId = selectedMarket?.yes_token_id || selectedMarket?.condition_id || '';
  const noTokenId = selectedMarket?.no_token_id || '';
  const activeTokenId = outcomeView === 'YES' ? yesTokenId : noTokenId;

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

  // Full-screen trading terminal layout using react-resizable-panels
  return (
    <div className="h-full flex flex-col bg-terminal-bg overflow-hidden">
      {/* Market Header Bar */}
      <div className="flex items-center justify-between px-2 py-1 border-b border-terminal-border bg-terminal-surface/50 shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={handleCloseTrading}
            className="text-terminal-muted hover:text-white transition-colors p-0.5 hover:bg-terminal-border/30 rounded"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h2 className="text-white font-semibold text-[10px] leading-tight line-clamp-1 max-w-[200px]">
            {selectedMarket.question}
          </h2>
          {/* YES/NO Toggle */}
          <div className="flex border border-terminal-border rounded overflow-hidden">
            <button
              onClick={() => setOutcomeView('YES')}
              className={`px-1.5 py-0.5 text-[9px] font-mono font-bold transition-all ${
                outcomeView === 'YES' ? 'bg-neon-green/20 text-neon-green' : 'text-terminal-muted hover:text-white'
              }`}
            >
              YES
            </button>
            <button
              onClick={() => setOutcomeView('NO')}
              className={`px-1.5 py-0.5 text-[9px] font-mono font-bold transition-all ${
                outcomeView === 'NO' ? 'bg-neon-red/20 text-neon-red' : 'text-terminal-muted hover:text-white'
              }`}
            >
              NO
            </button>
          </div>
        </div>
        <div className="flex items-center gap-3 text-[9px]">
          {/* Market Stats */}
          <div className="flex items-center gap-0.5">
            <span className={outcomeView === 'YES' ? 'text-neon-green' : 'text-terminal-muted'}>Y</span>
            <span className="text-neon-green font-mono font-bold">
              {((selectedMarket.outcome_yes_price || 0.5) * 100).toFixed(0)}¢
            </span>
          </div>
          <div className="flex items-center gap-0.5">
            <span className={outcomeView === 'NO' ? 'text-neon-red' : 'text-terminal-muted'}>N</span>
            <span className="text-neon-red font-mono font-bold">
              {((selectedMarket.outcome_no_price || 0.5) * 100).toFixed(0)}¢
            </span>
          </div>
          <div className="flex items-center gap-0.5 border-l border-terminal-border pl-2">
            <span className="text-terminal-muted">VOL</span>
            <span className="text-neon-amber font-mono">${((selectedMarket.volume || 0) / 1_000_000).toFixed(1)}M</span>
          </div>
          {/* User Stats */}
          {isAuthenticated && (
            <>
              <div className="flex items-center gap-0.5 border-l border-terminal-border pl-2">
                <span className="text-terminal-muted">BAL</span>
                <span className="text-neon-cyan font-mono">{formattedBalance}</span>
              </div>
              <div className="flex items-center gap-0.5">
                <span className="text-terminal-muted">PNL</span>
                <span className={`font-mono ${(user?.realizedPnl || 0) >= 0 ? 'text-neon-green' : 'text-neon-red'}`}>
                  {(user?.realizedPnl || 0) >= 0 ? '+' : ''}{(user?.realizedPnl || 0).toFixed(0)}
                </span>
              </div>
              <div className="flex items-center gap-0.5">
                <span className="text-terminal-muted">ORD</span>
                <span className="text-white font-mono">{user?.totalOrders || 0}</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Main Content - Resizable Panels */}
      <PanelGroup
        direction="horizontal"
        autoSaveId="trading-terminal-main-v2"
        className="flex-1 min-h-0"
      >
        {/* Left Panel: Chart + Positions */}
        <Panel defaultSize={70} minSize={40}>
          <PanelGroup
            direction="vertical"
            autoSaveId="trading-terminal-left-v2"
            className="h-full"
          >
            {/* Chart Panel - expandable to nearly full height */}
            <Panel defaultSize={70} minSize={10}>
              <div className="h-full p-2">
                <PriceChart tokenId={activeTokenId} outcome={outcomeView} />
              </div>
            </Panel>

            <ResizeHandle direction="horizontal" />

            {/* Bottom Panel: Positions/Orders/Fills - can shrink to nothing */}
            <Panel defaultSize={30} minSize={0}>
              <div className="h-full flex flex-col bg-terminal-surface/30 overflow-hidden">
                <div className="flex items-center justify-between border-b border-terminal-border shrink-0">
                  <div className="flex">
                    {(['positions', 'orders', 'fills'] as const).map((tab) => (
                      <button
                        key={tab}
                        onClick={() => setBottomTab(tab)}
                        className={`px-3 py-1.5 text-[10px] font-mono uppercase transition-colors ${
                          bottomTab === tab
                            ? 'text-neon-cyan border-b-2 border-neon-cyan bg-neon-cyan/5'
                            : 'text-terminal-muted hover:text-white'
                        }`}
                      >
                        {tab}
                      </button>
                    ))}
                  </div>
                  {/* Huldah Analysis Toggle */}
                  <button
                    onClick={() => setShowAnalysis(!showAnalysis)}
                    className={`px-2 py-1.5 text-[9px] font-mono transition-colors flex items-center gap-1 ${
                      showAnalysis ? 'text-neon-magenta' : 'text-terminal-muted hover:text-neon-magenta'
                    }`}
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                    AI
                  </button>
                </div>

                {/* Huldah Analysis - expandable inline */}
                {showAnalysis && (
                  <div className="px-3 py-2 border-b border-terminal-border/50 bg-neon-magenta/5 text-[10px] flex items-center gap-6 shrink-0">
                    <span className="text-neon-magenta font-mono font-bold">HULDAH</span>
                    <div className="flex items-center gap-1">
                      <span className="text-terminal-muted">Whale:</span>
                      <span className="text-neon-amber font-mono">Mod</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-terminal-muted">Smart $:</span>
                      <span className="text-neon-green font-mono">65% Y</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-terminal-muted">Insider:</span>
                      <span className="text-terminal-muted font-mono">None</span>
                    </div>
                  </div>
                )}

                <div className="flex-1 overflow-auto p-2">
                  {bottomTab === 'positions' && <Positions compact />}
                  {bottomTab === 'orders' && <OpenOrders />}
                  {bottomTab === 'fills' && <RecentFills />}
                </div>
              </div>
            </Panel>
          </PanelGroup>
        </Panel>

        <ResizeHandle direction="vertical" />

        {/* Right Panel: Orderbook + Order Form */}
        <Panel defaultSize={30} minSize={15} maxSize={50}>
          <PanelGroup
            direction="horizontal"
            autoSaveId="trading-terminal-right-v2"
            className="h-full"
          >
            {/* Orderbook/Trades Panel */}
            <Panel
              defaultSize={orderbookCollapsed ? 5 : 50}
              minSize={orderbookCollapsed ? 5 : 20}
              maxSize={orderbookCollapsed ? 5 : 80}
              collapsible
              collapsedSize={5}
              onCollapse={() => setOrderbookCollapsed(true)}
              onExpand={() => setOrderbookCollapsed(false)}
            >
              <div className="h-full flex flex-col border-r border-terminal-border overflow-hidden relative">
                {/* Panel header with Book/Trades toggle */}
                <div className="flex items-center justify-between px-2 py-1 border-b border-terminal-border bg-terminal-surface/50 shrink-0">
                  {!orderbookCollapsed && (
                    <div className="flex border border-terminal-border rounded overflow-hidden">
                      <button
                        onClick={() => setRightPanelView('book')}
                        className={`px-1.5 py-0.5 text-[8px] font-mono font-bold transition-all ${
                          rightPanelView === 'book' ? 'bg-neon-cyan/20 text-neon-cyan' : 'text-terminal-muted hover:text-white'
                        }`}
                      >
                        BOOK
                      </button>
                      <button
                        onClick={() => setRightPanelView('trades')}
                        className={`px-1.5 py-0.5 text-[8px] font-mono font-bold transition-all ${
                          rightPanelView === 'trades' ? 'bg-neon-cyan/20 text-neon-cyan' : 'text-terminal-muted hover:text-white'
                        }`}
                      >
                        TRADES
                      </button>
                    </div>
                  )}
                  <button
                    onClick={() => setOrderbookCollapsed(!orderbookCollapsed)}
                    className="text-terminal-muted hover:text-white transition-colors p-0.5 ml-auto"
                    title={orderbookCollapsed ? 'Expand' : 'Collapse'}
                  >
                    <svg
                      className={`w-3 h-3 transition-transform ${orderbookCollapsed ? 'rotate-90' : '-rotate-90'}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                </div>
                {/* Content area - always render Orderbook hidden to maintain price updates */}
                <div className={orderbookCollapsed ? 'absolute opacity-0 pointer-events-none' : 'flex-1 overflow-hidden'}>
                  {/* Orderbook - hidden when trades view active but still fetching */}
                  <div className={rightPanelView === 'book' ? 'h-full' : 'absolute opacity-0 pointer-events-none'}>
                    <Orderbook
                      tokenId={activeTokenId}
                      onPriceClick={handlePriceClick}
                      onBestPricesChange={handleBestPricesChange}
                      compact
                    />
                  </div>
                  {/* Trades - only visible when selected */}
                  {rightPanelView === 'trades' && (
                    <div className="h-full">
                      <Trades tokenId={activeTokenId} compact />
                    </div>
                  )}
                </div>
                {orderbookCollapsed && (
                  <div className="flex-1 flex items-center justify-center">
                    <span
                      className="text-[9px] font-mono text-terminal-muted"
                      style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
                    >
                      {rightPanelView === 'book' ? 'BOOK' : 'TRADES'}
                    </span>
                  </div>
                )}
              </div>
            </Panel>

            <ResizeHandle direction="vertical" />

            {/* Order Form Panel */}
            <Panel
              defaultSize={orderFormCollapsed ? 5 : 50}
              minSize={orderFormCollapsed ? 5 : 20}
              maxSize={orderFormCollapsed ? 5 : 80}
              collapsible
              collapsedSize={5}
              onCollapse={() => setOrderFormCollapsed(true)}
              onExpand={() => setOrderFormCollapsed(false)}
            >
              <div className="h-full flex flex-col overflow-hidden">
                <PanelHeader
                  title=""
                  collapsed={orderFormCollapsed}
                  onToggle={() => setOrderFormCollapsed(!orderFormCollapsed)}
                />
                {!orderFormCollapsed && (
                  <div className="flex-1 overflow-hidden">
                    <OrderForm
                      yesTokenId={activeTokenId}
                      noTokenId={undefined}
                      marketName={`${selectedMarket.question} (${outcomeView})`}
                      yesPrice={outcomeView === 'YES' ? selectedMarket.outcome_yes_price : selectedMarket.outcome_no_price}
                      noPrice={outcomeView === 'YES' ? selectedMarket.outcome_no_price : selectedMarket.outcome_yes_price}
                      currentPrice={orderPrice}
                      bestBid={bestBid}
                      bestAsk={bestAsk}
                      onOrderPlaced={() => {}}
                      compact
                    />
                  </div>
                )}
                {orderFormCollapsed && (
                  <div className="flex-1 flex items-center justify-center">
                    <span
                      className="text-terminal-muted text-[9px] font-mono"
                      style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
                    >
                      ORDER
                    </span>
                  </div>
                )}
              </div>
            </Panel>
          </PanelGroup>
        </Panel>
      </PanelGroup>
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
