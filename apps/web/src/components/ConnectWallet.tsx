import { useAccount, useConnect, useDisconnect, useSignMessage } from 'wagmi';
import { useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import { getAuthChallenge, login, logout } from '../lib/tradingApi';

export function ConnectWallet() {
  const { address, isConnected } = useAccount();
  const { connectors, connect, isPending: isConnecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  
  const { token, user, isAuthenticated, setSession, clearSession } = useAuthStore();
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConnect = async (connectorId: string) => {
    const connector = connectors.find(c => c.id === connectorId);
    if (connector) {
      connect({ connector });
    }
  };

  const handleAuthenticate = async () => {
    if (!address) return;
    
    setIsAuthenticating(true);
    setError(null);
    
    try {
      // Get challenge from server
      const challenge = await getAuthChallenge(address);
      
      // Sign the message
      const signature = await signMessageAsync({ message: challenge.message });
      
      // Send signature to server
      const session = await login(address, signature);
      
      // Store session
      setSession(session.token, {
        id: session.userId,
        eoaAddress: session.eoaAddress,
        proxyAddress: session.proxyAddress,
        username: null,
        proxyDeployed: !!session.proxyAddress,
        totalOrders: 0,
        totalVolume: 0,
        realizedPnl: 0,
      });
    } catch (err) {
      console.error('Auth error:', err);
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleLogout = async () => {
    if (token) {
      try {
        await logout(token);
      } catch (err) {
        console.warn('Logout error:', err);
      }
    }
    clearSession();
    disconnect();
  };

  // Not connected - show single connect button
  if (!isConnected) {
    // Prefer injected wallet (MetaMask, etc.), fallback to first available
    const preferredConnector = connectors.find(c => c.id === 'injected') || connectors[0];
    
    return (
      <button
        onClick={() => preferredConnector && handleConnect(preferredConnector.id)}
        disabled={isConnecting || !preferredConnector}
        className="
          px-5 py-2.5 bg-terminal-surface border border-neon-cyan/40 
          rounded-lg text-neon-cyan text-sm font-mono font-semibold
          hover:bg-neon-cyan/10 hover:border-neon-cyan hover:shadow-[0_0_15px_rgba(0,255,245,0.3)]
          disabled:opacity-50 disabled:cursor-not-allowed
          transition-all duration-200
        "
      >
        {isConnecting ? (
          <span className="animate-pulse">CONNECTING...</span>
        ) : (
          '⚡ CONNECT WALLET'
        )}
      </button>
    );
  }

  // Connected but not authenticated - show sign button
  if (!isAuthenticated) {
    return (
      <div className="flex items-center gap-3">
        <div className="text-terminal-muted text-xs">
          <span className="text-neon-green">●</span>
          <span className="ml-2 font-mono">
            {address?.slice(0, 6)}...{address?.slice(-4)}
          </span>
        </div>
        <button
          onClick={handleAuthenticate}
          disabled={isAuthenticating}
          className="
            px-4 py-2 bg-neon-cyan/20 border border-neon-cyan
            rounded-lg text-neon-cyan text-sm font-mono font-bold
            hover:bg-neon-cyan/30
            disabled:opacity-50 disabled:cursor-not-allowed
            transition-all duration-200
          "
        >
          {isAuthenticating ? 'SIGNING...' : 'SIGN IN'}
        </button>
        <button
          onClick={() => disconnect()}
          className="
            px-3 py-2 bg-terminal-surface border border-terminal-muted/30
            rounded-lg text-terminal-muted text-xs font-mono
            hover:border-neon-red/50 hover:text-neon-red
            transition-all duration-200
          "
        >
          ✕
        </button>
        {error && (
          <span className="text-neon-red text-xs">{error}</span>
        )}
      </div>
    );
  }

  // Fully authenticated
  return (
    <div className="flex items-center gap-4">
      {/* User info */}
      <div className="text-right">
        <div className="flex items-center gap-2">
          <span className="text-neon-green text-xs">●</span>
          <span className="text-white font-mono text-sm">
            {user?.username || `${address?.slice(0, 6)}...${address?.slice(-4)}`}
          </span>
        </div>
        {user?.proxyAddress && (
          <div className="text-terminal-muted text-xs font-mono">
            Proxy: {user.proxyAddress.slice(0, 8)}...
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="hidden md:flex items-center gap-4 px-4 border-l border-terminal-border">
        <div className="text-center">
          <div className="text-terminal-muted text-[10px] uppercase tracking-wider">Orders</div>
          <div className="text-neon-cyan font-mono text-sm">{user?.totalOrders || 0}</div>
        </div>
        <div className="text-center">
          <div className="text-terminal-muted text-[10px] uppercase tracking-wider">Volume</div>
          <div className="text-neon-amber font-mono text-sm">
            ${((user?.totalVolume || 0) / 1000).toFixed(1)}K
          </div>
        </div>
        <div className="text-center">
          <div className="text-terminal-muted text-[10px] uppercase tracking-wider">P&L</div>
          <div className={`font-mono text-sm ${(user?.realizedPnl || 0) >= 0 ? 'text-neon-green' : 'text-neon-red'}`}>
            ${user?.realizedPnl?.toFixed(2) || '0.00'}
          </div>
        </div>
      </div>

      {/* Logout */}
      <button
        onClick={handleLogout}
        className="
          px-3 py-2 bg-terminal-surface border border-terminal-muted/30
          rounded-lg text-terminal-muted text-xs font-mono
          hover:border-neon-red/50 hover:text-neon-red
          transition-all duration-200
        "
      >
        LOGOUT
      </button>
    </div>
  );
}

