import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { getMarkets } from '../../lib/tradingApi';

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

interface MarketSelectorProps {
  selectedTokenId: string | null;
  onSelectToken: (tokenId: string, market: Market) => void;
}

export function MarketSelector({ selectedTokenId, onSelectToken }: MarketSelectorProps) {
  const [search, setSearch] = useState('');
  
  const { data: markets = [], isLoading } = useQuery({
    queryKey: ['markets'],
    queryFn: () => getMarkets(100),
    staleTime: 60000,
  });

  const filteredMarkets = markets.filter((m: Market) =>
    m.question && m.question.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="bg-terminal-surface/80 border border-terminal-border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-terminal-border">
        <h3 className="text-white font-mono text-sm font-semibold mb-3">SELECT MARKET</h3>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search markets..."
          className="
            w-full bg-terminal-bg border border-terminal-border rounded-lg
            px-3 py-2 font-mono text-sm text-white
            focus:outline-none focus:border-neon-cyan
            placeholder:text-terminal-muted
          "
        />
      </div>

      {/* Markets List */}
      <div className="max-h-[400px] overflow-y-auto">
        {isLoading ? (
          <div className="p-4 space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="animate-pulse">
                <div className="h-4 bg-terminal-border/50 rounded w-3/4 mb-2" />
                <div className="h-3 bg-terminal-border/30 rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : filteredMarkets.length === 0 ? (
          <div className="p-8 text-center text-terminal-muted text-sm">
            No markets found
          </div>
        ) : (
          <div className="divide-y divide-terminal-border/30">
            {filteredMarkets.slice(0, 20).map((market: Market) => {
              // Use condition_id as identifier for now - actual token_id fetched on demand
              const tokenId = market.condition_id;
              const isSelected = selectedTokenId === tokenId;

              return (
                <button
                  key={market.condition_id}
                  onClick={() => onSelectToken(tokenId, market)}
                  className={`
                    w-full px-4 py-3 text-left transition-colors
                    ${isSelected 
                      ? 'bg-neon-cyan/10 border-l-2 border-neon-cyan' 
                      : 'hover:bg-terminal-bg border-l-2 border-transparent'
                    }
                    ${market.resolved ? 'opacity-60' : ''}
                  `}
                >
                  <div className="flex items-start gap-2">
                    <div className="text-white text-sm leading-tight mb-1 line-clamp-2 flex-1">
                      {market.question}
                    </div>
                    {market.resolved && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-terminal-muted/20 text-terminal-muted rounded shrink-0">
                        RESOLVED
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-terminal-muted">
                      Vol: <span className="text-neon-amber">${((market.volume || 0) / 1000000).toFixed(1)}M</span>
                    </span>
                    <span className="text-terminal-muted truncate">
                      /{market.slug}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

