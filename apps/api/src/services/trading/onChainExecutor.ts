/**
 * On-Chain Executor (Fallback)
 * 
 * Direct on-chain execution when relayer fails.
 * User pays gas fees but trades still execute.
 */

import {
  createWalletClient,
  createPublicClient,
  http,
  Hex,
  encodeFunctionData,
  parseUnits,
  formatUnits,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { polygon } from 'viem/chains';
import {
  TradingConfig,
  POLYGON_CONTRACTS,
  DEFAULT_RETRY_CONFIG,
  RetryConfig,
} from '../../types/trading.js';

export interface OnChainResult {
  success: boolean;
  transactionHash?: string;
  gasUsed?: string;
  error?: string;
}

// ERC20 ABI
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
  {
    name: 'allowance',
    type: 'function',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
] as const;

// CTF Exchange ABI (simplified for order execution)
const CTF_EXCHANGE_ABI = [
  {
    name: 'fillOrder',
    type: 'function',
    inputs: [
      {
        name: 'order',
        type: 'tuple',
        components: [
          { name: 'salt', type: 'uint256' },
          { name: 'maker', type: 'address' },
          { name: 'signer', type: 'address' },
          { name: 'taker', type: 'address' },
          { name: 'tokenId', type: 'uint256' },
          { name: 'makerAmount', type: 'uint256' },
          { name: 'takerAmount', type: 'uint256' },
          { name: 'expiration', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
          { name: 'feeRateBps', type: 'uint256' },
          { name: 'side', type: 'uint8' },
          { name: 'signatureType', type: 'uint8' },
        ],
      },
      { name: 'fillAmount', type: 'uint256' },
    ],
    outputs: [],
  },
] as const;

export class OnChainExecutor {
  private walletClient: ReturnType<typeof createWalletClient> | null = null;
  private publicClient: ReturnType<typeof createPublicClient> | null = null;
  private config: TradingConfig;
  private retryConfig: RetryConfig;
  private account: ReturnType<typeof privateKeyToAccount> | null = null;
  private initialized = false;

  constructor(config: TradingConfig, retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG) {
    this.config = config;
    this.retryConfig = retryConfig;
  }

  /**
   * Initialize the on-chain executor
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    console.log('[OnChain] Initializing executor...');

    try {
      this.account = privateKeyToAccount(this.config.privateKey as Hex);
      
      this.walletClient = createWalletClient({
        account: this.account,
        chain: polygon,
        transport: http(this.config.rpcUrl),
      });

      this.publicClient = createPublicClient({
        chain: polygon,
        transport: http(this.config.rpcUrl),
      });

      this.initialized = true;
      console.log('[OnChain] Executor initialized');
    } catch (error) {
      console.error('[OnChain] Failed to initialize:', error);
      throw error;
    }
  }

  /**
   * Ensure executor is initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized || !this.walletClient || !this.publicClient || !this.account) {
      throw new Error('OnChain executor not initialized. Call initialize() first.');
    }
  }

  /**
   * Get USDC balance
   */
  async getUSDCBalance(): Promise<number> {
    this.ensureInitialized();

    try {
      const balance = await this.publicClient!.readContract({
        address: POLYGON_CONTRACTS.USDC as Hex,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [this.account!.address],
      });

      return parseFloat(formatUnits(balance as bigint, 6));
    } catch (error) {
      console.error('[OnChain] Error getting balance:', error);
      return 0;
    }
  }

  /**
   * Get MATIC balance for gas
   */
  async getMaticBalance(): Promise<number> {
    this.ensureInitialized();

    try {
      const balance = await this.publicClient!.getBalance({
        address: this.account!.address,
      });

      return parseFloat(formatUnits(balance, 18));
    } catch (error) {
      console.error('[OnChain] Error getting MATIC balance:', error);
      return 0;
    }
  }

  /**
   * Approve USDC spending
   */
  async approveUSDC(spender: string, amount: bigint): Promise<OnChainResult> {
    this.ensureInitialized();

    console.log(`[OnChain] Approving USDC for ${spender}...`);

    try {
      const hash = await this.walletClient!.writeContract({
        chain: polygon,
        account: this.account!,
        address: POLYGON_CONTRACTS.USDC as Hex,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [spender as Hex, amount],
      });

      console.log(`[OnChain] Approval tx: ${hash}`);

      // Wait for confirmation
      const receipt = await this.publicClient!.waitForTransactionReceipt({
        hash,
        confirmations: 3,
      });

      return {
        success: receipt.status === 'success',
        transactionHash: hash,
        gasUsed: receipt.gasUsed.toString(),
      };
    } catch (error) {
      console.error('[OnChain] Approval failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Transfer USDC
   */
  async transferUSDC(to: string, amount: number): Promise<OnChainResult> {
    this.ensureInitialized();

    console.log(`[OnChain] Transferring ${amount} USDC to ${to}...`);

    try {
      const amountWei = parseUnits(amount.toString(), 6);

      const hash = await this.walletClient!.writeContract({
        chain: polygon,
        account: this.account!,
        address: POLYGON_CONTRACTS.USDC as Hex,
        abi: ERC20_ABI,
        functionName: 'transfer',
        args: [to as Hex, amountWei],
      });

      console.log(`[OnChain] Transfer tx: ${hash}`);

      const receipt = await this.publicClient!.waitForTransactionReceipt({
        hash,
        confirmations: 3,
      });

      return {
        success: receipt.status === 'success',
        transactionHash: hash,
        gasUsed: receipt.gasUsed.toString(),
      };
    } catch (error) {
      console.error('[OnChain] Transfer failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Execute raw transaction
   */
  async executeRaw(
    to: string,
    data: string,
    value = '0'
  ): Promise<OnChainResult> {
    this.ensureInitialized();

    console.log(`[OnChain] Executing raw tx to ${to}...`);

    try {
      const hash = await this.walletClient!.sendTransaction({
        chain: polygon,
        account: this.account!,
        to: to as Hex,
        data: data as Hex,
        value: BigInt(value),
      });

      console.log(`[OnChain] Raw tx: ${hash}`);

      const receipt = await this.publicClient!.waitForTransactionReceipt({
        hash,
        confirmations: 3,
      });

      return {
        success: receipt.status === 'success',
        transactionHash: hash,
        gasUsed: receipt.gasUsed.toString(),
      };
    } catch (error) {
      console.error('[OnChain] Raw tx failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Check if we have enough gas
   */
  async hasEnoughGas(minMatic = 0.01): Promise<boolean> {
    const balance = await this.getMaticBalance();
    return balance >= minMatic;
  }

  /**
   * Estimate gas for a transaction
   */
  async estimateGas(to: string, data: string): Promise<bigint | null> {
    this.ensureInitialized();

    try {
      const gas = await this.publicClient!.estimateGas({
        account: this.account!.address,
        to: to as Hex,
        data: data as Hex,
      });
      return gas;
    } catch (error) {
      console.error('[OnChain] Gas estimation failed:', error);
      return null;
    }
  }

  /**
   * Get wallet address
   */
  getAddress(): string {
    if (!this.account) throw new Error('Not initialized');
    return this.account.address;
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}

/**
 * Create an OnChainExecutor from environment variables
 */
export function createOnChainExecutorFromEnv(): OnChainExecutor {
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

  return new OnChainExecutor(config);
}


