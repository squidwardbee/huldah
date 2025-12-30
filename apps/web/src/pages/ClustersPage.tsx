import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getCluster } from '../lib/intelligenceApi';

const METHOD_LABELS: Record<string, string> = {
  funding_pattern: 'Funding Pattern',
  timing: 'Timing Correlation',
  behavior: 'Behavioral',
  manual: 'Manual',
};

const METHOD_COLORS: Record<string, string> = {
  funding_pattern: 'border-neon-amber/50 bg-neon-amber/10',
  timing: 'border-neon-cyan/50 bg-neon-cyan/10',
  behavior: 'border-neon-purple/50 bg-neon-purple/10',
  manual: 'border-terminal-border bg-terminal-surface',
};

export function ClustersPage() {
  const { clusterId } = useParams<{ clusterId: string }>();
  const navigate = useNavigate();

  const { data: cluster, isLoading, error } = useQuery({
    queryKey: ['clusterDetail', clusterId],
    queryFn: () => clusterId ? getCluster(clusterId) : null,
    enabled: !!clusterId,
  });

  if (!clusterId) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-terminal-muted">No cluster ID provided</div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-terminal-muted animate-pulse">[ LOADING CLUSTER ]</div>
      </div>
    );
  }

  if (error || !cluster) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4">
        <div className="text-neon-red">Cluster not found</div>
        <button
          onClick={() => navigate('/wallets')}
          className="px-4 py-2 text-sm font-mono text-terminal-muted border border-terminal-border rounded hover:text-white hover:border-neon-cyan/50 transition-colors"
        >
          ← Back to Wallets
        </button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-terminal-border bg-terminal-bg/50">
        <div className="flex items-center gap-4 mb-4">
          <button
            onClick={() => navigate(-1)}
            className="text-terminal-muted hover:text-white transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 className="font-display text-xl text-white tracking-wide">WALLET CLUSTER</h1>
            <p className="text-terminal-muted text-xs font-mono mt-1">
              {clusterId.slice(0, 8)}...{clusterId.slice(-8)}
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Summary Card */}
          <div className={`rounded-lg p-6 border ${METHOD_COLORS[cluster.detectionMethod] || METHOD_COLORS.manual}`}>
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <svg className="w-6 h-6 text-neon-amber" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
                <span className="text-white text-lg font-medium">
                  {METHOD_LABELS[cluster.detectionMethod]} Cluster
                </span>
              </div>
              <span className="text-sm font-mono px-3 py-1 rounded bg-terminal-surface text-terminal-muted">
                {(cluster.confidence * 100).toFixed(0)}% confidence
              </span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatBox label="Members" value={`${cluster.memberCount} wallets`} />
              <StatBox label="Total Volume" value={formatAmount(cluster.totalVolume)} />
              <StatBox
                label="Total PnL"
                value={formatPnl(cluster.totalPnl)}
                color={cluster.totalPnl >= 0 ? 'green' : 'red'}
              />
              <StatBox
                label="Avg Win Rate"
                value={`${(cluster.avgWinRate * 100).toFixed(1)}%`}
                color={cluster.avgWinRate >= 0.5 ? 'green' : 'muted'}
              />
              <StatBox
                label="Avg Insider Score"
                value={cluster.avgInsiderScore.toString()}
                color={cluster.avgInsiderScore >= 50 ? 'red' : cluster.avgInsiderScore >= 30 ? 'amber' : 'muted'}
              />
              <StatBox label="Markets Traded" value={cluster.marketsTraded.toString()} />
              <StatBox label="Created" value={new Date(cluster.createdAt).toLocaleDateString()} />
              {cluster.lastActivity && (
                <StatBox label="Last Activity" value={new Date(cluster.lastActivity).toLocaleDateString()} />
              )}
            </div>
          </div>

          {/* Funding Source */}
          {cluster.fundingSource && (
            <div className="rounded-lg p-4 border border-terminal-border bg-terminal-surface/30">
              <h3 className="text-xs text-terminal-muted uppercase mb-3">Funding Source</h3>
              <div className="flex items-center gap-3">
                <a
                  href={`https://polygonscan.com/address/${cluster.fundingSource}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-neon-cyan hover:underline"
                >
                  {cluster.fundingSource}
                </a>
                {cluster.fundingSourceType && (
                  <span className="text-xs px-2 py-0.5 bg-terminal-surface rounded text-terminal-muted uppercase">
                    {cluster.fundingSourceType}
                  </span>
                )}
              </div>
              {cluster.totalFunded && cluster.totalFunded > 0 && (
                <div className="mt-2 text-sm text-terminal-muted">
                  Total funded: {formatAmount(cluster.totalFunded)}
                </div>
              )}
            </div>
          )}

          {/* Members List */}
          <div className="rounded-lg border border-terminal-border bg-terminal-surface/20">
            <div className="px-4 py-3 border-b border-terminal-border">
              <h3 className="text-xs text-terminal-muted uppercase">Cluster Members ({cluster.members.length})</h3>
            </div>
            <div className="divide-y divide-terminal-border/30">
              {cluster.members.map(member => (
                <div
                  key={member.address}
                  className="flex items-center justify-between p-4 hover:bg-terminal-surface/30 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <a
                      href={`https://polymarket.com/profile/${member.address}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-sm text-neon-cyan hover:underline"
                    >
                      {member.address.slice(0, 10)}...{member.address.slice(-6)}
                    </a>
                    <span className="text-xs px-1.5 py-0.5 bg-terminal-surface rounded text-terminal-muted">
                      {member.role}
                    </span>
                  </div>
                  <div className="flex items-center gap-6 text-xs font-mono">
                    <div className="text-right">
                      <div className="text-terminal-muted">Volume</div>
                      <div className="text-white">{formatAmount(member.volume)}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-terminal-muted">PnL</div>
                      <div className={member.pnl >= 0 ? 'text-neon-green' : 'text-neon-red'}>
                        {formatPnl(member.pnl)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-terminal-muted">Win Rate</div>
                      <div className={member.winRate >= 0.5 ? 'text-neon-green' : 'text-terminal-muted'}>
                        {(member.winRate * 100).toFixed(0)}%
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-terminal-muted">Insider</div>
                      <div className={
                        member.insiderScore >= 50 ? 'text-neon-red' :
                        member.insiderScore >= 30 ? 'text-neon-amber' :
                        'text-terminal-muted'
                      }>
                        {member.insiderScore}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatBox({
  label,
  value,
  color = 'white',
}: {
  label: string;
  value: string;
  color?: 'white' | 'green' | 'red' | 'amber' | 'muted';
}) {
  const colorClasses = {
    white: 'text-white',
    green: 'text-neon-green',
    red: 'text-neon-red',
    amber: 'text-neon-amber',
    muted: 'text-terminal-muted',
  };

  return (
    <div className="bg-terminal-surface/30 rounded p-3">
      <div className="text-terminal-muted text-xs mb-1">{label}</div>
      <div className={`font-mono text-sm ${colorClasses[color]}`}>{value}</div>
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
