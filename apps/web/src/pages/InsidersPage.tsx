import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  getInsidersV2,
  getInsiderAlertsV2,
  triggerInsiderRecomputeV2,
  type InsiderSuspect,
  type InsiderAlert,
} from '../lib/intelligenceApi';

const SEVERITY_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  critical: { bg: 'bg-neon-red/20', text: 'text-neon-red', border: 'border-neon-red/50' },
  high: { bg: 'bg-neon-amber/20', text: 'text-neon-amber', border: 'border-neon-amber/50' },
  medium: { bg: 'bg-neon-cyan/20', text: 'text-neon-cyan', border: 'border-neon-cyan/50' },
  low: { bg: 'bg-terminal-muted/20', text: 'text-terminal-muted', border: 'border-terminal-border' },
};

function formatAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatAmount(amount: number): string {
  if (Math.abs(amount) >= 1000000) return `$${(amount / 1000000).toFixed(1)}M`;
  if (Math.abs(amount) >= 1000) return `$${(amount / 1000).toFixed(0)}K`;
  return `$${amount.toFixed(0)}`;
}

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

function ScoreBar({ score, max, color }: { score: number; max: number; color: string }) {
  const pct = Math.min((score / max) * 100, 100);
  return (
    <div className="h-1.5 bg-terminal-surface rounded-full overflow-hidden">
      <div
        className={`h-full ${color} transition-all`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function InsiderCard({ suspect }: { suspect: InsiderSuspect }) {
  const [expanded, setExpanded] = useState(false);
  const scoreColor = suspect.totalInsiderScore >= 70 ? 'text-neon-red' :
    suspect.totalInsiderScore >= 50 ? 'text-neon-amber' :
    suspect.totalInsiderScore >= 30 ? 'text-neon-cyan' : 'text-terminal-muted';

  return (
    <div className="bg-terminal-surface/50 border border-terminal-border rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-4 text-left hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <div className={`text-2xl font-bold font-mono ${scoreColor}`}>
              {suspect.totalInsiderScore.toFixed(0)}
            </div>
            <div>
              <div className="text-white font-medium">
                {suspect.polymarketUsername || formatAddress(suspect.address)}
              </div>
              {suspect.polymarketUsername && (
                <div className="text-terminal-muted text-xs font-mono">
                  {formatAddress(suspect.address)}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <div className="text-right">
              <div className="text-terminal-muted text-xs">Win Rate</div>
              <div className="text-white font-mono">{(suspect.winRate * 100).toFixed(0)}%</div>
            </div>
            <div className="text-right">
              <div className="text-terminal-muted text-xs">Volume</div>
              <div className="text-white font-mono">{formatAmount(suspect.totalVolume)}</div>
            </div>
            <svg
              className={`w-4 h-4 text-terminal-muted transition-transform ${expanded ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>

        {/* Score breakdown preview */}
        <div className="grid grid-cols-5 gap-2 mt-3">
          <div>
            <div className="text-[10px] text-terminal-muted mb-1">Temporal</div>
            <ScoreBar score={suspect.temporalScore} max={30} color="bg-neon-cyan" />
          </div>
          <div>
            <div className="text-[10px] text-terminal-muted mb-1">Trade Quality</div>
            <ScoreBar score={suspect.tradeQualityScore} max={25} color="bg-neon-green" />
          </div>
          <div>
            <div className="text-[10px] text-terminal-muted mb-1">Category</div>
            <ScoreBar score={suspect.categoryRiskScore} max={15} color="bg-neon-amber" />
          </div>
          <div>
            <div className="text-[10px] text-terminal-muted mb-1">Network</div>
            <ScoreBar score={suspect.networkScore} max={15} color="bg-neon-purple" />
          </div>
          <div>
            <div className="text-[10px] text-terminal-muted mb-1">Statistical</div>
            <ScoreBar score={suspect.statisticalScore} max={15} color="bg-neon-red" />
          </div>
        </div>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-terminal-border/50 pt-3">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
            <div>
              <div className="text-terminal-muted text-xs mb-1">Pre-Resolution Accuracy (24h)</div>
              <div className="text-white font-mono">
                {(suspect.preResolution24hAccuracy * 100).toFixed(0)}%
              </div>
            </div>
            <div>
              <div className="text-terminal-muted text-xs mb-1">Low Odds Win Rate</div>
              <div className="text-white font-mono">
                {(suspect.lowOddsWinRate * 100).toFixed(0)}%
                <span className="text-terminal-muted ml-1">({suspect.lowOddsSampleSize} trades)</span>
              </div>
            </div>
            <div>
              <div className="text-terminal-muted text-xs mb-1">High-Risk Category Win Rate</div>
              <div className="text-white font-mono">
                {(suspect.highRiskCategoryWinRate * 100).toFixed(0)}%
              </div>
            </div>
            <div>
              <div className="text-terminal-muted text-xs mb-1">Primary Category</div>
              <div className="text-white font-mono capitalize">
                {suspect.primaryCategory || 'N/A'}
              </div>
            </div>
            <div>
              <div className="text-terminal-muted text-xs mb-1">Total Trades</div>
              <div className="text-white font-mono">{suspect.totalTrades}</div>
            </div>
            <div>
              <div className="text-terminal-muted text-xs mb-1">Win/Loss</div>
              <div className="text-white font-mono">
                <span className="text-neon-green">{suspect.winCount}W</span>
                {' / '}
                <span className="text-neon-red">{suspect.lossCount}L</span>
              </div>
            </div>
            <div>
              <div className="text-terminal-muted text-xs mb-1">Cluster Leader</div>
              <div className={suspect.isClusterLeader ? 'text-neon-amber' : 'text-terminal-muted'}>
                {suspect.isClusterLeader ? 'Yes' : 'No'}
              </div>
            </div>
            <div>
              <div className="text-terminal-muted text-xs mb-1">First Seen</div>
              <div className="text-white font-mono">{formatTime(suspect.firstSeen)}</div>
            </div>
          </div>

          {/* Tags */}
          {suspect.tags && suspect.tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1">
              {suspect.tags.map((tag) => (
                <span
                  key={tag}
                  className="px-2 py-0.5 text-[10px] bg-terminal-border/50 text-terminal-muted rounded"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Actions */}
          <div className="mt-3 flex gap-2">
            <a
              href={`https://polymarket.com/profile/${suspect.address}`}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1 text-xs bg-terminal-border/50 text-terminal-muted hover:text-white rounded transition-colors"
            >
              View on Polymarket
            </a>
            <a
              href={`https://polygonscan.com/address/${suspect.address}`}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1 text-xs bg-terminal-border/50 text-terminal-muted hover:text-white rounded transition-colors"
            >
              View on Polygonscan
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

function AlertCard({ alert }: { alert: InsiderAlert }) {
  const style = SEVERITY_STYLES[alert.severity] || SEVERITY_STYLES.medium;

  return (
    <div className={`p-4 rounded-lg border ${style.border} ${style.bg}`}>
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className={`px-2 py-0.5 text-[10px] font-mono uppercase rounded ${style.bg} ${style.text} border ${style.border}`}>
            {alert.severity}
          </span>
          <span className="text-terminal-muted text-xs font-mono">
            {alert.alertType.replace(/_/g, ' ')}
          </span>
        </div>
        <span className="text-terminal-muted text-xs">{formatTime(alert.createdAt)}</span>
      </div>

      <div className="text-white text-sm mb-2 line-clamp-2">
        {alert.marketQuestion}
      </div>

      <div className="text-terminal-muted text-xs mb-2">
        {alert.description}
      </div>

      <div className="flex items-center gap-4 text-xs">
        <div>
          <span className="text-terminal-muted">Direction:</span>{' '}
          <span className={alert.betDirection === 'YES' ? 'text-neon-green' : 'text-neon-red'}>
            {alert.betDirection}
          </span>
        </div>
        <div>
          <span className="text-terminal-muted">Volume:</span>{' '}
          <span className="text-white font-mono">{formatAmount(alert.totalVolume)}</span>
        </div>
        <div>
          <span className="text-terminal-muted">Wallets:</span>{' '}
          <span className="text-white font-mono">{alert.wallets.length}</span>
        </div>
        <div>
          <span className="text-terminal-muted">Odds:</span>{' '}
          <span className="text-white font-mono">{(alert.oddsAtTime * 100).toFixed(0)}%</span>
        </div>
      </div>
    </div>
  );
}

export function InsidersPage() {
  const [activeTab, setActiveTab] = useState<'suspects' | 'alerts'>('suspects');

  const { data: suspects = [], isLoading: suspectsLoading } = useQuery({
    queryKey: ['insidersV2'],
    queryFn: () => getInsidersV2(100),
    refetchInterval: 60000,
  });

  const { data: alerts = [], isLoading: alertsLoading } = useQuery({
    queryKey: ['insiderAlertsV2'],
    queryFn: () => getInsiderAlertsV2(50),
    refetchInterval: 60000,
  });

  const recomputeMutation = useMutation({
    mutationFn: triggerInsiderRecomputeV2,
  });

  const highScoreSuspects = suspects.filter((s) => s.totalInsiderScore >= 50);
  const criticalAlerts = alerts.filter((a) => a.severity === 'critical' || a.severity === 'high');

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-terminal-border bg-terminal-bg/50">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-xl text-white tracking-wide">INSIDER DETECTION</h1>
            <p className="text-terminal-muted text-sm mt-1">
              Multi-factor scoring system to identify potential insider trading
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-terminal-muted text-xs">High Score Suspects</div>
              <div className="text-neon-red font-mono text-lg">{highScoreSuspects.length}</div>
            </div>
            <div className="text-right">
              <div className="text-terminal-muted text-xs">Critical Alerts</div>
              <div className="text-neon-amber font-mono text-lg">{criticalAlerts.length}</div>
            </div>
            <button
              onClick={() => recomputeMutation.mutate()}
              disabled={recomputeMutation.isPending}
              className="px-3 py-1.5 text-xs font-mono bg-terminal-surface border border-terminal-border rounded hover:border-neon-cyan/50 transition-colors disabled:opacity-50"
            >
              {recomputeMutation.isPending ? 'COMPUTING...' : 'RECOMPUTE SCORES'}
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mt-4">
          <button
            onClick={() => setActiveTab('suspects')}
            className={`px-4 py-2 text-xs font-mono rounded-t transition-colors ${
              activeTab === 'suspects'
                ? 'bg-terminal-surface text-neon-cyan border-t border-x border-terminal-border'
                : 'text-terminal-muted hover:text-white'
            }`}
          >
            SUSPECTS ({suspects.length})
          </button>
          <button
            onClick={() => setActiveTab('alerts')}
            className={`px-4 py-2 text-xs font-mono rounded-t transition-colors ${
              activeTab === 'alerts'
                ? 'bg-terminal-surface text-neon-cyan border-t border-x border-terminal-border'
                : 'text-terminal-muted hover:text-white'
            }`}
          >
            ALERTS ({alerts.length})
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === 'suspects' && (
          <div className="space-y-3">
            {suspectsLoading ? (
              <div className="text-center py-8 text-terminal-muted">Loading suspects...</div>
            ) : suspects.length === 0 ? (
              <div className="text-center py-8">
                <div className="text-terminal-muted mb-2">No insider suspects detected yet</div>
                <div className="text-terminal-muted/60 text-sm">
                  Click "RECOMPUTE SCORES" to analyze wallet behavior
                </div>
              </div>
            ) : (
              suspects.map((suspect) => (
                <InsiderCard key={suspect.address} suspect={suspect} />
              ))
            )}
          </div>
        )}

        {activeTab === 'alerts' && (
          <div className="space-y-3">
            {alertsLoading ? (
              <div className="text-center py-8 text-terminal-muted">Loading alerts...</div>
            ) : alerts.length === 0 ? (
              <div className="text-center py-8">
                <div className="text-terminal-muted mb-2">No insider alerts yet</div>
                <div className="text-terminal-muted/60 text-sm">
                  Alerts are generated when suspicious patterns are detected on active markets
                </div>
              </div>
            ) : (
              alerts.map((alert) => (
                <AlertCard key={alert.id} alert={alert} />
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
