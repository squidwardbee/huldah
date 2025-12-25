/**
 * Wallet-Based Polymarket Trading Hook
 *
 * Client-side signing with direct submission to Polymarket CLOB.
 * No credentials stored on server - everything stays in browser.
 *
 * Flow:
 * 1. User connects wallet via wagmi
 * 2. Derive API credentials from wallet signature (one-time)
 * 3. Store credentials in localStorage (browser only)
 * 4. Sign orders in browser, submit directly to Polymarket CLOB
 */

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useAccount, useChainId } from 'wagmi';
import { switchChain, getChainId } from '@wagmi/core';
import { wagmiConfig } from '../lib/wagmi';
import { ethers } from 'ethers';
import { ClobClient, Side, OrderType as ClobOrderType, AssetType } from '@polymarket/clob-client';
import { getCreate2Address, keccak256, encodeAbiParameters, type Hex } from 'viem';

// Direct to Polymarket CLOB - no proxy
const CLOB_API_URL = 'https://clob.polymarket.com';
const CHAIN_ID = 137; // Polygon
const CREDS_STORAGE_KEY = 'polymarket_api_creds';

// Polymarket Safe wallet derivation constants
// From @polymarket/builder-relayer-client
const SAFE_FACTORY_ADDRESS = '0xaacfeea03eb1561c4e67d661e40682bd20e3541b' as Hex;
const SAFE_INIT_CODE_HASH = '0x2bce2127ff07fb632d16c8347c4ebf501f4841168bed00d9e6ef715ddb6fcecf' as Hex;

/**
 * Derive the Polymarket Safe (proxy wallet) address from an EOA
 * This is deterministic - same EOA always gets same Safe address
 */
function deriveSafeAddress(eoaAddress: string): string {
  const salt = keccak256(
    encodeAbiParameters(
      [{ name: 'address', type: 'address' }],
      [eoaAddress as Hex]
    )
  );

  return getCreate2Address({
    bytecodeHash: SAFE_INIT_CODE_HASH,
    from: SAFE_FACTORY_ADDRESS,
    salt,
  });
}

// Geoblock check
interface GeoblockResponse {
  blocked: boolean;
  ip: string;
  country: string;
  region: string;
}

async function checkGeoblock(): Promise<GeoblockResponse | null> {
  try {
    const response = await fetch('https://polymarket.com/api/geoblock');
    return response.json();
  } catch (err) {
    console.error('[Geoblock] Failed to check:', err);
    return null;
  }
}

export interface OrderParams {
  tokenId: string;
  side: 'BUY' | 'SELL';
  price: number;
  size: number;
  orderType?: 'GTC' | 'GTD' | 'FOK';
}

export interface OrderResult {
  success: boolean;
  orderId?: string;
  transactionHash?: string;
  errorMessage?: string;
}

interface StoredCredentials {
  key: string;
  secret: string;
  passphrase: string;
  address: string;
  signatureType?: number; // 0=EOA, 1=POLY_PROXY, 2=GNOSIS_SAFE
  funder?: string; // Proxy wallet address if using signature type 1 or 2
}

// Signature types per Polymarket docs
const SIGNATURE_TYPE = {
  EOA: 0,           // Standard wallet, funds in EOA itself
  POLY_PROXY: 1,    // Magic Link users
  GNOSIS_SAFE: 2,   // Users who have deposited via polymarket.com (most common)
} as const;

