import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { useState } from 'react';
import { WhaleFeed } from './components/WhaleFeed';
import { TopWallets } from './components/TopWallets';
import { TradingView } from './components/trading';
import { ConnectWallet } from './components/ConnectWallet';
import { useWhaleFeed } from './hooks/useWhaleFeed';
import { wagmiConfig } from './lib/wagmi';
import { useAuthStore } from './stores/authStore';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 10000,
    },
  },
});

type Tab = 'intelligence' | 'trading';

function SearchBar() {
  const [query, setQuery] = useState('');

  return (
    <div className="relative">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search markets or wallets..."
        className="w-64 bg-terminal-surface/80 border border-terminal-border rounded px-3 py-1.5 text-sm text-white placeholder-terminal-muted focus:outline-none focus:border-neon-cyan/50 font-mono"
      />
      <svg
        className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-terminal-muted"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
    </div>
  );
}

function Dashboard() {
  useWhaleFeed();
  const [activeTab, setActiveTab] = useState<Tab>('intelligence');
  const { isAuthenticated } = useAuthStore();

  return (
    <div className="min-h-screen flex flex-col">
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
            <SearchBar />
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
          <TradingView />
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
