import { useQuery } from '@tanstack/react-query';
import { getFeaturedMarkets, type FeaturedMarket } from '../../lib/api';

interface FeaturedMarketsProps {
  onSelectMarket?: (market: FeaturedMarket) => void;
}

export function FeaturedMarkets({ onSelectMarket }: FeaturedMarketsProps) {
  const { data: markets = [], isLoading, error } = useQuery({
    queryKey: ['featuredMarkets'],
    queryFn: getFeaturedMarkets,
    staleTime: 60000, // 1 minute
    refetchInterval: 60000,
  });

  if (isLoading) {
    return (
      <div className="bg-terminal-surface/60 border border-terminal-border rounded-lg p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 w-48 bg-terminal-border rounded" />
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 bg-terminal-border/50 rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-terminal-surface/60 border border-terminal-border rounded-lg p-6">
        <div className="text-terminal-muted text-sm">Failed to load featured markets</div>
      </div>
    );
  }

  return (
    <div className="bg-terminal-surface/60 border border-terminal-border rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-terminal-border flex items-center justify-between">
        <h2 className="font-mono text-sm font-semibold text-white tracking-wide">
          TRENDING MARKETS
        </h2>
        <span className="text-[10px] text-terminal-muted font-mono">24H VOLUME</span>
      </div>

      <div className="divide-y divide-terminal-border/50">
        {markets.slice(0, 5).map((market, index) => (
          <MarketCard
            key={market.condition_id}
            market={market}
            rank={index + 1}
            onClick={() => onSelectMarket?.(market)}
          />
        ))}

        {markets.length === 0 && (
          <div className="px-4 py-8 text-center text-terminal-muted text-sm">
            No trending markets available
          </div>
        )}
      </div>
    </div>
  );
}

function MarketCard({
  market,
  rank,
  onClick,
}: {
  market: FeaturedMarket;
  rank: number;
  onClick?: () => void;
}) {
  const yesPrice = market.outcome_yes_price;
  const priceChange = market.price_change_24h;
  const volume24h = market.volume_24h;

  const formatVolume = (vol: number) => {
    if (vol >= 1_000_000) return `$${(vol / 1_000_000).toFixed(1)}M`;
    if (vol >= 1_000) return `$${(vol / 1_000).toFixed(0)}K`;
    return `$${vol.toFixed(0)}`;
  };

  const formatPrice = (price: number) => `${(price * 100).toFixed(0)}%`;

  return (
    <button
      onClick={onClick}
      className="w-full px-4 py-3 hover:bg-terminal-border/20 transition-colors text-left group"
    >
      <div className="flex items-start gap-3">
        {/* Rank */}
        <div
          className={`
            w-6 h-6 rounded flex items-center justify-center font-mono text-xs font-bold
            ${rank === 1 ? 'bg-neon-amber/20 text-neon-amber' : ''}
            ${rank === 2 ? 'bg-terminal-muted/20 text-terminal-muted' : ''}
            ${rank === 3 ? 'bg-orange-500/20 text-orange-400' : ''}
            ${rank > 3 ? 'bg-terminal-border/50 text-terminal-muted' : ''}
          `}
        >
          {rank}
        </div>

        {/* Image */}
        {market.image_url && (
          <img
            src={market.image_url}
            alt=""
            className="w-10 h-10 rounded object-cover flex-shrink-0"
          />
        )}

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="text-white text-sm font-medium line-clamp-2 group-hover:text-neon-cyan transition-colors">
            {market.question}
          </div>
          <div className="flex items-center gap-3 mt-1.5">
            {/* Price */}
            <div className="flex items-center gap-1.5">
              <span className="text-neon-green font-mono text-sm font-semibold">
                {formatPrice(yesPrice)}
              </span>
              <span className="text-[10px] text-terminal-muted">YES</span>
            </div>

            {/* Price change */}
            {priceChange !== 0 && (
              <span
                className={`text-[10px] font-mono ${
                  priceChange > 0 ? 'text-neon-green' : 'text-neon-magenta'
                }`}
              >
                {priceChange > 0 ? '+' : ''}
                {(priceChange * 100).toFixed(1)}%
              </span>
            )}

            {/* Category badge */}
            {market.category && (
              <span className="text-[9px] px-1.5 py-0.5 bg-terminal-border/50 text-terminal-muted rounded">
                {market.category}
              </span>
            )}
          </div>
        </div>

        {/* Volume */}
        <div className="text-right flex-shrink-0">
          <div className="text-neon-cyan font-mono text-sm font-semibold">
            {formatVolume(volume24h)}
          </div>
          <div className="text-[10px] text-terminal-muted">24h</div>
        </div>
      </div>
    </button>
  );
}
