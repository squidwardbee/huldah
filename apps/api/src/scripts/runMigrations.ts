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

// Support DATABASE_URL (Railway/Heroku) or individual vars
const db = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  : new Pool({
      host: process.env.DB_HOST || 'host.docker.internal',
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

  // Track files that need retry
  let pendingFiles = [...files];
  let maxPasses = 5;
  let pass = 1;

  while (pendingFiles.length > 0 && pass <= maxPasses) {
    if (pass > 1) {
      console.log(`\n🔄 Retry pass ${pass} for ${pendingFiles.length} remaining files...\n`);
    }

    const stillPending: string[] = [];

    for (const file of pendingFiles) {
      console.log(`   Applying ${file}...`);

      try {
        const sql = readFileSync(join(migrationsDir, file), 'utf-8');
        await db.query(sql);
        console.log(`   ✅ ${file} applied successfully`);
      } catch (err: any) {
        // Some errors are expected (e.g., table already exists)
        if (err.message.includes('already exists')) {
          console.log(`   ⚠️  ${file} - some objects already exist (OK)`);
        } else if (err.message.includes('does not exist') || err.message.includes('violates foreign key')) {
          console.log(`   ⏳ ${file} - dependencies missing, will retry`);
          if (pass === maxPasses) {
            console.log(`      Error: ${err.message}`);
          }
          stillPending.push(file);
        } else {
          console.error(`   ❌ ${file} failed:`, err.message);
          // Still try to retry if it's a dependency issue
          if (pass < maxPasses) {
            stillPending.push(file);
          }
        }
      }
    }

    pendingFiles = stillPending;
    pass++;
  }

  if (pendingFiles.length > 0) {
    console.log(`\n⚠️  Warning: ${pendingFiles.length} migrations could not be applied:`);
    pendingFiles.forEach(f => console.log(`   - ${f}`));
  }

  console.log('\n✅ Migrations complete!\n');
  console.log('   Run "pnpm --filter api db:check" to verify.\n');

  await db.end();
}

runMigrations().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});


