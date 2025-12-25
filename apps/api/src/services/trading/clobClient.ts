/**
 * CLOB Client Wrapper
 * 
 * Wraps the Polymarket CLOB client with:
 * - Builder authentication
 * - Error handling
 * - Retry logic
 * - Type safety
 */

import { Wallet } from '@ethersproject/wallet';
import { 
  ClobClient, 
  Side, 
  OrderType as ClobOrderType,
  ApiKeyCreds
} from '@polymarket/clob-client';
import { BuilderConfig } from '@polymarket/builder-signing-sdk';
import {
  OrderRequest,
  OrderResponse,
  OrderSide,
  OrderType,
  Orderbook,
  MarketInfo,
  TradingConfig,
  TransactionState,
  DEFAULT_RETRY_CONFIG,
  RetryConfig,
} from '../../types/trading.js';
import { BuilderSigner } from './builderSigner.js';

export class TradingClobClient {
  private clobClient: ClobClient | null = null;
  private signer: Wallet;
  private config: TradingConfig;
  private builderSigner: BuilderSigner;
  private userCreds: ApiKeyCreds | null = null;
  private retryConfig: RetryConfig;
  private initialized = false;

  constructor(config: TradingConfig, retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG) {
    this.config = config;
    this.retryConfig = retryConfig;
    this.signer = new Wallet(config.privateKey);
    this.builderSigner = new BuilderSigner(config.builderCredentials);
  }

  /**
   * Initialize the CLOB client
   * Must be called before any operations
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    console.log('[CLOB] Initializing client...');

    try {
      // Create or derive API credentials for this wallet
      const tempClient = new ClobClient(
        this.config.clobUrl,
        this.config.chainId,
        this.signer
      );

      this.userCreds = await tempClient.createOrDeriveApiKey();
      console.log('[CLOB] API credentials derived');

      // Create builder config for order attribution
      const builderConfig = new BuilderConfig({
        localBuilderCreds: {
          key: this.config.builderCredentials.key,
          secret: this.config.builderCredentials.secret,
          passphrase: this.config.builderCredentials.passphrase,
        },
      });

      // Create the full client with builder attribution
      this.clobClient = new ClobClient(
        this.config.clobUrl,
        this.config.chainId,
        this.signer,
        this.userCreds ?? undefined,
        this.config.signatureType,
        this.config.funderAddress,
        undefined,
        false,
        builderConfig
      );

      this.initialized = true;
      console.log('[CLOB] Client initialized successfully');
    } catch (error) {
      console.error('[CLOB] Failed to initialize:', error);
      throw error;
    }
  }

  /**
   * Ensure client is initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized || !this.clobClient) {
      throw new Error('CLOB client not initialized. Call initialize() first.');
    }
  }

  /**
   * Get orderbook for a token
   */
  async getOrderbook(tokenId: string): Promise<Orderbook> {
    this.ensureInitialized();

    try {
      const book = await this.clobClient!.getOrderBook(tokenId);
      
      return {
        tokenId,
        bids: book.bids.map((b: { price: string; size: string }) => ({ 
          price: b.price, 
          size: b.size 
        })),
        asks: book.asks.map((a: { price: string; size: string }) => ({ 
          price: a.price, 
          size: a.size 
        })),
        timestamp: Date.now(),
      };
    } catch (error) {
      console.error('[CLOB] Error fetching orderbook:', error);
      throw error;
    }
  }

  /**
   * Get market info from CLOB
   */
  async getMarket(tokenId: string): Promise<MarketInfo | null> {
    this.ensureInitialized();

    try {
      const market = await this.clobClient!.getMarket(tokenId);
      
      if (!market) return null;

      return {
        conditionId: market.condition_id,
        questionId: market.question_id,
        question: market.question,
        slug: market.market_slug,
        tokens: market.tokens.map((t: { token_id: string; outcome: string }) => ({
          tokenId: t.token_id,
          outcome: t.outcome,
          price: 0, // Would need to fetch from orderbook
        })),
        endDate: market.end_date_iso,
        volume: market.volume || '0',
        liquidity: market.liquidity || '0',
        active: market.active,
        negRisk: market.neg_risk || false,
        tickSize: market.minimum_tick_size || '0.01',
      };
    } catch (error) {
      console.error('[CLOB] Error fetching market:', error);
      return null;
    }
  }

