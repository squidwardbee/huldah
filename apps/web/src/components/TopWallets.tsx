import { useQuery } from '@tanstack/react-query';
import { getTopWallets } from '../lib/api';
import type { Wallet } from '../stores/appStore';

function formatAmount(amount: number): string {
  if (Math.abs(amount) >= 1000000) {
    return `$${(amount / 1000000).toFixed(1)}M`;
  }
  if (Math.abs(amount) >= 1000) {
    return `$${(amount / 1000).toFixed(1)}K`;
  }
  return `$${amount.toFixed(0)}`;
}

function formatAddress(address: string): string {
  return `${address.slice(0, 8)}···${address.slice(-4)}`;
}

const TAG_LABELS: Record<string, string> = {
  whale: 'W',
  smart_money: 'S',
  insider: 'I',
  active: 'A',
  new: 'N',
  top_trader: 'T',
};

interface TopWalletsProps {
  compact?: boolean;
}

export function TopWallets({ compact = false }: TopWalletsProps) {
  const { data: wallets, isLoading, error } = useQuery<Wallet[]>({
    queryKey: ['topWallets'],
    queryFn: getTopWallets,
    refetchInterval: 30000
  });

  return (
    <div className="bg-terminal-surface/80 backdrop-blur border border-terminal-border rounded-lg overflow-hidden card-glow h-full flex flex-col">
      {/* Header */}
      <div className={`${compact ? 'px-4 py-2' : 'px-5 py-4'} border-b border-terminal-border flex items-center gap-3`}>
        <h2 className={`font-display ${compact ? 'text-sm' : 'text-xl'} text-neon-magenta tracking-wide`}>TOP WALLETS</h2>
      </div>

      {/* Content */}
      <div className={`${compact ? 'max-h-64' : 'max-h-[480px]'} overflow-y-auto flex-1`}>
        {isLoading ? (
          <div className="p-8 text-center">
            <div className="text-terminal-muted text-sm animate-pulse">[ LOADING DATA ]</div>
          </div>
        ) : error ? (
          <div className="p-8 text-center">
            <div className="text-neon-red text-sm">[ CONNECTION ERROR ]</div>
            <div className="text-terminal-muted/60 text-xs mt-2">Unable to fetch wallet data</div>
          </div>
        ) : !wallets || wallets.length === 0 ? (
          <div className="p-8 text-center">
            <div className="text-terminal-muted text-sm">[ NO DATA YET ]</div>
            <div className="text-terminal-muted/60 text-xs mt-2">Wallets will appear as trades are tracked</div>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="text-terminal-muted text-xs uppercase tracking-wider border-b border-terminal-border/50">
                <th className="px-4 py-3 text-left font-medium">#</th>
                <th className="px-4 py-3 text-left font-medium">Wallet</th>
                <th className="px-4 py-3 text-center font-medium">Tags</th>
                <th className="px-4 py-3 text-right font-medium">Best PnL</th>
                <th className="px-4 py-3 text-right font-medium">Volume</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-terminal-border/30">
              {wallets.slice(0, 20).map((wallet, idx) => (
                <tr 
                  key={wallet.address} 
                  className="hover:bg-white/[0.02] transition-colors animate-fade-in"
                  style={{ animationDelay: `${idx * 30}ms` }}
                >
                  <td className="px-4 py-3">
                    <span className={`font-mono text-sm ${
                      idx < 3 ? 'text-neon-amber font-bold' : 'text-terminal-muted'
                    }`}>
                      {String(idx + 1).padStart(2, '0')}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <a
                      href={`https://polygonscan.com/address/${wallet.address}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-neon-cyan/80 hover:text-neon-cyan font-mono text-sm transition-colors"
                    >
                      {formatAddress(wallet.address)}
                    </a>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      {wallet.tags && wallet.tags.length > 0 ? (
                        wallet.tags.slice(0, 3).map(tag => (
                          <span key={tag} title={tag} className="text-[10px] font-mono px-1 py-0.5 bg-terminal-border/50 rounded text-terminal-muted">
                            {TAG_LABELS[tag] || tag.charAt(0).toUpperCase()}
                          </span>
                        ))
                      ) : (
                        <span className="text-terminal-muted/40">-</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={`font-mono text-sm font-semibold ${
                      Number(wallet.realized_pnl) > 0 ? 'text-neon-green' : 'text-terminal-muted'
                    }`}>
                      {wallet.realized_pnl && Number(wallet.realized_pnl) > 0 
                        ? formatAmount(Number(wallet.realized_pnl)) 
                        : '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="font-mono text-sm text-white">
                      {wallet.total_volume && Number(wallet.total_volume) > 0 
                        ? formatAmount(Number(wallet.total_volume)) 
                        : '—'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
