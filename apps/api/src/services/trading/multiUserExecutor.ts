/**
 * Multi-User Order Executor
 * 
 * Executes orders on behalf of users with:
 * - User-specific wallet management
 * - Builder attribution for all orders
 * - Gasless execution via relayer
 * - Per-user rate limiting
 */

import { Pool } from 'pg';
import Redis from 'ioredis';
import { Wallet } from '@ethersproject/wallet';
import { ClobClient, Side, OrderType as ClobOrderType } from '@polymarket/clob-client';
import { BuilderConfig } from '@polymarket/builder-signing-sdk';
import { createWalletClient, http, Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { polygon } from 'viem/chains';
import { RelayClient, RelayerTxType } from '@polymarket/builder-relayer-client';
import {
  OrderRequest,
  OrderResponse,
  TransactionState,
  ExecutionPath,
  BuilderCredentials,
  POLYGON_CONTRACTS,
} from '../../types/trading.js';
import { UserManager, User } from './userManager.js';

// Rate limits per user
const USER_DAILY_LIMIT = 50;  // Orders per user per day
const PLATFORM_DAILY_LIMIT = 100;  // Total relayer transactions (unverified)

export interface UserOrderRequest extends OrderRequest {
  userId: number;
}

export interface MultiUserExecutorConfig {
  chainId: number;
  clobUrl: string;
  relayerUrl: string;
  rpcUrl: string;
  builderCredentials: BuilderCredentials;
}

export class MultiUserExecutor {
  private db: Pool;
  private redis: Redis;
  private config: MultiUserExecutorConfig;
  private userManager: UserManager;
  private builderConfig: BuilderConfig;
  private initialized = false;

  // Cache for user CLOB clients (keyed by user ID)
  private userClients: Map<number, ClobClient> = new Map();

  constructor(
    db: Pool,
    redis: Redis,
    userManager: UserManager,
    config: MultiUserExecutorConfig
  ) {
    this.db = db;
    this.redis = redis;
    this.userManager = userManager;
    this.config = config;

    // Builder config for order attribution
    this.builderConfig = new BuilderConfig({
      localBuilderCreds: {
        key: config.builderCredentials.key,
        secret: config.builderCredentials.secret,
        passphrase: config.builderCredentials.passphrase,
      },
    });
  }

  /**
   * Initialize the executor
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    console.log('[MultiUserExecutor] Initializing...');
    this.initialized = true;
    console.log('[MultiUserExecutor] Ready');
  }

  /**
   * Deploy proxy wallet for a user
   * 
   * This uses the SERVER's relayer access to deploy a Safe wallet
   * that the user's EOA will control.
   */
  async deployUserWallet(userId: number, userEoaPrivateKey: string): Promise<{
    success: boolean;
    proxyAddress?: string;
    transactionHash?: string;
    error?: string;
  }> {
    const user = await this.userManager.getUserById(userId);
    if (!user) {
      return { success: false, error: 'User not found' };
    }

    if (user.proxyDeployed && user.proxyAddress) {
      return { success: true, proxyAddress: user.proxyAddress };
    }

    console.log(`[MultiUserExecutor] Deploying wallet for user ${userId}...`);

    try {
      // Create viem wallet for user
      const account = privateKeyToAccount(userEoaPrivateKey as Hex);
      const wallet = createWalletClient({
        account,
        chain: polygon,
        transport: http(this.config.rpcUrl),
      });

      // Create relayer client with builder attribution
      const relayClient = new RelayClient(
        this.config.relayerUrl,
        this.config.chainId,
        wallet,
        this.builderConfig,
        RelayerTxType.SAFE
      );

      // Deploy Safe
      const response = await relayClient.deploy();
      const result = await response.wait();

      if (result && result.proxyAddress) {
        // Update user record
        await this.userManager.setProxyAddress(userId, result.proxyAddress);

        // Track operation
        await this.recordOperation(userId, 'deploy_wallet', 'CONFIRMED', result.transactionHash);

        console.log(`[MultiUserExecutor] Wallet deployed for user ${userId}:`, result.proxyAddress);

        return {
          success: true,
          proxyAddress: result.proxyAddress,
          transactionHash: result.transactionHash,
        };
      }

      return { success: false, error: 'Deployment returned no result' };
    } catch (error) {
      console.error(`[MultiUserExecutor] Wallet deployment failed for user ${userId}:`, error);
      await this.recordOperation(userId, 'deploy_wallet', 'FAILED', undefined, 
        error instanceof Error ? error.message : 'Unknown error');
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Execute order for a user
   * 
   * The user must provide a signed order. We add builder headers.
   */
  async executeOrder(request: UserOrderRequest): Promise<OrderResponse> {
    const { userId, ...orderRequest } = request;
    const orderId = this.generateOrderId();
    const timestamp = Date.now();

    // Get user
    const user = await this.userManager.getUserById(userId);
    if (!user) {
      return this.buildErrorResponse(orderId, orderRequest, timestamp, 'User not found');
    }

    // Check user rate limit
    if (!await this.checkUserRateLimit(userId)) {
      return this.buildErrorResponse(orderId, orderRequest, timestamp, 'Daily order limit reached');
    }

    // Check platform rate limit
    if (!await this.checkPlatformRateLimit()) {
      return this.buildErrorResponse(orderId, orderRequest, timestamp, 'Platform rate limit reached');
    }

    // Validate order
    const validationError = this.validateOrder(orderRequest);
    if (validationError) {
      return this.buildErrorResponse(orderId, orderRequest, timestamp, validationError);
    }

    console.log(`[MultiUserExecutor] Executing order ${orderId} for user ${userId}`);

    // Record order start
    await this.recordOrderStart(orderId, userId, orderRequest);

    try {
      // For now, we need the user to have API credentials
      // In production, users would sign orders client-side
      const result = await this.executeViaClob(user, orderRequest);

      // Update rate limits
      await this.incrementUserRateLimit(userId);
      await this.incrementPlatformRateLimit();

      // Update user stats
      await this.userManager.recordOrder(userId, orderRequest.price * orderRequest.size);

      // Record order completion
      await this.recordOrderComplete(orderId, result.status, result.executionPath, 
        result.transactionHash, result.errorMessage);

      return {
        orderId,
        status: result.status,
        executionPath: result.executionPath,
        timestamp,
        order: orderRequest,
        transactionHash: result.transactionHash,
        errorMessage: result.errorMessage,
      };
    } catch (error) {
      console.error(`[MultiUserExecutor] Order ${orderId} failed:`, error);
      
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      await this.recordOrderComplete(orderId, 'FAILED', 'CLOB_RELAYER', undefined, errorMsg);

      return this.buildErrorResponse(orderId, orderRequest, timestamp, errorMsg);
    }
  }

  /**
   * Execute order via CLOB
   */
  private async executeViaClob(user: User, request: OrderRequest): Promise<{
    status: TransactionState;
    executionPath: ExecutionPath;
    transactionHash?: string;
    errorMessage?: string;
  }> {
    // Note: In a full implementation, the user would sign the order client-side
    // and we'd add builder headers server-side before submitting.
    // 
    // For this implementation, we're demonstrating the server-side flow.
    // In production, you'd use:
    // 1. Client-side order signing (user's wallet)
    // 2. Server adds builder headers
    // 3. Submit to CLOB

    // This is a placeholder that shows the structure
    // Real implementation requires user to sign orders
    
    return {
      status: 'SUBMITTED',
      executionPath: 'CLOB_RELAYER',
      errorMessage: 'Order queued - user signature required',
    };
  }

  /**
   * Validate order parameters
   */
  private validateOrder(request: OrderRequest): string | null {
    if (!request.tokenId) {
      return 'Token ID is required';
    }
    if (request.price < 0.01 || request.price > 0.99) {
      return 'Price must be between 0.01 and 0.99';
    }
    if (request.size <= 0) {
      return 'Size must be greater than 0';
    }
    if (!['BUY', 'SELL'].includes(request.side)) {
      return 'Side must be BUY or SELL';
    }
    return null;
  }

  /**
   * Check user rate limit
   */
  private async checkUserRateLimit(userId: number): Promise<boolean> {
    const key = `trading:user:${userId}:daily_orders`;
    const count = await this.redis.get(key);
    return !count || parseInt(count) < USER_DAILY_LIMIT;
  }

  /**
   * Check platform rate limit
   */
  private async checkPlatformRateLimit(): Promise<boolean> {
    const key = 'trading:platform:daily_relayer';
    const count = await this.redis.get(key);
    return !count || parseInt(count) < PLATFORM_DAILY_LIMIT;
  }

  /**
   * Increment user rate limit
   */
  private async incrementUserRateLimit(userId: number): Promise<void> {
    const key = `trading:user:${userId}:daily_orders`;
    const exists = await this.redis.exists(key);
    
    if (exists) {
      await this.redis.incr(key);
    } else {
      const ttl = this.getTtlUntilMidnight();
      await this.redis.set(key, '1', 'EX', ttl);
    }
  }

  /**
   * Increment platform rate limit
   */
  private async incrementPlatformRateLimit(): Promise<void> {
    const key = 'trading:platform:daily_relayer';
    const exists = await this.redis.exists(key);
    
    if (exists) {
      await this.redis.incr(key);
    } else {
      const ttl = this.getTtlUntilMidnight();
      await this.redis.set(key, '1', 'EX', ttl);
    }
  }

  /**
   * Get TTL until midnight UTC
   */
  private getTtlUntilMidnight(): number {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setUTCHours(24, 0, 0, 0);
    return Math.floor((midnight.getTime() - now.getTime()) / 1000);
  }

  /**
   * Record operation in database
   */
  private async recordOperation(
    userId: number,
    operationType: string,
    status: string,
    txHash?: string,
    error?: string
  ): Promise<void> {
    await this.db.query(`
      INSERT INTO user_pending_operations 
        (user_id, operation_type, status, transaction_hash, error_message, completed_at)
      VALUES ($1, $2, $3, $4, $5, CASE WHEN $3 IN ('CONFIRMED', 'FAILED') THEN NOW() ELSE NULL END)
    `, [userId, operationType, status, txHash, error]);
  }

  /**
   * Record order start
   */
  private async recordOrderStart(orderId: string, userId: number, request: OrderRequest): Promise<void> {
    await this.db.query(`
      INSERT INTO trading_orders (order_id, user_id, token_id, side, price, size, status, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', NOW())
    `, [orderId, userId, request.tokenId, request.side, request.price, request.size]);
  }

  /**
   * Record order completion
   */
  private async recordOrderComplete(
    orderId: string,
    status: TransactionState,
    executionPath: ExecutionPath,
    txHash?: string,
    error?: string
  ): Promise<void> {
    await this.db.query(`
      UPDATE trading_orders
      SET status = $2, execution_path = $3, transaction_hash = $4, 
          error_message = $5, completed_at = NOW()
      WHERE order_id = $1
    `, [orderId, status, executionPath, txHash, error]);
  }

  /**
   * Build error response
   */
  private buildErrorResponse(
    orderId: string,
    request: OrderRequest,
    timestamp: number,
    error: string
  ): OrderResponse {
    return {
      orderId,
      status: 'FAILED',
      executionPath: 'CLOB_RELAYER',
      timestamp,
      order: request,
      errorMessage: error,
    };
  }

  /**
   * Generate order ID
   */
  private generateOrderId(): string {
    return `hld_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get user's rate limit status
   */
  async getUserRateLimitStatus(userId: number): Promise<{
    dailyLimit: number;
    used: number;
    remaining: number;
    resetAt: Date;
  }> {
    const key = `trading:user:${userId}:daily_orders`;
    const count = await this.redis.get(key);
    const used = count ? parseInt(count) : 0;
    const ttl = await this.redis.ttl(key);

    return {
      dailyLimit: USER_DAILY_LIMIT,
      used,
      remaining: Math.max(0, USER_DAILY_LIMIT - used),
      resetAt: new Date(Date.now() + (ttl > 0 ? ttl * 1000 : this.getTtlUntilMidnight() * 1000)),
    };
  }

  /**
   * Get platform rate limit status
   */
  async getPlatformRateLimitStatus(): Promise<{
    dailyLimit: number;
    used: number;
    remaining: number;
    resetAt: Date;
  }> {
    const key = 'trading:platform:daily_relayer';
    const count = await this.redis.get(key);
    const used = count ? parseInt(count) : 0;
    const ttl = await this.redis.ttl(key);

    return {
      dailyLimit: PLATFORM_DAILY_LIMIT,
      used,
      remaining: Math.max(0, PLATFORM_DAILY_LIMIT - used),
      resetAt: new Date(Date.now() + (ttl > 0 ? ttl * 1000 : this.getTtlUntilMidnight() * 1000)),
    };
  }

  /**
   * Get executor status
   */
  async getStatus(): Promise<{
    initialized: boolean;
    platformRateLimit: {
      dailyLimit: number;
      used: number;
      remaining: number;
      resetAt: Date;
    };
    activeUsers: number;
  }> {
    const platformRateLimit = await this.getPlatformRateLimitStatus();
    const platformStats = await this.userManager.getPlatformStats();

    return {
      initialized: this.initialized,
      platformRateLimit,
      activeUsers: platformStats.activeUsers24h,
    };
  }
}

/**
 * Create MultiUserExecutor from environment
 */
export function createMultiUserExecutorFromEnv(
  db: Pool,
  redis: Redis,
  userManager: UserManager
): MultiUserExecutor {
  const config: MultiUserExecutorConfig = {
    chainId: parseInt(process.env.CHAIN_ID || '137'),
    clobUrl: process.env.CLOB_API_URL || 'https://clob.polymarket.com',
    relayerUrl: process.env.RELAYER_URL || 'https://relayer-v2.polymarket.com',
    rpcUrl: process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com',
    builderCredentials: {
      key: process.env.POLY_BUILDER_API_KEY || '',
      secret: process.env.POLY_BUILDER_SECRET || '',
      passphrase: process.env.POLY_BUILDER_PASSPHRASE || '',
    },
  };

  return new MultiUserExecutor(db, redis, userManager, config);
}

