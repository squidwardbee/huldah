/**
 * Relayer Client Wrapper
 * 
 * Wraps the Polymarket Builder Relayer Client for gasless transactions.
 * Handles wallet deployment, token approvals, and CTF operations.
 */

import { createWalletClient, http, Hex, encodeFunctionData, parseUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { polygon } from 'viem/chains';
import { RelayClient, RelayerTxType } from '@polymarket/builder-relayer-client';
import { BuilderConfig } from '@polymarket/builder-signing-sdk';
import {
  TradingConfig,
  POLYGON_CONTRACTS,
  DEFAULT_RETRY_CONFIG,
  RetryConfig,
} from '../../types/trading.js';

// Transaction State from Relayer
export type RelayerTxState = 
  | 'STATE_NEW'
  | 'STATE_EXECUTED'
  | 'STATE_MINED'
  | 'STATE_CONFIRMED'
  | 'STATE_FAILED'
  | 'STATE_INVALID';

export interface RelayerTransaction {
  to: string;
  data: string;
  value: string;
}

export interface RelayerResult {
  success: boolean;
  transactionHash?: string;
  proxyAddress?: string;
  state?: RelayerTxState;
  error?: string;
}

// ERC20 ABI fragments
const ERC20_ABI = [
  {
    name: 'approve',
    type: 'function',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
  {
    name: 'transfer',
    type: 'function',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const;

// CTF ABI fragments
const CTF_ABI = [
  {
    name: 'splitPosition',
    type: 'function',
    inputs: [
      { name: 'collateralToken', type: 'address' },
      { name: 'parentCollectionId', type: 'bytes32' },
      { name: 'conditionId', type: 'bytes32' },
      { name: 'partition', type: 'uint256[]' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'mergePositions',
    type: 'function',
    inputs: [
      { name: 'collateralToken', type: 'address' },
      { name: 'parentCollectionId', type: 'bytes32' },
      { name: 'conditionId', type: 'bytes32' },
      { name: 'partition', type: 'uint256[]' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'redeemPositions',
    type: 'function',
    inputs: [
      { name: 'collateralToken', type: 'address' },
      { name: 'parentCollectionId', type: 'bytes32' },
      { name: 'conditionId', type: 'bytes32' },
      { name: 'indexSets', type: 'uint256[]' },
    ],
    outputs: [],
  },
] as const;

export class TradingRelayerClient {
  private relayClient: RelayClient | null = null;
  private config: TradingConfig;
  private retryConfig: RetryConfig;
  private proxyAddress: string | null = null;
  private initialized = false;
  private walletDeployed = false;

  constructor(config: TradingConfig, retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG) {
    this.config = config;
    this.retryConfig = retryConfig;
  }

  /**
   * Initialize the relayer client
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    console.log('[Relayer] Initializing client...');

    try {
      // Create viem wallet
      const account = privateKeyToAccount(this.config.privateKey as Hex);
      const wallet = createWalletClient({
        account,
        chain: polygon,
        transport: http(this.config.rpcUrl),
      });

      // Create builder config
      const builderConfig = new BuilderConfig({
        localBuilderCreds: {
          key: this.config.builderCredentials.key,
          secret: this.config.builderCredentials.secret,
          passphrase: this.config.builderCredentials.passphrase,
        },
      });

      // Create relayer client
      this.relayClient = new RelayClient(
        this.config.relayerUrl,
        this.config.chainId,
        wallet,
        builderConfig,
        RelayerTxType.SAFE // Use Safe proxy wallet
      );

      this.initialized = true;
      console.log('[Relayer] Client initialized');
    } catch (error) {
      console.error('[Relayer] Failed to initialize:', error);
      throw error;
    }
  }

  /**
   * Ensure client is initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized || !this.relayClient) {
      throw new Error('Relayer client not initialized. Call initialize() first.');
    }
  }

  /**
   * Deploy Safe proxy wallet
   */
  async deployWallet(): Promise<RelayerResult> {
    this.ensureInitialized();

    if (this.walletDeployed && this.proxyAddress) {
      console.log('[Relayer] Wallet already deployed:', this.proxyAddress);
      return {
        success: true,
        proxyAddress: this.proxyAddress,
        state: 'STATE_CONFIRMED',
      };
    }

    console.log('[Relayer] Deploying Safe wallet...');

    try {
      const response = await this.relayClient!.deploy();
      const result = await response.wait();

      if (result) {
        this.walletDeployed = true;
        this.proxyAddress = result.proxyAddress;
        console.log('[Relayer] Wallet deployed:', result.proxyAddress);
        
        return {
          success: true,
          transactionHash: result.transactionHash,
          proxyAddress: result.proxyAddress,
          state: 'STATE_CONFIRMED',
        };
      }

      return {
        success: false,
        error: 'Deployment returned no result',
      };
    } catch (error) {
      console.error('[Relayer] Wallet deployment failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Approve USDC spending for CTF
   */
  async approveUSDC(amount: bigint = BigInt('115792089237316195423570985008687907853269984665640564039457584007913129639935')): Promise<RelayerResult> {
    this.ensureInitialized();

    console.log('[Relayer] Approving USDC for CTF...');

    const tx: RelayerTransaction = {
      to: POLYGON_CONTRACTS.USDC,
      data: encodeFunctionData({
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [POLYGON_CONTRACTS.CTF, amount],
      }),
      value: '0',
    };

    return this.executeWithRetry([tx], 'Approve USDC for CTF');
  }

  /**
   * Approve outcome tokens for CTF Exchange
   */
  async approveTokensForExchange(negRisk = false): Promise<RelayerResult> {
    this.ensureInitialized();

    const exchange = negRisk 
      ? POLYGON_CONTRACTS.NEG_RISK_CTF_EXCHANGE 
      : POLYGON_CONTRACTS.CTF_EXCHANGE;

    console.log(`[Relayer] Approving tokens for ${negRisk ? 'NegRisk' : ''} Exchange...`);

    // Approve USDC
    const usdcApprove: RelayerTransaction = {
      to: POLYGON_CONTRACTS.USDC,
      data: encodeFunctionData({
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [exchange, BigInt('115792089237316195423570985008687907853269984665640564039457584007913129639935')],
      }),
      value: '0',
    };

    // Approve CTF tokens
    const ctfApprove: RelayerTransaction = {
      to: POLYGON_CONTRACTS.CTF,
      data: encodeFunctionData({
        abi: [
          {
            name: 'setApprovalForAll',
            type: 'function',
            inputs: [
              { name: 'operator', type: 'address' },
              { name: 'approved', type: 'bool' },
            ],
            outputs: [],
          },
        ],
        functionName: 'setApprovalForAll',
        args: [exchange, true],
      }),
      value: '0',
    };

    return this.executeWithRetry([usdcApprove, ctfApprove], 'Approve tokens for exchange');
  }

  /**
   * Split USDC into outcome tokens
   */
  async splitPosition(
    conditionId: string,
    amount: number // in USDC (6 decimals)
  ): Promise<RelayerResult> {
    this.ensureInitialized();

    console.log(`[Relayer] Splitting ${amount} USDC for condition ${conditionId}`);

    const amountWei = parseUnits(amount.toString(), 6);

    const tx: RelayerTransaction = {
      to: POLYGON_CONTRACTS.CTF,
      data: encodeFunctionData({
        abi: CTF_ABI,
        functionName: 'splitPosition',
        args: [
          POLYGON_CONTRACTS.USDC,
          '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex,
          conditionId as Hex,
          [1n, 2n], // Binary partition
          amountWei,
        ],
      }),
      value: '0',
    };

    return this.executeWithRetry([tx], 'Split position');
  }

  /**
   * Merge outcome tokens back to USDC
   */
  async mergePositions(
    conditionId: string,
    amount: number // in shares
  ): Promise<RelayerResult> {
    this.ensureInitialized();

    console.log(`[Relayer] Merging ${amount} shares for condition ${conditionId}`);

    const amountWei = parseUnits(amount.toString(), 6);

    const tx: RelayerTransaction = {
      to: POLYGON_CONTRACTS.CTF,
      data: encodeFunctionData({
        abi: CTF_ABI,
        functionName: 'mergePositions',
        args: [
          POLYGON_CONTRACTS.USDC,
          '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex,
          conditionId as Hex,
          [1n, 2n],
          amountWei,
        ],
      }),
      value: '0',
    };

    return this.executeWithRetry([tx], 'Merge positions');
  }

  /**
   * Redeem winning positions after market resolution
   */
  async redeemPositions(conditionId: string): Promise<RelayerResult> {
    this.ensureInitialized();

    console.log(`[Relayer] Redeeming positions for condition ${conditionId}`);

    const tx: RelayerTransaction = {
      to: POLYGON_CONTRACTS.CTF,
      data: encodeFunctionData({
        abi: CTF_ABI,
        functionName: 'redeemPositions',
        args: [
          POLYGON_CONTRACTS.USDC,
          '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex,
          conditionId as Hex,
          [1n, 2n],
        ],
      }),
      value: '0',
    };

    return this.executeWithRetry([tx], 'Redeem positions');
  }

  /**
   * Transfer USDC to another address
   */
  async transferUSDC(to: string, amount: number): Promise<RelayerResult> {
    this.ensureInitialized();

    console.log(`[Relayer] Transferring ${amount} USDC to ${to}`);

    const amountWei = parseUnits(amount.toString(), 6);

    const tx: RelayerTransaction = {
      to: POLYGON_CONTRACTS.USDC,
      data: encodeFunctionData({
        abi: ERC20_ABI,
        functionName: 'transfer',
        args: [to as Hex, amountWei],
      }),
      value: '0',
    };

    return this.executeWithRetry([tx], 'Transfer USDC');
  }

  /**
   * Execute transactions with retry logic
   */
  private async executeWithRetry(
    transactions: RelayerTransaction[],
    description: string,
    attempt = 0
  ): Promise<RelayerResult> {
    try {
      const response = await this.relayClient!.execute(transactions, description);
      const result = await response.wait();

      if (result) {
        return {
          success: true,
          transactionHash: result.transactionHash,
          state: 'STATE_CONFIRMED',
        };
      }

      throw new Error('Execution returned no result');
    } catch (error) {
      console.error(`[Relayer] Execution failed (attempt ${attempt + 1}):`, error);

      if (attempt < this.retryConfig.maxRetries) {
        const delay = this.calculateRetryDelay(attempt);
        console.log(`[Relayer] Retrying in ${delay}ms...`);
        
        await this.sleep(delay);
        return this.executeWithRetry(transactions, description, attempt + 1);
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        state: 'STATE_FAILED',
      };
    }
  }

  /**
   * Execute batch of transactions
   */
  async executeBatch(
    transactions: RelayerTransaction[],
    description: string
  ): Promise<RelayerResult> {
    this.ensureInitialized();
    return this.executeWithRetry(transactions, description);
  }

  /**
   * Calculate retry delay with exponential backoff
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
   * Get proxy wallet address
   */
  getProxyAddress(): string | null {
    return this.proxyAddress;
  }

  /**
   * Check if wallet is deployed
   */
  isWalletDeployed(): boolean {
    return this.walletDeployed;
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}

/**
 * Create a TradingRelayerClient from environment variables
 */
export function createRelayerClientFromEnv(): TradingRelayerClient {
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
    signatureType: 2,
  };

  return new TradingRelayerClient(config);
}

