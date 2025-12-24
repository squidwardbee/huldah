/**
 * User Manager
 * 
 * Manages user registration, authentication, and wallet management
 * for the multi-user trading aggregation terminal.
 */

import { Pool } from 'pg';
import crypto from 'crypto';
import { verifyMessage } from 'viem';
import { TradingRelayerClient } from './relayerClient.js';
import { BuilderCredentials, TradingConfig } from '../../types/trading.js';

export interface User {
  id: number;
  eoaAddress: string;
  proxyAddress: string | null;
  username: string | null;
  proxyDeployed: boolean;
  usdcApproved: boolean;
  tokensApproved: boolean;
  totalOrders: number;
  totalVolume: number;
  totalTrades: number;
  realizedPnl: number;
  createdAt: Date;
  lastActive: Date;
}

export interface UserSession {
  token: string;
  userId: number;
  eoaAddress: string;
  proxyAddress: string | null;
  expiresAt: Date;
}

export interface AuthChallenge {
  nonce: string;
  message: string;
  expiresAt: Date;
}

// Session duration (24 hours)
const SESSION_DURATION_MS = 24 * 60 * 60 * 1000;

// Nonce expiry (5 minutes)
const NONCE_EXPIRY_MS = 5 * 60 * 1000;

export class UserManager {
  private db: Pool;
  private builderCredentials: BuilderCredentials;
  private relayerUrl: string;
  private rpcUrl: string;
  private chainId: number;

  constructor(db: Pool, config: {
    builderCredentials: BuilderCredentials;
    relayerUrl: string;
    rpcUrl: string;
    chainId: number;
  }) {
    this.db = db;
    this.builderCredentials = config.builderCredentials;
    this.relayerUrl = config.relayerUrl;
    this.rpcUrl = config.rpcUrl;
    this.chainId = config.chainId;
  }

  /**
   * Generate authentication challenge for wallet signature
   */
  async generateAuthChallenge(eoaAddress: string): Promise<AuthChallenge> {
    const address = eoaAddress.toLowerCase();
    const nonce = crypto.randomBytes(32).toString('hex');
    
    console.log('[UserManager] Generating auth challenge for', address);
    
    // Store nonce - use database NOW() + interval for timezone-safe expiry
    // This ensures expires_at is calculated in the same timezone as the comparison
    try {
      const result = await this.db.query(`
        INSERT INTO user_nonces (eoa_address, nonce, expires_at)
        VALUES ($1, $2, NOW() + INTERVAL '5 minutes')
        ON CONFLICT (eoa_address) DO UPDATE SET
          nonce = $2,
          expires_at = NOW() + INTERVAL '5 minutes',
          created_at = NOW()
        RETURNING expires_at
      `, [address, nonce]);
      
      const expiresAt = new Date(result.rows[0].expires_at);
      console.log('[UserManager] Nonce stored successfully for', address, 'expires at', expiresAt.toISOString());
      
      const message = this.buildSignMessage(address, nonce);
      console.log('[UserManager] Challenge message generated');

      return {
        nonce,
        message,
        expiresAt,
      };
    } catch (err: any) {
      console.error('[UserManager] Failed to store nonce:', err.message || err);
      // If the table doesn't exist, provide helpful error
      if (err.message?.includes('relation "user_nonces" does not exist')) {
        throw new Error('Database migration 005_multi_user_trading.sql has not been applied. Please run the migration.');
      }
      throw err;
    }
  }

  /**
   * Build the message users sign to authenticate
   * Note: Do NOT include dynamic values like timestamps that change between calls
   * Use lowercase address for consistency between challenge and verification
   */
  private buildSignMessage(address: string, nonce: string): string {
    return `Sign this message to authenticate with Huldah Trading Terminal.

Address: ${address.toLowerCase()}
Nonce: ${nonce}

This signature does not trigger any blockchain transaction or cost any gas.`;
  }

