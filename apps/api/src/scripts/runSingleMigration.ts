import 'dotenv/config';
import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const db = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  : new Pool({
      host: process.env.DB_HOST || 'host.docker.internal',
      port: parseInt(process.env.DB_PORT || '5432'),
      user: process.env.DB_USER || 'huldah',
      password: process.env.DB_PASSWORD || 'huldah',
      database: process.env.DB_NAME || 'huldah',
    });

async function run() {
  const migrationFile = process.argv[2];
  if (!migrationFile) {
    console.error('Usage: tsx runSingleMigration.ts <migration_file>');
    process.exit(1);
  }

  console.log(`Running migration: ${migrationFile}`);

  try {
    await db.query('SELECT 1');
    console.log('Connected to database');

    const sql = readFileSync(join(__dirname, '..', 'db', 'migrations', migrationFile), 'utf-8');

    // Split by semicolons to run statements individually
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    for (const stmt of statements) {
      try {
        await db.query(stmt);
        console.log('✅ Executed statement');
      } catch (err: any) {
        if (err.message.includes('already exists')) {
          console.log('⚠️  Already exists, skipping');
        } else {
          console.error('❌ Error:', err.message);
        }
      }
    }

    console.log('Done!');
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await db.end();
  }
}

run();
