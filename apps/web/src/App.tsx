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

function Dashboard() {
  useWhaleFeed();
  const [activeTab, setActiveTab] = useState<Tab>('intelligence');
  const { isAuthenticated } = useAuthStore();

  return (
    <div className="min-h-screen p-6 md:p-8">
      {/* Header */}
      <header className="mb-6 animate-fade-in">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          {/* Logo & Title */}
          <div>
            <div className="flex items-center gap-4 mb-2">
              <div className="w-3 h-3 bg-neon-cyan rounded-full animate-pulse" />
              <h1 className="font-display text-3xl md:text-4xl text-white tracking-tight">
                HULDAH<span className="text-neon-cyan">.AI</span>
              </h1>
            </div>
            <p className="text-terminal-muted text-xs tracking-widest uppercase pl-7">
              Polymarket Intelligence & Execution Terminal
            </p>
          </div>
          
          {/* Wallet Connection */}
          <div className="pl-7 lg:pl-0">
            <ConnectWallet />
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav className="mt-6 flex gap-1 border-b border-terminal-border">
          <TabButton 
            active={activeTab === 'intelligence'} 
            onClick={() => setActiveTab('intelligence')}
          >
            <span className="hidden sm:inline">🔍</span> INTELLIGENCE
          </TabButton>
          <TabButton 
            active={activeTab === 'trading'} 
            onClick={() => setActiveTab('trading')}
            badge={isAuthenticated ? undefined : 'SIGN IN'}
          >
            <span className="hidden sm:inline">⚡</span> TRADING
          </TabButton>
        </nav>
      </header>

      {/* Content */}
      <main className="animate-fade-in" style={{ animationDelay: '100ms' }}>
        {activeTab === 'intelligence' ? (
          <IntelligenceView />
        ) : (
          <TradingView />
        )}
      </main>

      {/* Footer */}
      <footer className="mt-12 text-center text-terminal-muted/40 text-xs">
        <span className="font-mono">v2.0.0</span>
        <span className="mx-3">|</span>
        <span>Real-time prediction market intelligence & execution</span>
      </footer>
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
        relative px-6 py-3 font-mono text-sm font-semibold transition-all
        border-b-2 -mb-[2px]
        ${active 
          ? 'text-neon-cyan border-neon-cyan bg-neon-cyan/5' 
          : 'text-terminal-muted border-transparent hover:text-white hover:bg-terminal-surface/50'
        }
      `}
    >
      {children}
      {badge && (
        <span className="ml-2 px-1.5 py-0.5 text-[10px] bg-neon-amber/20 text-neon-amber rounded">
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
