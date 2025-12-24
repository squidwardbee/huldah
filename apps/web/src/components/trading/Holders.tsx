import { useQuery } from '@tanstack/react-query';
import { getMarketHolders } from '../../lib/tradingApi';

interface HoldersProps {
  conditionId: string;
}

export function Holders({ conditionId }: HoldersProps) {
  const { data: holders = [], isLoading } = useQuery({
    queryKey: ['holders', conditionId],
    queryFn: () => getMarketHolders(conditionId, 30),
    enabled: !!conditionId,
    staleTime: 30000,
  });

  // Separate holders by outcome
  const yesHolders = holders.filter(h => h.outcome === 'Yes');
  const noHolders = holders.filter(h => h.outcome === 'No');

  // Calculate totals
  const totalYes = yesHolders.reduce((sum, h) => sum + h.balance, 0);
  const totalNo = noHolders.reduce((sum, h) => sum + h.balance, 0);

  if (!conditionId) {
    return (
      <div className="bg-terminal-surface/80 border border-terminal-border rounded-lg p-6 h-64 flex items-center justify-center">
        <span className="text-terminal-muted text-sm">Select a market to view holders</span>
      </div>
    );
  }

  return (
    <div className="bg-terminal-surface/80 border border-terminal-border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-terminal-border flex items-center justify-between">
        <h3 className="text-white font-mono text-sm font-semibold">HOLDERS</h3>
        <div className="flex gap-4 text-xs font-mono">
          <span className="text-neon-green">YES: ${totalYes.toFixed(0)}</span>
          <span className="text-neon-red">NO: ${totalNo.toFixed(0)}</span>
        </div>
      </div>

      {isLoading ? (
        <div className="p-4 space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="animate-pulse h-8 bg-terminal-border/30 rounded" />
          ))}
        </div>
      ) : holders.length === 0 ? (
        <div className="p-8 text-center text-terminal-muted text-sm">
          No position data available
        </div>
      ) : (
        <div className="max-h-[300px] overflow-y-auto">
          <div className="grid grid-cols-2 divide-x divide-terminal-border/30">
            {/* YES Holders */}
            <div>
              <div className="px-3 py-2 bg-neon-green/5 border-b border-terminal-border/30">
                <span className="text-neon-green text-xs font-mono font-semibold">YES HOLDERS</span>
              </div>
              <div className="divide-y divide-terminal-border/10">
                {yesHolders.length === 0 ? (
                  <div className="p-4 text-center text-terminal-muted/50 text-xs">No holders</div>
                ) : (
                  yesHolders.map((holder, i) => (
                    <div key={i} className="px-3 py-2 hover:bg-terminal-bg/30">
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-mono text-terminal-muted truncate w-24" title={holder.address}>
                          {holder.address.slice(0, 6)}...{holder.address.slice(-4)}
                        </span>
                        <span className="text-xs font-mono text-neon-green">
                          ${holder.balance.toFixed(0)}
                        </span>
                      </div>
                      <div className="text-[10px] text-terminal-muted/60 mt-0.5">
                        Avg: {(holder.avgPrice * 100).toFixed(1)}¢
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* NO Holders */}
            <div>
              <div className="px-3 py-2 bg-neon-red/5 border-b border-terminal-border/30">
                <span className="text-neon-red text-xs font-mono font-semibold">NO HOLDERS</span>
              </div>
              <div className="divide-y divide-terminal-border/10">
                {noHolders.length === 0 ? (
                  <div className="p-4 text-center text-terminal-muted/50 text-xs">No holders</div>
                ) : (
                  noHolders.map((holder, i) => (
                    <div key={i} className="px-3 py-2 hover:bg-terminal-bg/30">
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-mono text-terminal-muted truncate w-24" title={holder.address}>
                          {holder.address.slice(0, 6)}...{holder.address.slice(-4)}
                        </span>
                        <span className="text-xs font-mono text-neon-red">
                          ${holder.balance.toFixed(0)}
                        </span>
                      </div>
                      <div className="text-[10px] text-terminal-muted/60 mt-0.5">
                        Avg: {(holder.avgPrice * 100).toFixed(1)}¢
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

