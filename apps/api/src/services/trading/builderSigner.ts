/**
 * Builder Signer Service
 * 
 * Handles HMAC signing for Polymarket Builder authentication.
 * Used by both CLOB client and Relayer client.
 */

import crypto from 'crypto';
import { BuilderCredentials } from '../../types/trading.js';

export interface SignatureHeaders {
  'POLY-BUILDER-API-KEY': string;
  'POLY-BUILDER-TIMESTAMP': string;
  'POLY-BUILDER-PASSPHRASE': string;
  'POLY-BUILDER-SIGNATURE': string;
}

export class BuilderSigner {
  private credentials: BuilderCredentials;

  constructor(credentials: BuilderCredentials) {
    this.credentials = credentials;
    this.validateCredentials();
  }

  /**
   * Validate that all credentials are present
   */
  private validateCredentials(): void {
    if (!this.credentials.key) {
      throw new Error('Builder API key is required');
    }
    if (!this.credentials.secret) {
      throw new Error('Builder secret is required');
    }
    if (!this.credentials.passphrase) {
      throw new Error('Builder passphrase is required');
    }
  }

  /**
   * Build HMAC signature for a request
   * 
   * The signature is computed as:
   * HMAC-SHA256(secret, timestamp + method + path + body)
   */
  buildSignature(
    timestamp: number,
    method: string,
    path: string,
    body: string = ''
  ): string {
    const message = `${timestamp}${method.toUpperCase()}${path}${body}`;
    
    const hmac = crypto.createHmac('sha256', this.credentials.secret);
    hmac.update(message);
    
    return hmac.digest('base64');
  }

  /**
   * Generate all authentication headers for a request
   */
  getAuthHeaders(
    method: string,
    path: string,
    body: string = ''
  ): SignatureHeaders {
    const timestamp = Date.now();
    const signature = this.buildSignature(timestamp, method, path, body);

    return {
      'POLY-BUILDER-API-KEY': this.credentials.key,
      'POLY-BUILDER-TIMESTAMP': timestamp.toString(),
      'POLY-BUILDER-PASSPHRASE': this.credentials.passphrase,
      'POLY-BUILDER-SIGNATURE': signature,
    };
  }

  /**
   * Sign a request payload (for remote signing endpoint compatibility)
   */
  signRequest(request: {
    method: string;
    path: string;
    body?: string;
  }): {
    POLY_BUILDER_SIGNATURE: string;
    POLY_BUILDER_TIMESTAMP: string;
    POLY_BUILDER_API_KEY: string;
    POLY_BUILDER_PASSPHRASE: string;
  } {
    const timestamp = Date.now();
    const signature = this.buildSignature(
      timestamp,
      request.method,
      request.path,
      request.body || ''
    );

    return {
      POLY_BUILDER_SIGNATURE: signature,
      POLY_BUILDER_TIMESTAMP: timestamp.toString(),
      POLY_BUILDER_API_KEY: this.credentials.key,
      POLY_BUILDER_PASSPHRASE: this.credentials.passphrase,
    };
  }

  /**
   * Get the API key (for logging/debugging - never log secret!)
   */
  getApiKey(): string {
    return this.credentials.key;
  }

  /**
   * Check if credentials are configured
   */
  isConfigured(): boolean {
    return !!(
      this.credentials.key &&
      this.credentials.secret &&
      this.credentials.passphrase
    );
  }
}

/**
 * Create a BuilderSigner from environment variables
 */
export function createBuilderSignerFromEnv(): BuilderSigner {
  const credentials: BuilderCredentials = {
    key: process.env.POLY_BUILDER_API_KEY || '',
    secret: process.env.POLY_BUILDER_SECRET || '',
    passphrase: process.env.POLY_BUILDER_PASSPHRASE || '',
  };

  return new BuilderSigner(credentials);
}

