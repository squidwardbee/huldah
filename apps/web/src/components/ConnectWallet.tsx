import { useAccount, useConnect, useDisconnect, useSignMessage, useSwitchChain, useChainId } from 'wagmi';
import { polygon } from 'wagmi/chains';
import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
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

  // Track if we should auto-authenticate after connecting
  const pendingAuthRef = useRef(false);

  const isOnPolygon = chainId === polygon.id;

  // Close modal when fully authenticated (not just connected)
  useEffect(() => {
    if (isAuthenticated) {
      setShowModal(false);
      setError(null);
    }
  }, [isAuthenticated]);

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
      pendingAuthRef.current = false; // Clear pending auth on error
      if (connectError.message?.includes('rejected')) {
        setError('Connection rejected');
      } else {
        setError(connectError.message || 'Connection failed');
      }
    }
  }, [connectError]);

  const handleAuthenticate = useCallback(async () => {
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
      pendingAuthRef.current = false;
    }
  }, [address, signMessageAsync, setSession]);

  // Auto-authenticate after wallet connects on Polygon
  // This enables single-step connect+sign flow
  useEffect(() => {
    if (
      pendingAuthRef.current &&
      isConnected &&
      address &&
      isOnPolygon &&
      !isAuthenticated &&
      !isAuthenticating &&
      !isSwitching
    ) {
      console.log('[ConnectWallet] Auto-authenticating after connect...');
      handleAuthenticate();
    }
  }, [isConnected, address, isOnPolygon, isAuthenticated, isAuthenticating, isSwitching, handleAuthenticate]);

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
            disabled={isConnecting || isAuthenticating}
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
            ) : isAuthenticating ? (
              <span className="animate-pulse">SIGNING...</span>
            ) : (
              'CONNECT WALLET'
            )}
          </button>
          {error && (
            <span className="text-neon-red text-xs font-mono">{error}</span>
          )}
        </div>

        {/* Wallet Selection Modal - rendered via Portal to document.body */}
        {showModal && createPortal(
          <div
            className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
            style={{ zIndex: 9999 }}
            onClick={() => {
              if (!isConnecting && !isAuthenticating && !isSwitching) {
                pendingAuthRef.current = false;
                setShowModal(false);
              }
            }}
          >
            <div
              className="bg-terminal-surface border border-neon-cyan/30 rounded-lg p-6 max-w-sm w-full shadow-2xl shadow-black/50 animate-fade-in"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-white font-mono text-lg font-semibold">Connect Wallet</h3>
                <button
                  onClick={() => {
                    if (!isConnecting && !isAuthenticating && !isSwitching) {
                      pendingAuthRef.current = false;
                      setShowModal(false);
                    }
                  }}
                  className="text-terminal-muted hover:text-white text-xl disabled:opacity-50"
                  disabled={isConnecting || isAuthenticating || isSwitching}
                >
                  ×
                </button>
              </div>

              {/* Status indicator during connect/sign flow */}
              {(isConnecting || isSwitching || isAuthenticating) && (
                <div className="mb-4 p-3 bg-neon-cyan/10 border border-neon-cyan/30 rounded-lg">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-neon-cyan rounded-full animate-pulse" />
                    <span className="text-neon-cyan text-sm font-mono">
                      {isConnecting && 'Connecting wallet...'}
                      {isSwitching && 'Switching to Polygon...'}
                      {isAuthenticating && 'Sign message in wallet...'}
                    </span>
                  </div>
                </div>
              )}

              <div className="space-y-3">
                {connectors.map((connector) => {
                  const isInjected = connector.id === 'injected';
                  const isWalletConnect = connector.id === 'walletConnect';

                  return (
                    <button
                      key={connector.uid}
                      onClick={() => {
                        setError(null);
                        // Set flag to auto-authenticate after connection completes
                        pendingAuthRef.current = true;
                        connect({ connector });
                      }}
                      disabled={isConnecting || isAuthenticating || isSwitching}
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
          </div>,
          document.body
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
