/**
 * Authentication Flow Tests
 * 
 * Tests the wallet connection and authentication flow including:
 * - Challenge generation
 * - Signature verification
 * - Session management
 * - Error handling
 * 
 * Run with: npx vitest run src/__tests__/auth.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import crypto from 'crypto';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { UserManager, createUserManagerFromEnv } from '../services/trading/userManager.js';

// Test database configuration
const TEST_DB_CONFIG = {
  host: process.env.DB_HOST || 'host.docker.internal',
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER || 'huldah',
  password: process.env.DB_PASSWORD || 'huldah',
  database: process.env.DB_NAME || 'huldah',
};

describe('Authentication Flow', () => {
  let db: Pool;
  let userManager: UserManager;
  
  // Generate a test wallet
  const testPrivateKey = generatePrivateKey();
  const testAccount = privateKeyToAccount(testPrivateKey);
  const testAddress = testAccount.address;

  beforeAll(async () => {
    db = new Pool(TEST_DB_CONFIG);
    userManager = createUserManagerFromEnv(db);
    
    // Verify database connection
    try {
      await db.query('SELECT 1');
    } catch (err) {
      throw new Error(`Database connection failed: ${err}`);
    }
    
    // Verify required tables exist
    const tablesCheck = await db.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('user_nonces', 'user_sessions', 'trading_users')
    `);
    
    const existingTables = tablesCheck.rows.map(r => r.table_name);
    const requiredTables = ['user_nonces', 'user_sessions', 'trading_users'];
    const missingTables = requiredTables.filter(t => !existingTables.includes(t));
    
    if (missingTables.length > 0) {
      throw new Error(
        `Missing required tables: ${missingTables.join(', ')}. ` +
        `Please run migration 005_multi_user_trading.sql`
      );
    }
  });

  afterAll(async () => {
    // Cleanup test data
    await db.query('DELETE FROM user_nonces WHERE eoa_address = $1', [testAddress.toLowerCase()]);
    await db.query('DELETE FROM user_sessions WHERE user_id IN (SELECT id FROM trading_users WHERE eoa_address = $1)', [testAddress.toLowerCase()]);
    await db.query('DELETE FROM trading_users WHERE eoa_address = $1', [testAddress.toLowerCase()]);
    await db.end();
  });

  beforeEach(async () => {
    // Clean up nonces before each test
    await db.query('DELETE FROM user_nonces WHERE eoa_address = $1', [testAddress.toLowerCase()]);
  });

  describe('Challenge Generation', () => {
    it('should generate a valid challenge with nonce', async () => {
      const challenge = await userManager.generateAuthChallenge(testAddress);
      
      expect(challenge).toBeDefined();
      expect(challenge.nonce).toBeDefined();
      expect(challenge.nonce).toHaveLength(64); // 32 bytes hex
      expect(challenge.message).toContain(testAddress.toLowerCase());
      expect(challenge.message).toContain(challenge.nonce);
      expect(challenge.expiresAt).toBeInstanceOf(Date);
      expect(challenge.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('should store nonce in database', async () => {
      const challenge = await userManager.generateAuthChallenge(testAddress);
      
      const result = await db.query(
        'SELECT nonce, expires_at FROM user_nonces WHERE eoa_address = $1',
        [testAddress.toLowerCase()]
      );
      
      expect(result.rows.length).toBe(1);
      expect(result.rows[0].nonce).toBe(challenge.nonce);
    });

    it('should replace existing nonce on subsequent challenge', async () => {
      const challenge1 = await userManager.generateAuthChallenge(testAddress);
      const challenge2 = await userManager.generateAuthChallenge(testAddress);
      
      expect(challenge1.nonce).not.toBe(challenge2.nonce);
      
      const result = await db.query(
        'SELECT nonce FROM user_nonces WHERE eoa_address = $1',
        [testAddress.toLowerCase()]
      );
      
      expect(result.rows.length).toBe(1);
      expect(result.rows[0].nonce).toBe(challenge2.nonce);
    });

    it('should handle mixed case addresses consistently', async () => {
      const mixedCaseAddress = testAddress; // Original has mixed case
      const lowerCaseAddress = testAddress.toLowerCase();
      
      const challenge = await userManager.generateAuthChallenge(mixedCaseAddress);
      
      // Should be stored with lowercase
      const result = await db.query(
        'SELECT nonce FROM user_nonces WHERE eoa_address = $1',
        [lowerCaseAddress]
      );
      
      expect(result.rows.length).toBe(1);
      // Message should also use lowercase
      expect(challenge.message).toContain(lowerCaseAddress);
    });
  });

  describe('Signature Verification', () => {
    it('should authenticate with valid signature', async () => {
      // Get challenge
      const challenge = await userManager.generateAuthChallenge(testAddress);
      
      // Sign message with test wallet
      const signature = await testAccount.signMessage({ message: challenge.message });
      
      // Authenticate
      const session = await userManager.authenticateWithSignature(
        testAddress,
        signature,
        '127.0.0.1',
        'test-agent'
      );
      
      expect(session).toBeDefined();
      expect(session).not.toBeNull();
      expect(session!.token).toBeDefined();
      expect(session!.eoaAddress).toBe(testAddress.toLowerCase());
      expect(session!.expiresAt).toBeInstanceOf(Date);
    });

    it('should reject invalid signature', async () => {
      const challenge = await userManager.generateAuthChallenge(testAddress);
      
      // Generate signature from different wallet
      const otherKey = generatePrivateKey();
      const otherAccount = privateKeyToAccount(otherKey);
      const wrongSignature = await otherAccount.signMessage({ message: challenge.message });
      
      const session = await userManager.authenticateWithSignature(
        testAddress,
        wrongSignature,
        '127.0.0.1'
      );
      
      expect(session).toBeNull();
    });

    it('should reject when no challenge requested', async () => {
      // Sign arbitrary message without requesting challenge
      const signature = await testAccount.signMessage({ message: 'arbitrary message' });
      
      const session = await userManager.authenticateWithSignature(
        testAddress,
        signature,
        '127.0.0.1'
      );
      
      expect(session).toBeNull();
    });

    it('should reject expired nonce', async () => {
      const challenge = await userManager.generateAuthChallenge(testAddress);
      
      // Manually expire the nonce
      await db.query(
        'UPDATE user_nonces SET expires_at = NOW() - INTERVAL \'1 minute\' WHERE eoa_address = $1',
        [testAddress.toLowerCase()]
      );
      
      const signature = await testAccount.signMessage({ message: challenge.message });
      
      const session = await userManager.authenticateWithSignature(
        testAddress,
        signature,
        '127.0.0.1'
      );
      
      expect(session).toBeNull();
    });

    it('should reject already-used nonce', async () => {
      const challenge = await userManager.generateAuthChallenge(testAddress);
      const signature = await testAccount.signMessage({ message: challenge.message });
      
      // First authentication should succeed
      const session1 = await userManager.authenticateWithSignature(
        testAddress,
        signature,
        '127.0.0.1'
      );
      expect(session1).not.toBeNull();
      
      // Second authentication with same signature should fail (nonce deleted)
      const session2 = await userManager.authenticateWithSignature(
        testAddress,
        signature,
        '127.0.0.1'
      );
      expect(session2).toBeNull();
    });

    it('should delete nonce after successful authentication', async () => {
      const challenge = await userManager.generateAuthChallenge(testAddress);
      const signature = await testAccount.signMessage({ message: challenge.message });
      
      await userManager.authenticateWithSignature(testAddress, signature, '127.0.0.1');
      
      const result = await db.query(
        'SELECT * FROM user_nonces WHERE eoa_address = $1',
        [testAddress.toLowerCase()]
      );
      
      expect(result.rows.length).toBe(0);
    });
  });

  describe('Session Management', () => {
    it('should create valid session token', async () => {
      const challenge = await userManager.generateAuthChallenge(testAddress);
      const signature = await testAccount.signMessage({ message: challenge.message });
      
      const session = await userManager.authenticateWithSignature(
        testAddress,
        signature,
        '127.0.0.1'
      );
      
      expect(session).not.toBeNull();
      expect(session!.token).toHaveLength(64); // 32 bytes hex
    });

    it('should validate active session', async () => {
      const challenge = await userManager.generateAuthChallenge(testAddress);
      const signature = await testAccount.signMessage({ message: challenge.message });
      
      const session = await userManager.authenticateWithSignature(
        testAddress,
        signature,
        '127.0.0.1'
      );
      
      const user = await userManager.validateSession(session!.token);
      
      expect(user).not.toBeNull();
      expect(user!.eoaAddress).toBe(testAddress.toLowerCase());
    });

    it('should reject invalid session token', async () => {
      const fakeToken = crypto.randomBytes(32).toString('hex');
      const user = await userManager.validateSession(fakeToken);
      
      expect(user).toBeNull();
    });

    it('should invalidate session on logout', async () => {
      const challenge = await userManager.generateAuthChallenge(testAddress);
      const signature = await testAccount.signMessage({ message: challenge.message });
      
      const session = await userManager.authenticateWithSignature(
        testAddress,
        signature,
        '127.0.0.1'
      );
      
      // Validate session works
      const userBefore = await userManager.validateSession(session!.token);
      expect(userBefore).not.toBeNull();
      
      // Invalidate session
      await userManager.invalidateSession(session!.token);
      
      // Should no longer validate
      const userAfter = await userManager.validateSession(session!.token);
      expect(userAfter).toBeNull();
    });
  });

  describe('User Management', () => {
    it('should create user on first authentication', async () => {
      // Use a fresh address for this test
      const newKey = generatePrivateKey();
      const newAccount = privateKeyToAccount(newKey);
      const newAddress = newAccount.address;
      
      const challenge = await userManager.generateAuthChallenge(newAddress);
      const signature = await newAccount.signMessage({ message: challenge.message });
      
      const session = await userManager.authenticateWithSignature(
        newAddress,
        signature,
        '127.0.0.1'
      );
      
      expect(session).not.toBeNull();
      
      const user = await userManager.getUserByAddress(newAddress);
      expect(user).not.toBeNull();
      expect(user!.eoaAddress).toBe(newAddress.toLowerCase());
      
      // Cleanup
      await db.query('DELETE FROM user_sessions WHERE user_id = $1', [user!.id]);
      await db.query('DELETE FROM trading_users WHERE id = $1', [user!.id]);
    });

    it('should return existing user on subsequent authentication', async () => {
      // First auth
      const challenge1 = await userManager.generateAuthChallenge(testAddress);
      const signature1 = await testAccount.signMessage({ message: challenge1.message });
      const session1 = await userManager.authenticateWithSignature(
        testAddress,
        signature1,
        '127.0.0.1'
      );
      
      // Second auth
      const challenge2 = await userManager.generateAuthChallenge(testAddress);
      const signature2 = await testAccount.signMessage({ message: challenge2.message });
      const session2 = await userManager.authenticateWithSignature(
        testAddress,
        signature2,
        '127.0.0.1'
      );
      
      expect(session1!.userId).toBe(session2!.userId);
    });
  });
});

describe('API Endpoint Integration', () => {
  // These tests would require a running server
  // In a real setup, use supertest or similar
  
  it.skip('POST /api/auth/challenge should return valid challenge', async () => {
    // Integration test placeholder
  });

  it.skip('POST /api/auth/login should authenticate with valid signature', async () => {
    // Integration test placeholder
  });

  it.skip('POST /api/auth/login should return 401 for invalid signature', async () => {
    // Integration test placeholder
  });
});

