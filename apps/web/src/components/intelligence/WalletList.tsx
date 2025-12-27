import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getWalletList, type WalletProfile, type WalletQueryParams } from '../../lib/intelligenceApi';

const TAG_COLORS: Record<string, string> = {
  whale: 'bg-neon-cyan/20 text-neon-cyan border-neon-cyan/30',
  smart_money: 'bg-neon-green/20 text-neon-green border-neon-green/30',
  insider_suspect: 'bg-neon-red/20 text-neon-red border-neon-red/30',
  active: 'bg-neon-amber/20 text-neon-amber border-neon-amber/30',
  sniper: 'bg-neon-magenta/20 text-neon-magenta border-neon-magenta/30',
};

const SORT_OPTIONS = [
  { value: 'volume', label: 'Volume' },
  { value: 'pnl', label: 'PnL' },
  { value: 'win_rate', label: 'Win Rate' },
  { value: 'insider_score', label: 'Insider Score' },
  { value: 'smart_money_score', label: 'Smart Money' },
  { value: 'last_active', label: 'Last Active' },
];

interface WalletListProps {
  onSelectWallet: (wallet: WalletProfile) => void;
  selectedAddress?: string;
}

export function WalletList({ onSelectWallet, selectedAddress }: WalletListProps) {
  const [filters, setFilters] = useState<WalletQueryParams>({
    sortBy: 'volume',
    sortOrder: 'desc',
    limit: 50,
    offset: 0,
  });

  const [tagFilter, setTagFilter] = useState<string>('');
  const [minVolumeInput, setMinVolumeInput] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['walletList', filters, tagFilter, minVolumeInput],
    queryFn: () => getWalletList({
      ...filters,
      tags: tagFilter ? [tagFilter] : undefined,
      minVolume: minVolumeInput ? parseFloat(minVolumeInput) * 1000 : undefined,
    }),
    refetchInterval: 60000,
  });

  const wallets = data?.wallets || [];
  const pagination = data?.pagination;

  const handlePageChange = (direction: 'prev' | 'next') => {
    if (!pagination) return;
    const newOffset = direction === 'next'
      ? pagination.offset + pagination.limit
      : Math.max(0, pagination.offset - pagination.limit);
    setFilters(f => ({ ...f, offset: newOffset }));
  };

  return (
    <div className="bg-terminal-surface/80 backdrop-blur border border-terminal-border rounded-lg overflow-hidden h-full flex flex-col">
      {/* Header with Filters */}
      <div className="px-4 py-3 border-b border-terminal-border space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg text-neon-cyan tracking-wide">WALLET INTELLIGENCE</h2>
          <span className="text-terminal-muted text-xs font-mono">
            {pagination ? `${pagination.total.toLocaleString()} wallets` : '...'}
          </span>
        </div>

        {/* Filter Row */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Sort */}
          <select
            value={filters.sortBy}
            onChange={(e) => setFilters(f => ({ ...f, sortBy: e.target.value as any, offset: 0 }))}
            className="bg-terminal-bg border border-terminal-border rounded px-2 py-1 text-xs text-white font-mono focus:outline-none focus:border-neon-cyan/50"
          >
            {SORT_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>

          {/* Sort Order */}
          <button
            onClick={() => setFilters(f => ({ ...f, sortOrder: f.sortOrder === 'desc' ? 'asc' : 'desc', offset: 0 }))}
            className="bg-terminal-bg border border-terminal-border rounded px-2 py-1 text-xs text-terminal-muted hover:text-white transition-colors"
          >
            {filters.sortOrder === 'desc' ? '↓' : '↑'}
          </button>

          {/* Tag Filter */}
          <select
            value={tagFilter}
            onChange={(e) => { setTagFilter(e.target.value); setFilters(f => ({ ...f, offset: 0 })); }}
            className="bg-terminal-bg border border-terminal-border rounded px-2 py-1 text-xs text-white font-mono focus:outline-none focus:border-neon-cyan/50"
          >
            <option value="">All Tags</option>
            <option value="whale">Whale</option>
            <option value="smart_money">Smart Money</option>
            <option value="insider_suspect">Insider</option>
            <option value="active">Active</option>
            <option value="sniper">Sniper</option>
          </select>

          {/* Min Volume */}
          <div className="flex items-center gap-1">
            <span className="text-terminal-muted text-xs">Min $</span>
            <input
              type="text"
              value={minVolumeInput}
              onChange={(e) => { setMinVolumeInput(e.target.value); setFilters(f => ({ ...f, offset: 0 })); }}
              placeholder="0"
              className="w-16 bg-terminal-bg border border-terminal-border rounded px-2 py-1 text-xs text-white font-mono focus:outline-none focus:border-neon-cyan/50"
            />
            <span className="text-terminal-muted text-xs">K</span>
          </div>
        </div>
      </div>

      {/* Wallet List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="p-8 text-center">
            <div className="text-terminal-muted text-sm animate-pulse">[ LOADING ]</div>
          </div>
        ) : error ? (
          <div className="p-8 text-center">
            <div className="text-neon-red text-sm">[ ERROR ]</div>
          </div>
        ) : wallets.length === 0 ? (
          <div className="p-8 text-center">
            <div className="text-terminal-muted text-sm">[ NO WALLETS FOUND ]</div>
          </div>
        ) : (
          <div className="divide-y divide-terminal-border/30">
            {wallets.map((wallet, idx) => (
              <WalletRow
                key={wallet.address}
                wallet={wallet}
                rank={pagination ? pagination.offset + idx + 1 : idx + 1}
                isSelected={wallet.address === selectedAddress}
                onClick={() => onSelectWallet(wallet)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      {pagination && pagination.total > pagination.limit && (
        <div className="px-4 py-2 border-t border-terminal-border flex items-center justify-between">
          <button
            onClick={() => handlePageChange('prev')}
            disabled={pagination.offset === 0}
            className="text-xs text-terminal-muted hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
          >
            ← Prev
          </button>
          <span className="text-xs text-terminal-muted font-mono">
            {pagination.offset + 1}-{Math.min(pagination.offset + pagination.limit, pagination.total)} of {pagination.total}
          </span>
          <button
            onClick={() => handlePageChange('next')}
            disabled={!pagination.hasMore}
            className="text-xs text-terminal-muted hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

interface WalletRowProps {
  wallet: WalletProfile;
  rank: number;
  isSelected: boolean;
  onClick: () => void;
}

function WalletRow({ wallet, rank, isSelected, onClick }: WalletRowProps) {
  const winRate = wallet.performance.winRate * 100;
  const pnl = wallet.performance.realizedPnl;

  return (
    <button
      onClick={onClick}
      className={`w-full px-4 py-3 text-left hover:bg-white/[0.03] transition-colors ${
        isSelected ? 'bg-neon-cyan/5 border-l-2 border-l-neon-cyan' : ''
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Rank */}
        <span className={`font-mono text-sm w-6 ${
          rank <= 3 ? 'text-neon-amber font-bold' : 'text-terminal-muted'
        }`}>
          {String(rank).padStart(2, '0')}
        </span>

        {/* Main Info */}
        <div className="flex-1 min-w-0">
          {/* Address + Tags */}
          <div className="flex items-center gap-2 mb-1">
            <span className="text-neon-cyan/90 font-mono text-sm">
              {wallet.address.slice(0, 8)}...{wallet.address.slice(-4)}
            </span>
            {wallet.tags.slice(0, 2).map(tag => (
              <span
                key={tag}
                className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${TAG_COLORS[tag] || 'bg-terminal-border/50 text-terminal-muted border-terminal-border'}`}
              >
                {tag.replace('_', ' ').toUpperCase()}
              </span>
            ))}
          </div>

          {/* Stats Row */}
          <div className="flex items-center gap-4 text-xs">
            <span className="text-terminal-muted">
              Vol: <span className="text-white">{formatAmount(wallet.activity.totalVolume)}</span>
            </span>
            <span className="text-terminal-muted">
              PnL: <span className={pnl >= 0 ? 'text-neon-green' : 'text-neon-red'}>
                {pnl >= 0 ? '+' : ''}{formatAmount(pnl)}
              </span>
            </span>
            <span className="text-terminal-muted">
              Win: <span className={winRate >= 50 ? 'text-neon-green' : 'text-terminal-muted'}>
                {winRate.toFixed(0)}%
              </span>
            </span>
          </div>
        </div>

        {/* Scores */}
        <div className="text-right space-y-1">
          {wallet.scores.insiderScore > 30 && (
            <div className="text-[10px] font-mono text-neon-red">
              INS: {wallet.scores.insiderScore}
            </div>
          )}
          {wallet.scores.smartMoneyScore > 50 && (
            <div className="text-[10px] font-mono text-neon-green">
              SM: {wallet.scores.smartMoneyScore}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

function formatAmount(amount: number): string {
  if (Math.abs(amount) >= 1000000) {
    return `$${(amount / 1000000).toFixed(1)}M`;
  }
  if (Math.abs(amount) >= 1000) {
    return `$${(amount / 1000).toFixed(1)}K`;
  }
  return `$${amount.toFixed(0)}`;
}