  /**
   * Verify signature and create session
   */
  async authenticateWithSignature(
    eoaAddress: string,
    signature: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<UserSession | null> {
    const address = eoaAddress.toLowerCase();
    console.log('[UserManager] Authenticating', address);

    // Get stored nonce
    let nonceResult;
    try {
      nonceResult = await this.db.query(`
        SELECT nonce, expires_at FROM user_nonces
        WHERE eoa_address = $1 AND expires_at > NOW()
      `, [address]);
    } catch (err: any) {
      console.error('[UserManager] Failed to query nonce:', err.message || err);
      if (err.message?.includes('relation "user_nonces" does not exist')) {
        console.error('[UserManager] Database migration 005_multi_user_trading.sql has not been applied!');
      }
      return null;
    }

    if (nonceResult.rows.length === 0) {
      console.log('[UserManager] No valid nonce found for', address);
      // Check if there's an expired nonce
      const expiredCheck = await this.db.query(`
        SELECT nonce, expires_at, created_at FROM user_nonces WHERE eoa_address = $1
      `, [address]);
      if (expiredCheck.rows.length > 0) {
        const row = expiredCheck.rows[0];
        console.log('[UserManager] Found expired/used nonce:', {
          createdAt: row.created_at,
          expiresAt: row.expires_at,
          now: new Date(),
          isExpired: new Date(row.expires_at) < new Date()
        });
      } else {
        console.log('[UserManager] No nonce ever requested for this address. Did /api/auth/challenge fail?');
      }
      return null;
    }

    const { nonce, expires_at } = nonceResult.rows[0];
    console.log('[UserManager] Found valid nonce, expires at', expires_at);
    
    const message = this.buildSignMessage(address, nonce);
    
    console.log('[UserManager] Verifying signature for', address);
    console.log('[UserManager] Expected message:', message.slice(0, 100) + '...');

    // Verify signature
    try {
      const isValid = await verifyMessage({
        address: eoaAddress as `0x${string}`,
        message,
        signature: signature as `0x${string}`,
      });

      if (!isValid) {
        console.log('[UserManager] Invalid signature for', address);
        console.log('[UserManager] Signature received:', signature.slice(0, 20) + '...');
        return null;
      }
      
      console.log('[UserManager] Signature verified successfully for', address);
    } catch (error) {
      console.error('[UserManager] Signature verification failed:', error);
      return null;
    }

    // Delete used nonce
    await this.db.query(`DELETE FROM user_nonces WHERE eoa_address = $1`, [address]);

    // Get or create user
    let user = await this.getUserByAddress(address);
    if (!user) {
      user = await this.createUser(address);
    }

    // Create session
    const session = await this.createSession(user.id, ipAddress, userAgent);

    return {
      token: session.token,
      userId: user.id,
      eoaAddress: user.eoaAddress,
      proxyAddress: user.proxyAddress,
      expiresAt: session.expiresAt,
    };
  }

  /**
   * Get user by EOA address
   */
  async getUserByAddress(eoaAddress: string): Promise<User | null> {
    const result = await this.db.query(`
      SELECT 
        id,
        eoa_address,
        proxy_address,
        username,
        proxy_deployed,
        usdc_approved,
        tokens_approved,
        total_orders,
        total_volume,
        total_trades,
        realized_pnl,
        created_at,
        last_active
      FROM trading_users
      WHERE eoa_address = $1
    `, [eoaAddress.toLowerCase()]);

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      id: row.id,
      eoaAddress: row.eoa_address,
      proxyAddress: row.proxy_address,
      username: row.username,
      proxyDeployed: row.proxy_deployed,
      usdcApproved: row.usdc_approved,
      tokensApproved: row.tokens_approved,
      totalOrders: row.total_orders,
      totalVolume: parseFloat(row.total_volume),
      totalTrades: row.total_trades,
      realizedPnl: parseFloat(row.realized_pnl),
      createdAt: row.created_at,
      lastActive: row.last_active,
    };
  }

