import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { useState, useMemo, useRef, useEffect } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { WhaleFeed } from './components/WhaleFeed';
import { TopWallets } from './components/TopWallets';
import { TradingView } from './components/trading';
import { ConnectWallet } from './components/ConnectWallet';
import { FeaturedMarkets, GlobalNews } from './components/home';
import { WalletsPage } from './pages/WalletsPage';
import { useWhaleFeed } from './hooks/useWhaleFeed';
import { useWalletTrading } from './hooks/useWalletTrading';
import { wagmiConfig } from './lib/wagmi';
import { useAuthStore } from './stores/authStore';
import { getMarketsSimple, type Market } from './lib/tradingApi';
import { getTopWallets, type FeaturedMarket } from './lib/api';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 10000,
    },
  },
});

// Balance display component for header
function BalanceDisplay() {
  const { balance } = useWalletTrading();
  const { isAuthenticated } = useAuthStore();

  if (!isAuthenticated || !balance) return null;

  const formattedBalance = (parseFloat(balance) / 1e6).toFixed(2);

  return (
    <div className="flex items-center gap-1.5 px-2 py-1 bg-terminal-surface/50 border border-terminal-border rounded text-xs font-mono">
      <span className="text-terminal-muted">BAL:</span>
      <span className="text-neon-green">${formattedBalance}</span>
    </div>
  );
}

interface SearchBarProps {
  onSelectMarket?: (market: Market) => void;
  onSelectWallet?: (address: string) => void;
}

