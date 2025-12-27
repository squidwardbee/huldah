# Railway Deployment Guide

## Context

This project uses Railway for deployment with a PostgreSQL database. The API is an Express.js server that requires specific database tables and columns to exist before startup.

## Problems Encountered & Solutions

### 1. Database Migrations Cannot Run During Build

**Problem**: Railway's internal database DNS (`postgres.railway.internal`) is NOT available during the build phase. Any attempt to connect to the database during `npm run build` will fail with:

```
getaddrinfo ENOTFOUND postgres.railway.internal
```

**Solution**: Keep the build script simple - just compile TypeScript:
```json
{
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js"
  }
}
```

**DO NOT** try to run migrations during build. The database is only accessible at runtime.

### 2. Migrations Must Be Applied Manually or at Runtime

**Problem**: Unlike build time, the database IS accessible at runtime. However, if migrations haven't been applied, the app will crash on startup with errors like:

```
error: relation "wallet_snapshots" does not exist
error: column "markets_traded" of relation "wallets" does not exist
```

**Solutions**:

#### Option A: Run migrations manually before deploying (Recommended)
```bash
# Set DATABASE_URL to your Railway database's public connection string
DATABASE_URL="postgresql://user:pass@host:port/railway" pnpm --filter api db:migrate
```

#### Option B: Add a prestart hook (Use with caution)
```json
{
  "scripts": {
    "prestart": "node dist/scripts/runMigrations.js",
    "start": "node dist/index.js"
  }
}
```
Note: This requires migration files to be copied to `dist/` during build.

### 3. Railway Caches Old Commits

**Problem**: Sometimes Railway deploys from an old cached commit instead of the latest push.

**Symptoms**: Build logs show an old commit message even though you pushed a newer one.

**Solutions**:
- Use `railway up` to push directly from local files (bypasses git)
- Cancel the current build in Railway dashboard and manually trigger a new deployment
- Push an empty commit: `git commit --allow-empty -m "trigger deploy" && git push`

### 4. Missing Tables/Columns Cause Cascading Failures

**Problem**: The app has multiple services (InsiderDetector, WalletObserver, etc.) that query different tables. If any table is missing, that service crashes but the app may partially start.

**Example errors**:
```
relation "wallet_subscriptions" does not exist
column "single_market_wallet" of relation "wallets" does not exist
```

**Solution**: Always ensure ALL migrations are applied before deploying. Check the migration files in `apps/api/src/db/migrations/` to see all required tables and columns.

## Database Schema Dependencies

The migrations have dependencies on each other:

1. `001_init.sql` - Base tables (wallets, trades)
2. `002_lean_schema.sql` - Whale trades, basic wallet fields
3. `003_insider_detection.sql` - Markets, wallet_positions, insider_alerts, adds columns to wallets
4. `004-007` - Trading-related tables
5. `008_wallet_intelligence.sql` - Clusters, snapshots, subscriptions, more wallet columns

**Important**: Migration 003 and 008 add columns to the `wallets` table. If these don't run, the app will fail.

## Quick Fix: Add Missing Schema Manually

If you need to quickly fix a broken deployment, you can add missing tables/columns directly:

```bash
# Connect to Railway database and run SQL
DATABASE_URL="postgresql://..." node -e "
const pg = require('pg');
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Add missing columns
db.query('ALTER TABLE wallets ADD COLUMN IF NOT EXISTS markets_traded INT DEFAULT 0')
  .then(() => db.query('ALTER TABLE wallets ADD COLUMN IF NOT EXISTS single_market_wallet BOOLEAN DEFAULT FALSE'))
  .then(() => console.log('Done'))
  .catch(console.error)
  .finally(() => db.end());
"
```

## Best Practices

1. **Test migrations locally first** against a local PostgreSQL instance
2. **Run migrations against Railway DB before pushing code** that depends on new schema
3. **Keep build script simple** - just `tsc`, no database operations
4. **Use the public DATABASE_URL** for manual migrations (not the internal one)
5. **Check Railway logs immediately after deploy** to catch schema errors early
6. **Don't use `railway up`** for production deploys - prefer git-based deployments for traceability

## Useful Commands

```bash
# Run all migrations against Railway
DATABASE_URL="postgresql://..." pnpm --filter api db:migrate

# Run a single migration
DATABASE_URL="..." npx tsx apps/api/src/scripts/runSingleMigration.ts 008_wallet_intelligence.sql

# Check what tables exist
DATABASE_URL="..." node -e "
const pg = require('pg');
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
db.query(\"SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'\")
  .then(r => console.log(r.rows.map(x => x.table_name).join(', ')))
  .finally(() => db.end());
"

# Force redeploy from Railway CLI
railway redeploy -y
```

## Environment Variables Required

Make sure these are set in Railway:
- `DATABASE_URL` - Automatically set by Railway when you link a PostgreSQL database
- `REDIS_URL` - If using Redis
- `NEWS_API_KEY` - For the news feature
