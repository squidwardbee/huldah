/**
 * Backend-Routed Trading Hook
 *
 * Routes orders through our backend API, which then calls Polymarket.
 * This avoids CORS issues and allows the backend to use VPN for geoblocking.
 *
 * Flow: Frontend -> Backend (localhost:3001) -> Polymarket CLOB
 */

import { useState, useCallback } from 'react';
import { useAccount } from 'wagmi';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

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

export function useBackendTrading() {
  const { address, isConnected } = useAccount();

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Place an order via the backend
   */
  const placeOrder = useCallback(async (params: OrderParams): Promise<OrderResult> => {
    setIsLoading(true);
    setError(null);

    try {
      if (!isConnected || !address) {
        return { success: false, errorMessage: 'Wallet not connected' };
      }

      // Validate price range
      if (params.price < 0.01 || params.price > 0.99) {
        return { success: false, errorMessage: 'Price must be between 1¢ and 99¢' };
      }

      if (params.size <= 0) {
        return { success: false, errorMessage: 'Size must be greater than 0' };
      }

      console.log('[useBackendTrading] Placing order via backend:', params);

      const response = await fetch(`${API_URL}/api/trading/order`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tokenId: params.tokenId,
          side: params.side,
          price: params.price,
          size: params.size,
          orderType: params.orderType || 'GTC',
        }),
      });

      const data = await response.json();

      console.log('[useBackendTrading] Backend response:', data);

      if (!response.ok) {
        return {
          success: false,
          errorMessage: data.error || data.errorMessage || `Server error: ${response.status}`,
        };
      }

      if (data.status === 'FAILED') {
        return {
          success: false,
          errorMessage: data.errorMessage || 'Order rejected',
        };
      }

      return {
        success: true,
        orderId: data.orderId,
        transactionHash: data.transactionHash,
      };
    } catch (err: any) {
      console.error('[useBackendTrading] Order failed:', err);

      let errorMessage = err.message || 'Unknown error';

      // Check for network errors
      if (err.name === 'TypeError' && err.message.includes('fetch')) {
        errorMessage = 'Cannot connect to backend. Is the API server running?';
      }

      setError(errorMessage);
      return { success: false, errorMessage };
    } finally {
      setIsLoading(false);
    }
  }, [isConnected, address]);

  /**
   * Cancel an order via the backend
   */
  const cancelOrder = useCallback(async (orderId: string): Promise<OrderResult> => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_URL}/api/trading/order/${orderId}`, {
        method: 'DELETE',
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        return {
          success: false,
          errorMessage: data.error || 'Failed to cancel order',
        };
      }

      return { success: true, orderId };
    } catch (err: any) {
      console.error('[useBackendTrading] Cancel failed:', err);
      return { success: false, errorMessage: err.message || 'Failed to cancel order' };
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Get open orders from backend
   */
  const getOpenOrders = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/api/trading/orders`);
      if (!response.ok) return [];
      return await response.json();
    } catch (err) {
      console.error('[useBackendTrading] Failed to get open orders:', err);
      return [];
    }
  }, []);

  /**
   * Check trading status
   */
  const checkStatus = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/api/trading/status`);
      if (!response.ok) return null;
      return await response.json();
    } catch (err) {
      console.error('[useBackendTrading] Failed to check status:', err);
      return null;
    }
  }, []);

  return {
    // State
    isLoading,
    error,
    isConnected,
    address,
    hasCredentials: true, // Backend handles credentials

    // Actions
    placeOrder,
    cancelOrder,
    getOpenOrders,
    checkStatus,
  };
}
