import { useQuery } from '@tanstack/react-query';
import { useState, useMemo, useEffect } from 'react';
import { getMarkets, type Market, type SortBy } from '../../lib/tradingApi';

interface MarketGridProps {
  onSelectMarket: (market: Market) => void;
  selectedMarketId: string | null;
}

// Format large numbers compactly
function formatVolume(volume: number | string | null | undefined): string {
  const num = typeof volume === 'string' ? parseFloat(volume) : (volume || 0);
  if (isNaN(num)) return '$0';
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `$${(num / 1_000).toFixed(0)}K`;
  return `$${num.toFixed(0)}`;
}

// Default image for markets without one
const DEFAULT_IMAGE = 'https://polymarket.com/images/default-market.png';

const INITIAL_BATCH_SIZE = 50; // Fetch 50 first for quick UI population
const FULL_BATCH_SIZE = 500; // Then fetch more for complete data

// Category definitions with display names
const CATEGORIES = [
  { id: 'trending', label: 'Trending' },
  { id: 'breaking', label: 'Breaking' },
  { id: 'new', label: 'New' },
  { id: 'Politics', label: 'Politics' },
  { id: 'Sports', label: 'Sports' },
  { id: 'Crypto', label: 'Crypto' },
  { id: 'Finance', label: 'Finance' },
  { id: 'Geopolitics', label: 'Geopolitics' },
  { id: 'Earnings', label: 'Earnings' },
  { id: 'Tech', label: 'Tech' },
  { id: 'Culture', label: 'Culture' },
  { id: 'World', label: 'World' },
  { id: 'Economy', label: 'Economy' },
  { id: 'Trump', label: 'Trump' },
  { id: 'Elections', label: 'Elections' },
  { id: 'Mentions', label: 'Mentions' },
] as const;

const SORT_OPTIONS = [
  { id: 'volume', label: 'Volume' },
  { id: 'volume_24h', label: '24h Volume' },
  { id: 'ending_soon', label: 'Ending Soon' },
  { id: 'liquidity', label: 'Liquidity' },
  { id: 'newest', label: 'Newest' },
] as const;

