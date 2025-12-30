import { useState, useEffect, useRef, useMemo } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import {
  getSubscriptionActivity,
  getUserSubscriptionsDetailed,
  updateSubscription,
  type WalletActivity,
  type WalletSubscription,
  type WalletProfile
} from '../lib/intelligenceApi';
import { useAuthStore } from '../stores/authStore';
import { WalletSlideout } from '../components/WalletSlideout';

// Derive WebSocket URL from API URL
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const WS_URL = API_URL.replace(/^http/, 'ws') + '/ws';

const ACTIVITY_TYPE_STYLES: Record<string, { bg: string; text: string; label: string; icon: string }> = {
  trade: { bg: 'bg-white/10', text: 'text-white', label: 'TRADE', icon: '↔' },
  whale_trade: { bg: 'bg-neon-cyan/20', text: 'text-neon-cyan', label: 'WHALE', icon: '🐋' },
  position_opened: { bg: 'bg-neon-green/20', text: 'text-neon-green', label: 'OPEN', icon: '📈' },
  position_closed: { bg: 'bg-neon-amber/20', text: 'text-neon-amber', label: 'CLOSE', icon: '📉' },
};

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatAddress(address: string): string {
  return `${address.slice(0, 6)}···${address.slice(-4)}`;
}

function formatAmount(amount: number): string {
  if (Math.abs(amount) >= 1000000) return `$${(amount / 1000000).toFixed(1)}M`;
  if (Math.abs(amount) >= 1000) return `$${(amount / 1000).toFixed(0)}K`;
  return `$${amount.toFixed(0)}`;
}

interface ActivityCardProps {
  activity: WalletActivity;
  nickname?: string;
}

