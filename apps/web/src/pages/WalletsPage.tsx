import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getWalletList, type WalletProfile, type WalletQueryParams } from '../lib/intelligenceApi';
import { WalletSlideout } from '../components/WalletSlideout';

const TAG_COLORS: Record<string, string> = {
  whale: 'bg-neon-cyan/20 text-neon-cyan border-neon-cyan/30',
  smart_money: 'bg-neon-green/20 text-neon-green border-neon-green/30',
  insider_suspect: 'bg-neon-red/20 text-neon-red border-neon-red/30',
  active: 'bg-neon-amber/20 text-neon-amber border-neon-amber/30',
  sniper: 'bg-neon-magenta/20 text-neon-magenta border-neon-magenta/30',
};

const SORT_OPTIONS = [
  { value: 'pnl', label: '24h PnL' },
  { value: 'volume', label: 'Total Volume' },
  { value: 'volume_24h', label: '24h Volume' },
  { value: 'win_rate', label: 'Win Rate' },
  { value: 'insider_score', label: 'Insider Score' },
  { value: 'smart_money_score', label: 'Smart Money' },
  { value: 'last_active', label: 'Last Active' },
];

export function WalletsPage() {
  const [selectedWallet, setSelectedWallet] = useState<WalletProfile | null>(null);
  const [filters, setFilters] = useState<WalletQueryParams>({
    sortBy: 'pnl',
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
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-terminal-border bg-terminal-bg/50">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="font-display text-xl text-white tracking-wide">WALLETS</h1>
            <p className="text-terminal-muted text-sm mt-1">
              {pagination ? `${pagination.total.toLocaleString()} tracked wallets` : 'Loading...'}
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Sort By */}
          <div className="flex items-center gap-2">
            <span className="text-terminal-muted text-xs">Sort by</span>
            <select
              value={filters.sortBy}
              onChange={(e) => setFilters(f => ({ ...f, sortBy: e.target.value as any, offset: 0 }))}
              className="bg-terminal-surface border border-terminal-border rounded px-3 py-1.5 text-sm text-white font-mono focus:outline-none focus:border-neon-cyan/50"
            >
              {SORT_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <button
              onClick={() => setFilters(f => ({ ...f, sortOrder: f.sortOrder === 'desc' ? 'asc' : 'desc', offset: 0 }))}
              className="bg-terminal-surface border border-terminal-border rounded px-2 py-1.5 text-sm text-terminal-muted hover:text-white transition-colors"
            >
              {filters.sortOrder === 'desc' ? '↓ High' : '↑ Low'}
            </button>
          </div>

          {/* Tag Filter */}
          <div className="flex items-center gap-2">
            <span className="text-terminal-muted text-xs">Tag</span>
            <select
              value={tagFilter}
              onChange={(e) => { setTagFilter(e.target.value); setFilters(f => ({ ...f, offset: 0 })); }}
              className="bg-terminal-surface border border-terminal-border rounded px-3 py-1.5 text-sm text-white font-mono focus:outline-none focus:border-neon-cyan/50"
            >
              <option value="">All</option>
              <option value="whale">Whale</option>
              <option value="smart_money">Smart Money</option>
              <option value="insider_suspect">Insider</option>
              <option value="active">Active</option>
              <option value="sniper">Sniper</option>
            </select>
          </div>

          {/* Min Volume */}
          <div className="flex items-center gap-2">
            <span className="text-terminal-muted text-xs">Min Vol</span>
            <div className="flex items-center">
              <span className="text-terminal-muted text-sm">$</span>
              <input
                type="text"
                value={minVolumeInput}
                onChange={(e) => { setMinVolumeInput(e.target.value); setFilters(f => ({ ...f, offset: 0 })); }}
                placeholder="0"
                className="w-20 bg-terminal-surface border border-terminal-border rounded px-2 py-1.5 text-sm text-white font-mono focus:outline-none focus:border-neon-cyan/50 ml-1"
              />
              <span className="text-terminal-muted text-sm ml-1">K</span>
            </div>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="p-8 text-center">
            <div className="text-terminal-muted text-sm animate-pulse">[ LOADING WALLETS ]</div>
          </div>
        ) : error ? (
          <div className="p-8 text-center">
            <div className="text-neon-red text-sm">[ ERROR LOADING WALLETS ]</div>
          </div>
        ) : wallets.length === 0 ? (
          <div className="p-8 text-center">
            <div className="text-terminal-muted text-sm">[ NO WALLETS FOUND ]</div>
          </div>
        ) : (
          <table className="w-full">
            <thead className="sticky top-0 bg-terminal-bg/95 backdrop-blur border-b border-terminal-border">
              <tr className="text-terminal-muted text-xs uppercase">
                <th className="text-left px-6 py-3 font-medium">#</th>
                <th className="text-left px-6 py-3 font-medium">Wallet</th>
                <th className="text-left px-6 py-3 font-medium">Tags</th>
                <th className="text-right px-6 py-3 font-medium">24h PnL</th>
                <th className="text-right px-6 py-3 font-medium">Total PnL</th>
                <th className="text-right px-6 py-3 font-medium">Volume</th>
                <th className="text-right px-6 py-3 font-medium">Win Rate</th>
                <th className="text-right px-6 py-3 font-medium">Trades</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-terminal-border/30">
              {wallets.map((wallet, idx) => (
                <WalletRow
                  key={wallet.address}
                  wallet={wallet}
                  rank={pagination ? pagination.offset + idx + 1 : idx + 1}
                  isSelected={selectedWallet?.address === wallet.address}
                  onClick={() => setSelectedWallet(wallet)}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {pagination && pagination.total > pagination.limit && (
        <div className="px-6 py-3 border-t border-terminal-border bg-terminal-bg/50 flex items-center justify-between">
          <button
            onClick={() => handlePageChange('prev')}
            disabled={pagination.offset === 0}
            className="px-4 py-1.5 text-sm text-terminal-muted hover:text-white border border-terminal-border rounded disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            ← Previous
          </button>
          <span className="text-sm text-terminal-muted font-mono">
            {pagination.offset + 1}-{Math.min(pagination.offset + pagination.limit, pagination.total)} of {pagination.total.toLocaleString()}
          </span>
          <button
            onClick={() => handlePageChange('next')}
            disabled={!pagination.hasMore}
            className="px-4 py-1.5 text-sm text-terminal-muted hover:text-white border border-terminal-border rounded disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            Next →
          </button>
        </div>
      )}

      {/* Slideout Panel */}
      <WalletSlideout
        wallet={selectedWallet}
        onClose={() => setSelectedWallet(null)}
      />
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
  const pnl24h = wallet.performance.pnl24h;
  const totalPnl = wallet.performance.totalPnl;
  const winRate = wallet.performance.winRate * 100;

  return (
    <tr
      onClick={onClick}
      className={`cursor-pointer transition-colors hover:bg-white/[0.02] ${
        isSelected ? 'bg-neon-cyan/5' : ''
      }`}
    >
      {/* Rank */}
      <td className="px-6 py-4">
        <span className={`font-mono text-sm ${rank <= 3 ? 'text-neon-amber font-bold' : 'text-terminal-muted'}`}>
          {String(rank).padStart(2, '0')}
        </span>
      </td>

      {/* Wallet Address */}
      <td className="px-6 py-4">
        <span className="text-neon-cyan font-mono text-sm">
          {wallet.address.slice(0, 8)}...{wallet.address.slice(-4)}
        </span>
      </td>

      {/* Tags */}
      <td className="px-6 py-4">
        <div className="flex flex-wrap gap-1">
          {wallet.tags.slice(0, 2).map(tag => (
            <span
              key={tag}
              className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${TAG_COLORS[tag] || 'bg-terminal-border/50 text-terminal-muted border-terminal-border'}`}
            >
              {tag.replace('_', ' ').toUpperCase()}
            </span>
          ))}
        </div>
      </td>

      {/* 24h PnL */}
      <td className="px-6 py-4 text-right">
        <span className={`font-mono text-sm ${pnl24h >= 0 ? 'text-neon-green' : 'text-neon-red'}`}>
          {pnl24h >= 0 ? '+' : ''}{formatAmount(pnl24h)}
        </span>
      </td>

      {/* Total PnL */}
      <td className="px-6 py-4 text-right">
        <span className={`font-mono text-sm ${totalPnl >= 0 ? 'text-neon-green' : 'text-neon-red'}`}>
          {totalPnl >= 0 ? '+' : ''}{formatAmount(totalPnl)}
        </span>
      </td>

      {/* Volume */}
      <td className="px-6 py-4 text-right">
        <span className="font-mono text-sm text-white">{formatAmount(wallet.activity.totalVolume)}</span>
      </td>

      {/* Win Rate */}
      <td className="px-6 py-4 text-right">
        <span className={`font-mono text-sm ${winRate >= 50 ? 'text-neon-green' : 'text-terminal-muted'}`}>
          {winRate.toFixed(1)}%
        </span>
      </td>

      {/* Total Trades */}
      <td className="px-6 py-4 text-right">
        <span className="font-mono text-sm text-terminal-muted">{wallet.activity.totalTrades.toLocaleString()}</span>
      </td>
    </tr>
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
