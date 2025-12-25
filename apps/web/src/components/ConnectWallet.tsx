import { useAccount, useConnect, useDisconnect, useSignMessage, useSwitchChain, useChainId } from 'wagmi';
import { polygon } from 'wagmi/chains';
import { useState, useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import { getAuthChallenge, login, logout } from '../lib/tradingApi';

export function ConnectWallet() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending: isConnecting, error: connectError } = useConnect();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const chainId = useChainId();

  const { token, user, isAuthenticated, setSession, clearSession } = useAuthStore();
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);

  const isOnPolygon = chainId === polygon.id;

  // Close modal when connected
  useEffect(() => {
    if (isConnected) {
      setShowModal(false);
      setError(null);
    }
  }, [isConnected]);

  // Switch to Polygon when connected on wrong chain
  useEffect(() => {
    if (isConnected && !isOnPolygon && !isSwitching) {
      console.log('[ConnectWallet] Wrong chain detected, switching to Polygon...', { chainId, targetChain: polygon.id });
      switchChain({ chainId: polygon.id }, {
        onError: (err) => {
          console.error('[ConnectWallet] Chain switch failed:', err);
          if (err.message?.includes('rejected') || err.message?.includes('denied')) {
            setError('Please switch to Polygon network to use this app');
          } else {
            setError('Please switch to Polygon network in your wallet');
          }
        },
        onSuccess: () => {
          console.log('[ConnectWallet] Successfully switched to Polygon');
          setError(null);
        }
      });
    }
  }, [isConnected, isOnPolygon, isSwitching, chainId, switchChain]);

  // Handle connect errors
  useEffect(() => {
    if (connectError) {
      console.error('Connection error:', connectError);
      if (connectError.message?.includes('rejected')) {
        setError('Connection rejected');
      } else {
        setError(connectError.message || 'Connection failed');
      }
    }
  }, [connectError]);

  const handleAuthenticate = async () => {
    if (!address) return;

    setIsAuthenticating(true);
    setError(null);

    try {
      const challenge = await getAuthChallenge(address);
      const signature = await signMessageAsync({ message: challenge.message });
      const session = await login(address, signature);

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
    } catch (err: any) {
      console.error('Auth error:', err);
      setError(err.message || 'Authentication failed');
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

  // Not connected - show connect button
  if (!isConnected) {
    return (
      <>
        <div className="flex flex-col items-end gap-2">
          <button
            onClick={() => setShowModal(true)}
            disabled={isConnecting}
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
              'CONNECT WALLET'
            )}
          </button>
          {error && (
            <span className="text-neon-red text-xs font-mono">{error}</span>
          )}
        </div>

        {/* Wallet Selection Modal */}
        {showModal && (
          <div
            className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
            onClick={() => setShowModal(false)}
          >
            <div
              className="bg-terminal-surface border border-terminal-border rounded-lg p-6 max-w-sm w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-white font-mono text-lg font-semibold">Connect Wallet</h3>
                <button
                  onClick={() => setShowModal(false)}
                  className="text-terminal-muted hover:text-white text-xl"
                >
                  ×
                </button>
              </div>

              <div className="space-y-3">
                {connectors.map((connector) => {
                  const isInjected = connector.id === 'injected';
                  const isWalletConnect = connector.id === 'walletConnect';

                  return (
                    <button
                      key={connector.uid}
                      onClick={() => {
                        setError(null);
                        connect({ connector });
                      }}
                      disabled={isConnecting}
                      className={`
                        w-full flex items-center gap-4 p-4 rounded-lg border transition-all
                        border-terminal-border hover:border-neon-cyan hover:bg-neon-cyan/5
                        disabled:opacity-50 disabled:cursor-not-allowed
                      `}
                    >
                      <div className="w-10 h-10 rounded-lg bg-terminal-bg flex items-center justify-center text-xl">
                        {isInjected ? '🦊' : isWalletConnect ? '🔗' : '👛'}
                      </div>
                      <div className="text-left">
                        <div className="text-white font-mono text-sm">
                          {isInjected ? 'MetaMask' : connector.name}
                        </div>
                        <div className="text-terminal-muted text-xs">
                          {isWalletConnect
                            ? 'Scan with mobile wallet'
                            : 'Browser extension'
                          }
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {error && (
                <div className="mt-4 p-3 bg-neon-red/10 border border-neon-red/30 rounded-lg text-neon-red text-sm">
                  {error}
                </div>
              )}
            </div>
          </div>
        )}
      </>
    );
  }

  // Connected but not authenticated - show sign button
  if (!isAuthenticated) {
    return (
      <div className="flex items-center gap-3">
        <div className="text-terminal-muted text-xs">
          <span className={isOnPolygon ? 'text-neon-green' : 'text-neon-amber'}>●</span>
          <span className="ml-2 font-mono">
            {address?.slice(0, 6)}...{address?.slice(-4)}
          </span>
          {!isOnPolygon && (
            <span className="ml-2 text-neon-amber text-[10px]">
              {isSwitching ? '(switching...)' : '(wrong chain)'}
            </span>
          )}
        </div>
        {!isOnPolygon ? (
          <button
            onClick={() => switchChain({ chainId: polygon.id })}
            disabled={isSwitching}
            className="
              px-4 py-2 bg-neon-amber/20 border border-neon-amber
              rounded-lg text-neon-amber text-sm font-mono font-bold
              hover:bg-neon-amber/30
              disabled:opacity-50 disabled:cursor-not-allowed
              transition-all duration-200
            "
          >
            {isSwitching ? 'SWITCHING...' : 'SWITCH TO POLYGON'}
          </button>
        ) : (
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
        )}
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
