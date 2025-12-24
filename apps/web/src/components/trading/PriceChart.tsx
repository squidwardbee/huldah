import { useState, useEffect, useMemo } from 'react';

interface PriceChartProps {
  tokenId: string;
  yesPrice?: number;
  noPrice?: number;
}

type ChartView = 'yes' | 'no' | 'both';

export function PriceChart({ tokenId, yesPrice = 0.5, noPrice = 0.5 }: PriceChartProps) {
  const [view, setView] = useState<ChartView>('both');
  const [priceHistory, setPriceHistory] = useState<{ yes: number; no: number }[]>([]);

  // Build simulated history when prices change
  useEffect(() => {
    if (!tokenId) {
      setPriceHistory([]);
      return;
    }

    // Generate price history that trends toward current price
    const history: { yes: number; no: number }[] = [];
    const startYes = 0.5;
    const targetYes = yesPrice;
    
    for (let i = 0; i < 25; i++) {
      // Interpolate from 0.5 toward current price with some noise
      const progress = i / 24;
      const noise = (Math.random() - 0.5) * 0.08;
      const yes = Math.max(0.01, Math.min(0.99, startYes + (targetYes - startYes) * progress + noise));
      history.push({ yes, no: 1 - yes });
    }
    
    // Ensure last point is exactly the current price
    history[history.length - 1] = { yes: yesPrice, no: noPrice };
    
    setPriceHistory(history);
  }, [tokenId, yesPrice, noPrice]);

  // Calculate chart bounds
  const { minPrice, maxPrice, priceRange } = useMemo(() => {
    if (priceHistory.length === 0) {
      return { minPrice: 0.3, maxPrice: 0.7, priceRange: 0.4 };
    }
    
    const allPrices = priceHistory.flatMap(p => 
      view === 'yes' ? [p.yes] : view === 'no' ? [p.no] : [p.yes, p.no]
    );
    const min = Math.max(0, Math.min(...allPrices) - 0.05);
    const max = Math.min(1, Math.max(...allPrices) + 0.05);
    return { minPrice: min, maxPrice: max, priceRange: max - min || 0.1 };
  }, [priceHistory, view]);

  if (!tokenId) {
    return (
      <div className="bg-terminal-surface/80 border border-terminal-border rounded-lg p-6 h-64 flex items-center justify-center">
        <span className="text-terminal-muted text-sm">Select a market to view chart</span>
      </div>
    );
  }

  const chartHeight = 160;

  // Generate SVG path
  const generatePath = (prices: number[], color: string) => {
    if (prices.length < 2) return null;
    
    const points = prices.map((price, i) => {
      const x = (i / (prices.length - 1)) * 100;
      const y = ((maxPrice - price) / priceRange) * chartHeight;
      return `${x},${y}`;
    });
    
    return (
      <polyline
        key={color}
        points={points.join(' ')}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    );
  };

  return (
    <div className="bg-terminal-surface/80 border border-terminal-border rounded-lg overflow-hidden">
      {/* Header with view toggles */}
      <div className="px-4 py-3 border-b border-terminal-border flex items-center justify-between">
        <h3 className="text-white font-mono text-sm font-semibold">PRICE</h3>
        <div className="flex gap-1">
          {(['yes', 'no', 'both'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-3 py-1 text-xs font-mono rounded transition-all ${
                view === v
                  ? v === 'yes' ? 'bg-neon-green/20 text-neon-green border border-neon-green/50'
                    : v === 'no' ? 'bg-neon-red/20 text-neon-red border border-neon-red/50'
                    : 'bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/50'
                  : 'text-terminal-muted hover:text-white'
              }`}
            >
              {v.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div className="p-4">
        <div className="relative" style={{ height: chartHeight }}>
          {/* Y-axis labels */}
          <div className="absolute left-0 top-0 bottom-0 w-10 flex flex-col justify-between text-[10px] text-terminal-muted font-mono">
            <span>{(maxPrice * 100).toFixed(0)}¢</span>
            <span>{((maxPrice + minPrice) / 2 * 100).toFixed(0)}¢</span>
            <span>{(minPrice * 100).toFixed(0)}¢</span>
          </div>

          {/* Chart area */}
          <div className="ml-12 h-full relative">
            {/* Grid lines */}
            <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
              <div className="border-t border-terminal-border/20" />
              <div className="border-t border-terminal-border/20" />
              <div className="border-t border-terminal-border/20" />
            </div>

            {/* SVG Chart */}
            {priceHistory.length > 0 && (
              <svg
                viewBox={`0 0 100 ${chartHeight}`}
                preserveAspectRatio="none"
                className="w-full h-full"
              >
                {(view === 'yes' || view === 'both') && 
                  generatePath(priceHistory.map(p => p.yes), '#00ff88')}
                {(view === 'no' || view === 'both') && 
                  generatePath(priceHistory.map(p => p.no), '#ff3366')}
              </svg>
            )}
          </div>
        </div>

        {/* Current prices - large display */}
        <div className="mt-4 flex gap-6 justify-center">
          {(view === 'yes' || view === 'both') && (
            <div className="text-center">
              <div className="text-terminal-muted text-[10px] uppercase mb-1">Yes</div>
              <div className="text-neon-green font-mono text-2xl font-bold">
                {(yesPrice * 100).toFixed(1)}¢
              </div>
            </div>
          )}
          {(view === 'no' || view === 'both') && (
            <div className="text-center">
              <div className="text-terminal-muted text-[10px] uppercase mb-1">No</div>
              <div className="text-neon-red font-mono text-2xl font-bold">
                {(noPrice * 100).toFixed(1)}¢
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
