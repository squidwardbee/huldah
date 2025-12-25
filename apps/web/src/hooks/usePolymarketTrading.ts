/**
 * Client-Side Polymarket Trading Hook
 *
 * Uses wagmi wallet to sign orders directly with the user's wallet,
 * then submits to Polymarket CLOB API.
 */

import { useState, useCallback } from 'react';
import { useAccount } from 'wagmi';
import { ClobClient, Side, OrderType as ClobOrderType } from '@polymarket/clob-client';

const CLOB_API_URL = 'https://clob.polymarket.com';
const CHAIN_ID = 137; // Polygon

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

interface ApiCredentials {
  apiKey: string;
  apiSecret: string;
  apiPassphrase: string;
}

export function usePolymarketTrading() {
  const { address, isConnected } = useAccount();

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Store API credentials in memory (user provides these)
  const [credentials, setCredentials] = useState<ApiCredentials | null>(null);

  /**
   * Create CLOB client with API credentials
   * This is the recommended way for web apps - use API key auth
   */
  const getClobClient = useCallback(async (): Promise<ClobClient | null> => {
    if (!credentials) {
      setError('API credentials not set. Please configure your Polymarket API credentials.');
      return null;
    }

    try {
      const client = new ClobClient(
        CLOB_API_URL,
        CHAIN_ID,
        undefined, // No signer - using API credentials
        {
          key: credentials.apiKey,
          secret: credentials.apiSecret,
          passphrase: credentials.apiPassphrase,
        }
      );

      return client;
    } catch (err) {
      console.error('[usePolymarketTrading] Failed to create CLOB client:', err);
      setError('Failed to initialize trading client');
      return null;
    }
  }, [credentials]);

  /**
   * Place an order on Polymarket
   */
  const placeOrder = useCallback(async (params: OrderParams): Promise<OrderResult> => {
    setIsLoading(true);
    setError(null);

    try {
      if (!isConnected || !address) {
        return { success: false, errorMessage: 'Wallet not connected' };
      }

      const client = await getClobClient();
      if (!client) {
        return { success: false, errorMessage: 'Failed to initialize trading client. Check your API credentials.' };
      }

      // Validate price range
      if (params.price < 0.01 || params.price > 0.99) {
        return { success: false, errorMessage: 'Price must be between 0.01 and 0.99' };
      }

      // Map order type
      const orderType = mapOrderType(params.orderType || 'GTC');
      const side = params.side === 'BUY' ? Side.BUY : Side.SELL;

      console.log('[usePolymarketTrading] Creating order:', {
        tokenId: params.tokenId,
        side: params.side,
        price: params.price,
        size: params.size,
        orderType: params.orderType,
      });

      // Create the order (this signs it with API credentials)
      const order = await client.createOrder({
        tokenID: params.tokenId,
        price: params.price,
        side,
        size: params.size,
      }, {
        tickSize: '0.01',
        negRisk: false,
      });

      console.log('[usePolymarketTrading] Order created, submitting...');

      // Submit the order
      const response = await client.postOrder(order, orderType);

      console.log('[usePolymarketTrading] Response:', response);

      if (response.success) {
        return {
          success: true,
          orderId: response.orderID,
          transactionHash: response.transactionsHashes?.[0],
        };
      } else {
        return {
          success: false,
          errorMessage: response.errorMsg || 'Order rejected',
        };
      }
    } catch (err: any) {
      console.error('[usePolymarketTrading] Order failed:', err);

      // Parse common errors
      let errorMessage = err.message || 'Unknown error';
      if (errorMessage.includes('insufficient') || errorMessage.includes('Insufficient')) {
        errorMessage = 'Insufficient balance. Deposit USDC to your Polymarket account.';
      } else if (errorMessage.includes('invalid signature') || errorMessage.includes('Unauthorized')) {
        errorMessage = 'Invalid API credentials. Please check your Polymarket API settings.';
      } else if (errorMessage.includes('rate limit') || errorMessage.includes('429')) {
        errorMessage = 'Rate limit exceeded. Please wait and try again.';
      }

      return { success: false, errorMessage };
    } finally {
      setIsLoading(false);
    }
  }, [isConnected, address, getClobClient]);

  /**
   * Cancel an order
   */
  const cancelOrder = useCallback(async (orderId: string): Promise<OrderResult> => {
    setIsLoading(true);
    setError(null);

    try {
      const client = await getClobClient();
      if (!client) {
        return { success: false, errorMessage: 'Failed to initialize trading client' };
      }

      const response = await client.cancelOrder({ orderID: orderId });

      if (response.canceled) {
        return { success: true, orderId };
      } else {
        return { success: false, errorMessage: 'Failed to cancel order' };
      }
    } catch (err: any) {
      console.error('[usePolymarketTrading] Cancel failed:', err);
      return { success: false, errorMessage: err.message || 'Failed to cancel order' };
    } finally {
      setIsLoading(false);
    }
  }, [getClobClient]);

  /**
   * Get open orders
   */
  const getOpenOrders = useCallback(async () => {
    try {
      const client = await getClobClient();
      if (!client) return [];

      const orders = await client.getOpenOrders();
      return orders;
    } catch (err) {
      console.error('[usePolymarketTrading] Failed to get open orders:', err);
      return [];
    }
  }, [getClobClient]);

  /**
   * Set API credentials for trading
   */
  const setApiCredentials = useCallback((creds: ApiCredentials) => {
    setCredentials(creds);
    setError(null);
  }, []);

  /**
   * Clear API credentials
   */
  const clearCredentials = useCallback(() => {
    setCredentials(null);
  }, []);

  return {
    // State
    isLoading,
    error,
    isConnected,
    address,
    hasCredentials: !!credentials,

    // Actions
    placeOrder,
    cancelOrder,
    getOpenOrders,
    setApiCredentials,
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