function ActivityCard({ activity, nickname }: ActivityCardProps) {
  const style = ACTIVITY_TYPE_STYLES[activity.activityType] || ACTIVITY_TYPE_STYLES.trade;
  const data = activity.data || {};

  // Extract trade details from activity data
  const side = data.side || data.type || '';
  const usdValue = data.usdValue || data.usd_value || data.value || 0;
  const marketQuestion = data.marketQuestion || data.market_question || data.market || '';
  const price = data.price || 0;

  return (
    <div className="px-5 py-4 hover:bg-white/[0.02] transition-colors border-b border-terminal-border/30">
      {/* Header row: Type badge + Amount + Time */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <span className={`${style.bg} ${style.text} text-xs px-2 py-0.5 rounded font-mono flex items-center gap-1`}>
            <span>{style.icon}</span>
            {style.label}
          </span>
          {side && (
            <span className={`font-mono text-sm font-semibold px-2 py-0.5 rounded ${
              side === 'BUY' ? 'bg-neon-green/10 text-neon-green' : 'bg-neon-red/10 text-neon-red'
            }`}>
              {side}
            </span>
          )}
          {usdValue > 0 && (
            <span className="text-white font-mono font-bold text-lg">
              {formatAmount(usdValue)}
            </span>
          )}
        </div>
        <span className="text-terminal-muted text-xs font-mono">
          {formatTime(activity.createdAt)}
        </span>
      </div>

      {/* Market question */}
      {marketQuestion && (
        <div className="text-terminal-muted text-sm mb-2 truncate">
          {marketQuestion}
        </div>
      )}

      {/* Wallet row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <a
            href={`https://polygonscan.com/address/${activity.walletAddress}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-neon-cyan/70 hover:text-neon-cyan text-sm font-mono transition-colors"
          >
            {formatAddress(activity.walletAddress)}
          </a>
          {(nickname || activity.walletNickname) && (
            <span className="text-terminal-muted text-xs bg-terminal-border/30 px-1.5 py-0.5 rounded">
              {nickname || activity.walletNickname}
            </span>
          )}
        </div>
        {price > 0 && (
          <span className="text-terminal-muted/60 text-xs">
            @ {price.toFixed(2)}
          </span>
        )}
      </div>
    </div>
  );
}

interface SubscribedWalletCardProps {
  subscription: WalletSubscription;
  wallet: WalletProfile | null;
  isSelected: boolean;
  onClick: () => void;
  onOpenSlideout: () => void;
  onUpdateNickname: (nickname: string) => void;
  isUpdatingNickname: boolean;
}

function SubscribedWalletCard({
  subscription,
  wallet,
  isSelected,
  onClick,
  onOpenSlideout,
  onUpdateNickname,
  isUpdatingNickname
}: SubscribedWalletCardProps) {
  const [isEditingNickname, setIsEditingNickname] = useState(false);
  const [nicknameInput, setNicknameInput] = useState('');
  const pnl = wallet?.performance?.totalPnl || 0;
  // Display priority: user's nickname > polymarket username > address
  const displayName = subscription.nickname || wallet?.polymarketUsername;

  const handleStartEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setNicknameInput(subscription.nickname || '');
    setIsEditingNickname(true);
  };

  const handleSaveNickname = () => {
    onUpdateNickname(nicknameInput.trim());
    setIsEditingNickname(false);
  };

  const handleCancelEdit = () => {
    setIsEditingNickname(false);
    setNicknameInput('');
  };

  return (
    <div
      className={`group w-full px-3 py-2 text-left transition-colors border-b border-terminal-border/30 ${
        isSelected ? 'bg-neon-cyan/10' : 'hover:bg-white/[0.02]'
      }`}
    >
      <div className="flex items-center justify-between">
        <button onClick={onClick} className="flex-1 text-left">
          {displayName ? (
            <>
              <div className="text-white text-sm font-medium">
                {displayName}
              </div>
              <div className="text-neon-cyan/70 font-mono text-xs mt-0.5">
                {formatAddress(subscription.walletAddress)}
              </div>
            </>
          ) : (
            <div className="text-neon-cyan font-mono text-sm">
              {formatAddress(subscription.walletAddress)}
            </div>
          )}
        </button>
        <div className="flex items-center gap-2">
          {wallet && (
            <span className={`font-mono text-xs ${pnl >= 0 ? 'text-neon-green' : 'text-neon-red'}`}>
              {pnl >= 0 ? '+' : ''}{formatAmount(pnl)}
            </span>
          )}
          {/* Edit nickname button */}
          <button
            onClick={handleStartEdit}
            className="p-1 text-terminal-muted hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
            title="Edit nickname"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
          </button>
          {/* Open slideout button */}
          <button
            onClick={(e) => { e.stopPropagation(); onOpenSlideout(); }}
            className="p-1 text-terminal-muted hover:text-neon-cyan transition-colors"
            title="View wallet details"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </button>
        </div>
      </div>

      {/* Inline nickname editing */}
      {isEditingNickname && (
        <div className="mt-2 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <input
            type="text"
            value={nicknameInput}
            onChange={(e) => setNicknameInput(e.target.value)}
            placeholder="Nickname..."
            className="flex-1 bg-terminal-surface border border-terminal-border rounded px-2 py-1 text-xs text-white placeholder-terminal-muted focus:outline-none focus:border-neon-cyan/50"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSaveNickname();
              if (e.key === 'Escape') handleCancelEdit();
            }}
          />
          <button
            onClick={handleSaveNickname}
            disabled={isUpdatingNickname}
            className="px-1.5 py-1 text-[10px] font-mono text-neon-green hover:bg-neon-green/10 rounded"
          >
            {isUpdatingNickname ? '...' : '✓'}
          </button>
          <button
            onClick={handleCancelEdit}
            className="px-1.5 py-1 text-[10px] font-mono text-terminal-muted hover:text-white"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

export function MonitorPage() {
  const { isAuthenticated, token } = useAuthStore();
  const queryClient = useQueryClient();
  const [filterWallet, setFilterWallet] = useState<string | null>(null);
  const [slideoutWallet, setSlideoutWallet] = useState<WalletProfile | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const ws = useRef<WebSocket | null>(null);

  // Fetch subscribed wallets
  const { data: subscriptions = [], isLoading: subsLoading } = useQuery({
    queryKey: ['subscriptionsDetailed'],
    queryFn: getUserSubscriptionsDetailed,
    enabled: isAuthenticated,
    refetchInterval: 60000,
  });

  // Mutation for updating nickname
  const updateNicknameMutation = useMutation({
    mutationFn: ({ walletAddress, nickname }: { walletAddress: string; nickname: string }) =>
      updateSubscription(walletAddress, { nickname }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['userSubscriptions'] });
      queryClient.invalidateQueries({ queryKey: ['subscriptionsDetailed'] });
    },
  });

  // Fetch activity feed
  const { data: activities = [], isLoading: activityLoading, error } = useQuery({
    queryKey: ['subscriptionActivity'],
    queryFn: () => getSubscriptionActivity(100),
    enabled: isAuthenticated,
    refetchInterval: 30000,
  });

  // Build display name map for quick lookup (nickname > polymarket username)
  const displayNameMap = useMemo(() => {
    const map = new Map<string, string>();
    subscriptions.forEach(({ subscription, wallet }) => {
      const displayName = subscription.nickname || wallet?.polymarketUsername;
      if (displayName) {
        map.set(subscription.walletAddress.toLowerCase(), displayName);
      }
    });
    return map;
  }, [subscriptions]);

  // Filter activities by selected wallet
  const filteredActivities = useMemo(() => {
    if (!filterWallet) return activities;
    return activities.filter(a => a.walletAddress.toLowerCase() === filterWallet.toLowerCase());
  }, [activities, filterWallet]);

  // WebSocket for real-time updates
  useEffect(() => {
    if (!isAuthenticated || !token) return;

    const connect = () => {
      ws.current = new WebSocket(WS_URL);

      ws.current.onopen = () => {
        console.log('[Monitor WS] Connected');
        setWsConnected(true);
        // Send auth token to subscribe to user's activity channel
        ws.current?.send(JSON.stringify({ type: 'auth', token }));
      };

      ws.current.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'subscription_activity') {
          // Invalidate query to refetch activity
          queryClient.invalidateQueries({ queryKey: ['subscriptionActivity'] });
        }
      };

      ws.current.onclose = () => {
        console.log('[Monitor WS] Disconnected');
        setWsConnected(false);
        // Reconnect after 5s
        setTimeout(connect, 5000);
      };

      ws.current.onerror = () => {
        setWsConnected(false);
      };
    };

    connect();

    return () => {
      ws.current?.close();
    };
  }, [isAuthenticated, token, queryClient]);

  // Not authenticated view
  if (!isAuthenticated) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="text-6xl mb-4">🔐</div>
          <h2 className="font-display text-xl text-white mb-2">SIGN IN TO MONITOR</h2>
          <p className="text-terminal-muted text-sm max-w-md">
            Connect your wallet and sign in to subscribe to wallets and monitor their trading activity in real-time.
          </p>
        </div>
      </div>
    );
  }

  // No subscriptions view
  if (!subsLoading && subscriptions.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="text-6xl mb-4">👀</div>
          <h2 className="font-display text-xl text-white mb-2">NO WALLETS SUBSCRIBED</h2>
          <p className="text-terminal-muted text-sm max-w-md mb-4">
            Go to the Wallets tab, click on a wallet, and subscribe to start monitoring their trades.
          </p>
          <div className="text-terminal-muted/60 text-xs">
            You'll see their trades appear here in real-time.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex">
      {/* Left sidebar: Subscribed wallets */}
      <div className="w-64 border-r border-terminal-border bg-terminal-bg/50 flex flex-col">
        <div className="px-4 py-3 border-b border-terminal-border">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-sm text-white">SUBSCRIBED</h2>
            <span className="text-terminal-muted text-xs font-mono">
              {subscriptions.length}
            </span>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {/* All wallets option */}
          <button
            onClick={() => setFilterWallet(null)}
            className={`w-full px-3 py-2 text-left transition-colors border-b border-terminal-border/30 ${
              !filterWallet ? 'bg-neon-cyan/10' : 'hover:bg-white/[0.02]'
            }`}
          >
            <div className="text-white font-mono text-sm">All Wallets</div>
            <div className="text-terminal-muted text-xs mt-0.5">
              {activities.length} activities
            </div>
          </button>

          {/* Individual wallets */}
          {subscriptions.map(({ subscription, wallet }) => (
            <SubscribedWalletCard
              key={subscription.id}
              subscription={subscription}
              wallet={wallet}
              isSelected={filterWallet === subscription.walletAddress}
              onClick={() => setFilterWallet(
                filterWallet === subscription.walletAddress ? null : subscription.walletAddress
              )}
              onOpenSlideout={() => wallet && setSlideoutWallet(wallet)}
              onUpdateNickname={(nickname) => updateNicknameMutation.mutate({
                walletAddress: subscription.walletAddress,
                nickname
              })}
              isUpdatingNickname={updateNicknameMutation.isPending}
            />
          ))}
        </div>
      </div>

      {/* Main content: Activity feed */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-terminal-border bg-terminal-bg/50">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="font-display text-xl text-white tracking-wide">MONITOR</h1>
              <p className="text-terminal-muted text-sm mt-1">
                {filterWallet
                  ? `Activity from ${formatAddress(filterWallet)}`
                  : 'Activity from all subscribed wallets'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-neon-green animate-pulse' : 'bg-neon-red'}`}
              />
              <span className={`text-[10px] font-mono uppercase tracking-widest ${
                wsConnected ? 'text-neon-green' : 'text-neon-red'
              }`}>
                {wsConnected ? 'LIVE' : 'OFFLINE'}
              </span>
            </div>
          </div>
        </div>

        {/* Activity list */}
        <div className="flex-1 overflow-y-auto">
          {activityLoading ? (
            <div className="p-8 text-center">
              <div className="text-terminal-muted text-sm animate-pulse">[ LOADING ACTIVITY ]</div>
            </div>
          ) : error ? (
            <div className="p-8 text-center">
              <div className="text-neon-red text-sm">[ ERROR LOADING ACTIVITY ]</div>
            </div>
          ) : filteredActivities.length === 0 ? (
            <div className="p-8 text-center">
              <div className="text-terminal-muted text-sm mb-2">[ NO ACTIVITY YET ]</div>
              <div className="text-terminal-muted/60 text-xs">
                {filterWallet
                  ? 'This wallet has no recent activity.'
                  : 'Trades from subscribed wallets will appear here.'}
              </div>
            </div>
          ) : (
            <div>
              {filteredActivities.map((activity) => (
                <ActivityCard
                  key={activity.id}
                  activity={activity}
                  nickname={displayNameMap.get(activity.walletAddress.toLowerCase())}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Wallet Slideout */}
      <WalletSlideout
        wallet={slideoutWallet}
        onClose={() => setSlideoutWallet(null)}
      />
    </div>
  );
}