  /**
   * Get user by ID
   */
  async getUserById(userId: number): Promise<User | null> {
    const result = await this.db.query(`
      SELECT 
        id,
        eoa_address,
        proxy_address,
        username,
        proxy_deployed,
        usdc_approved,
        tokens_approved,
        total_orders,
        total_volume,
        total_trades,
        realized_pnl,
        created_at,
        last_active
      FROM trading_users
      WHERE id = $1
    `, [userId]);

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      id: row.id,
      eoaAddress: row.eoa_address,
      proxyAddress: row.proxy_address,
      username: row.username,
      proxyDeployed: row.proxy_deployed,
      usdcApproved: row.usdc_approved,
      tokensApproved: row.tokens_approved,
      totalOrders: row.total_orders,
      totalVolume: parseFloat(row.total_volume),
      totalTrades: row.total_trades,
      realizedPnl: parseFloat(row.realized_pnl),
      createdAt: row.created_at,
      lastActive: row.last_active,
    };
  }

  /**
   * Create new user
   */
  async createUser(eoaAddress: string, username?: string): Promise<User> {
    const result = await this.db.query(`
      INSERT INTO trading_users (eoa_address, username)
      VALUES ($1, $2)
      RETURNING id, eoa_address, proxy_address, username, proxy_deployed,
                usdc_approved, tokens_approved, total_orders, total_volume,
                total_trades, realized_pnl, created_at, last_active
    `, [eoaAddress.toLowerCase(), username || null]);

    const row = result.rows[0];
    console.log('[UserManager] Created new user:', row.id, eoaAddress);

    return {
      id: row.id,
      eoaAddress: row.eoa_address,
      proxyAddress: row.proxy_address,
      username: row.username,
      proxyDeployed: row.proxy_deployed,
      usdcApproved: row.usdc_approved,
      tokensApproved: row.tokens_approved,
      totalOrders: row.total_orders,
      totalVolume: parseFloat(row.total_volume || '0'),
      totalTrades: row.total_trades,
      realizedPnl: parseFloat(row.realized_pnl || '0'),
      createdAt: row.created_at,
      lastActive: row.last_active,
    };
  }

  /**
   * Create session for user
   */
  private async createSession(
    userId: number,
    ipAddress?: string,
    userAgent?: string
  ): Promise<{ token: string; expiresAt: Date }> {
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

    await this.db.query(`
      INSERT INTO user_sessions (user_id, token_hash, expires_at, ip_address, user_agent)
      VALUES ($1, $2, $3, $4, $5)
    `, [userId, tokenHash, expiresAt, ipAddress, userAgent]);

    // Update last active
    await this.db.query(`
      UPDATE trading_users SET last_active = NOW() WHERE id = $1
    `, [userId]);

    return { token, expiresAt };
  }

  /**
   * Validate session token and return user
   */
  async validateSession(token: string): Promise<User | null> {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const result = await this.db.query(`
      SELECT user_id FROM user_sessions
      WHERE token_hash = $1 AND expires_at > NOW()
    `, [tokenHash]);

    if (result.rows.length === 0) return null;

    // Update last used
    await this.db.query(`
      UPDATE user_sessions SET last_used = NOW() WHERE token_hash = $1
    `, [tokenHash]);

    return this.getUserById(result.rows[0].user_id);
  }

  /**
   * Invalidate session (logout)
   */
  async invalidateSession(token: string): Promise<void> {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    await this.db.query(`DELETE FROM user_sessions WHERE token_hash = $1`, [tokenHash]);
  }

  /**
   * Update user's proxy wallet address
   */
  async setProxyAddress(userId: number, proxyAddress: string): Promise<void> {
    await this.db.query(`
      UPDATE trading_users
      SET proxy_address = $2, proxy_deployed = TRUE
      WHERE id = $1
    `, [userId, proxyAddress.toLowerCase()]);
  }

  /**
   * Mark USDC approved for user
   */
  async setUsdcApproved(userId: number): Promise<void> {
    await this.db.query(`
      UPDATE trading_users SET usdc_approved = TRUE WHERE id = $1
    `, [userId]);
  }

  /**
   * Mark tokens approved for user
   */
  async setTokensApproved(userId: number): Promise<void> {
    await this.db.query(`
      UPDATE trading_users SET tokens_approved = TRUE WHERE id = $1
    `, [userId]);
  }

  /**
   * Update user stats after order
   */
  async recordOrder(userId: number, volume: number): Promise<void> {
    await this.db.query(`
      UPDATE trading_users
      SET total_orders = total_orders + 1,
          total_volume = total_volume + $2,
          last_active = NOW()
      WHERE id = $1
    `, [userId, volume]);
  }

  /**
   * Update user stats after trade fill
   */
  async recordTrade(userId: number, pnl: number): Promise<void> {
    await this.db.query(`
      UPDATE trading_users
      SET total_trades = total_trades + 1,
          realized_pnl = realized_pnl + $2,
          last_active = NOW()
      WHERE id = $1
    `, [userId, pnl]);
  }

  /**
   * Get user's positions
   */
  async getUserPositions(userId: number): Promise<Array<{
    tokenId: string;
    conditionId: string | null;
    outcome: string | null;
    size: number;
    avgEntryPrice: number;
    realizedPnl: number;
  }>> {
    const result = await this.db.query(`
      SELECT token_id, condition_id, outcome, size, avg_entry_price, realized_pnl
      FROM user_positions
      WHERE user_id = $1 AND size > 0
      ORDER BY updated_at DESC
    `, [userId]);

    return result.rows.map(row => ({
      tokenId: row.token_id,
      conditionId: row.condition_id,
      outcome: row.outcome,
      size: parseFloat(row.size),
      avgEntryPrice: parseFloat(row.avg_entry_price || '0'),
      realizedPnl: parseFloat(row.realized_pnl || '0'),
    }));
  }

  /**
   * Get user's order history
   */
  async getUserOrders(userId: number, limit = 50): Promise<unknown[]> {
    const result = await this.db.query(`
      SELECT 
        order_id, token_id, side, price, size, status,
        execution_path, transaction_hash, error_message,
        filled_size, avg_fill_price, created_at, completed_at
      FROM trading_orders
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `, [userId, limit]);

    return result.rows;
  }

  /**
   * Get all users (admin)
   */
  async getAllUsers(limit = 100): Promise<User[]> {
    const result = await this.db.query(`
      SELECT 
        id, eoa_address, proxy_address, username, proxy_deployed,
        usdc_approved, tokens_approved, total_orders, total_volume,
        total_trades, realized_pnl, created_at, last_active
      FROM trading_users
      ORDER BY total_volume DESC
      LIMIT $1
    `, [limit]);

    return result.rows.map(row => ({
      id: row.id,
      eoaAddress: row.eoa_address,
      proxyAddress: row.proxy_address,
      username: row.username,
      proxyDeployed: row.proxy_deployed,
      usdcApproved: row.usdc_approved,
      tokensApproved: row.tokens_approved,
      totalOrders: row.total_orders,
      totalVolume: parseFloat(row.total_volume || '0'),
      totalTrades: row.total_trades,
      realizedPnl: parseFloat(row.realized_pnl || '0'),
      createdAt: row.created_at,
      lastActive: row.last_active,
    }));
  }

  /**
   * Get platform stats
   */
  async getPlatformStats(): Promise<{
    totalUsers: number;
    activeUsers24h: number;
    totalVolume: number;
    totalOrders: number;
  }> {
    const result = await this.db.query(`
      SELECT 
        COUNT(*) as total_users,
        COUNT(*) FILTER (WHERE last_active > NOW() - INTERVAL '24 hours') as active_24h,
        COALESCE(SUM(total_volume), 0) as total_volume,
        COALESCE(SUM(total_orders), 0) as total_orders
      FROM trading_users
    `);

    const row = result.rows[0];
    return {
      totalUsers: parseInt(row.total_users),
      activeUsers24h: parseInt(row.active_24h),
      totalVolume: parseFloat(row.total_volume),
      totalOrders: parseInt(row.total_orders),
    };
  }

  /**
   * Cleanup expired sessions and nonces
   */
  async cleanup(): Promise<void> {
    await this.db.query(`DELETE FROM user_sessions WHERE expires_at < NOW()`);
    await this.db.query(`DELETE FROM user_nonces WHERE expires_at < NOW()`);
  }
}

/**
 * Create UserManager from environment
 */
export function createUserManagerFromEnv(db: Pool): UserManager {
  return new UserManager(db, {
    builderCredentials: {
      key: process.env.POLY_BUILDER_API_KEY || '',
      secret: process.env.POLY_BUILDER_SECRET || '',
      passphrase: process.env.POLY_BUILDER_PASSPHRASE || '',
    },
    relayerUrl: process.env.RELAYER_URL || 'https://relayer-v2.polymarket.com',
    rpcUrl: process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com',
    chainId: parseInt(process.env.CHAIN_ID || '137'),
  });
}

