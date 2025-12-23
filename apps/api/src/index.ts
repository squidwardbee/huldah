import 'dotenv/config';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { Pool } from 'pg';
import Redis from 'ioredis';
import cors from 'cors';
import { TradePoller } from './services/tradePoller.js';
import { WalletScorer } from './services/walletScorer.js';

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

// Services
const walletScorer = new WalletScorer(db);

// Routes
app.get('/api/whales', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
  
  const { rows } = await db.query(`
    SELECT * FROM whale_trades
    ORDER BY timestamp DESC
    LIMIT $1
  `, [limit]);
  
  res.json(rows);
});

app.get('/api/wallets/top', async (_req, res) => {
  const { rows } = await db.query(`
    SELECT 
      address, 
      total_trades, 
      total_volume, 
      win_count, 
      loss_count, 
      realized_pnl,
      tags,
      insider_score,
      smart_money_score,
      CASE WHEN (win_count + loss_count) > 0 
           THEN win_count::float / (win_count + loss_count) 
           ELSE 0 END as win_rate
    FROM wallets
    ORDER BY total_volume DESC
    LIMIT 50
  `);
  
  res.json(rows);
});

app.get('/api/wallets/tagged/:tag', async (req, res) => {
  const { tag } = req.params;
  const { rows } = await db.query(`
    SELECT 
      address, 
      total_trades, 
      total_volume, 
      tags,
      smart_money_score
    FROM wallets
    WHERE $1 = ANY(tags)
    ORDER BY total_volume DESC
    LIMIT 50
  `, [tag]);
  
  res.json(rows);
});

app.get('/api/wallets/:address', async (req, res) => {
  const { address } = req.params;
  
  const wallet = await db.query(`SELECT * FROM wallets WHERE address = $1`, [address]);
  const recentTrades = await db.query(`
    SELECT * FROM whale_trades
    WHERE wallet_address = $1
    ORDER BY timestamp DESC
    LIMIT 50
  `, [address]);
  
  res.json({
    wallet: wallet.rows[0],
    trades: recentTrades.rows
  });
});

// Stats endpoint
app.get('/api/stats', async (_req, res) => {
  const [wallets, whales, tagged] = await Promise.all([
    db.query('SELECT COUNT(*) as count, SUM(total_volume) as volume FROM wallets'),
    db.query('SELECT COUNT(*) as count FROM whale_trades'),
    db.query(`
      SELECT 
        COALESCE(SUM(CASE WHEN 'whale' = ANY(tags) THEN 1 ELSE 0 END), 0) as whales,
        COALESCE(SUM(CASE WHEN 'smart_money' = ANY(tags) THEN 1 ELSE 0 END), 0) as smart_money,
        COALESCE(SUM(CASE WHEN 'active' = ANY(tags) THEN 1 ELSE 0 END), 0) as active
      FROM wallets
    `)
  ]);
  
  res.json({
    wallets: {
      count: parseInt(wallets.rows[0].count),
      totalVolume: parseFloat(wallets.rows[0].volume) || 0
    },
    whaleTrades: parseInt(whales.rows[0].count),
    tagged: {
      whales: parseInt(tagged.rows[0].whales),
      smartMoney: parseInt(tagged.rows[0].smart_money),
      active: parseInt(tagged.rows[0].active)
    }
  });
});

// Manually trigger tag recomputation
app.post('/api/wallets/recompute-tags', async (_req, res) => {
  walletScorer.computeAllTags();
  res.json({ message: 'Tag recomputation started' });
});

// HTTP + WebSocket server
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

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
  
  // Start trade polling
  await poller.start();
  
  // Start wallet scoring (runs every 5 minutes)
  walletScorer.startScheduled(5 * 60 * 1000);
});