function SearchBar({ onSelectMarket, onSelectWallet }: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fetch data for search
  const { data: markets = [] } = useQuery({
    queryKey: ['markets-search'],
    queryFn: () => getMarketsSimple(200),
    staleTime: 60000,
  });

  const { data: wallets = [] } = useQuery({
    queryKey: ['topWallets'],
    queryFn: getTopWallets,
    staleTime: 60000,
  });

  // Filter results based on query
  const searchResults = useMemo(() => {
    if (!query || query.length < 2) return { markets: [], wallets: [] };

    const q = query.toLowerCase();

    // Search markets by question
    const matchedMarkets = markets
      .filter((m: Market) => m.question?.toLowerCase().includes(q))
      .slice(0, 5);

    // Search wallets by address
    const matchedWallets = (wallets as { address: string; smart_money_score?: number }[])
      .filter((w) => w.address?.toLowerCase().includes(q))
      .slice(0, 5);

    return { markets: matchedMarkets, wallets: matchedWallets };
  }, [query, markets, wallets]);

  const hasResults = searchResults.markets.length > 0 || searchResults.wallets.length > 0;

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={dropdownRef}>
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setShowDropdown(true);
        }}
        onFocus={() => setShowDropdown(true)}
        placeholder="Search markets or wallets..."
        className="w-56 bg-terminal-surface/80 border border-terminal-border rounded px-3 py-1 text-xs text-white placeholder-terminal-muted focus:outline-none focus:border-neon-cyan/50 font-mono"
      />
      <svg
        className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-terminal-muted"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>

      {/* Dropdown */}
      {showDropdown && query.length >= 2 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-terminal-surface border border-terminal-border rounded-lg shadow-xl z-50 max-h-80 overflow-auto">
          {!hasResults ? (
            <div className="px-3 py-2 text-terminal-muted text-xs">No results found</div>
          ) : (
            <>
              {/* Markets */}
              {searchResults.markets.length > 0 && (
                <div>
                  <div className="px-3 py-1 text-[9px] text-terminal-muted uppercase border-b border-terminal-border">Markets</div>
                  {searchResults.markets.map((market: Market) => (
                    <button
                      key={market.condition_id}
                      onClick={() => {
                        onSelectMarket?.(market);
                        setQuery('');
                        setShowDropdown(false);
                      }}
                      className="w-full px-3 py-2 text-left hover:bg-terminal-border/30 transition-colors flex items-center gap-2"
                    >
                      {market.image_url && (
                        <img src={market.image_url} alt="" className="w-5 h-5 rounded object-cover" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-white text-xs truncate">{market.question}</div>
                        <div className="text-terminal-muted text-[10px]">
                          <span className="text-neon-green">{((market.outcome_yes_price || 0.5) * 100).toFixed(0)}%</span>
                          {' · '}${((market.volume || 0) / 1000).toFixed(0)}K vol
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* Wallets */}
              {searchResults.wallets.length > 0 && (
                <div>
                  <div className="px-3 py-1 text-[9px] text-terminal-muted uppercase border-b border-terminal-border">Wallets</div>
                  {searchResults.wallets.map((wallet: { address: string; smart_money_score?: number }) => (
                    <button
                      key={wallet.address}
                      onClick={() => {
                        onSelectWallet?.(wallet.address);
                        setQuery('');
                        setShowDropdown(false);
                      }}
                      className="w-full px-3 py-2 text-left hover:bg-terminal-border/30 transition-colors"
                    >
                      <div className="text-white text-xs font-mono">
                        {wallet.address.slice(0, 8)}...{wallet.address.slice(-6)}
                      </div>
                      {wallet.smart_money_score !== undefined && (
                        <div className="text-terminal-muted text-[10px]">
                          Score: <span className="text-neon-cyan">{wallet.smart_money_score.toFixed(1)}</span>
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Dashboard() {
  useWhaleFeed();
  const navigate = useNavigate();
  const location = useLocation();
  const [selectedMarketFromSearch, setSelectedMarketFromSearch] = useState<Market | null>(null);
  const [tradingViewKey, setTradingViewKey] = useState(0);
  const { isAuthenticated } = useAuthStore();

  const activeTab = location.pathname === '/wallets' ? 'wallets'
    : location.pathname === '/trading' ? 'trading'
    : 'home';

  // Handle market selection from search
  const handleSelectMarket = (market: Market) => {
    setSelectedMarketFromSearch(market);
    navigate('/trading');
  };

  // Handle market selection from featured markets
  const handleSelectFeaturedMarket = (featured: FeaturedMarket) => {
    // Convert FeaturedMarket to Market format
    const market: Market = {
      condition_id: featured.condition_id,
      question: featured.question,
      slug: featured.slug,
      outcome_yes_price: featured.outcome_yes_price,
      outcome_no_price: featured.outcome_no_price,
      volume: featured.volume,
      liquidity: featured.liquidity,
      resolved: false,
      resolution_outcome: null,
      end_date: featured.end_date,
      yes_token_id: featured.yes_token_id,
      no_token_id: featured.no_token_id,
      image_url: featured.image_url,
      icon_url: featured.icon_url,
      category: featured.category,
      volume_24h: featured.volume_24h,
      price_change_24h: featured.price_change_24h,
      best_bid: featured.best_bid,
      best_ask: featured.best_ask,
    };
    setSelectedMarketFromSearch(market);
    navigate('/trading');
  };

  // Handle clicking Trading tab - reset to market list
  const handleTradingClick = () => {
    if (activeTab === 'trading') {
      // Already on trading, reset to market list by incrementing key
      setSelectedMarketFromSearch(null);
      setTradingViewKey(k => k + 1);
    } else {
      navigate('/trading');
    }
  };

  // Handle wallet selection from search (copy to clipboard)
  const handleSelectWallet = (address: string) => {
    navigator.clipboard.writeText(address);
  };

  return (
    <div className="h-full flex flex-col">
      {/* Compact Header with logo offset */}
      <header className="bg-terminal-bg/95 backdrop-blur border-b border-terminal-border py-2 animate-fade-in">
        <div className="flex items-center justify-between gap-4 px-4">
          {/* Left spacer + Logo + Tabs */}
          <div className="flex items-center">
            {/* Left spacer to push logo ~20% from left */}
            <div className="w-[calc(20vw-120px)] min-w-0 max-w-32" />

            <div className="flex items-center gap-6">
              {/* Logo */}
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-neon-cyan rounded-full animate-pulse" />
                <h1 className="font-display text-lg text-white tracking-tight">
                  HULDAH<span className="text-neon-cyan">.AI</span>
                </h1>
              </div>

              {/* Navigation Tabs */}
              <nav className="flex gap-1">
                <TabButton
                  active={activeTab === 'home'}
                  onClick={() => navigate('/home')}
                >
                  HOME
                </TabButton>
                <TabButton
                  active={activeTab === 'trading'}
                  onClick={handleTradingClick}
                  badge={isAuthenticated ? undefined : 'SIGN IN'}
                >
                  TRADING
                </TabButton>
                <TabButton
                  active={activeTab === 'wallets'}
                  onClick={() => navigate('/wallets')}
                >
                  WALLETS
                </TabButton>
              </nav>
            </div>
          </div>

          {/* Right: Balance + Search + Wallet */}
          <div className="flex items-center">
            <div className="flex items-center gap-3">
              <BalanceDisplay />
              <SearchBar
                onSelectMarket={handleSelectMarket}
                onSelectWallet={handleSelectWallet}
              />
              <ConnectWallet />
            </div>
            {/* Right spacer to push content ~20% from right */}
            <div className="w-[calc(20vw-120px)] min-w-0 max-w-32" />
          </div>
        </div>
      </header>

      {/* Content - Full height */}
      <main className="flex-1 animate-fade-in overflow-hidden" style={{ animationDelay: '100ms' }}>
        <Routes>
          <Route path="/home" element={
            <div className="h-full p-4 overflow-y-auto">
              <HomeView onSelectMarket={handleSelectFeaturedMarket} />
            </div>
          } />
          <Route path="/trading" element={
            <TradingView
              key={tradingViewKey}
              initialMarket={selectedMarketFromSearch}
              onMarketCleared={() => setSelectedMarketFromSearch(null)}
            />
          } />
          <Route path="/wallets" element={<WalletsPage />} />
          <Route path="/" element={
            <div className="h-full p-4 overflow-y-auto">
              <HomeView onSelectMarket={handleSelectFeaturedMarket} />
            </div>
          } />
          <Route path="*" element={
            <div className="h-full p-4 overflow-y-auto">
              <HomeView onSelectMarket={handleSelectFeaturedMarket} />
            </div>
          } />
        </Routes>
      </main>
    </div>
  );
}

interface HomeViewProps {
  onSelectMarket: (market: FeaturedMarket) => void;
}

function HomeView({ onSelectMarket }: HomeViewProps) {
  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Primary row: Featured Markets + Global News */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <FeaturedMarkets onSelectMarket={onSelectMarket} />
        <GlobalNews />
      </div>

      {/* Secondary row: Whale Feed + Top Wallets (smaller) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="max-h-80 overflow-hidden">
          <WhaleFeed compact />
        </div>
        <div className="max-h-80 overflow-hidden">
          <TopWallets compact />
        </div>
      </div>
    </div>
  );
}

function TabButton({
  children,
  active,
  onClick,
  badge,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  badge?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`
        relative px-3 py-1.5 font-mono text-xs font-semibold transition-all rounded
        ${active
          ? 'text-neon-cyan bg-neon-cyan/10'
          : 'text-terminal-muted hover:text-white hover:bg-terminal-surface/50'
        }
      `}
    >
      {children}
      {badge && (
        <span className="ml-1.5 px-1 py-0.5 text-[9px] bg-neon-amber/20 text-neon-amber rounded">
          {badge}
        </span>
      )}
    </button>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          <Dashboard />
        </QueryClientProvider>
      </WagmiProvider>
    </BrowserRouter>
  );
}