export function useWalletTrading() {
  const { address, isConnected, connector } = useAccount();
  const chainId = useChainId();

  const [isLoading, setIsLoading] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [hasCredentials, setHasCredentials] = useState(false);
  const [geoblock, setGeoblock] = useState<GeoblockResponse | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [allowance, setAllowance] = useState<string | null>(null);

  // CLOB client ref
  const clobClientRef = useRef<ClobClient | null>(null);

  // Derive the Safe (proxy wallet) address from the EOA
  // This is where the user's Polymarket funds are held
  const proxyWallet = useMemo(() => {
    if (!address) return null;
    try {
      const derived = deriveSafeAddress(address);
      console.log('[useWalletTrading] Derived Safe address:', derived, 'from EOA:', address);
      return derived;
    } catch (err) {
      console.error('[useWalletTrading] Failed to derive Safe address:', err);
      return null;
    }
  }, [address]);

  // Check geoblock on mount
  useEffect(() => {
    checkGeoblock().then(result => {
      if (result) {
        setGeoblock(result);
        if (result.blocked) {
          console.warn(`[useWalletTrading] Geoblocked: ${result.country}/${result.region} (IP: ${result.ip})`);
        } else {
          console.log(`[useWalletTrading] Geoblock OK: ${result.country} (IP: ${result.ip})`);
        }
      }
    });
  }, []);

  // Check if on correct chain
  const isOnPolygon = chainId === CHAIN_ID;

  // Load cached credentials on mount/address change
  useEffect(() => {
    if (address) {
      const cached = localStorage.getItem(`${CREDS_STORAGE_KEY}_${address.toLowerCase()}`);
      if (cached) {
        try {
          const creds: StoredCredentials = JSON.parse(cached);
          if (creds.address.toLowerCase() === address.toLowerCase()) {
            setHasCredentials(true);
            console.log('[useWalletTrading] Found cached credentials for', address);
          }
        } catch (e) {
          console.error('[useWalletTrading] Failed to parse cached credentials');
        }
      } else {
        setHasCredentials(false);
      }
    } else {
      setHasCredentials(false);
      clobClientRef.current = null;
      setIsReady(false);
    }
  }, [address]);

  // Clear error when wallet reconnects
  useEffect(() => {
    if (connector && address && error) {
      setError(null);
    }
  }, [connector, address, error]);

  // Track if we've tried auto-init for this address
  const hasTriedAutoInit = useRef(false);

  // Reset auto-init flag when address changes
  useEffect(() => {
    hasTriedAutoInit.current = false;
  }, [address]);

  /**
   * Initialize CLOB client with wallet signer
   * Derives API credentials from wallet signature on first use
   */
  const initializeClient = useCallback(async (): Promise<boolean> => {
    if (!connector || !address) {
      setError('Wallet not connected');
      return false;
    }

    // Already initialized
    if (clobClientRef.current && isReady) {
      return true;
    }

    // Check geoblock
    if (geoblock?.blocked) {
      setError(`Trading blocked in ${geoblock.country}. Use a VPN in a supported region.`);
      return false;
    }

    setIsInitializing(true);
    setError(null);

    try {
      // Ensure on Polygon
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const currentChain = getChainId(wagmiConfig as any);
      if (currentChain !== CHAIN_ID) {
        console.log('[useWalletTrading] Switching to Polygon...');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await switchChain(wagmiConfig as any, { chainId: CHAIN_ID });

        // Wait for chain switch
        let attempts = 0;
        while (attempts < 10) {
          await new Promise(resolve => setTimeout(resolve, 500));
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if (getChainId(wagmiConfig as any) === CHAIN_ID) break;
          attempts++;
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (getChainId(wagmiConfig as any) !== CHAIN_ID) {
          throw new Error('Please switch to Polygon network');
        }
      }

      // Get wallet signer
      console.log('[useWalletTrading] Getting provider from connector...');
      const provider = await connector.getProvider();
      if (!provider) {
        throw new Error('Failed to get wallet provider');
      }

      const web3Provider = new ethers.providers.Web3Provider(provider as any);
      const signer = web3Provider.getSigner();

      // Check for cached credentials
      const cached = localStorage.getItem(`${CREDS_STORAGE_KEY}_${address.toLowerCase()}`);

      if (cached) {
        const creds: StoredCredentials = JSON.parse(cached);
        if (creds.address.toLowerCase() === address.toLowerCase()) {
          // Always use GNOSIS_SAFE signature type with derived proxy wallet
          // This is how Polymarket works - funds are in the Safe, not the EOA
          const signatureType = SIGNATURE_TYPE.GNOSIS_SAFE;
          const funder = proxyWallet;

          console.log('[useWalletTrading] Using cached credentials with Safe wallet', {
            signatureType,
            funder,
            eoa: address,
          });

          // Create client with cached credentials
          clobClientRef.current = new ClobClient(
            CLOB_API_URL,
            CHAIN_ID,
            signer,
            {
              key: creds.key,
              secret: creds.secret,
              passphrase: creds.passphrase,
            },
            signatureType,
            funder ?? undefined // Safe wallet where Polymarket funds are held
          );

          setHasCredentials(true);
          setIsReady(true);
          console.log('[useWalletTrading] Client initialized from cache', {
            hasClient: !!clobClientRef.current,
            funder,
            signatureType,
          });
          return true;
        }
      }

      // No cached credentials - derive new ones
      console.log('[useWalletTrading] Deriving API credentials (will prompt signature)...');

      // Create temp client without credentials
      const tempClient = new ClobClient(
        CLOB_API_URL,
        CHAIN_ID,
        signer
      );

      // This prompts user to sign a message to derive API credentials
      const derivedCreds = await tempClient.createOrDeriveApiKey();

      if (!derivedCreds || !derivedCreds.key) {
        throw new Error('Failed to derive API credentials');
      }

      console.log('[useWalletTrading] Credentials derived, caching in localStorage...');

      // Always use GNOSIS_SAFE with derived proxy wallet
      // Polymarket deposits go to the Safe, so that's where funds are
      const signatureType = SIGNATURE_TYPE.GNOSIS_SAFE;

      // Cache credentials in localStorage (browser only)
      const credsToStore: StoredCredentials = {
        key: derivedCreds.key,
        secret: derivedCreds.secret,
        passphrase: derivedCreds.passphrase,
        address: address,
        signatureType,
        funder: proxyWallet || undefined,
      };
      localStorage.setItem(
        `${CREDS_STORAGE_KEY}_${address.toLowerCase()}`,
        JSON.stringify(credsToStore)
      );

      console.log('[useWalletTrading] Creating CLOB client with Safe wallet', {
        signatureType,
        funder: proxyWallet,
        eoa: address,
      });

      // Create full client with credentials - using Safe wallet as funder
      clobClientRef.current = new ClobClient(
        CLOB_API_URL,
        CHAIN_ID,
        signer,
        {
          key: derivedCreds.key,
          secret: derivedCreds.secret,
          passphrase: derivedCreds.passphrase,
        },
        signatureType,
        proxyWallet || undefined // Safe wallet where Polymarket funds are held
      );

      setHasCredentials(true);
      setIsReady(true);
      console.log('[useWalletTrading] Client initialized successfully', {
        hasClient: !!clobClientRef.current,
        proxyWallet,
        signatureType: SIGNATURE_TYPE.GNOSIS_SAFE,
      });
      return true;

    } catch (err: any) {
      console.error('[useWalletTrading] Initialization failed:', err);

      let errorMsg = err.message || 'Failed to initialize trading';
      if (errorMsg.includes('user rejected') || errorMsg.includes('User rejected')) {
        errorMsg = 'Signature rejected. Please sign to enable trading.';
      } else if (errorMsg.includes('network') || errorMsg.includes('Network')) {
        errorMsg = 'Network error. Check your connection.';
      } else if (errorMsg.includes('403')) {
        errorMsg = 'Access denied (403). Try a different VPN server or clear credentials.';
      }

      setError(errorMsg);
      setIsReady(false);
      clobClientRef.current = null;
      return false;
    } finally {
      setIsInitializing(false);
    }
  }, [connector, address, isReady, geoblock, proxyWallet]);

  // Auto-initialize when wallet connects on Polygon
  useEffect(() => {
    // Only auto-init once per session, when connected on Polygon and not already ready
    if (
      isConnected &&
      connector &&
      address &&
      chainId === CHAIN_ID &&
      !isReady &&
      !isInitializing &&
      !hasTriedAutoInit.current &&
      geoblock !== null && // Wait for geoblock check to complete
      !geoblock?.blocked
    ) {
      hasTriedAutoInit.current = true;
      console.log('[useWalletTrading] Auto-initializing client on connect...');
      initializeClient();
    }
  }, [isConnected, connector, address, chainId, isReady, isInitializing, geoblock, initializeClient]);

  /**
   * Place an order - signs in browser, submits directly to Polymarket
   */
  const placeOrder = useCallback(async (params: OrderParams): Promise<OrderResult> => {
    setIsLoading(true);
    setError(null);

    try {
      if (!isConnected || !address) {
        return { success: false, errorMessage: 'Wallet not connected' };
      }

      // Initialize if needed
      if (!clobClientRef.current || !isReady) {
        const initialized = await initializeClient();
        if (!initialized) {
          return { success: false, errorMessage: error || 'Failed to initialize trading' };
        }
      }

      const client = clobClientRef.current!;

      // Validate price range (Polymarket: 0.01 - 0.99)
      if (params.price < 0.01 || params.price > 0.99) {
        return { success: false, errorMessage: 'Price must be between 1¢ and 99¢' };
      }

      if (params.size <= 0) {
        return { success: false, errorMessage: 'Size must be greater than 0' };
      }

      const side = params.side === 'BUY' ? Side.BUY : Side.SELL;
      const orderType = mapOrderType(params.orderType || 'GTC');

      console.log('[useWalletTrading] Creating order:', {
        tokenId: params.tokenId,
        side: params.side,
        price: params.price,
        size: params.size,
        orderType: params.orderType,
      });

      // Create order (signs with wallet)
      const order = await client.createOrder({
        tokenID: params.tokenId,
        price: params.price,
        side,
        size: params.size,
      });

      console.log('[useWalletTrading] Order created, submitting to CLOB...');

      // Submit directly to Polymarket CLOB
      const response = await client.postOrder(order, orderType);

      console.log('[useWalletTrading] CLOB response:', response);

      if (response.success) {
        return {
          success: true,
          orderId: response.orderID,
          transactionHash: response.transactionsHashes?.[0],
        };
      } else {
        return {
          success: false,
          errorMessage: response.errorMsg || 'Order rejected by Polymarket',
        };
      }

    } catch (err: any) {
      console.error('[useWalletTrading] Order failed:', err);

      let errorMessage = err.message || 'Unknown error';

      // Log full error for debugging
      if (err.response) {
        console.error('[useWalletTrading] Response status:', err.response.status);
        console.error('[useWalletTrading] Response data:', err.response.data);
      }

      // Make errors more user-friendly
      if (errorMessage.includes('insufficient') || errorMessage.includes('Insufficient')) {
        errorMessage = 'Insufficient balance. Deposit USDC to your Polymarket account.';
      } else if (errorMessage.includes('user rejected') || errorMessage.includes('User rejected')) {
        errorMessage = 'Transaction rejected by user.';
      } else if (errorMessage.includes('allowance')) {
        errorMessage = 'Token not approved. Enable trading on polymarket.com first.';
      } else if (errorMessage.includes('CORS') || errorMessage.includes('Failed to fetch')) {
        errorMessage = 'Connection blocked. Try using a VPN or check your network.';
      } else if (errorMessage.includes('403') || err.response?.status === 403) {
        errorMessage = 'Access denied (403). Try: 1) Different VPN server 2) Clear credentials [RESET] 3) Ensure wallet is set up on polymarket.com';
      } else if (errorMessage.includes('L2_AUTH') || errorMessage.includes('INVALID_SIGNATURE')) {
        errorMessage = 'Auth error. Clear credentials [RESET] and re-sign.';
      } else if (errorMessage.includes('balance') || errorMessage.includes('allowance')) {
        errorMessage = `Insufficient balance or allowance. Deposit USDC at polymarket.com. Your Safe: ${proxyWallet?.slice(0, 10)}...`;
      }

      setError(errorMessage);
      return { success: false, errorMessage };
    } finally {
      setIsLoading(false);
    }
  }, [isConnected, address, isReady, error, initializeClient, proxyWallet]);

  /**
   * Cancel an order
   */
  const cancelOrder = useCallback(async (orderId: string): Promise<OrderResult> => {
    setIsLoading(true);
    setError(null);

    try {
      if (!clobClientRef.current || !isReady) {
        return { success: false, errorMessage: 'Trading not initialized' };
      }

      const response = await clobClientRef.current.cancelOrder({ orderID: orderId });

      if (response.canceled) {
        return { success: true, orderId };
      } else {
        return { success: false, errorMessage: 'Failed to cancel order' };
      }
    } catch (err: any) {
      console.error('[useWalletTrading] Cancel failed:', err);
      return { success: false, errorMessage: err.message || 'Failed to cancel order' };
    } finally {
      setIsLoading(false);
    }
  }, [isReady]);

  /**
   * Get open orders
   */
  const getOpenOrders = useCallback(async () => {
    try {
      if (!clobClientRef.current || !isReady) return [];
      return await clobClientRef.current.getOpenOrders();
    } catch (err) {
      console.error('[useWalletTrading] Failed to get open orders:', err);
      return [];
    }
  }, [isReady]);

  /**
   * Get USDC balance and allowance
   */
  const refreshBalance = useCallback(async () => {
    try {
      if (!clobClientRef.current || !isReady) {
        console.log('[useWalletTrading] Cannot get balance - client not ready');
        return null;
      }

      console.log('[useWalletTrading] Fetching balance...');
      const result = await clobClientRef.current.getBalanceAllowance({
        asset_type: AssetType.COLLATERAL, // USDC
      });

      console.log('[useWalletTrading] Balance result:', result);
      setBalance(result.balance);
      setAllowance(result.allowance);

      return result;
    } catch (err: any) {
      console.error('[useWalletTrading] Failed to get balance:', err);
      // Log more details
      if (err.response) {
        console.error('[useWalletTrading] Response:', err.response.status, err.response.data);
      }
      return null;
    }
  }, [isReady]);

  // Auto-refresh balance when client becomes ready
  useEffect(() => {
    if (isReady && clobClientRef.current) {
      console.log('[useWalletTrading] Client ready, triggering balance refresh...');
      refreshBalance().then(result => {
        console.log('[useWalletTrading] Balance refresh complete:', result);
      }).catch(err => {
        console.error('[useWalletTrading] Balance refresh error:', err);
      });
    }
  }, [isReady, refreshBalance]);

  /**
   * Clear credentials (for switching accounts)
   */
  const clearCredentials = useCallback(() => {
    if (address) {
      localStorage.removeItem(`${CREDS_STORAGE_KEY}_${address.toLowerCase()}`);
    }
    setHasCredentials(false);
    clobClientRef.current = null;
    setIsReady(false);
  }, [address]);

  return {
    // State
    isLoading,
    isInitializing,
    error,
    isConnected,
    address,
    isReady,
    hasCredentials,
    isOnPolygon,
    geoblock, // null = checking, { blocked: true/false, country, ip }
    chainId,
    proxyWallet, // The user's Polymarket Safe wallet (auto-derived from EOA)
    balance, // USDC balance (null until fetched)
    allowance, // USDC allowance (null until fetched)

    // Actions
    initializeClient,
    placeOrder,
    cancelOrder,
    getOpenOrders,
    clearCredentials,
    refreshBalance,
  };
}

function mapOrderType(type: string): ClobOrderType {
  switch (type) {
    case 'GTC':
      return ClobOrderType.GTC;
    case 'GTD':
      return ClobOrderType.GTD;
    case 'FOK':
      return ClobOrderType.FOK;
    default:
      return ClobOrderType.GTC;
  }
}
