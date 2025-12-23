import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WhaleFeed } from './components/WhaleFeed';
import { TopWallets } from './components/TopWallets';
import { useWhaleFeed } from './hooks/useWhaleFeed';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 10000,
    },
  },
});

function Dashboard() {
  useWhaleFeed();

  return (
    <div className="min-h-screen p-6 md:p-8">
      {/* Header */}
      <header className="mb-10 animate-fade-in">
        <div className="flex items-center gap-4 mb-3">
          <div className="w-3 h-3 bg-neon-cyan rounded-full animate-pulse" />
          <h1 className="font-display text-4xl md:text-5xl text-white tracking-tight">
            HULDAH<span className="text-neon-cyan">.AI</span>
          </h1>
        </div>
        <p className="text-terminal-muted text-sm tracking-widest uppercase pl-7">
          Polymarket Whale Intelligence Terminal
        </p>
      </header>

      {/* Stats Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8 animate-fade-in" style={{ animationDelay: '100ms' }}>
        <StatCard label="TRACKING" value="ACTIVE" accent="cyan" />
        <StatCard label="THRESHOLD" value="$1,000" accent="magenta" />
        <StatCard label="DATA SOURCE" value="POLYMARKET" accent="amber" />
        <StatCard label="LATENCY" value="~2s" accent="green" />
      </div>

      {/* Main Grid */}
      <div 
        className="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-fade-in" 
        style={{ animationDelay: '200ms' }}
      >
        <WhaleFeed />
        <TopWallets />
      </div>

      {/* Footer */}
      <footer className="mt-12 text-center text-terminal-muted/40 text-xs">
        <span className="font-mono">v1.0.0</span>
        <span className="mx-3">|</span>
        <span>Real-time prediction market intelligence</span>
      </footer>
    </div>
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
    <QueryClientProvider client={queryClient}>
      <Dashboard />
    </QueryClientProvider>
  );
}


