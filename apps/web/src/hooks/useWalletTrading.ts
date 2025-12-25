/**
 * Wallet-Based Polymarket Trading Hook
 *
 * Signs orders directly with the user's connected wallet (MetaMask, etc.)
 * This is the native Polymarket approach - no API credentials needed.
 *
 * Flow:
 * 1. User connects wallet via wagmi
 * 2. On first trade, derive API credentials from wallet signature
 * 3. Sign orders with wallet, submit to CLOB API
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useAccount, useChainId } from 'wagmi';
import { switchChain, getChainId } from '@wagmi/core';
import { wagmiConfig } from '../lib/wagmi';
import { ethers } from 'ethers';
import {
  ClobClient,
  Side,
  OrderType as ClobOrderType,
} from '@polymarket/clob-client';

const CLOB_API_URL = 'https://clob.polymarket.com';
const CHAIN_ID = 137; // Polygon
const CREDS_STORAGE_KEY = 'polymarket_derived_creds';
const GEOBLOCK_API_URL = 'https://polymarket.com/api/geoblock';

interface GeoblockResponse {
  blocked: boolean;
  ip: string;
  country: string;
  region: string;
}

// Check if user is in a blocked region
async function checkGeoblock(): Promise<{ blocked: boolean; country?: string; region?: string }> {
  try {
    const response = await fetch(GEOBLOCK_API_URL);
    if (!response.ok) {
      console.warn('[Geoblock] Failed to check geoblock status');
      return { blocked: false }; // Allow attempt if check fails
    }
    const data: GeoblockResponse = await response.json();
    console.log('[Geoblock] Check result:', data);
    return {
      blocked: data.blocked,
      country: data.country,
      region: data.region,
    };
  } catch (err) {
    console.warn('[Geoblock] Error checking geoblock:', err);
    return { blocked: false }; // Allow attempt if check fails
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

interface DerivedCredentials {
  key: string;
  secret: string;
  passphrase: string;
  address: string;
}

export function useWalletTrading() {
  const { address, isConnected, connector } = useAccount();
  const chainId = useChainId();

  const [isLoading, setIsLoading] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isGeoblocked, setIsGeoblocked] = useState<boolean | null>(null);
  const [geoblockCountry, setGeoblockCountry] = useState<string | null>(null);

  // Check if on correct chain
  const isOnPolygon = chainId === CHAIN_ID;

  // Check geoblock status on mount
  useEffect(() => {
    checkGeoblock().then(result => {
      setIsGeoblocked(result.blocked);
      if (result.blocked) {
        setGeoblockCountry(result.country || 'Unknown');
        setError(`Trading is not available in ${result.country || 'your region'}. Polymarket restricts access from certain locations.`);
      }
    });
  }, []);

  // Store derived credentials (persisted per address)
  const [credentials, setCredentials] = useState<DerivedCredentials | null>(null);
  const clobClientRef = useRef<ClobClient | null>(null);

  // Load cached credentials on mount/address change
  useEffect(() => {
    if (address) {
      const cached = localStorage.getItem(`${CREDS_STORAGE_KEY}_${address.toLowerCase()}`);
      if (cached) {
        try {
          const creds: DerivedCredentials = JSON.parse(cached);
          if (creds.address.toLowerCase() === address.toLowerCase()) {
            setCredentials(creds);
            console.log('[useWalletTrading] Loaded cached credentials for', address);
          }
        } catch (e) {
          console.error('[useWalletTrading] Failed to parse cached credentials');
        }
      }
    } else {
      setCredentials(null);
      clobClientRef.current = null;
      setIsReady(false);
    }
  }, [address]);

  // Clear error when wallet reconnects or connector changes
  useEffect(() => {
    if (connector && address && error) {
      // Wallet is connected - clear the error to allow retry
      setError(null);
      console.log('[useWalletTrading] Wallet reconnected, clearing error');
    }
  }, [connector, address, error]);

  /**
   * Initialize CLOB client with wallet signer
   * This derives API credentials from a wallet signature on first use
   */
  const initializeClient = useCallback(async (): Promise<boolean> => {
    if (!connector || !address) {
      setError('Wallet not connected');
      return false;
    }

    // If we already have a ready client, use it
    if (clobClientRef.current && isReady) {
      return true;
    }

    setIsInitializing(true);
    setError(null);

    try {
      // Check geoblock first
      if (isGeoblocked) {
        throw new Error(`Trading is not available in ${geoblockCountry || 'your region'}. Polymarket restricts access from certain locations.`);
      }

      // Re-check geoblock if not yet checked
      if (isGeoblocked === null) {
        const geoResult = await checkGeoblock();
        setIsGeoblocked(geoResult.blocked);
        if (geoResult.blocked) {
          setGeoblockCountry(geoResult.country || 'Unknown');
          throw new Error(`Trading is not available in ${geoResult.country || 'your region'}. Polymarket restricts access from certain locations.`);
        }
      }

      // Check current chain and switch if needed
      const currentChain = getChainId(wagmiConfig);
      console.log('[useWalletTrading] Current chain:', currentChain, 'Need:', CHAIN_ID);

      if (currentChain !== CHAIN_ID) {
        console.log('[useWalletTrading] Switching to Polygon...');
        try {
          await switchChain(wagmiConfig, { chainId: CHAIN_ID });
          console.log('[useWalletTrading] Switch initiated, waiting for confirmation...');

          // Wait for chain to actually switch (poll for up to 5 seconds)
          let attempts = 0;
          while (attempts < 10) {
            await new Promise(resolve => setTimeout(resolve, 500));
            const newChain = getChainId(wagmiConfig);
            if (newChain === CHAIN_ID) {
              console.log('[useWalletTrading] Chain switch confirmed!');
              break;
            }
            attempts++;
          }

          const finalChain = getChainId(wagmiConfig);
          if (finalChain !== CHAIN_ID) {
            throw new Error(`Chain switch incomplete. Expected ${CHAIN_ID}, got ${finalChain}`);
          }
        } catch (switchError: any) {
          console.error('[useWalletTrading] Chain switch failed:', switchError);
          if (switchError.message?.includes('rejected') || switchError.message?.includes('denied')) {
            throw new Error('Network switch rejected. Please approve in your wallet.');
          }
          throw new Error('Please switch to Polygon network manually in your wallet');
        }
      }

      // Get the EIP-1193 provider from the connector
      console.log('[useWalletTrading] Getting provider from connector:', connector.name);
      const provider = await connector.getProvider();
      console.log('[useWalletTrading] Got provider:', !!provider);

      if (!provider) {
        throw new Error('Failed to get wallet provider');
      }

      // Create signer from the provider using ethers Web3Provider
      console.log('[useWalletTrading] Creating signer...');
      const web3Provider = new ethers.providers.Web3Provider(provider as any);
      const signer = web3Provider.getSigner();
      console.log('[useWalletTrading] Signer created:', !!signer);

      // Check if we have cached credentials for this address
      if (credentials && credentials.address.toLowerCase() === address.toLowerCase()) {
        // Use cached credentials
        // ClobClient(host, chainId, signer, creds, signatureType)
        // signatureType 0 = Browser Wallet (MetaMask, etc)
        clobClientRef.current = new ClobClient(
          CLOB_API_URL,
          CHAIN_ID,
          signer,
          {
            key: credentials.key,
            secret: credentials.secret,
            passphrase: credentials.passphrase,
          },
          0 // Browser wallet signature type
        );
        setIsReady(true);
        console.log('[useWalletTrading] Initialized with cached credentials');
        return true;
      }

      // First time - need to derive credentials from wallet signature
      console.log('[useWalletTrading] Deriving new API credentials from wallet...');
      console.log('[useWalletTrading] Creating temp CLOB client...');

      // ClobClient(host, chainId, signer, creds, signatureType)
      const tempClient = new ClobClient(
        CLOB_API_URL,
        CHAIN_ID,
        signer,
        undefined, // no creds yet
        0 // Browser wallet signature type
      );
      console.log('[useWalletTrading] Temp client created, calling createOrDeriveApiKey...');

      // This will prompt the user to sign a message to derive API credentials
      const derivedApiCreds = await tempClient.createOrDeriveApiKey();
      console.log('[useWalletTrading] Got credentials response:', !!derivedApiCreds, derivedApiCreds ? Object.keys(derivedApiCreds) : 'null');

      if (!derivedApiCreds || !derivedApiCreds.key) {
        throw new Error('Failed to derive API credentials - empty response from CLOB API');
      }

      // Cache the credentials
      const derivedCreds: DerivedCredentials = {
        key: derivedApiCreds.key,
        secret: derivedApiCreds.secret,
        passphrase: derivedApiCreds.passphrase,
        address: address,
      };

      localStorage.setItem(
        `${CREDS_STORAGE_KEY}_${address.toLowerCase()}`,
        JSON.stringify(derivedCreds)
      );
      setCredentials(derivedCreds);

      // Create the full client with credentials
      clobClientRef.current = new ClobClient(
        CLOB_API_URL,
        CHAIN_ID,
        signer,
        {
          key: derivedApiCreds.key,
          secret: derivedApiCreds.secret,
          passphrase: derivedApiCreds.passphrase,
        },
        0 // Browser wallet signature type
      );

      setIsReady(true);
      console.log('[useWalletTrading] Initialized with new credentials');
      return true;
    } catch (err: any) {
      console.error('[useWalletTrading] Initialization failed:', err);
      console.error('[useWalletTrading] Error name:', err?.name);
      console.error('[useWalletTrading] Error message:', err?.message);
      console.error('[useWalletTrading] Error stack:', err?.stack);
      if (err?.response) {
        console.error('[useWalletTrading] Response status:', err.response.status);
        console.error('[useWalletTrading] Response data:', err.response.data);
      }

      let errorMsg = err.message || 'Failed to initialize trading';
      if (errorMsg.includes('user rejected') || errorMsg.includes('User rejected')) {
        errorMsg = 'Signature rejected. Please sign to enable trading.';
      } else if (errorMsg.includes('CORS') || errorMsg.includes('cors')) {
        errorMsg = 'CORS error - try using the API method instead.';
      } else if (errorMsg.includes('network') || errorMsg.includes('Network')) {
        errorMsg = 'Network error - check your connection.';
      }

      setError(errorMsg);
      // Reset state on error to allow retry
      setIsReady(false);
      clobClientRef.current = null;
      return false;
    } finally {
      setIsInitializing(false);
    }
  }, [connector, address, credentials, isReady, isGeoblocked, geoblockCountry]);

  /**
   * Place an order using wallet signing
   */
  const placeOrder = useCallback(async (params: OrderParams): Promise<OrderResult> => {
    setIsLoading(true);
    setError(null);

    try {
      if (!isConnected || !address) {
        return { success: false, errorMessage: 'Wallet not connected' };
      }

      // Initialize client if needed
      if (!clobClientRef.current || !isReady) {
        const initialized = await initializeClient();
        if (!initialized) {
          return { success: false, errorMessage: 'Failed to initialize trading. Please try again.' };
        }
      }

      const client = clobClientRef.current!;

      // Validate price range (0.01 to 0.99 for Polymarket)
      if (params.price < 0.01 || params.price > 0.99) {
        return { success: false, errorMessage: 'Price must be between 1¢ and 99¢' };
      }

      if (params.size <= 0) {
        return { success: false, errorMessage: 'Size must be greater than 0' };
      }

      const orderType = mapOrderType(params.orderType || 'GTC');
      const side = params.side === 'BUY' ? Side.BUY : Side.SELL;

      console.log('[useWalletTrading] Placing order:', {
        tokenId: params.tokenId,
        side: params.side,
        price: params.price,
        size: params.size,
        orderType: params.orderType,
      });

      // Create the order first
      const order = await client.createOrder({
        tokenID: params.tokenId,
        price: params.price,
        side,
        size: params.size,
      });

      // Post the order with the specified order type
      const response = await client.postOrder(order, orderType);

      console.log('[useWalletTrading] Response:', response);

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

      // Make errors more user-friendly
      if (errorMessage.includes('insufficient') || errorMessage.includes('Insufficient')) {
        errorMessage = 'Insufficient balance. Deposit USDC to your Polymarket account.';
      } else if (errorMessage.includes('user rejected') || errorMessage.includes('User rejected')) {
        errorMessage = 'Transaction rejected by user.';
      } else if (errorMessage.includes('allowance')) {
        errorMessage = 'Token not approved. Enable trading on polymarket.com first.';
      } else if (errorMessage.includes('rate limit') || errorMessage.includes('429')) {
        errorMessage = 'Rate limit exceeded. Wait a moment and try again.';
      }

      setError(errorMessage);
      return { success: false, errorMessage };
    } finally {
      setIsLoading(false);
    }
  }, [isConnected, address, isReady, initializeClient]);

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
   * Clear derived credentials (useful for switching accounts)
   */
  const clearCredentials = useCallback(() => {
    if (address) {
      localStorage.removeItem(`${CREDS_STORAGE_KEY}_${address.toLowerCase()}`);
    }
    setCredentials(null);
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
    hasCredentials: !!credentials,
    isOnPolygon,
    chainId,
    isGeoblocked,
    geoblockCountry,

    // Actions
    initializeClient,
    placeOrder,
    cancelOrder,
    getOpenOrders,
    clearCredentials,
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
