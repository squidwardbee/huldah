import { useAppStore } from '../stores/appStore';

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', { 
    hour: '2-digit', 
    minute: '2-digit', 
    second: '2-digit',
    hour12: false 
  });
}

function formatAddress(address: string): string {
  return `${address.slice(0, 6)}···${address.slice(-4)}`;
}

export function WhaleFeed() {
  const { whaleTrades, connected } = useAppStore();

  return (
    <div className="bg-terminal-surface/80 backdrop-blur border border-terminal-border rounded-lg overflow-hidden card-glow">
      {/* Header */}
      <div className="px-5 py-4 border-b border-terminal-border flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🐋</span>
          <h2 className="font-display text-xl text-neon-cyan tracking-wide">WHALE FEED</h2>
        </div>
        <div className="flex items-center gap-2">
          <span 
            className={`w-2.5 h-2.5 rounded-full ${connected ? 'bg-neon-green live-indicator' : 'bg-neon-red'}`} 
          />
          <span className={`text-xs font-mono uppercase tracking-widest ${connected ? 'text-neon-green' : 'text-neon-red'}`}>
            {connected ? 'LIVE' : 'OFFLINE'}
          </span>
        </div>
      </div>
      
      {/* Trade List */}
      <div className="max-h-[480px] overflow-y-auto">
        {whaleTrades.length === 0 ? (
          <div className="p-8 text-center">
            <div className="text-terminal-muted text-sm mb-2">[ AWAITING WHALE ACTIVITY ]</div>
            <div className="text-terminal-muted/60 text-xs">Large trades (&gt;$1000) will appear here</div>
          </div>
        ) : (
          <div className="divide-y divide-terminal-border/50">
            {whaleTrades.map((trade, i) => (
              <div 
                key={`${trade.timestamp}-${i}`}
                className="px-5 py-3 hover:bg-white/[0.02] transition-colors animate-slide-up"
                style={{ animationDelay: `${i * 20}ms` }}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <span 
                      className={`font-mono text-sm font-semibold px-2 py-0.5 rounded ${
                        trade.side === 'BUY' 
                          ? 'bg-neon-green/10 text-neon-green' 
                          : 'bg-neon-red/10 text-neon-red'
                      }`}
                    >
                      {trade.side}
                    </span>
                    <span className="text-white font-mono font-bold text-lg">
                      ${trade.usdValue.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                    </span>
                  </div>
                  <span className="text-terminal-muted text-xs font-mono">
                    {formatTime(trade.timestamp)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <a 
                    href={`https://polygonscan.com/address/${trade.wallet}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-neon-cyan/70 hover:text-neon-cyan text-sm font-mono transition-colors"
                  >
                    {formatAddress(trade.wallet)}
                  </a>
                  <span className="text-terminal-muted/60 text-xs">
                    @ {trade.price.toFixed(2)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


