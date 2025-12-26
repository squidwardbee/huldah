import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { useState, useMemo, useRef, useEffect } from 'react';
import { WhaleFeed } from './components/WhaleFeed';
import { TopWallets } from './components/TopWallets';
import { TradingView } from './components/trading';
import { ConnectWallet } from './components/ConnectWallet';
import { useWhaleFeed } from './hooks/useWhaleFeed';
import { wagmiConfig } from './lib/wagmi';
import { useAuthStore } from './stores/authStore';
import { getMarketsSimple, type Market } from './lib/tradingApi';
import { getTopWallets } from './lib/api';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 10000,
    },
  },
});

type Tab = 'intelligence' | 'trading';

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
  const [activeTab, setActiveTab] = useState<Tab>('intelligence');
  const [selectedMarketFromSearch, setSelectedMarketFromSearch] = useState<Market | null>(null);
  const { isAuthenticated } = useAuthStore();

  // Handle market selection from search
  const handleSelectMarket = (market: Market) => {
    setSelectedMarketFromSearch(market);
    setActiveTab('trading');
  };

  // Handle wallet selection from search (copy to clipboard)
  const handleSelectWallet = (address: string) => {
    navigator.clipboard.writeText(address);
    // Could also navigate to wallet detail view in future
  };

  return (
    <div className="h-full flex flex-col">
      {/* Compact Header */}
      <header className="bg-terminal-bg/95 backdrop-blur border-b border-terminal-border px-4 py-2 animate-fade-in">
        <div className="flex items-center justify-between gap-4">
          {/* Left: Logo + Tabs */}
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
                active={activeTab === 'intelligence'}
                onClick={() => setActiveTab('intelligence')}
              >
                INTELLIGENCE
              </TabButton>
              <TabButton
                active={activeTab === 'trading'}
                onClick={() => setActiveTab('trading')}
                badge={isAuthenticated ? undefined : 'SIGN IN'}
              >
                TRADING
              </TabButton>
            </nav>
          </div>

          {/* Right: Search + Wallet */}
          <div className="flex items-center gap-4">
            <SearchBar
              onSelectMarket={handleSelectMarket}
              onSelectWallet={handleSelectWallet}
            />
            <ConnectWallet />
          </div>
        </div>
      </header>

      {/* Content - Full height */}
      <main className="flex-1 animate-fade-in overflow-hidden" style={{ animationDelay: '100ms' }}>
        {activeTab === 'intelligence' ? (
          <div className="h-full p-4">
            <IntelligenceView />
          </div>
        ) : (
          <TradingView
            initialMarket={selectedMarketFromSearch}
            onMarketCleared={() => setSelectedMarketFromSearch(null)}
          />
        )}
      </main>
    </div>
  );
}

function IntelligenceView() {
  return (
    <>
      {/* Stats Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard label="TRACKING" value="ACTIVE" accent="cyan" />
        <StatCard label="THRESHOLD" value="$1,000" accent="magenta" />
        <StatCard label="DATA SOURCE" value="POLYMARKET" accent="amber" />
        <StatCard label="LATENCY" value="~2s" accent="green" />
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <WhaleFeed />
        <TopWallets />
      </div>
    </>
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

function StatCard({ 
  label, 
  value, 
  accent 
}: { 
  label: string; 
  value: string; 
  accent: 'cyan' | 'magenta' | 'amber' | 'green';
}) {
  const accentColors = {
    cyan: 'border-neon-cyan/30 text-neon-cyan',
    magenta: 'border-neon-magenta/30 text-neon-magenta',
    amber: 'border-neon-amber/30 text-neon-amber',
    green: 'border-neon-green/30 text-neon-green',
  };

  return (
    <div className={`bg-terminal-surface/60 border ${accentColors[accent].split(' ')[0]} rounded-lg px-4 py-3`}>
      <div className="text-terminal-muted text-xs tracking-widest uppercase mb-1">{label}</div>
      <div className={`font-mono font-semibold ${accentColors[accent].split(' ')[1]}`}>{value}</div>
    </div>
  );
}

export default function App() {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <Dashboard />
      </QueryClientProvider>
    </WagmiProvider>
  );
}