export function MarketGrid({ onSelectMarket, selectedMarketId }: MarketGridProps) {
  // Filter state for ALL column
  const [sortBy, setSortBy] = useState<SortBy>('volume');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [activeFilterMenu, setActiveFilterMenu] = useState<'sort' | 'category' | null>(null);

  // For special categories, we need to handle differently
  const apiCategory = ['trending', 'breaking', 'new'].includes(selectedCategory || '')
    ? undefined
    : selectedCategory;

  // First query: fetch initial batch quickly (50 markets)
  const {
    data: initialData,
    isLoading: isLoadingInitial,
  } = useQuery({
    queryKey: ['markets-initial', sortBy, apiCategory],
    queryFn: () => getMarkets({
      limit: INITIAL_BATCH_SIZE,
      offset: 0,
      category: apiCategory || undefined,
      sortBy: sortBy,
    }),
    staleTime: 30000,
  });

  // Second query: fetch full batch in background (500 markets)
  const {
    data: fullData,
    isLoading: isLoadingFull,
  } = useQuery({
    queryKey: ['markets-full', sortBy, apiCategory],
    queryFn: () => getMarkets({
      limit: FULL_BATCH_SIZE,
      offset: 0,
      category: apiCategory || undefined,
      sortBy: sortBy,
    }),
    staleTime: 30000,
    // Only start this query once initial data is loaded
    enabled: !!initialData,
  });

  // Use full data if available, otherwise use initial data
  const allMarkets = useMemo(() => {
    if (fullData?.markets) return fullData.markets;
    if (initialData?.markets) return initialData.markets;
    return [];
  }, [initialData, fullData]);

  const isLoading = isLoadingInitial;
  const isFetchingMore = isLoadingFull && !!initialData;

  // Filter out closed/resolved markets and sort into columns (no duplicates)
  // Priority: 1) Closing Soon (<7 days), 2) Trending (>$10M volume), 3) All (rest)
  const { closingSoonMarkets, trendingMarkets, allOpenMarkets } = useMemo(() => {
    const now = Date.now();
    const sevenDaysFromNow = now + 7 * 24 * 60 * 60 * 1000;

    // Filter out resolved/closed markets
    const openMarkets = allMarkets.filter((m) => {
      // Skip resolved markets
      if (m.resolved) return false;
      // Skip markets that have already ended
      if (m.end_date) {
        const endTime = new Date(m.end_date).getTime();
        if (endTime < now) return false;
      }
      return true;
    });

    // Track which markets are already used
    const usedIds = new Set<string>();

    // 1. CLOSING SOON (highest priority): markets ending within 7 days
    const closingSoonMarkets = openMarkets
      .filter((m) => {
        if (!m.end_date) return false;
        const endTime = new Date(m.end_date).getTime();
        return endTime > now && endTime < sevenDaysFromNow;
      })
      .sort((a, b) => {
        const endA = new Date(a.end_date!).getTime();
        const endB = new Date(b.end_date!).getTime();
        return endA - endB; // Earliest first
      });

    // Mark closing soon markets as used
    closingSoonMarkets.forEach(m => usedIds.add(m.condition_id));

    // 2. TRENDING: markets with >$10M volume (not already in Closing Soon)
    const trendingMarkets = openMarkets
      .filter((m) => {
        if (usedIds.has(m.condition_id)) return false;
        const volume = typeof m.volume === 'string' ? parseFloat(m.volume) : (m.volume || 0);
        return volume >= 10_000_000; // $10M+
      })
      .sort((a, b) => {
        const volA = typeof a.volume === 'string' ? parseFloat(a.volume) : (a.volume || 0);
        const volB = typeof b.volume === 'string' ? parseFloat(b.volume) : (b.volume || 0);
        return volB - volA; // Highest volume first
      });

    // Mark trending markets as used
    trendingMarkets.forEach(m => usedIds.add(m.condition_id));

    // 3. ALL: everything else, with applied filters
    let allOpenMarkets = openMarkets.filter((m) => !usedIds.has(m.condition_id));

    // Apply special category filters for ALL column
    if (selectedCategory === 'trending') {
      allOpenMarkets = allOpenMarkets.filter(m => {
        const vol = typeof m.volume === 'string' ? parseFloat(m.volume) : (m.volume || 0);
        return vol >= 5_000_000;
      });
    } else if (selectedCategory === 'new' || selectedCategory === 'newest') {
      // Already sorted by newest from API if sortBy is 'newest'
    }

    // Sort based on current sortBy (already done by API, but ensure client-side consistency)
    allOpenMarkets.sort((a, b) => {
      switch (sortBy) {
        case 'volume_24h': {
          const vol24A = typeof a.volume_24h === 'string' ? parseFloat(a.volume_24h) : (a.volume_24h || 0);
          const vol24B = typeof b.volume_24h === 'string' ? parseFloat(b.volume_24h) : (b.volume_24h || 0);
          return vol24B - vol24A;
        }
        case 'ending_soon': {
          if (!a.end_date && !b.end_date) return 0;
          if (!a.end_date) return 1;
          if (!b.end_date) return -1;
          return new Date(a.end_date).getTime() - new Date(b.end_date).getTime();
        }
        case 'liquidity': {
          const liqA = typeof a.liquidity === 'string' ? parseFloat(a.liquidity) : (a.liquidity || 0);
          const liqB = typeof b.liquidity === 'string' ? parseFloat(b.liquidity) : (b.liquidity || 0);
          return liqB - liqA;
        }
        default: {
          const volA = typeof a.volume === 'string' ? parseFloat(a.volume) : (a.volume || 0);
          const volB = typeof b.volume === 'string' ? parseFloat(b.volume) : (b.volume || 0);
          return volB - volA;
        }
      }
    });

    return { closingSoonMarkets, trendingMarkets, allOpenMarkets };
  }, [allMarkets, sortBy, selectedCategory]);

  // Close filter menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (showFilters) {
        const target = e.target as HTMLElement;
        if (!target.closest('.filter-dropdown')) {
          setShowFilters(false);
          setActiveFilterMenu(null);
        }
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showFilters]);

  if (isLoading) {
    return (
      <div className="grid grid-cols-3 gap-4 h-full">
        {[0, 1, 2].map((col) => (
          <div key={col} className="bg-terminal-surface/60 border border-terminal-border rounded-lg">
            <div className="p-3 border-b border-terminal-border">
              <div className="h-5 bg-terminal-border/50 rounded w-24 animate-pulse" />
            </div>
            <div className="p-2 space-y-2">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-16 bg-terminal-border/30 rounded animate-pulse" />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  const totalMarkets = fullData?.pagination.total || initialData?.pagination.total || allMarkets.length;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 h-full">
      {/* Closing Soon Column (highest priority) */}
      <MarketColumn
        title="CLOSING SOON"
        subtitle="Resolving within 7 days"
        markets={closingSoonMarkets}
        onSelectMarket={onSelectMarket}
        selectedMarketId={selectedMarketId}
        accentColor="magenta"
        isLoadingMore={isFetchingMore}
      />

      {/* Trending Column */}
      <MarketColumn
        title="TRENDING"
        subtitle="$10M+ volume"
        markets={trendingMarkets}
        onSelectMarket={onSelectMarket}
        selectedMarketId={selectedMarketId}
        accentColor="amber"
        isLoadingMore={isFetchingMore}
      />

      {/* All Markets Column with Filters */}
      <div className="bg-terminal-surface/60 border border-terminal-border rounded-lg flex flex-col overflow-hidden">
        {/* Column Header with Filter Dropdown */}
        <div className="px-3 py-2 border-b border-neon-cyan/30 bg-terminal-bg/50">
          <div className="flex items-center justify-between">
            <h3 className="font-mono text-sm font-bold text-neon-cyan">ALL</h3>
            <div className="flex items-center gap-2">
              <span className="text-terminal-muted text-[10px] font-mono">
                {allOpenMarkets.length} / {totalMarkets}
              </span>
              {/* Filter Button */}
              <div className="relative filter-dropdown">
                <button
                  onClick={() => setShowFilters(!showFilters)}
                  className={`
                    p-1 rounded transition-colors
                    ${showFilters ? 'bg-neon-cyan/20 text-neon-cyan' : 'text-terminal-muted hover:text-white hover:bg-terminal-border/30'}
                  `}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                  </svg>
                </button>

                {/* Filter Dropdown */}
                {showFilters && (
                  <div className="absolute right-0 top-full mt-1 z-50 flex">
                    {/* Main menu */}
                    <div className="bg-terminal-surface border border-terminal-border rounded-lg shadow-xl min-w-[140px]">
                      <button
                        onClick={() => setActiveFilterMenu(activeFilterMenu === 'sort' ? null : 'sort')}
                        className={`
                          w-full px-3 py-2 text-left text-xs font-mono flex items-center justify-between
                          ${activeFilterMenu === 'sort' ? 'bg-neon-cyan/10 text-neon-cyan' : 'text-white hover:bg-terminal-border/30'}
                        `}
                      >
                        <span>Sort By</span>
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                      <button
                        onClick={() => setActiveFilterMenu(activeFilterMenu === 'category' ? null : 'category')}
                        className={`
                          w-full px-3 py-2 text-left text-xs font-mono flex items-center justify-between
                          ${activeFilterMenu === 'category' ? 'bg-neon-cyan/10 text-neon-cyan' : 'text-white hover:bg-terminal-border/30'}
                        `}
                      >
                        <span>Categories</span>
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                      {/* Clear filters */}
                      {(selectedCategory || sortBy !== 'volume') && (
                        <button
                          onClick={() => {
                            setSelectedCategory(null);
                            setSortBy('volume');
                            setShowFilters(false);
                            setActiveFilterMenu(null);
                          }}
                          className="w-full px-3 py-2 text-left text-xs font-mono text-neon-red hover:bg-neon-red/10 border-t border-terminal-border"
                        >
                          Clear Filters
                        </button>
                      )}
                    </div>

                    {/* Sub-sidebar for Sort */}
                    {activeFilterMenu === 'sort' && (
                      <div className="bg-terminal-surface border border-terminal-border rounded-lg shadow-xl ml-1 min-w-[130px]">
                        {SORT_OPTIONS.map((option) => (
                          <button
                            key={option.id}
                            onClick={() => {
                              setSortBy(option.id as SortBy);
                              setShowFilters(false);
                              setActiveFilterMenu(null);
                            }}
                            className={`
                              w-full px-3 py-2 text-left text-xs font-mono flex items-center gap-2
                              ${sortBy === option.id ? 'bg-neon-cyan/10 text-neon-cyan' : 'text-white hover:bg-terminal-border/30'}
                            `}
                          >
                            {sortBy === option.id && (
                              <svg className="w-3 h-3 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                            )}
                            <span className={sortBy !== option.id ? 'ml-5' : ''}>{option.label}</span>
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Sub-sidebar for Categories */}
                    {activeFilterMenu === 'category' && (
                      <div className="bg-terminal-surface border border-terminal-border rounded-lg shadow-xl ml-1 min-w-[130px] max-h-[400px] overflow-y-auto">
                        <button
                          onClick={() => {
                            setSelectedCategory(null);
                            setShowFilters(false);
                            setActiveFilterMenu(null);
                          }}
                          className={`
                            w-full px-3 py-2 text-left text-xs font-mono flex items-center gap-2
                            ${selectedCategory === null ? 'bg-neon-cyan/10 text-neon-cyan' : 'text-white hover:bg-terminal-border/30'}
                          `}
                        >
                          {selectedCategory === null && (
                            <svg className="w-3 h-3 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                          )}
                          <span className={selectedCategory !== null ? 'ml-5' : ''}>All Categories</span>
                        </button>
                        <div className="border-t border-terminal-border" />
                        {CATEGORIES.map((cat) => (
                          <button
                            key={cat.id}
                            onClick={() => {
                              setSelectedCategory(cat.id);
                              setShowFilters(false);
                              setActiveFilterMenu(null);
                            }}
                            className={`
                              w-full px-3 py-2 text-left text-xs font-mono flex items-center gap-2
                              ${selectedCategory === cat.id ? 'bg-neon-cyan/10 text-neon-cyan' : 'text-white hover:bg-terminal-border/30'}
                            `}
                          >
                            {selectedCategory === cat.id && (
                              <svg className="w-3 h-3 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                            )}
                            <span className={selectedCategory !== cat.id ? 'ml-5' : ''}>{cat.label}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <p className="text-terminal-muted text-[10px]">All open markets</p>
            {/* Active filter badges */}
            {(sortBy !== 'volume' || selectedCategory) && (
              <div className="flex items-center gap-1">
                {sortBy !== 'volume' && (
                  <span className="px-1.5 py-0.5 bg-neon-cyan/10 text-neon-cyan text-[9px] font-mono rounded">
                    {SORT_OPTIONS.find(s => s.id === sortBy)?.label}
                  </span>
                )}
                {selectedCategory && (
                  <span className="px-1.5 py-0.5 bg-neon-amber/10 text-neon-amber text-[9px] font-mono rounded">
                    {CATEGORIES.find(c => c.id === selectedCategory)?.label}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Market List */}
        <MarketList
          markets={allOpenMarkets}
          onSelectMarket={onSelectMarket}
          selectedMarketId={selectedMarketId}
          isLoadingMore={isFetchingMore}
        />
      </div>
    </div>
  );
}

interface MarketColumnProps {
  title: string;
  subtitle: string;
  markets: Market[];
  onSelectMarket: (market: Market) => void;
  selectedMarketId: string | null;
  accentColor: 'cyan' | 'amber' | 'magenta';
  isLoadingMore?: boolean;
}

function MarketColumn({
  title,
  subtitle,
  markets,
  onSelectMarket,
  selectedMarketId,
  accentColor,
  isLoadingMore,
}: MarketColumnProps) {
  const colorClasses = {
    cyan: 'text-neon-cyan border-neon-cyan/30',
    amber: 'text-neon-amber border-neon-amber/30',
    magenta: 'text-neon-magenta border-neon-magenta/30',
  };

  return (
    <div className="bg-terminal-surface/60 border border-terminal-border rounded-lg flex flex-col overflow-hidden">
      {/* Column Header */}
      <div className={`px-3 py-2 border-b ${colorClasses[accentColor].split(' ')[1]} bg-terminal-bg/50`}>
        <div className="flex items-center justify-between">
          <h3 className={`font-mono text-sm font-bold ${colorClasses[accentColor].split(' ')[0]}`}>
            {title}
          </h3>
          <span className="text-terminal-muted text-[10px] font-mono">
            {markets.length} markets
          </span>
        </div>
        <p className="text-terminal-muted text-[10px]">{subtitle}</p>
      </div>

      {/* Market List */}
      <MarketList
        markets={markets}
        onSelectMarket={onSelectMarket}
        selectedMarketId={selectedMarketId}
        isLoadingMore={isLoadingMore}
      />
    </div>
  );
}

interface MarketListProps {
  markets: Market[];
  onSelectMarket: (market: Market) => void;
  selectedMarketId: string | null;
  isLoadingMore?: boolean;
}

function MarketList({
  markets,
  onSelectMarket,
  selectedMarketId,
  isLoadingMore,
}: MarketListProps) {
  return (
    <div className="flex-1 overflow-y-auto">
      {markets.length === 0 ? (
        <div className="p-4 text-center text-terminal-muted text-xs">
          No markets found
        </div>
      ) : (
        <div className="divide-y divide-terminal-border/30">
          {markets.map((market) => (
            <CompactMarketCard
              key={market.condition_id}
              market={market}
              isSelected={selectedMarketId === market.condition_id}
              onSelect={() => onSelectMarket(market)}
            />
          ))}
          {isLoadingMore && (
            <div className="p-3 text-center">
              <div className="inline-block w-4 h-4 border-2 border-terminal-muted border-t-neon-cyan rounded-full animate-spin" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface CompactMarketCardProps {
  market: Market;
  isSelected: boolean;
  onSelect: () => void;
}

function CompactMarketCard({ market, isSelected, onSelect }: CompactMarketCardProps) {
  const price = typeof market.outcome_yes_price === 'string'
    ? parseFloat(market.outcome_yes_price)
    : (market.outcome_yes_price || 0.5);

  const volume = typeof market.volume === 'string'
    ? parseFloat(market.volume)
    : (market.volume || 0);

  // Calculate time until resolution
  const getTimeUntil = () => {
    if (!market.end_date) return null;
    const endTime = new Date(market.end_date).getTime();
    const now = Date.now();
    const diff = endTime - now;
    if (diff <= 0) return 'Ended';
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);
    if (days > 0) return `${days}d`;
    return `${hours}h`;
  };

  const timeUntil = getTimeUntil();

  return (
    <button
      onClick={onSelect}
      className={`
        w-full text-left p-2.5 transition-all hover:bg-terminal-surface/80
        ${isSelected ? 'bg-neon-cyan/10 border-l-2 border-l-neon-cyan' : ''}
      `}
    >
      <div className="flex gap-2">
        {/* Image */}
        <img
          src={market.image_url || market.icon_url || DEFAULT_IMAGE}
          alt=""
          className="w-10 h-10 rounded object-cover bg-terminal-border shrink-0"
          onError={(e) => {
            (e.target as HTMLImageElement).src = DEFAULT_IMAGE;
          }}
        />

        {/* Content */}
        <div className="flex-1 min-w-0">
          <h4 className="text-white text-xs font-medium leading-tight line-clamp-2 mb-1">
            {market.question}
          </h4>
          <div className="flex items-center gap-2 text-[10px]">
            <span className="text-neon-cyan font-mono font-bold">
              {isNaN(price) ? '50' : (price * 100).toFixed(0)}%
            </span>
            <span className="text-terminal-muted font-mono">
              {formatVolume(volume)}
            </span>
            {timeUntil && (
              <span className="text-neon-magenta font-mono">
                {timeUntil}
              </span>
            )}
            {market.category && (
              <span className="text-terminal-muted/60 font-mono truncate">
                {market.category}
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}
