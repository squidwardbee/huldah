import { useState, useEffect } from 'react';
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
} from '../lib/intelligenceApi';
import { useAuthStore } from '../stores/authStore';

interface WalletSlideoutProps {
  wallet: WalletProfile | null;
  onClose: () => void;
}

export function WalletSlideout({ wallet, onClose }: WalletSlideoutProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'trades' | 'positions'>('overview');
  const { isAuthenticated } = useAuthStore();
  const queryClient = useQueryClient();

  useEffect(() => {
    setActiveTab('overview');
  }, [wallet?.address]);

  const { data: detailData } = useQuery({
    queryKey: ['walletDetail', wallet?.address],
    queryFn: () => wallet ? getWalletDetail(wallet.address) : null,
    enabled: !!wallet && activeTab !== 'overview',
  });

  const { data: categories } = useQuery({
    queryKey: ['walletCategories', wallet?.address],
    queryFn: () => wallet ? getWalletCategories(wallet.address) : [],
    enabled: !!wallet,
  });

  const { data: subscriptions } = useQuery({
    queryKey: ['userSubscriptions'],
    queryFn: getUserSubscriptions,
    enabled: isAuthenticated,
  });

  const isSubscribed = wallet && subscriptions?.some(
    s => s.walletAddress.toLowerCase() === wallet.address.toLowerCase()
  );

  const subscribeMutation = useMutation({
    mutationFn: () => wallet ? subscribeToWallet(wallet.address, { notifyOnWhaleTrade: true }) : Promise.reject(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['userSubscriptions'] }),
  });

  const unsubscribeMutation = useMutation({
    mutationFn: () => wallet ? unsubscribeFromWallet(wallet.address) : Promise.reject(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['userSubscriptions'] }),
  });

  const handleSubscribeToggle = () => {
    if (isSubscribed) {
      unsubscribeMutation.mutate();
    } else {
      subscribeMutation.mutate();
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!wallet) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 w-full max-w-lg bg-terminal-bg border-l border-terminal-border z-50 flex flex-col animate-slide-in-right">
        <div className="px-6 py-4 border-b border-terminal-border">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-mono text-lg text-neon-cyan">
              {wallet.address.slice(0, 10)}...{wallet.address.slice(-6)}
            </h2>
            <button onClick={onClose} className="p-1 text-terminal-muted hover:text-white">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="flex flex-wrap gap-2 mb-3">
            {wallet.tags.map(tag => (
              <span key={tag} className="text-[10px] font-mono px-2 py-1 rounded bg-terminal-surface border border-terminal-border text-terminal-muted">
                {tag.replace('_', ' ').toUpperCase()}
              </span>
            ))}
          </div>
          <div className="flex items-center gap-3">
            {isAuthenticated && (
              <button
                onClick={handleSubscribeToggle}
                disabled={subscribeMutation.isPending || unsubscribeMutation.isPending}
                className={`px-4 py-1.5 text-xs font-mono rounded border transition-colors ${
                  isSubscribed
                    ? 'border-neon-green/50 text-neon-green bg-neon-green/10'
                    : 'border-terminal-border text-terminal-muted hover:border-neon-cyan/50 hover:text-neon-cyan'
                }`}
              >
                {isSubscribed ? '✓ SUBSCRIBED' : 'SUBSCRIBE'}
              </button>
            )}
            <a href={`https://polygonscan.com/address/${wallet.address}`} target="_blank" rel="noopener noreferrer"
              className="px-4 py-1.5 text-xs font-mono rounded border border-terminal-border text-terminal-muted hover:text-white">
              PolygonScan ↗
            </a>
            <a href={`https://polymarket.com/profile/${wallet.address}`} target="_blank" rel="noopener noreferrer"
              className="px-4 py-1.5 text-xs font-mono rounded border border-terminal-border text-terminal-muted hover:text-white">
              Polymarket ↗
            </a>
          </div>
        </div>

        <div className="flex border-b border-terminal-border">
          {(['overview', 'trades', 'positions'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 px-4 py-3 text-sm font-mono ${
                activeTab === tab ? 'text-neon-cyan border-b-2 border-neon-cyan bg-neon-cyan/5' : 'text-terminal-muted hover:text-white'
              }`}
            >
              {tab.toUpperCase()}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'overview' && <OverviewTab wallet={wallet} categories={categories || []} />}
          {activeTab === 'trades' && <TradesTab trades={detailData?.recentTrades || []} />}
          {activeTab === 'positions' && <PositionsTab positions={detailData?.positions || []} />}
        </div>
      </div>
    </>
  );
}

function OverviewTab({ wallet, categories }: { wallet: WalletProfile; categories: CategoryPerformance[] }) {
  const { performance, activity, scores, behavior } = wallet;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-3">
        <ScoreCard label="Smart Money" value={scores.smartMoneyScore} color={scores.smartMoneyScore >= 50 ? 'green' : 'muted'} />
        <ScoreCard label="Insider Score" value={scores.insiderScore} color={scores.insiderScore >= 50 ? 'red' : scores.insiderScore >= 30 ? 'amber' : 'muted'} />
        <ScoreCard label="Whale Score" value={scores.whaleScore} color={scores.whaleScore >= 50 ? 'cyan' : 'muted'} />
      </div>

      <Section title="Performance">
        <div className="grid grid-cols-2 gap-2">
          <StatRow label="Realized PnL" value={formatPnl(performance.realizedPnl)} positive={performance.realizedPnl >= 0} />
          <StatRow label="Unrealized PnL" value={formatPnl(performance.unrealizedPnl)} positive={performance.unrealizedPnl >= 0} />
          <StatRow label="Win Rate" value={`${(performance.winRate * 100).toFixed(1)}%`} positive={performance.winRate >= 0.5} />
          <StatRow label="Profit Factor" value={performance.profitFactor.toFixed(2)} />
          <StatRow label="Wins / Losses" value={`${performance.winCount} / ${performance.lossCount}`} />
          <StatRow label="ROI" value={`${(performance.roi * 100).toFixed(1)}%`} positive={performance.roi >= 0} />
        </div>
      </Section>

      <Section title="Activity">
        <div className="grid grid-cols-2 gap-2">
          <StatRow label="Total Volume" value={formatAmount(activity.totalVolume)} />
          <StatRow label="Total Trades" value={activity.totalTrades.toLocaleString()} />
          <StatRow label="24h Volume" value={formatAmount(activity.volume24h)} />
          <StatRow label="Avg Trade Size" value={formatAmount(activity.avgTradeSize)} />
        </div>
      </Section>

      <Section title="Behavior">
        <div className="grid grid-cols-2 gap-2">
          <StatRow label="Preferred Side" value={behavior.preferredSide.toUpperCase()} />
          <StatRow label="Pre-Resolution" value={`${(behavior.preResolutionRate * 100).toFixed(1)}%`} />
          <StatRow label="Markets Traded" value={wallet.specialization.marketsTraded.toString()} />
          <StatRow label="Concentration" value={`${(wallet.specialization.marketConcentration * 100).toFixed(0)}%`} />
        </div>
      </Section>

      {categories.length > 0 && (
        <Section title="Top Categories">
          <div className="space-y-2">
            {categories.slice(0, 5).map(cat => (
              <div key={cat.category} className="flex items-center justify-between py-2 border-b border-terminal-border/30 last:border-0">
                <span className="text-white text-sm">{cat.category}</span>
                <div className="flex items-center gap-4 text-xs font-mono">
                  <span className="text-terminal-muted">{formatAmount(cat.volume)}</span>
                  <span className={cat.winRate >= 0.5 ? 'text-neon-green' : 'text-terminal-muted'}>{(cat.winRate * 100).toFixed(0)}%</span>
                  <span className={cat.pnl >= 0 ? 'text-neon-green' : 'text-neon-red'}>{formatPnl(cat.pnl)}</span>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function TradesTab({ trades }: { trades: WalletTrade[] }) {
  if (trades.length === 0) return <div className="text-center text-terminal-muted py-12">No recent trades</div>;

  return (
    <div className="space-y-3">
      {trades.map(trade => (
        <div key={trade.txHash} className="p-4 bg-terminal-surface/50 rounded-lg border border-terminal-border/50">
          <div className="flex items-start justify-between mb-2">
            <div className="flex-1 min-w-0">
              <div className="text-white text-sm truncate">{trade.marketQuestion || trade.marketId}</div>
              <div className="text-terminal-muted text-xs mt-1">{new Date(trade.timestamp).toLocaleString()}</div>
            </div>
            <div className="text-right ml-4">
              <div className={`text-sm font-mono font-medium ${trade.side === 'BUY' ? 'text-neon-green' : 'text-neon-red'}`}>
                {trade.side} {trade.outcome}
              </div>
              <div className="text-xs text-terminal-muted font-mono">{formatAmount(trade.usdValue)} @ {(trade.price * 100).toFixed(0)}¢</div>
            </div>
          </div>
          {trade.outcomeCorrect !== undefined && (
            <div className={`text-xs font-mono ${trade.outcomeCorrect ? 'text-neon-green' : 'text-neon-red'}`}>
              {trade.outcomeCorrect ? '✓ WON' : '✗ LOST'}{trade.profitLoss !== undefined && ` ${formatPnl(trade.profitLoss)}`}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function PositionsTab({ positions }: { positions: WalletPosition[] }) {
  if (positions.length === 0) return <div className="text-center text-terminal-muted py-12">No open positions</div>;

  return (
    <div className="space-y-3">
      {positions.map(pos => (
        <div key={`${pos.marketId}-${pos.outcome}`} className="p-4 bg-terminal-surface/50 rounded-lg border border-terminal-border/50">
          <div className="flex items-start justify-between mb-2">
            <div className="flex-1 min-w-0">
              <div className="text-white text-sm truncate">{pos.marketQuestion || pos.marketId}</div>
              <div className="text-terminal-muted text-xs mt-1 font-mono">{pos.size.toFixed(2)} shares @ {(pos.avgEntryPrice * 100).toFixed(1)}¢</div>
            </div>
            <div className="text-right ml-4">
              <div className={`text-sm font-mono font-medium ${pos.outcome === 'YES' ? 'text-neon-green' : 'text-neon-red'}`}>{pos.outcome}</div>
              <div className="text-xs text-terminal-muted font-mono">Now: {(pos.currentPrice * 100).toFixed(1)}¢</div>
            </div>
          </div>
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-terminal-muted">Value: {formatAmount(pos.value)}</span>
            <span className={pos.unrealizedPnl >= 0 ? 'text-neon-green' : 'text-neon-red'}>{formatPnl(pos.unrealizedPnl)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs text-terminal-muted uppercase tracking-wider mb-3">{title}</h3>
      {children}
    </div>
  );
}

function ScoreCard({ label, value, color }: { label: string; value: number; color: 'green' | 'red' | 'amber' | 'cyan' | 'muted' }) {
  const colors = { green: 'text-neon-green border-neon-green/30', red: 'text-neon-red border-neon-red/30', amber: 'text-neon-amber border-neon-amber/30', cyan: 'text-neon-cyan border-neon-cyan/30', muted: 'text-terminal-muted border-terminal-border' };
  return (
    <div className={`bg-terminal-surface/50 rounded-lg p-4 text-center border ${colors[color]}`}>
      <div className={`text-2xl font-mono font-bold ${colors[color].split(' ')[0]}`}>{value}</div>
      <div className="text-xs text-terminal-muted mt-1">{label}</div>
    </div>
  );
}

function StatRow({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div className="flex items-center justify-between p-2 bg-terminal-surface/30 rounded">
      <span className="text-xs text-terminal-muted">{label}</span>
      <span className={`text-sm font-mono ${positive === true ? 'text-neon-green' : positive === false ? 'text-neon-red' : 'text-white'}`}>{value}</span>
    </div>
  );
}

function formatAmount(amount: number): string {
  if (Math.abs(amount) >= 1000000) return `$${(amount / 1000000).toFixed(1)}M`;
  if (Math.abs(amount) >= 1000) return `$${(amount / 1000).toFixed(1)}K`;
  return `$${amount.toFixed(0)}`;
}

function formatPnl(pnl: number): string {
  return (pnl >= 0 ? '+' : '') + formatAmount(pnl);
}
