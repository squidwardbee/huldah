/**
 * Database Check Script
 * 
 * Verifies that all required database tables exist and are properly set up
 * for the trading terminal authentication flow.
 * 
 * Run with: pnpm --filter api db:check
 */

import 'dotenv/config';
import { Pool } from 'pg';

const DB_HOST = process.env.DB_HOST || 'host.docker.internal';
const db = new Pool({
  host: DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER || 'huldah',
  password: process.env.DB_PASSWORD || 'huldah',
  database: process.env.DB_NAME || 'huldah',
});

interface TableCheck {
  name: string;
  migration: string;
  required: boolean;
}

const requiredTables: TableCheck[] = [
  { name: 'wallets', migration: '001_init.sql', required: true },
  { name: 'whale_trades', migration: '001_init.sql', required: true },
  { name: 'markets', migration: '001_init.sql or 002_lean_schema.sql', required: true },
  { name: 'insider_scores', migration: '003_insider_detection.sql', required: false },
  { name: 'trading_orders', migration: '004_trading_orders.sql', required: true },
  { name: 'trading_stats', migration: '004_trading_orders.sql', required: true },
  { name: 'trading_users', migration: '005_multi_user_trading.sql', required: true },
  { name: 'user_sessions', migration: '005_multi_user_trading.sql', required: true },
  { name: 'user_nonces', migration: '005_multi_user_trading.sql', required: true },
  { name: 'user_positions', migration: '005_multi_user_trading.sql', required: false },
  { name: 'user_pending_operations', migration: '005_multi_user_trading.sql', required: false },
];

async function checkDatabase() {
  console.log('🔍 Checking database connection and tables...\n');
  console.log(`   Host: ${DB_HOST}`);
  console.log(`   Database: ${process.env.DB_NAME || 'huldah'}\n`);

  // Test connection
  try {
    await db.query('SELECT 1');
    console.log('✅ Database connection successful\n');
  } catch (err: any) {
    console.error('❌ Database connection failed:', err.message);
    console.log('\n   Make sure Docker is running and the postgres container is up:');
    console.log('   docker-compose up -d postgres\n');
    process.exit(1);
  }

  // Check tables
  const tablesResult = await db.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public'
    ORDER BY table_name
  `);
  
  const existingTables = new Set(tablesResult.rows.map(r => r.table_name));
  
  console.log('📋 Table Status:\n');
  
  let hasErrors = false;
  const missingRequired: string[] = [];
  const missingOptional: string[] = [];
  
  for (const table of requiredTables) {
    const exists = existingTables.has(table.name);
    const status = exists 
      ? '✅' 
      : (table.required ? '❌' : '⚠️');
    
    console.log(`   ${status} ${table.name.padEnd(25)} (${table.migration})`);
    
    if (!exists) {
      if (table.required) {
        missingRequired.push(table.name);
        hasErrors = true;
      } else {
        missingOptional.push(table.name);
      }
    }
  }

  console.log('\n');

  // Authentication-specific checks
  console.log('🔐 Authentication Tables Check:\n');
  
  const authTables = ['user_nonces', 'user_sessions', 'trading_users'];
  const missingAuthTables = authTables.filter(t => !existingTables.has(t));
  
  if (missingAuthTables.length > 0) {
    console.log('   ❌ Missing authentication tables:', missingAuthTables.join(', '));
    console.log('\n   👉 The wallet connection will NOT work until you run:');
    console.log('   docker exec -i huldah-postgres-1 psql -U huldah -d huldah < apps/api/src/db/migrations/005_multi_user_trading.sql\n');
  } else {
    console.log('   ✅ All authentication tables exist');
    
    // Check for any nonces or sessions
    const nonceCount = await db.query('SELECT COUNT(*) FROM user_nonces');
    const sessionCount = await db.query('SELECT COUNT(*) FROM user_sessions');
    const userCount = await db.query('SELECT COUNT(*) FROM trading_users');
    
    console.log(`\n   📊 Stats:`);
    console.log(`      - Active nonces: ${nonceCount.rows[0].count}`);
    console.log(`      - Active sessions: ${sessionCount.rows[0].count}`);
    console.log(`      - Registered users: ${userCount.rows[0].count}`);
  }

  console.log('\n');

  if (hasErrors) {
    console.log('❌ Database is not fully set up. Missing required tables:\n');
    for (const table of missingRequired) {
      const info = requiredTables.find(t => t.name === table);
      console.log(`   - ${table} (run ${info?.migration})`);
    }
    console.log('\n   To apply all migrations, run:');
    console.log('   pnpm --filter api db:migrate\n');
    process.exit(1);
  } else {
    console.log('✅ All required tables exist!\n');
    
    if (missingOptional.length > 0) {
      console.log('   ⚠️  Some optional tables are missing:', missingOptional.join(', '));
      console.log('      These are not required for basic functionality.\n');
    }
  }

  await db.end();
}

checkDatabase().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});


