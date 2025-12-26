import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { getMarkets, type Market } from '../../lib/tradingApi';

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

export function MarketGrid({ onSelectMarket, selectedMarketId }: MarketGridProps) {
  // Fetch all markets
  const { data: markets = [], isLoading } = useQuery({
    queryKey: ['markets'],
    queryFn: () => getMarkets(300),
    staleTime: 30000,
  });

  // Sort markets into columns
  const { newMarkets, trendingMarkets, almostResolvedMarkets } = useMemo(() => {
    const now = Date.now();
    const threeDaysFromNow = now + 3 * 24 * 60 * 60 * 1000;

    // New markets: high volume, recently active
    const newMarkets = markets
      .filter((m) => {
        const volume = typeof m.volume === 'string' ? parseFloat(m.volume) : (m.volume || 0);
        return volume > 10000;
      })
      .sort((a, b) => {
        const volA = typeof a.volume === 'string' ? parseFloat(a.volume) : (a.volume || 0);
        const volB = typeof b.volume === 'string' ? parseFloat(b.volume) : (b.volume || 0);
        return volB - volA;
      })
      .slice(0, 15);

    // Trending: high 24h volume
    const trendingMarkets = markets
      .filter((m) => {
        const vol24h = typeof m.volume_24h === 'string' ? parseFloat(m.volume_24h) : (m.volume_24h || 0);
        return vol24h > 5000;
      })
      .sort((a, b) => {
        const volA = typeof a.volume_24h === 'string' ? parseFloat(a.volume_24h) : (a.volume_24h || 0);
        const volB = typeof b.volume_24h === 'string' ? parseFloat(b.volume_24h) : (b.volume_24h || 0);
        return volB - volA;
      })
      .slice(0, 15);

    // Almost resolved: end_date within 3 days
    const almostResolvedMarkets = markets
      .filter((m) => {
        if (!m.end_date) return false;
        const endTime = new Date(m.end_date).getTime();
        return endTime > now && endTime < threeDaysFromNow;
      })
      .sort((a, b) => {
        const endA = new Date(a.end_date || 0).getTime();
        const endB = new Date(b.end_date || 0).getTime();
        return endA - endB; // Earliest first
      })
      .slice(0, 15);

    return { newMarkets, trendingMarkets, almostResolvedMarkets };
  }, [markets]);

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

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 h-full">
      {/* New Markets Column */}
      <MarketColumn
        title="NEW"
        subtitle="High volume markets"
        markets={newMarkets}
        onSelectMarket={onSelectMarket}
        selectedMarketId={selectedMarketId}
        accentColor="cyan"
      />

      {/* Trending Column */}
      <MarketColumn
        title="TRENDING"
        subtitle="Hot in last 24h"
        markets={trendingMarkets}
        onSelectMarket={onSelectMarket}
        selectedMarketId={selectedMarketId}
        accentColor="amber"
      />

      {/* Almost Resolved Column */}
      <MarketColumn
        title="CLOSING SOON"
        subtitle="Resolving in < 3 days"
        markets={almostResolvedMarkets}
        onSelectMarket={onSelectMarket}
        selectedMarketId={selectedMarketId}
        accentColor="magenta"
      />
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
}

function MarketColumn({
  title,
  subtitle,
  markets,
  onSelectMarket,
  selectedMarketId,
  accentColor,
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
        <h3 className={`font-mono text-sm font-bold ${colorClasses[accentColor].split(' ')[0]}`}>
          {title}
        </h3>
        <p className="text-terminal-muted text-[10px]">{subtitle}</p>
      </div>

      {/* Market List */}
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
          </div>
        )}
      </div>
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
          </div>
        </div>
      </div>
    </button>
  );
}
