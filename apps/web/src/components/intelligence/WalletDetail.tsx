import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getWalletDetail,
  getWalletCategories,
  subscribeToWallet,
  unsubscribeFromWallet,
  getUserSubscriptions,
  type WalletProfile,
  type WalletTrade,
  type WalletPosition,
  type CategoryPerformance,
} from '../../lib/intelligenceApi';
import { useAuthStore } from '../../stores/authStore';

interface WalletDetailProps {
  wallet: WalletProfile;
  onClose?: () => void;
}

export function WalletDetail({ wallet, onClose }: WalletDetailProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'trades' | 'positions'>('overview');
  const { isAuthenticated } = useAuthStore();
  const queryClient = useQueryClient();

  // Fetch detailed data
  const { data: detailData } = useQuery({
    queryKey: ['walletDetail', wallet.address],
    queryFn: () => getWalletDetail(wallet.address),
    enabled: activeTab !== 'overview',
  });

  const { data: categories } = useQuery({
    queryKey: ['walletCategories', wallet.address],
    queryFn: () => getWalletCategories(wallet.address),
  });

  // Check if subscribed
  const { data: subscriptions } = useQuery({
    queryKey: ['userSubscriptions'],
    queryFn: getUserSubscriptions,
    enabled: isAuthenticated,
  });

  const isSubscribed = subscriptions?.some(s => s.walletAddress.toLowerCase() === wallet.address.toLowerCase());

  // Subscribe/Unsubscribe mutations
  const subscribeMutation = useMutation({
    mutationFn: () => subscribeToWallet(wallet.address, { notifyOnWhaleTrade: true }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['userSubscriptions'] }),
  });

  const unsubscribeMutation = useMutation({
    mutationFn: () => unsubscribeFromWallet(wallet.address),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['userSubscriptions'] }),
  });

  const handleSubscribeToggle = () => {
    if (isSubscribed) {
      unsubscribeMutation.mutate();
    } else {
      subscribeMutation.mutate();
    }
  };

  return (
    <div className="bg-terminal-surface/95 border border-terminal-border rounded-lg overflow-hidden h-full flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-terminal-border">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <h2 className="font-mono text-neon-cyan">
              {wallet.address.slice(0, 10)}...{wallet.address.slice(-6)}
            </h2>
            {wallet.tags.slice(0, 3).map(tag => (
              <span
                key={tag}
                className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-terminal-border/50 text-terminal-muted"
              >
                {tag.replace('_', ' ').toUpperCase()}
              </span>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {isAuthenticated && (
              <button
                onClick={handleSubscribeToggle}
                disabled={subscribeMutation.isPending || unsubscribeMutation.isPending}
                className={`px-3 py-1 text-xs font-mono rounded border transition-colors ${
                  isSubscribed
                    ? 'border-neon-green/50 text-neon-green hover:bg-neon-green/10'
                    : 'border-terminal-border text-terminal-muted hover:border-neon-cyan/50 hover:text-neon-cyan'
                }`}
              >
                {isSubscribed ? 'SUBSCRIBED' : 'SUBSCRIBE'}
              </button>
            )}
            {onClose && (
              <button
                onClick={onClose}
                className="text-terminal-muted hover:text-white transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* External Links */}
        <div className="flex items-center gap-3 text-xs">
          <a
            href={`https://polygonscan.com/address/${wallet.address}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-terminal-muted hover:text-neon-cyan transition-colors"
          >
            PolygonScan ↗
          </a>
          <a
            href={`https://polymarket.com/profile/${wallet.address}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-terminal-muted hover:text-neon-cyan transition-colors"
          >
            Polymarket ↗
          </a>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-terminal-border">
        {(['overview', 'trades', 'positions'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-xs font-mono transition-colors ${
              activeTab === tab
                ? 'text-neon-cyan border-b-2 border-neon-cyan'
                : 'text-terminal-muted hover:text-white'
            }`}
          >
            {tab.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'overview' && (
          <OverviewTab wallet={wallet} categories={categories || []} />
        )}
        {activeTab === 'trades' && (
          <TradesTab trades={detailData?.recentTrades || []} />
        )}
        {activeTab === 'positions' && (
          <PositionsTab positions={detailData?.positions || []} />
        )}
      </div>
    </div>
  );
}

function OverviewTab({ wallet, categories }: { wallet: WalletProfile; categories: CategoryPerformance[] }) {
  const { performance, activity, scores, behavior } = wallet;

  return (
    <div className="space-y-6">
      {/* Scores */}
      <div className="grid grid-cols-3 gap-3">
        <ScoreCard
          label="Smart Money"
          value={scores.smartMoneyScore}
          color={scores.smartMoneyScore >= 50 ? 'green' : 'muted'}
        />
        <ScoreCard
          label="Insider Score"
          value={scores.insiderScore}
          color={scores.insiderScore >= 50 ? 'red' : scores.insiderScore >= 30 ? 'amber' : 'muted'}
        />
        <ScoreCard
          label="Whale Score"
          value={scores.whaleScore}
          color={scores.whaleScore >= 50 ? 'cyan' : 'muted'}
        />
      </div>

      {/* Performance */}
      <div>
        <h3 className="text-xs text-terminal-muted uppercase tracking-wider mb-2">Performance</h3>
        <div className="grid grid-cols-2 gap-3">
          <StatRow label="Realized PnL" value={formatPnl(performance.realizedPnl)} />
          <StatRow label="Unrealized PnL" value={formatPnl(performance.unrealizedPnl)} />
          <StatRow label="Win Rate" value={`${(performance.winRate * 100).toFixed(1)}%`} />
          <StatRow label="Profit Factor" value={performance.profitFactor.toFixed(2)} />
          <StatRow label="Wins / Losses" value={`${performance.winCount} / ${performance.lossCount}`} />
          <StatRow label="ROI" value={`${(performance.roi * 100).toFixed(1)}%`} />
        </div>
      </div>

      {/* Activity */}
      <div>
        <h3 className="text-xs text-terminal-muted uppercase tracking-wider mb-2">Activity</h3>
        <div className="grid grid-cols-2 gap-3">
          <StatRow label="Total Volume" value={formatAmount(activity.totalVolume)} />
          <StatRow label="Total Trades" value={activity.totalTrades.toLocaleString()} />
          <StatRow label="24h Volume" value={formatAmount(activity.volume24h)} />
          <StatRow label="Avg Trade Size" value={formatAmount(activity.avgTradeSize)} />
        </div>
      </div>

      {/* Behavior */}
      <div>
        <h3 className="text-xs text-terminal-muted uppercase tracking-wider mb-2">Behavior</h3>
        <div className="grid grid-cols-2 gap-3">
          <StatRow label="Preferred Side" value={behavior.preferredSide.toUpperCase()} />
          <StatRow label="Pre-Resolution Rate" value={`${(behavior.preResolutionRate * 100).toFixed(1)}%`} />
          <StatRow label="Markets Traded" value={wallet.specialization.marketsTraded.toString()} />
          <StatRow label="Concentration" value={`${(wallet.specialization.marketConcentration * 100).toFixed(0)}%`} />
        </div>
      </div>

      {/* Categories */}
      {categories.length > 0 && (
        <div>
          <h3 className="text-xs text-terminal-muted uppercase tracking-wider mb-2">Top Categories</h3>
          <div className="space-y-2">
            {categories.slice(0, 5).map(cat => (
              <div key={cat.category} className="flex items-center justify-between text-sm">
                <span className="text-white">{cat.category}</span>
                <div className="flex items-center gap-4 text-xs">
                  <span className="text-terminal-muted">{formatAmount(cat.volume)}</span>
                  <span className={cat.winRate >= 0.5 ? 'text-neon-green' : 'text-terminal-muted'}>
                    {(cat.winRate * 100).toFixed(0)}% win
                  </span>
                  <span className={cat.pnl >= 0 ? 'text-neon-green' : 'text-neon-red'}>
                    {formatPnl(cat.pnl)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TradesTab({ trades }: { trades: WalletTrade[] }) {
  if (trades.length === 0) {
    return (
      <div className="text-center text-terminal-muted py-8">
        No recent trades
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {trades.map(trade => (
        <div
          key={trade.txHash}
          className="p-3 bg-terminal-bg/50 rounded border border-terminal-border/30"
        >
          <div className="flex items-start justify-between mb-1">
            <div className="flex-1 min-w-0">
              <div className="text-white text-sm truncate">{trade.marketQuestion || trade.marketId}</div>
              <div className="text-terminal-muted text-xs">
                {new Date(trade.timestamp).toLocaleString()}
              </div>
            </div>
            <div className="text-right">
              <div className={`text-sm font-mono ${
                trade.side === 'BUY' ? 'text-neon-green' : 'text-neon-red'
              }`}>
                {trade.side} {trade.outcome}
              </div>
              <div className="text-xs text-terminal-muted">
                {formatAmount(trade.usdValue)} @ {(trade.price * 100).toFixed(0)}%
              </div>
            </div>
          </div>
          {trade.outcomeCorrect !== undefined && (
            <div className={`text-xs ${trade.outcomeCorrect ? 'text-neon-green' : 'text-neon-red'}`}>
              {trade.outcomeCorrect ? 'WON' : 'LOST'}
              {trade.profitLoss !== undefined && ` ${formatPnl(trade.profitLoss)}`}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function PositionsTab({ positions }: { positions: WalletPosition[] }) {
  if (positions.length === 0) {
    return (
      <div className="text-center text-terminal-muted py-8">
        No open positions
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {positions.map(pos => (
        <div
          key={`${pos.marketId}-${pos.outcome}`}
          className="p-3 bg-terminal-bg/50 rounded border border-terminal-border/30"
        >
          <div className="flex items-start justify-between mb-1">
            <div className="flex-1 min-w-0">
              <div className="text-white text-sm truncate">{pos.marketQuestion || pos.marketId}</div>
              <div className="text-terminal-muted text-xs">
                {pos.size.toFixed(2)} shares @ {(pos.avgEntryPrice * 100).toFixed(1)}%
              </div>
            </div>
            <div className="text-right">
              <div className={`text-sm font-mono ${pos.outcome === 'YES' ? 'text-neon-green' : 'text-neon-red'}`}>
                {pos.outcome}
              </div>
              <div className="text-xs text-terminal-muted">
                Now: {(pos.currentPrice * 100).toFixed(1)}%
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-terminal-muted">Value: {formatAmount(pos.value)}</span>
            <span className={pos.unrealizedPnl >= 0 ? 'text-neon-green' : 'text-neon-red'}>
              {formatPnl(pos.unrealizedPnl)}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function ScoreCard({ label, value, color }: { label: string; value: number; color: 'green' | 'red' | 'amber' | 'cyan' | 'muted' }) {
  const colorClasses = {
    green: 'text-neon-green',
    red: 'text-neon-red',
    amber: 'text-neon-amber',
    cyan: 'text-neon-cyan',
    muted: 'text-terminal-muted',
  };

  return (
    <div className="bg-terminal-bg/50 rounded p-3 text-center">
      <div className={`text-2xl font-mono font-bold ${colorClasses[color]}`}>{value}</div>
      <div className="text-xs text-terminal-muted">{label}</div>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between p-2 bg-terminal-bg/30 rounded">
      <span className="text-xs text-terminal-muted">{label}</span>
      <span className="text-sm font-mono text-white">{value}</span>
    </div>
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

function formatPnl(pnl: number): string {
  const prefix = pnl >= 0 ? '+' : '';
  return prefix + formatAmount(pnl);
}
