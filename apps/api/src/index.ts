import 'dotenv/config';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { Pool } from 'pg';
import Redis from 'ioredis';
import cors from 'cors';
import { TradePoller } from './services/tradePoller.js';
import { HistoricalBackfill } from './services/historicalBackfill.js';

const app = express();
app.use(cors());
app.use(express.json());

// Database - use host.docker.internal for WSL -> Docker Desktop connectivity
const DB_HOST = process.env.DB_HOST || 'host.docker.internal';
const db = new Pool({
  host: DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER || 'huldah',
  password: process.env.DB_PASSWORD || 'huldah',
  database: process.env.DB_NAME || 'huldah'
});

// Redis - use host.docker.internal for WSL -> Docker Desktop connectivity
const REDIS_HOST = process.env.REDIS_HOST || 'host.docker.internal';
const redis = new Redis({ host: REDIS_HOST, port: 6379 });
const redisSub = new Redis({ host: REDIS_HOST, port: 6379 });

// Routes
app.get('/api/whales', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
  
  const { rows } = await db.query(`
    SELECT t.*, m.question, m.slug
    FROM trades t
    LEFT JOIN markets m ON t.market_id = m.condition_id
    WHERE t.is_whale = true
    ORDER BY t.timestamp DESC
    LIMIT $1
  `, [limit]);
  
  res.json(rows);
});

app.get('/api/wallets/top', async (_req, res) => {
  const { rows } = await db.query(`
    SELECT address, total_trades, total_volume, win_count, loss_count, realized_pnl,
           CASE WHEN (win_count + loss_count) > 0 
                THEN win_count::float / (win_count + loss_count) 
                ELSE 0 END as win_rate
    FROM wallets
    ORDER BY total_volume DESC
    LIMIT 50
  `);
  
  res.json(rows);
});

app.get('/api/wallets/:address', async (req, res) => {
  const { address } = req.params;
  
  const wallet = await db.query(`SELECT * FROM wallets WHERE address = $1`, [address]);
  const trades = await db.query(`
    SELECT t.*, m.question
    FROM trades t
    LEFT JOIN markets m ON t.market_id = m.condition_id
    WHERE t.wallet_address = $1
    ORDER BY t.timestamp DESC
    LIMIT 100
  `, [address]);
  
  res.json({
    wallet: wallet.rows[0],
    trades: trades.rows
  });
});

app.get('/api/markets', async (_req, res) => {
  const { rows } = await db.query(`
    SELECT * FROM markets
    WHERE resolved = false
    ORDER BY volume DESC
    LIMIT 100
  `);
  res.json(rows);
});

// Backfill service
const backfill = new HistoricalBackfill(db);

// Backfill endpoints
app.post('/api/backfill/trades', async (req, res) => {
  const days = parseInt(req.query.days as string) || 30;
  
  if (backfill.getStatus().isRunning) {
    return res.status(409).json({ error: 'Backfill already running', status: backfill.getStatus() });
  }
  
  // Start backfill in background
  backfill.backfillTrades(days).catch(console.error);
  
  res.json({ message: `Started trade backfill for ${days} days`, status: backfill.getStatus() });
});

app.post('/api/backfill/markets', async (_req, res) => {
  if (backfill.getStatus().isRunning) {
    return res.status(409).json({ error: 'Backfill already running', status: backfill.getStatus() });
  }
  
  backfill.backfillMarkets().catch(console.error);
  
  res.json({ message: 'Started market backfill' });
});

app.get('/api/backfill/status', (_req, res) => {
  res.json(backfill.getStatus());
});

app.post('/api/backfill/stop', (_req, res) => {
  backfill.stop();
  res.json({ message: 'Backfill stopped', status: backfill.getStatus() });
});

// Stats endpoint
app.get('/api/stats', async (_req, res) => {
  const [trades, wallets, whales, markets] = await Promise.all([
    db.query('SELECT COUNT(*) as count, SUM(usd_value) as volume FROM trades'),
    db.query('SELECT COUNT(*) as count FROM wallets'),
    db.query('SELECT COUNT(*) as count FROM trades WHERE is_whale = true'),
    db.query('SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE resolved = true) as resolved FROM markets')
  ]);
  
  res.json({
    trades: {
      count: parseInt(trades.rows[0].count),
      volume: parseFloat(trades.rows[0].volume) || 0
    },
    wallets: parseInt(wallets.rows[0].count),
    whaleTrades: parseInt(whales.rows[0].count),
    markets: {
      total: parseInt(markets.rows[0].total),
      resolved: parseInt(markets.rows[0].resolved)
    }
  });
});

// HTTP + WebSocket server
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// Track connected clients
const clients = new Set<WebSocket>();

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log(`[WS] Client connected (${clients.size} total)`);
  
  ws.on('close', () => {
    clients.delete(ws);
  });
});

// Broadcast whale trades to all clients
redisSub.subscribe('whale_trades');
redisSub.on('message', (channel, message) => {
  if (channel === 'whale_trades') {
    const payload = JSON.stringify({ type: 'whale_trade', data: JSON.parse(message) });
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }
});

// Start services
const poller = new TradePoller(db, redis);

const PORT = parseInt(process.env.PORT || '3001');
server.listen(PORT, async () => {
  console.log(`[Server] Running on http://localhost:${PORT}`);
  await poller.start();
});


