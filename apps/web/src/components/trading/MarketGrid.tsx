import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { getMarkets, getCategories, type Market } from '../../lib/tradingApi';

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

// Format price change as percentage
function formatPriceChange(change: number | string | null | undefined): { text: string; color: string } {
  const num = typeof change === 'string' ? parseFloat(change) : (change || 0);
  if (isNaN(num)) return { text: '0%', color: 'text-terminal-muted' };
  const percent = (num * 100).toFixed(1);
  if (num > 0) return { text: `+${percent}%`, color: 'text-neon-green' };
  if (num < 0) return { text: `${percent}%`, color: 'text-neon-red' };
  return { text: '0%', color: 'text-terminal-muted' };
}

// Default image for markets without one
const DEFAULT_IMAGE = 'https://polymarket.com/images/default-market.png';

export function MarketGrid({ onSelectMarket, selectedMarketId }: MarketGridProps) {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  // Fetch categories
  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: getCategories,
    staleTime: 60000,
  });

  // Fetch markets with category filter
  const { data: markets = [], isLoading } = useQuery({
    queryKey: ['markets', selectedCategory],
    queryFn: () => getMarkets(200, selectedCategory || undefined),
    staleTime: 30000,
  });

  // Filter markets by search
  const filteredMarkets = markets.filter((m) => {
    if (!m.question) return false;
    if (search && !m.question.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // All category options including "All"
  const allCategories = [
    { category: 'All', count: markets.length },
    ...categories,
  ];

  return (
    <div className="space-y-4">
      {/* Filter Bar */}
      <div className="bg-terminal-surface/80 border border-terminal-border rounded-lg p-4">
        <div className="flex flex-col lg:flex-row gap-4">
          {/* Search */}
          <div className="flex-1">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search markets..."
              className="
                w-full bg-terminal-bg border border-terminal-border rounded-lg
                px-4 py-2.5 font-mono text-sm text-white
                focus:outline-none focus:border-neon-cyan
                placeholder:text-terminal-muted
              "
            />
          </div>

          {/* Category Filters */}
          <div className="flex flex-wrap gap-2">
            {allCategories.map((cat) => (
              <button
                key={cat.category}
                onClick={() => setSelectedCategory(cat.category === 'All' ? null : cat.category)}
                className={`
                  px-3 py-1.5 rounded-lg font-mono text-xs font-medium transition-all
                  ${(selectedCategory === null && cat.category === 'All') ||
                    selectedCategory === cat.category
                    ? 'bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/50'
                    : 'bg-terminal-bg border border-terminal-border text-terminal-muted hover:text-white hover:border-terminal-border/80'
                  }
                `}
              >
                {cat.category}
                <span className="ml-1 opacity-60">({cat.count})</span>
              </button>
            ))}
          </div>
        </div>

        {/* Results count */}
        <div className="mt-3 text-xs text-terminal-muted">
          Showing {filteredMarkets.length} markets
          {selectedCategory && ` in ${selectedCategory}`}
        </div>
      </div>

      {/* Market Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="bg-terminal-surface/60 border border-terminal-border rounded-lg p-4 animate-pulse">
              <div className="flex gap-3">
                <div className="w-16 h-16 bg-terminal-border/50 rounded-lg" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-terminal-border/50 rounded w-3/4" />
                  <div className="h-3 bg-terminal-border/30 rounded w-1/2" />
                  <div className="h-3 bg-terminal-border/30 rounded w-1/3" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : filteredMarkets.length === 0 ? (
        <div className="bg-terminal-surface/60 border border-terminal-border rounded-lg p-12 text-center">
          <div className="text-terminal-muted text-sm">No markets found</div>
          <div className="text-terminal-muted/60 text-xs mt-1">Try adjusting your filters</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredMarkets.map((market) => (
            <MarketCard
              key={market.condition_id}
              market={market}
              isSelected={selectedMarketId === market.condition_id}
              onSelect={() => onSelectMarket(market)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface MarketCardProps {
  market: Market;
  isSelected: boolean;
  onSelect: () => void;
}

function MarketCard({ market, isSelected, onSelect }: MarketCardProps) {
  // Parse numeric values (API may return strings)
  const price = typeof market.outcome_yes_price === 'string'
    ? parseFloat(market.outcome_yes_price)
    : (market.outcome_yes_price || 0.5);
  const volume24h = typeof market.volume_24h === 'string'
    ? parseFloat(market.volume_24h)
    : (market.volume_24h || 0);
  const priceChange = formatPriceChange(market.price_change_24h);

  return (
    <button
      onClick={onSelect}
      className={`
        w-full text-left bg-terminal-surface/60 border rounded-lg p-4
        transition-all hover:bg-terminal-surface/80 hover:border-neon-cyan/50
        ${isSelected
          ? 'border-neon-cyan bg-neon-cyan/5'
          : 'border-terminal-border'
        }
      `}
    >
      <div className="flex gap-3">
        {/* Market Image */}
        <div className="shrink-0">
          <img
            src={market.image_url || market.icon_url || DEFAULT_IMAGE}
            alt=""
            className="w-16 h-16 rounded-lg object-cover bg-terminal-border"
            onError={(e) => {
              (e.target as HTMLImageElement).src = DEFAULT_IMAGE;
            }}
          />
        </div>

        {/* Market Info */}
        <div className="flex-1 min-w-0">
          {/* Question */}
          <h3 className="text-white text-sm font-medium leading-tight line-clamp-2 mb-2">
            {market.question}
          </h3>

          {/* Price & Change */}
          <div className="flex items-center gap-3 mb-2">
            <span className="text-neon-cyan font-mono text-lg font-bold">
              {isNaN(price) ? '50' : (price * 100).toFixed(0)}%
            </span>
            <span className={`font-mono text-xs ${priceChange.color}`}>
              {priceChange.text}
            </span>
          </div>

          {/* Volume & Category */}
          <div className="flex items-center gap-2 text-xs text-terminal-muted">
            <span className="font-mono">{formatVolume(market.volume)}</span>
            <span className="opacity-40">|</span>
            <span className="font-mono">{formatVolume(volume24h)} 24h</span>
            {market.category && (
              <>
                <span className="opacity-40">|</span>
                <span className="px-1.5 py-0.5 bg-terminal-border/50 rounded text-[10px]">
                  {market.category}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Tags placeholder (for future insider activity, etc.) */}
      <div className="mt-3 flex gap-1.5">
        {/* Placeholder tags - will be populated with real data later */}
        {volume24h > 50000 && (
          <span className="px-2 py-0.5 bg-neon-amber/10 text-neon-amber text-[10px] font-mono rounded">
            HOT
          </span>
        )}
        {price >= 0.9 && !isNaN(price) && (
          <span className="px-2 py-0.5 bg-neon-green/10 text-neon-green text-[10px] font-mono rounded">
            LIKELY
          </span>
        )}
        {price <= 0.1 && !isNaN(price) && (
          <span className="px-2 py-0.5 bg-neon-red/10 text-neon-red text-[10px] font-mono rounded">
            UNLIKELY
          </span>
        )}
        {/* Future: insider activity tag */}
        {/* <span className="px-2 py-0.5 bg-neon-magenta/10 text-neon-magenta text-[10px] font-mono rounded">
          INSIDER
        </span> */}
      </div>
    </button>
  );
}
