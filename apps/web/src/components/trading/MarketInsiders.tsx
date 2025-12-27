import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getMarketInsiders, type WalletDTWScore } from '../../lib/tradingApi';

interface MarketInsidersProps {
  tokenId: string;
  compact?: boolean;
}

function formatAmount(amount: number): string {
  if (amount >= 1000000) return `$${(amount / 1000000).toFixed(1)}M`;
  if (amount >= 1000) return `$${(amount / 1000).toFixed(1)}K`;
  return `$${amount.toFixed(0)}`;
}

function formatAddress(address: string): string {
  return `${address.slice(0, 6)}···${address.slice(-4)}`;
}

function getScoreColor(score: number): string {
  if (score >= 80) return 'text-neon-red';
  if (score >= 70) return 'text-neon-amber';
  if (score >= 60) return 'text-neon-green';
  return 'text-terminal-muted';
}

function getDirectionColor(direction: string): string {
  if (direction === 'YES') return 'text-neon-green';
  if (direction === 'NO') return 'text-neon-red';
  return 'text-terminal-muted';
}

export function MarketInsiders({ tokenId, compact }: MarketInsidersProps) {
  const [isRefreshing, setIsRefreshing] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['marketInsiders', tokenId],
    queryFn: () => getMarketInsiders(tokenId, false),
    enabled: !!tokenId,
    staleTime: 60000, // Cache for 1 minute
    refetchOnWindowFocus: false,
  });

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refetch();
    } finally {
      setIsRefreshing(false);
    }
  };

  if (!tokenId) {
    return (
      <div className="bg-terminal-surface/80 h-full flex items-center justify-center text-terminal-muted text-xs">
        No market selected
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="bg-terminal-surface/80 h-full flex flex-col">
        <div className="flex items-center justify-between px-2 py-1 border-b border-terminal-border shrink-0">
          <span className="text-[9px] font-mono text-terminal-muted">DTW ANALYSIS</span>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-terminal-muted text-xs animate-pulse">Analyzing patterns...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-terminal-surface/80 h-full flex flex-col">
        <div className="flex items-center justify-between px-2 py-1 border-b border-terminal-border shrink-0">
          <span className="text-[9px] font-mono text-terminal-muted">DTW ANALYSIS</span>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-neon-red text-xs">Analysis failed</div>
        </div>
      </div>
    );
  }

  const insiders = data?.insiders || [];

  return (
    <div className="bg-terminal-surface/80 h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-1 border-b border-terminal-border shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-mono text-neon-magenta font-bold">DTW INSIDERS</span>
          <span className="text-[8px] text-terminal-muted">
            {insiders.length} found
          </span>
        </div>
        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="text-terminal-muted hover:text-white p-0.5 transition-colors disabled:opacity-50"
          title="Refresh analysis"
        >
          <svg
            className={`w-3 h-3 ${isRefreshing ? 'animate-spin' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
        </button>
      </div>

      {/* Info bar */}
      <div className="px-2 py-1 border-b border-terminal-border/50 bg-neon-magenta/5">
        <div className="text-[8px] text-terminal-muted">
          Wallets whose trades correlate with future price moves
        </div>
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-1 items-center px-2 py-1 border-b border-terminal-border/50 shrink-0">
        <span className="text-terminal-muted text-[8px] font-mono">WALLET</span>
        <span className="text-terminal-muted text-[8px] font-mono">SCORE</span>
        <span className="text-terminal-muted text-[8px] font-mono">DIR</span>
        <span className="text-terminal-muted text-[8px] font-mono">VOL</span>
      </div>

      {/* Insiders list */}
      <div className="flex-1 overflow-y-auto">
        {insiders.length === 0 ? (
          <div className="p-4 text-center text-terminal-muted text-[10px]">
            No predictive wallets detected
          </div>
        ) : (
          insiders.map((insider, idx) => (
            <InsiderRow
              key={insider.walletAddress}
              insider={insider}
              rank={idx + 1}
              compact={compact}
            />
          ))
        )}
      </div>
    </div>
  );
}

interface InsiderRowProps {
  insider: WalletDTWScore;
  rank: number;
  compact?: boolean;
}

function InsiderRow({ insider, rank, compact }: InsiderRowProps) {
  return (
    <div
      className={`grid grid-cols-[1fr_auto_auto_auto] gap-1 items-center px-2 ${compact ? 'py-0.5' : 'py-1'} hover:bg-white/[0.02] transition-colors border-b border-terminal-border/20`}
    >
      {/* Wallet with rank */}
      <div className="flex items-center gap-1 min-w-0">
        <span className={`text-[8px] font-mono ${rank <= 3 ? 'text-neon-amber' : 'text-terminal-muted'}`}>
          #{rank}
        </span>
        <a
          href={`https://polygonscan.com/address/${insider.walletAddress}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-[9px] text-neon-cyan/70 hover:text-neon-cyan truncate"
          title={insider.walletAddress}
        >
          {formatAddress(insider.walletAddress)}
        </a>
      </div>

      {/* DTW Score */}
      <div className="flex items-center gap-0.5">
        <span className={`font-mono text-[10px] font-bold ${getScoreColor(insider.dtwScore)}`}>
          {insider.dtwScore}
        </span>
        {insider.dtwScore >= 80 && (
          <span className="text-[8px]" title="High predictive score">
            🎯
          </span>
        )}
      </div>

      {/* Direction */}
      <span className={`font-mono text-[9px] font-bold ${getDirectionColor(insider.profitDirection)}`}>
        {insider.profitDirection}
      </span>

      {/* Volume */}
      <span className="font-mono text-[9px] text-terminal-muted">
        {formatAmount(insider.totalVolume)}
      </span>
    </div>
  );
}
