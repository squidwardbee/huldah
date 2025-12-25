/**
 * Credential Store
 *
 * Securely stores and retrieves user CLOB API credentials using AES-256-GCM encryption.
 *
 * Security considerations:
 * - Credentials encrypted at rest with AES-256-GCM
 * - Unique IV per credential (stored with ciphertext)
 * - Auth tag prevents tampering
 * - Encryption key from environment variable
 * - Credentials only decrypted at order execution time
 */

import crypto from 'crypto';
import { Pool } from 'pg';
import { UserApiCredentials } from '../../types/trading.js';

// Encryption configuration
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32; // 256 bits

export class CredentialStore {
  private db: Pool;
  private encryptionKey: Buffer;

  constructor(db: Pool) {
    this.db = db;

    // Get encryption key from environment
    const keyHex = process.env.CREDENTIAL_ENCRYPTION_KEY;
    if (!keyHex) {
      console.warn('[CredentialStore] ⚠️ CREDENTIAL_ENCRYPTION_KEY not set - credential storage disabled');
      console.warn('[CredentialStore] Generate with: openssl rand -hex 32');
      this.encryptionKey = Buffer.alloc(KEY_LENGTH); // Null key - will fail on use
    } else if (keyHex.length !== KEY_LENGTH * 2) {
      throw new Error(`CREDENTIAL_ENCRYPTION_KEY must be ${KEY_LENGTH * 2} hex characters (${KEY_LENGTH} bytes)`);
    } else {
      this.encryptionKey = Buffer.from(keyHex, 'hex');
    }
  }

  /**
   * Check if encryption is properly configured
   */
  isConfigured(): boolean {
    return !this.encryptionKey.equals(Buffer.alloc(KEY_LENGTH));
  }

  /**
   * Encrypt credentials
   * Returns base64 encoded string: IV + AuthTag + Ciphertext
   */
  encrypt(credentials: UserApiCredentials): string {
    if (!this.isConfigured()) {
      throw new Error('Credential encryption not configured - set CREDENTIAL_ENCRYPTION_KEY');
    }

    // Generate random IV
    const iv = crypto.randomBytes(IV_LENGTH);

    // Create cipher
    const cipher = crypto.createCipheriv(ALGORITHM, this.encryptionKey, iv);

    // Encrypt credentials as JSON
    const plaintext = JSON.stringify(credentials);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final()
    ]);

    // Get auth tag
    const authTag = cipher.getAuthTag();

    // Combine: IV + AuthTag + Ciphertext
    const combined = Buffer.concat([iv, authTag, encrypted]);

    return combined.toString('base64');
  }

  /**
   * Decrypt credentials
   * Expects base64 encoded string: IV + AuthTag + Ciphertext
   */
  decrypt(encryptedBase64: string): UserApiCredentials {
    if (!this.isConfigured()) {
      throw new Error('Credential encryption not configured - set CREDENTIAL_ENCRYPTION_KEY');
    }

    // Decode from base64
    const combined = Buffer.from(encryptedBase64, 'base64');

    // Extract components
    const iv = combined.subarray(0, IV_LENGTH);
    const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    // Create decipher
    const decipher = crypto.createDecipheriv(ALGORITHM, this.encryptionKey, iv);
    decipher.setAuthTag(authTag);

    // Decrypt
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final()
    ]);

    // Parse JSON
    return JSON.parse(decrypted.toString('utf8'));
  }

  /**
   * Store encrypted credentials for a user
   */
  async store(userId: number, credentials: UserApiCredentials): Promise<void> {
    // Validate credentials format
    if (!credentials.apiKey || !credentials.apiSecret || !credentials.apiPassphrase) {
      throw new Error('Invalid credentials: apiKey, apiSecret, and apiPassphrase are required');
    }

    // Encrypt
    const encrypted = this.encrypt(credentials);

    // Store in database
    await this.db.query(`
      INSERT INTO user_api_credentials (user_id, encrypted_credentials, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (user_id) DO UPDATE SET
        encrypted_credentials = $2,
        updated_at = NOW()
    `, [userId, encrypted]);

    console.log(`[CredentialStore] Credentials stored for user ${userId}`);
  }

  /**
   * Retrieve and decrypt credentials for a user
   */
  async retrieve(userId: number): Promise<UserApiCredentials | null> {
    const result = await this.db.query(`
      SELECT encrypted_credentials FROM user_api_credentials
      WHERE user_id = $1
    `, [userId]);

    if (result.rows.length === 0) {
      return null;
    }

    try {
      return this.decrypt(result.rows[0].encrypted_credentials);
    } catch (error) {
      console.error(`[CredentialStore] Failed to decrypt credentials for user ${userId}:`, error);
      return null;
    }
  }

  /**
   * Check if user has stored credentials
   */
  async hasCredentials(userId: number): Promise<boolean> {
    const result = await this.db.query(`
      SELECT 1 FROM user_api_credentials WHERE user_id = $1
    `, [userId]);

    return result.rows.length > 0;
  }

  /**
   * Delete credentials for a user
   */
  async delete(userId: number): Promise<void> {
    await this.db.query(`
      DELETE FROM user_api_credentials WHERE user_id = $1
    `, [userId]);

    console.log(`[CredentialStore] Credentials deleted for user ${userId}`);
  }

  /**
   * Validate credentials by attempting to use them with CLOB
   * This doesn't store them - just tests if they work
   */
  async validate(credentials: UserApiCredentials): Promise<{ valid: boolean; error?: string }> {
    // For now, just check format
    // TODO: Actually test against CLOB API
    if (!credentials.apiKey || credentials.apiKey.length < 10) {
      return { valid: false, error: 'API Key appears invalid' };
    }
    if (!credentials.apiSecret || credentials.apiSecret.length < 10) {
      return { valid: false, error: 'API Secret appears invalid' };
    }
    if (!credentials.apiPassphrase || credentials.apiPassphrase.length < 1) {
      return { valid: false, error: 'API Passphrase is required' };
    }

    return { valid: true };
  }
}

/**
 * Create CredentialStore instance
 */
export function createCredentialStore(db: Pool): CredentialStore {
  return new CredentialStore(db);
}
