import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getUserSubscriptionsDetailed,
  unsubscribeFromWallet,
  type WalletProfile,
  type WalletSubscription,
} from '../../lib/intelligenceApi';
import { useAuthStore } from '../../stores/authStore';

interface SubscriptionListProps {
  onSelectWallet?: (wallet: WalletProfile) => void;
}

export function SubscriptionList({ onSelectWallet }: SubscriptionListProps) {
  const { isAuthenticated } = useAuthStore();
  const queryClient = useQueryClient();

  const { data: subscriptions, isLoading, error } = useQuery({
    queryKey: ['userSubscriptionsDetailed'],
    queryFn: getUserSubscriptionsDetailed,
    enabled: isAuthenticated,
    refetchInterval: 60000,
  });

  const unsubscribeMutation = useMutation({
    mutationFn: unsubscribeFromWallet,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['userSubscriptionsDetailed'] });
      queryClient.invalidateQueries({ queryKey: ['userSubscriptions'] });
    },
  });

  if (!isAuthenticated) {
    return (
      <div className="bg-terminal-surface/80 border border-terminal-border rounded-lg p-4 text-center">
        <div className="text-terminal-muted text-sm">Sign in to manage your subscriptions</div>
      </div>
    );
  }

  return (
    <div className="bg-terminal-surface/80 border border-terminal-border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-terminal-border flex items-center justify-between">
        <h3 className="font-display text-lg text-neon-magenta tracking-wide">MY SUBSCRIPTIONS</h3>
        <span className="text-terminal-muted text-xs font-mono">
          {subscriptions?.length || 0} wallets
        </span>
      </div>

      {/* Content */}
      <div className="max-h-80 overflow-y-auto">
        {isLoading ? (
          <div className="p-4 text-center text-terminal-muted text-sm animate-pulse">
            [ LOADING ]
          </div>
        ) : error ? (
          <div className="p-4 text-center text-neon-red text-sm">
            [ ERROR ]
          </div>
        ) : !subscriptions || subscriptions.length === 0 ? (
          <div className="p-4 text-center text-terminal-muted text-sm">
            No subscriptions yet. Click the subscribe button on any wallet to track their activity.
          </div>
        ) : (
          <div className="divide-y divide-terminal-border/30">
            {subscriptions.map(({ subscription, wallet }) => (
              <SubscriptionRow
                key={subscription.id}
                subscription={subscription}
                wallet={wallet}
                onSelect={onSelectWallet}
                onUnsubscribe={() => unsubscribeMutation.mutate(subscription.walletAddress)}
                isUnsubscribing={unsubscribeMutation.isPending}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface SubscriptionRowProps {
  subscription: WalletSubscription;
  wallet: WalletProfile | null;
  onSelect?: (wallet: WalletProfile) => void;
  onUnsubscribe: () => void;
  isUnsubscribing: boolean;
}

function SubscriptionRow({ subscription, wallet, onSelect, onUnsubscribe, isUnsubscribing }: SubscriptionRowProps) {
  return (
    <div className="px-4 py-3 hover:bg-white/[0.02] transition-colors">
      <div className="flex items-center justify-between">
        <button
          onClick={() => wallet && onSelect?.(wallet)}
          disabled={!wallet}
          className="flex-1 text-left"
        >
          <div className="flex items-center gap-2">
            <span className="text-neon-cyan/80 font-mono text-sm">
              {subscription.nickname || `${subscription.walletAddress.slice(0, 10)}...${subscription.walletAddress.slice(-4)}`}
            </span>
            {wallet?.tags.slice(0, 2).map(tag => (
              <span
                key={tag}
                className="text-[8px] font-mono px-1 py-0.5 rounded bg-terminal-border/50 text-terminal-muted"
              >
                {tag.replace('_', ' ').toUpperCase()}
              </span>
            ))}
          </div>
          {wallet && (
            <div className="flex items-center gap-3 text-xs text-terminal-muted mt-1">
              <span>Vol: {formatAmount(wallet.activity.totalVolume)}</span>
              <span className={wallet.performance.realizedPnl >= 0 ? 'text-neon-green' : 'text-neon-red'}>
                PnL: {wallet.performance.realizedPnl >= 0 ? '+' : ''}{formatAmount(wallet.performance.realizedPnl)}
              </span>
            </div>
          )}
        </button>

        {/* Notification Settings */}
        <div className="flex items-center gap-2 ml-4">
          <div className="flex items-center gap-1 text-[10px]">
            {subscription.notifications.onWhaleTrade && (
              <span className="text-neon-cyan" title="Whale trades">W</span>
            )}
            {subscription.notifications.onTrade && (
              <span className="text-terminal-muted" title="All trades">T</span>
            )}
            {subscription.notifications.onNewPosition && (
              <span className="text-neon-green" title="New positions">P</span>
            )}
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onUnsubscribe(); }}
            disabled={isUnsubscribing}
            className="text-terminal-muted hover:text-neon-red transition-colors disabled:opacity-50"
            title="Unsubscribe"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
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
