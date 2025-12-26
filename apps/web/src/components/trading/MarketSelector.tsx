import { useInfiniteQuery } from '@tanstack/react-query';
import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { getMarkets, type Market } from '../../lib/tradingApi';

interface MarketSelectorProps {
  selectedTokenId: string | null;
  onSelectToken: (tokenId: string, market: Market) => void;
}

const PAGE_SIZE = 100;

export function MarketSelector({ selectedTokenId, onSelectToken }: MarketSelectorProps) {
  const [search, setSearch] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const {
    data,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['markets-selector'],
    queryFn: async ({ pageParam = 0 }) => {
      const response = await getMarkets(PAGE_SIZE, undefined, pageParam);
      return response;
    },
    getNextPageParam: (lastPage) => {
      if (lastPage.pagination.hasMore) {
        return lastPage.pagination.offset + lastPage.pagination.limit;
      }
      return undefined;
    },
    initialPageParam: 0,
    staleTime: 60000,
  });

  // Auto-fetch more pages until we hit max
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && !isLoading) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, isLoading, fetchNextPage]);

  // Flatten all pages into a single array
  const allMarkets = useMemo(() => {
    if (!data?.pages) return [];
    return data.pages.flatMap(page => page.markets);
  }, [data]);

  // Filter by search, only show open markets with tradeable prices
  const filteredMarkets = useMemo(() => {
    const now = Date.now();
    return allMarkets
      .filter((m: Market) => {
        if (!m.question) return false;
        if (m.resolved) return false; // Only open markets
        // Skip markets that have already ended
        if (m.end_date) {
          const endTime = new Date(m.end_date).getTime();
          if (endTime < now) return false;
        }
        if (search && !m.question.toLowerCase().includes(search.toLowerCase())) return false;

        // Filter for tradeable prices (0.01 to 0.99 = 1¢ to 99¢)
        const price = m.outcome_yes_price || 0.5;
        const isTradeable = price >= 0.01 && price <= 0.99;

        return isTradeable;
      })
      // Sort by volume (most liquid first)
      .sort((a: Market, b: Market) => (b.volume || 0) - (a.volume || 0));
  }, [allMarkets, search]);

  // Infinite scroll handler
  const handleScroll = useCallback(() => {
    if (!scrollRef.current || !hasNextPage || isFetchingNextPage) return;

    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    if (scrollTop + clientHeight >= scrollHeight * 0.8) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    el.addEventListener('scroll', handleScroll);
    return () => el.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  return (
    <div className="bg-terminal-surface/80 border border-terminal-border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-terminal-border">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-white font-mono text-sm font-semibold">TRADEABLE MARKETS</h3>
          <span className="text-neon-cyan text-xs font-mono">{filteredMarkets.length} liquid</span>
        </div>
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
      <div ref={scrollRef} className="max-h-[400px] overflow-y-auto">
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
            {filteredMarkets.map((market: Market) => {
              // Use condition_id as identifier for now - actual token_id fetched on demand
              const tokenId = market.condition_id;
              const isSelected = selectedTokenId === tokenId;
              const volume = market.volume || 0;
              const price = market.outcome_yes_price || 0.5;

              // Liquidity tier based on volume
              const liquidityTier = volume > 1000000 ? 'HIGH' : volume > 100000 ? 'MED' : 'LOW';
              const liquidityColor = liquidityTier === 'HIGH' ? 'text-neon-green' : liquidityTier === 'MED' ? 'text-neon-amber' : 'text-terminal-muted';

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
                  `}
                >
                  <div className="flex items-start gap-2">
                    <div className="text-white text-sm leading-tight mb-1 line-clamp-2 flex-1">
                      {market.question}
                    </div>
                    {/* Price indicator */}
                    <span className="text-neon-green font-mono text-sm shrink-0">
                      {(price * 100).toFixed(0)}¢
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <span className={`font-mono ${liquidityColor}`}>
                      {liquidityTier}
                    </span>
                    <span className="text-terminal-muted">
                      ${(volume / 1000000).toFixed(1)}M
                    </span>
                    <span className="text-terminal-muted truncate">
                      /{market.slug}
                    </span>
                  </div>
                </button>
              );
            })}
            {isFetchingNextPage && (
              <div className="p-3 text-center">
                <div className="inline-block w-4 h-4 border-2 border-terminal-muted border-t-neon-cyan rounded-full animate-spin" />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

