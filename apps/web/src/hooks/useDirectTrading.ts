/**
 * Direct Polymarket Trading Hook
 *
 * Trades directly with Polymarket CLOB API from the browser.
 * No server involvement - credentials stored in browser localStorage.
 *
 * This is the fastest possible execution path.
 */

import { useState, useCallback, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { ClobClient, Side, OrderType as ClobOrderType } from '@polymarket/clob-client';

const CLOB_API_URL = 'https://clob.polymarket.com';
const CHAIN_ID = 137; // Polygon
const CREDENTIALS_KEY = 'polymarket_credentials';

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
  fills?: Array<{ price: number; size: number }>;
}

interface StoredCredentials {
  apiKey: string;
  apiSecret: string;
  apiPassphrase: string;
}

export function useDirectTrading() {
  const { address, isConnected } = useAccount();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasCredentials, setHasCredentials] = useState(false);
  const [clobClient, setClobClient] = useState<ClobClient | null>(null);

  // Load credentials from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(CREDENTIALS_KEY);
    if (stored) {
      try {
        const creds: StoredCredentials = JSON.parse(stored);
        initializeClient(creds);
        setHasCredentials(true);
      } catch (e) {
        console.error('[useDirectTrading] Failed to parse stored credentials');
        localStorage.removeItem(CREDENTIALS_KEY);
      }
    }
  }, []);

  /**
   * Initialize CLOB client with credentials
   */
  const initializeClient = useCallback((creds: StoredCredentials) => {
    try {
      const client = new ClobClient(
        CLOB_API_URL,
        CHAIN_ID,
        undefined, // No wallet signer - using API credentials
        {
          key: creds.apiKey,
          secret: creds.apiSecret,
          passphrase: creds.apiPassphrase,
        }
      );
      setClobClient(client);
      setError(null);
      return true;
    } catch (err) {
      console.error('[useDirectTrading] Failed to create CLOB client:', err);
      setError('Failed to initialize trading client');
      return false;
    }
  }, []);

  /**
   * Save and initialize with new credentials
   */
  const saveCredentials = useCallback((apiKey: string, apiSecret: string, apiPassphrase: string) => {
    const creds: StoredCredentials = { apiKey, apiSecret, apiPassphrase };

    if (initializeClient(creds)) {
      localStorage.setItem(CREDENTIALS_KEY, JSON.stringify(creds));
      setHasCredentials(true);
      return true;
    }
    return false;
  }, [initializeClient]);

  /**
   * Clear saved credentials
   */
  const clearCredentials = useCallback(() => {
    localStorage.removeItem(CREDENTIALS_KEY);
    setClobClient(null);
    setHasCredentials(false);
  }, []);

  /**
   * Verify credentials work by fetching API key info
   */
  const verifyCredentials = useCallback(async (): Promise<boolean> => {
    if (!clobClient) return false;

    try {
      // Try to get API key info - this validates the credentials
      const info = await clobClient.getApiKeys();
      return !!info;
    } catch (err) {
      console.error('[useDirectTrading] Credential verification failed:', err);
      return false;
    }
  }, [clobClient]);

  /**
   * Place an order directly on Polymarket
   */
  const placeOrder = useCallback(async (params: OrderParams): Promise<OrderResult> => {
    setIsLoading(true);
    setError(null);

    try {
      if (!isConnected || !address) {
        return { success: false, errorMessage: 'Wallet not connected' };
      }

      if (!clobClient) {
        return {
          success: false,
          errorMessage: 'Trading not configured. Please set up your Polymarket API credentials.'
        };
      }

      // Validate price range (Polymarket uses 0.01-0.99 for probabilities)
      if (params.price < 0.01 || params.price > 0.99) {
        return { success: false, errorMessage: 'Price must be between 1¢ and 99¢' };
      }

      if (params.size <= 0) {
        return { success: false, errorMessage: 'Size must be greater than 0' };
      }

      // Map order type
      const orderType = mapOrderType(params.orderType || 'GTC');
      const side = params.side === 'BUY' ? Side.BUY : Side.SELL;

      console.log('[useDirectTrading] Placing order:', {
        tokenId: params.tokenId,
        side: params.side,
        price: params.price,
        size: params.size,
        orderType: params.orderType,
      });

      // Create the order (SDK handles signing with API credentials)
      const order = await clobClient.createOrder({
        tokenID: params.tokenId,
        price: params.price,
        side,
        size: params.size,
      }, {
        tickSize: '0.01',
        negRisk: false,
      });

      console.log('[useDirectTrading] Order created, submitting to CLOB...');

      // Submit the order
      const response = await clobClient.postOrder(order, orderType);

      console.log('[useDirectTrading] CLOB response:', response);

      if (response.success) {
        return {
          success: true,
          orderId: response.orderID,
          transactionHash: response.transactionsHashes?.[0],
        };
      } else {
        // Parse error message
        let errorMsg = response.errorMsg || 'Order rejected by Polymarket';

        // Make errors more user-friendly
        if (errorMsg.includes('insufficient') || errorMsg.includes('Insufficient')) {
          errorMsg = 'Insufficient balance. Deposit USDC to your Polymarket account at polymarket.com';
        } else if (errorMsg.includes('allowance')) {
          errorMsg = 'Token allowance not set. Please enable trading on polymarket.com first.';
        }

        return { success: false, errorMessage: errorMsg };
      }
    } catch (err: any) {
      console.error('[useDirectTrading] Order failed:', err);

      // Parse common errors
      let errorMessage = err.message || 'Unknown error';

      if (errorMessage.includes('insufficient') || errorMessage.includes('Insufficient')) {
        errorMessage = 'Insufficient balance. Deposit USDC to your Polymarket account.';
      } else if (errorMessage.includes('invalid signature') || errorMessage.includes('Unauthorized') || errorMessage.includes('401')) {
        errorMessage = 'Invalid or expired API credentials. Please update them in settings.';
        // Clear bad credentials
        clearCredentials();
      } else if (errorMessage.includes('rate limit') || errorMessage.includes('429')) {
        errorMessage = 'Rate limit exceeded. Please wait a moment and try again.';
      } else if (errorMessage.includes('allowance')) {
        errorMessage = 'Token not approved for trading. Enable trading on polymarket.com first.';
      } else if (errorMessage.includes('CORS') || errorMessage.includes('Network')) {
        errorMessage = 'Network error. Check your connection and try again.';
      }

      setError(errorMessage);
      return { success: false, errorMessage };
    } finally {
      setIsLoading(false);
    }
  }, [isConnected, address, clobClient, clearCredentials]);

  /**
   * Cancel an order
   */
  const cancelOrder = useCallback(async (orderId: string): Promise<OrderResult> => {
    setIsLoading(true);
    setError(null);

    try {
      if (!clobClient) {
        return { success: false, errorMessage: 'Trading not configured' };
      }

      const response = await clobClient.cancelOrder({ orderID: orderId });

      if (response.canceled) {
        return { success: true, orderId };
      } else {
        return { success: false, errorMessage: 'Failed to cancel order' };
      }
    } catch (err: any) {
      console.error('[useDirectTrading] Cancel failed:', err);
      return { success: false, errorMessage: err.message || 'Failed to cancel order' };
    } finally {
      setIsLoading(false);
    }
  }, [clobClient]);

  /**
   * Cancel all open orders
   */
  const cancelAllOrders = useCallback(async (): Promise<OrderResult> => {
    setIsLoading(true);
    setError(null);

    try {
      if (!clobClient) {
        return { success: false, errorMessage: 'Trading not configured' };
      }

      await clobClient.cancelAll();
      return { success: true };
    } catch (err: any) {
      console.error('[useDirectTrading] Cancel all failed:', err);
      return { success: false, errorMessage: err.message || 'Failed to cancel orders' };
    } finally {
      setIsLoading(false);
    }
  }, [clobClient]);

  /**
   * Get open orders
   */
  const getOpenOrders = useCallback(async () => {
    try {
      if (!clobClient) return [];
      return await clobClient.getOpenOrders();
    } catch (err) {
      console.error('[useDirectTrading] Failed to get open orders:', err);
      return [];
    }
  }, [clobClient]);

  /**
   * Get trade history
   */
  const getTrades = useCallback(async () => {
    try {
      if (!clobClient) return [];
      return await clobClient.getTrades();
    } catch (err) {
      console.error('[useDirectTrading] Failed to get trades:', err);
      return [];
    }
  }, [clobClient]);

  return {
    // State
    isLoading,
    error,
    isConnected,
    address,
    hasCredentials,

    // Actions
    placeOrder,
    cancelOrder,
    cancelAllOrders,
    getOpenOrders,
    getTrades,

    // Credentials management
    saveCredentials,
    clearCredentials,
    verifyCredentials,
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