  /**
   * Create and submit an order
   */
  async createOrder(request: OrderRequest): Promise<OrderResponse> {
    this.ensureInitialized();

    const orderId = this.generateOrderId();
    const timestamp = Date.now();

    try {
      // Validate order
      this.validateOrder(request);

      // Convert to CLOB types
      const side = request.side === 'BUY' ? Side.BUY : Side.SELL;
      const orderType = this.mapOrderType(request.orderType || 'GTC');

      console.log(`[CLOB] Creating order: ${request.side} ${request.size} @ ${request.price}`);

      // Create the order
      const order = await this.clobClient!.createOrder({
        tokenID: request.tokenId,
        price: request.price,
        side,
        size: request.size,
      }, {
        tickSize: (request.tickSize || '0.01') as '0.1' | '0.01' | '0.001' | '0.0001',
        negRisk: request.negRisk || false,
      });

      console.log('[CLOB] Order created, posting...');

      // Post the order with retry
      const response = await this.postOrderWithRetry(order, orderType);

      return {
        orderId,
        status: response.success ? 'SUBMITTED' : 'FAILED',
        executionPath: 'CLOB_RELAYER',
        timestamp,
        order: request,
        transactionHash: response.transactionsHashes?.[0],
        errorMessage: response.errorMsg,
      };
    } catch (error) {
      console.error('[CLOB] Order creation failed:', error);
      
      return {
        orderId,
        status: 'FAILED',
        executionPath: 'CLOB_RELAYER',
        timestamp,
        order: request,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Post order with retry logic
   */
  private async postOrderWithRetry(
    order: unknown,
    orderType: ClobOrderType,
    attempt = 0
  ): Promise<{ success: boolean; transactionsHashes?: string[]; errorMsg?: string }> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await this.clobClient!.postOrder(order as any, orderType);
      return response;
    } catch (error) {
      if (attempt < this.retryConfig.maxRetries) {
        const delay = this.calculateRetryDelay(attempt);
        console.log(`[CLOB] Retry ${attempt + 1}/${this.retryConfig.maxRetries} in ${delay}ms`);
        
        await this.sleep(delay);
        return this.postOrderWithRetry(order, orderType, attempt + 1);
      }
      
      throw error;
    }
  }

  /**
   * Cancel an order
   */
  async cancelOrder(orderId: string): Promise<boolean> {
    this.ensureInitialized();

    try {
      await this.clobClient!.cancelOrder({ orderID: orderId });
      console.log(`[CLOB] Order ${orderId} cancelled`);
      return true;
    } catch (error) {
      console.error('[CLOB] Cancel failed:', error);
      return false;
    }
  }

  /**
   * Cancel all orders for a market
   */
  async cancelAllOrders(conditionId?: string): Promise<boolean> {
    this.ensureInitialized();

    try {
      if (conditionId) {
        await this.clobClient!.cancelMarketOrders({ market: conditionId });
      } else {
        await this.clobClient!.cancelAll();
      }
      console.log('[CLOB] Orders cancelled');
      return true;
    } catch (error) {
      console.error('[CLOB] Cancel all failed:', error);
      return false;
    }
  }

  /**
   * Get open orders
   */
  async getOpenOrders(): Promise<unknown[]> {
    this.ensureInitialized();

    try {
      const orders = await this.clobClient!.getOpenOrders();
      return orders;
    } catch (error) {
      console.error('[CLOB] Error fetching open orders:', error);
      return [];
    }
  }

  /**
   * Get trade history
   */
  async getTradeHistory(): Promise<unknown[]> {
    this.ensureInitialized();

    try {
      const trades = await this.clobClient!.getTrades();
      return trades;
    } catch (error) {
      console.error('[CLOB] Error fetching trades:', error);
      return [];
    }
  }

  /**
   * Validate order parameters
   */
  private validateOrder(request: OrderRequest): void {
    if (!request.tokenId) {
      throw new Error('Token ID is required');
    }

    if (request.price < 0.01 || request.price > 0.99) {
      throw new Error('Price must be between 0.01 and 0.99');
    }

    if (request.size <= 0) {
      throw new Error('Size must be greater than 0');
    }

    if (!['BUY', 'SELL'].includes(request.side)) {
      throw new Error('Side must be BUY or SELL');
    }
  }

  /**
   * Map order type to CLOB type
   */
  private mapOrderType(type: OrderType): ClobOrderType {
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

  /**
   * Generate unique order ID
   */
  private generateOrderId(): string {
    return `ord_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Calculate retry delay with exponential backoff and jitter
   */
  private calculateRetryDelay(attempt: number): number {
    const exponentialDelay = Math.min(
      this.retryConfig.baseDelayMs * Math.pow(2, attempt),
      this.retryConfig.maxDelayMs
    );
    
    const jitter = Math.random() * this.retryConfig.jitterMs;
    return exponentialDelay + jitter;
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get wallet address
   */
  getWalletAddress(): string {
    return this.signer.address;
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}

/**
 * Create a TradingClobClient from environment variables
 */
export function createClobClientFromEnv(): TradingClobClient {
  const config: TradingConfig = {
    chainId: parseInt(process.env.CHAIN_ID || '137'),
    clobUrl: process.env.CLOB_API_URL || 'https://clob.polymarket.com',
    relayerUrl: process.env.RELAYER_URL || 'https://relayer-v2.polymarket.com',
    rpcUrl: process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com',
    builderCredentials: {
      key: process.env.POLY_BUILDER_API_KEY || '',
      secret: process.env.POLY_BUILDER_SECRET || '',
      passphrase: process.env.POLY_BUILDER_PASSPHRASE || '',
    },
    privateKey: process.env.TRADING_PRIVATE_KEY || '',
    funderAddress: process.env.TRADING_FUNDER_ADDRESS || '',
    signatureType: 2, // Safe proxy wallet
  };

  return new TradingClobClient(config);
}

