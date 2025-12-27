import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getSubscriptionActivity,
  getUnreadNotifications,
  markNotificationsRead,
  type WalletActivity,
} from '../../lib/intelligenceApi';
import { useAuthStore } from '../../stores/authStore';
import { useEffect } from 'react';

const ACTIVITY_ICONS: Record<string, string> = {
  trade: '📊',
  whale_trade: '🐋',
  position_opened: '📈',
  position_closed: '📉',
};

const ACTIVITY_COLORS: Record<string, string> = {
  trade: 'border-terminal-border',
  whale_trade: 'border-neon-cyan/50',
  position_opened: 'border-neon-green/50',
  position_closed: 'border-neon-amber/50',
};

interface ActivityFeedProps {
  compact?: boolean;
}

export function ActivityFeed({ compact = false }: ActivityFeedProps) {
  const { isAuthenticated } = useAuthStore();
  const queryClient = useQueryClient();

  const { data: activity, isLoading, error } = useQuery({
    queryKey: ['subscriptionActivity'],
    queryFn: () => getSubscriptionActivity(compact ? 10 : 50),
    enabled: isAuthenticated,
    refetchInterval: 30000,
  });

  const { data: unreadNotifications } = useQuery({
    queryKey: ['unreadNotifications'],
    queryFn: () => getUnreadNotifications(50),
    enabled: isAuthenticated,
    refetchInterval: 10000,
  });

  const markReadMutation = useMutation({
    mutationFn: markNotificationsRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['unreadNotifications'] });
      queryClient.invalidateQueries({ queryKey: ['subscriptionActivity'] });
    },
  });

  // Mark all as read when viewing
  useEffect(() => {
    if (unreadNotifications && unreadNotifications.length > 0 && !compact) {
      const ids = unreadNotifications.map(n => n.id);
      markReadMutation.mutate(ids);
    }
  }, [unreadNotifications?.length, compact]);

  if (!isAuthenticated) {
    return (
      <div className="bg-terminal-surface/80 border border-terminal-border rounded-lg p-4 text-center">
        <div className="text-terminal-muted text-sm">Sign in to see activity from subscribed wallets</div>
      </div>
    );
  }

  const unreadCount = unreadNotifications?.length || 0;
  const activities = activity || [];

  return (
    <div className="bg-terminal-surface/80 border border-terminal-border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-terminal-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="font-display text-lg text-neon-amber tracking-wide">ACTIVITY FEED</h3>
          {unreadCount > 0 && (
            <span className="px-1.5 py-0.5 bg-neon-red/20 text-neon-red text-[10px] font-mono rounded">
              {unreadCount} new
            </span>
          )}
        </div>
      </div>

      {/* Content */}
      <div className={`overflow-y-auto ${compact ? 'max-h-64' : 'max-h-96'}`}>
        {isLoading ? (
          <div className="p-4 text-center text-terminal-muted text-sm animate-pulse">
            [ LOADING ]
          </div>
        ) : error ? (
          <div className="p-4 text-center text-neon-red text-sm">
            [ ERROR ]
          </div>
        ) : activities.length === 0 ? (
          <div className="p-4 text-center text-terminal-muted text-sm">
            No activity yet. Subscribe to wallets to see their trades here.
          </div>
        ) : (
          <div className="divide-y divide-terminal-border/30">
            {activities.map(item => (
              <ActivityItem key={item.id} activity={item} compact={compact} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface ActivityItemProps {
  activity: WalletActivity;
  compact?: boolean;
}

function ActivityItem({ activity, compact }: ActivityItemProps) {
  const icon = ACTIVITY_ICONS[activity.activityType] || '📌';
  const borderColor = ACTIVITY_COLORS[activity.activityType] || 'border-terminal-border';
  const data = activity.data || {};

  const formatTime = (date: string) => {
    const d = new Date(date);
    const now = new Date();
    const diff = now.getTime() - d.getTime();

    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return d.toLocaleDateString();
  };

  return (
    <div className={`p-3 hover:bg-white/[0.02] transition-colors border-l-2 ${borderColor}`}>
      <div className="flex items-start gap-2">
        <span className="text-base">{icon}</span>
        <div className="flex-1 min-w-0">
          {/* Wallet */}
          <div className="flex items-center gap-2 mb-1">
            <span className="text-neon-cyan/80 font-mono text-xs">
              {activity.walletNickname || `${activity.walletAddress.slice(0, 8)}...`}
            </span>
            <span className="text-terminal-muted text-[10px]">{formatTime(activity.createdAt)}</span>
          </div>

          {/* Activity Description */}
          <div className="text-sm text-white">
            {activity.activityType === 'whale_trade' && (
              <>
                <span className={data.side === 'BUY' ? 'text-neon-green' : 'text-neon-red'}>
                  {data.side}
                </span>
                {' '}
                <span className={data.outcome === 'YES' ? 'text-neon-green' : 'text-neon-red'}>
                  {data.outcome}
                </span>
                {' for '}
                <span className="text-white font-mono">${data.usdValue?.toLocaleString()}</span>
              </>
            )}
            {activity.activityType === 'trade' && (
              <>
                <span className={data.side === 'BUY' ? 'text-neon-green' : 'text-neon-red'}>
                  {data.side} {data.outcome}
                </span>
                {' '}${data.usdValue?.toLocaleString()}
              </>
            )}
            {activity.activityType === 'position_opened' && (
              <>
                Opened {data.outcome} position: {data.size?.toFixed(2)} shares
              </>
            )}
            {activity.activityType === 'position_closed' && (
              <>
                Closed position with{' '}
                <span className={data.realizedPnl >= 0 ? 'text-neon-green' : 'text-neon-red'}>
                  {data.realizedPnl >= 0 ? '+' : ''}{formatAmount(data.realizedPnl || 0)} PnL
                </span>
              </>
            )}
          </div>

          {/* Market */}
          {!compact && data.marketQuestion && (
            <div className="text-xs text-terminal-muted truncate mt-1">
              {data.marketQuestion}
            </div>
          )}
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
