import { useQuery } from '@tanstack/react-query';
import { getPatternMatch } from '../../lib/tradingApi';

interface PatternPredictionProps {
  tokenId: string;
  onClose?: () => void;
  interval?: 5 | 15 | 60;
}

export function PatternPrediction({ tokenId, onClose, interval = 5 }: PatternPredictionProps) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['patternMatch', tokenId, interval],
    queryFn: () => getPatternMatch(tokenId, { horizon: '4h', topK: 100, interval }),
    enabled: !!tokenId,
    staleTime: 60000, // Cache for 1 minute
    refetchInterval: 300000, // Refetch every 5 minutes
  });

  if (isLoading) {
    return (
      <div className="bg-terminal-surface border border-terminal-border rounded-lg p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-mono text-neon-magenta font-bold">DTW PATTERN</span>
          {onClose && (
            <button onClick={onClose} className="text-terminal-muted hover:text-white text-xs">
              ×
            </button>
          )}
        </div>
        <div className="text-terminal-muted text-xs animate-pulse">Analyzing patterns...</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-terminal-surface border border-terminal-border rounded-lg p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-mono text-neon-magenta font-bold">DTW PATTERN</span>
          {onClose && (
            <button onClick={onClose} className="text-terminal-muted hover:text-white text-xs">
              ×
            </button>
          )}
        </div>
        <div className="text-terminal-muted text-xs">
          {data?.statistics.totalMatches === 0
            ? 'No historical patterns found. Run backfill to collect data.'
            : 'Pattern analysis unavailable'}
        </div>
        <button
          onClick={() => refetch()}
          className="mt-2 text-[9px] text-neon-cyan hover:underline"
        >
          Retry
        </button>
      </div>
    );
  }

  const { statistics, prediction } = data;

  if (statistics.totalMatches === 0) {
    return (
      <div className="bg-terminal-surface border border-terminal-border rounded-lg p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-mono text-neon-magenta font-bold">DTW PATTERN</span>
          {onClose && (
            <button onClick={onClose} className="text-terminal-muted hover:text-white text-xs">
              ×
            </button>
          )}
        </div>
        <div className="text-terminal-muted text-xs">
          No historical patterns in database yet.
        </div>
      </div>
    );
  }

  const directionColor =
    prediction.direction === 'UP'
      ? 'text-neon-green'
      : prediction.direction === 'DOWN'
      ? 'text-neon-red'
      : 'text-terminal-muted';

  const confidenceLevel =
    prediction.confidence > 0.15 ? 'HIGH' : prediction.confidence > 0.08 ? 'MED' : 'LOW';

  const confidenceColor =
    confidenceLevel === 'HIGH'
      ? 'text-neon-green'
      : confidenceLevel === 'MED'
      ? 'text-neon-amber'
      : 'text-terminal-muted';

  return (
    <div className="bg-terminal-surface border border-neon-magenta/30 rounded-lg p-3">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-neon-magenta font-bold">DTW PATTERN</span>
          <span className="text-[9px] text-terminal-muted">
            {interval === 60 ? '1h' : `${interval}m`} candles
          </span>
        </div>
        {onClose && (
          <button onClick={onClose} className="text-terminal-muted hover:text-white text-xs">
            ×
          </button>
        )}
      </div>

      {/* Main prediction */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-[9px] text-terminal-muted mb-1">Historical matches</div>
          <div className="text-lg font-mono font-bold text-white">
            {statistics.totalMatches}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[9px] text-terminal-muted mb-1">Prediction</div>
          <div className={`text-lg font-mono font-bold ${directionColor}`}>
            {prediction.direction}
          </div>
        </div>
      </div>

      {/* Up/Down breakdown */}
      <div className="flex gap-2 mb-3">
        <div className="flex-1 bg-neon-green/10 rounded px-2 py-1.5 border border-neon-green/20">
          <div className="flex items-center justify-between">
            <span className="text-[9px] text-neon-green">UP</span>
            <span className="text-sm font-mono font-bold text-neon-green">
              {statistics.upPercentage.toFixed(0)}%
            </span>
          </div>
          <div className="text-[8px] text-terminal-muted">
            {statistics.upCount} matches
          </div>
        </div>
        <div className="flex-1 bg-neon-red/10 rounded px-2 py-1.5 border border-neon-red/20">
          <div className="flex items-center justify-between">
            <span className="text-[9px] text-neon-red">DOWN</span>
            <span className="text-sm font-mono font-bold text-neon-red">
              {statistics.downPercentage.toFixed(0)}%
            </span>
          </div>
          <div className="text-[8px] text-terminal-muted">
            {statistics.downCount} matches
          </div>
        </div>
      </div>

      {/* Confidence & expected move */}
      <div className="flex items-center justify-between text-[9px] border-t border-terminal-border pt-2">
        <div>
          <span className="text-terminal-muted">Confidence: </span>
          <span className={`font-mono ${confidenceColor}`}>{confidenceLevel}</span>
          <span className="text-terminal-muted ml-1">
            ({(prediction.confidence * 100).toFixed(0)}%)
          </span>
        </div>
        <div>
          <span className="text-terminal-muted">Exp. move: </span>
          <span
            className={`font-mono ${
              prediction.expectedMove > 0 ? 'text-neon-green' : prediction.expectedMove < 0 ? 'text-neon-red' : ''
            }`}
          >
            {prediction.expectedMove > 0 ? '+' : ''}
            {(prediction.expectedMove * 100).toFixed(1)}%
          </span>
        </div>
      </div>

      {/* Disclaimer */}
      <div className="mt-2 text-[7px] text-terminal-muted/60 leading-tight">
        Based on DTW pattern matching. Not financial advice.
      </div>
    </div>
  );
}
