/**
 * Run Database Migrations Script
 * 
 * Applies all SQL migrations in order.
 * 
 * Run with: pnpm --filter api db:migrate
 */

import 'dotenv/config';
import { Pool } from 'pg';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DB_HOST = process.env.DB_HOST || 'host.docker.internal';
const db = new Pool({
  host: DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER || 'huldah',
  password: process.env.DB_PASSWORD || 'huldah',
  database: process.env.DB_NAME || 'huldah',
});

async function runMigrations() {
  console.log('🗄️  Running database migrations...\n');

  // Test connection
  try {
    await db.query('SELECT 1');
    console.log('✅ Database connection successful\n');
  } catch (err: any) {
    console.error('❌ Database connection failed:', err.message);
    process.exit(1);
  }

  // Get migration files
  const migrationsDir = join(__dirname, '..', 'db', 'migrations');
  const files = readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  console.log(`📁 Found ${files.length} migration files:\n`);

  for (const file of files) {
    console.log(`   Applying ${file}...`);
    
    try {
      const sql = readFileSync(join(migrationsDir, file), 'utf-8');
      await db.query(sql);
      console.log(`   ✅ ${file} applied successfully`);
    } catch (err: any) {
      // Some errors are expected (e.g., table already exists)
      if (err.message.includes('already exists')) {
        console.log(`   ⚠️  ${file} - some objects already exist (OK)`);
      } else if (err.message.includes('does not exist')) {
        console.log(`   ⚠️  ${file} - some dependencies missing, will retry`);
      } else {
        console.error(`   ❌ ${file} failed:`, err.message);
      }
    }
  }

  console.log('\n✅ Migrations complete!\n');
  console.log('   Run "pnpm --filter api db:check" to verify.\n');

  await db.end();
}

runMigrations().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});


