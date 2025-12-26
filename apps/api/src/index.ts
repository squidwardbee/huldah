import 'dotenv/config';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { Pool } from 'pg';
import Redis from 'ioredis';
import cors from 'cors';
import axios from 'axios';

// Simple axios instance for Polymarket CLOB API
const clobClient = axios.create({
  baseURL: 'https://clob.polymarket.com',
  timeout: 8000,
});
import { TradePoller } from './services/tradePoller.js';
import { WalletScorer } from './services/walletScorer.js';
import { SubgraphService } from './services/subgraphService.js';
import { SubgraphClient } from './services/polymarket/subgraphClient.js';
import { InsiderDetector } from './services/insiderDetector.js';
import { MarketSyncService } from './services/marketSync.js';
import { InsiderPredictor, TrainingExporter } from './services/ml/index.js';
import {
  OrderExecutor,
  createOrderExecutorFromEnv,
  UserManager,
  createUserManagerFromEnv,
  MultiUserExecutor,
  createMultiUserExecutorFromEnv,
  CredentialStore,
  createCredentialStore,
} from './services/trading/index.js';
import { OrderRequest } from './types/trading.js';
import { Request, Response, NextFunction } from 'express';

// Extend Express Request to include user
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: number;
        eoaAddress: string;
        proxyAddress: string | null;
      };
    }
  }
}

const app = express();
app.use(cors());
app.use(express.json());

// Database - supports DATABASE_URL (Railway/Heroku) or individual vars
const db = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  : new Pool({
      host: process.env.DB_HOST || 'host.docker.internal',
      port: parseInt(process.env.DB_PORT || '5432'),
      user: process.env.DB_USER || 'huldah',
      password: process.env.DB_PASSWORD || 'huldah',
      database: process.env.DB_NAME || 'huldah'
    });

// Redis - supports REDIS_URL (Railway) or individual vars
const redisConfig = process.env.REDIS_URL
  ? process.env.REDIS_URL
  : { host: process.env.REDIS_HOST || 'host.docker.internal', port: parseInt(process.env.REDIS_PORT || '6379') };
const redis = new Redis(redisConfig as any);
const redisSub = new Redis(redisConfig as any);

// Services
const walletScorer = new WalletScorer(db);
const subgraphService = new SubgraphService(db);
const subgraphClient = new SubgraphClient();
const insiderDetector = new InsiderDetector(db);
const marketSync = new MarketSyncService(db);
const insiderPredictor = new InsiderPredictor(db);
const trainingExporter = new TrainingExporter(db);

// Trading executor (initialized lazily on first trade)
let orderExecutor: OrderExecutor | null = null;
const getOrderExecutor = async (): Promise<OrderExecutor> => {
  if (!orderExecutor) {
    orderExecutor = createOrderExecutorFromEnv(db, redis);
    await orderExecutor.initialize();
  }
  return orderExecutor;
};

// Multi-user trading services
const userManager = createUserManagerFromEnv(db);
const credentialStore = createCredentialStore(db);
let multiUserExecutor: MultiUserExecutor | null = null;
const getMultiUserExecutor = async (): Promise<MultiUserExecutor> => {
  if (!multiUserExecutor) {
    multiUserExecutor = createMultiUserExecutorFromEnv(db, redis, userManager);
    await multiUserExecutor.initialize();
  }
  return multiUserExecutor;
};

// Auth middleware - validates session token
const authMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }
  
  const token = authHeader.substring(7);
  const user = await userManager.validateSession(token);
  
  if (!user) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
  
  req.user = {
    id: user.id,
    eoaAddress: user.eoaAddress,
    proxyAddress: user.proxyAddress,
  };
  
  next();
};

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
  try {
    const wallets = await subgraphService.getTopWallets(50);
    res.json(wallets);
  } catch (err) {
    console.error('Error fetching top wallets:', err);
    res.status(500).json({ error: 'Failed to fetch top wallets' });
  }
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

// Seed top wallets from Polymarket subgraph
app.post('/api/wallets/seed', async (_req, res) => {
  try {
    const count = await subgraphService.seedTopWallets();
    res.json({ message: `Seeded ${count} wallets from subgraph` });
  } catch (err) {
    console.error('Error seeding wallets:', err);
    res.status(500).json({ error: 'Failed to seed wallets' });
  }
});

// ============ INSIDER DETECTION ENDPOINTS ============

// Get potential insider wallets
app.get('/api/insiders', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const insiders = await insiderDetector.getTopInsiders(limit);
    res.json(insiders);
  } catch (err) {
    console.error('Error fetching insiders:', err);
    res.status(500).json({ error: 'Failed to fetch insiders' });
  }
});

// Get insider alerts
app.get('/api/insiders/alerts', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const alerts = await insiderDetector.getRecentAlerts(limit);
    res.json(alerts);
  } catch (err) {
    console.error('Error fetching insider alerts:', err);
    res.status(500).json({ error: 'Failed to fetch insider alerts' });
  }
});

// Analyze a specific market for insider activity
app.get('/api/insiders/market/:conditionId', async (req, res) => {
  try {
    const { conditionId } = req.params;
    const analysis = await insiderDetector.analyzeMarket(conditionId);
    res.json(analysis);
  } catch (err) {
    console.error('Error analyzing market:', err);
    res.status(500).json({ error: 'Failed to analyze market' });
  }
});

// Manually trigger insider score recomputation
app.post('/api/insiders/recompute', async (_req, res) => {
  try {
    await insiderDetector.computeAllInsiderScores();
    res.json({ message: 'Insider score recomputation complete' });
  } catch (err) {
    console.error('Error recomputing insider scores:', err);
    res.status(500).json({ error: 'Failed to recompute insider scores' });
  }
});

// ============ MARKET SYNC ENDPOINTS ============

// Get market sync stats
app.get('/api/markets/stats', async (_req, res) => {
  try {
    const stats = await marketSync.getStats();
    res.json(stats);
  } catch (err) {
    console.error('Error fetching market stats:', err);
    res.status(500).json({ error: 'Failed to fetch market stats' });
  }
});

// Get markets list
// By default shows only open (unresolved) markets
// Use ?resolved=true to see resolved markets, ?all=true to see everything
// Use ?category=Crypto to filter by category
// Use ?sortBy=volume_24h|ending_soon|liquidity|newest to change sorting
app.get('/api/markets', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 2000); // Allow up to 2000 markets
    const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);
    const showAll = req.query.all === 'true';
    const showResolved = req.query.resolved === 'true';
    const tradeableOnly = req.query.tradeable !== 'false'; // Default: only tradeable
    const category = req.query.category as string | undefined;
    const minVolume = parseInt(req.query.minVolume as string) || (tradeableOnly ? 1000 : 0);
    const sortBy = req.query.sortBy as string | undefined;

    // Default: show only open (unresolved) markets
    // ?resolved=true: show only resolved markets
    // ?all=true: show all markets
    let resolvedFilter: boolean | null = null;
    if (!showAll) {
      resolvedFilter = showResolved ? true : false;
    }

    // Build ORDER BY clause based on sortBy parameter
    let orderBy = 'volume DESC NULLS LAST, question ASC';
    switch (sortBy) {
      case 'volume_24h':
        orderBy = 'volume_24h DESC NULLS LAST, volume DESC NULLS LAST';
        break;
      case 'ending_soon':
        orderBy = 'end_date ASC NULLS LAST, volume DESC NULLS LAST';
        break;
      case 'liquidity':
        orderBy = 'liquidity DESC NULLS LAST, volume DESC NULLS LAST';
        break;
      case 'newest':
        // Use end_date DESC as proxy for "newest" (markets ending furthest in future are likely newer)
        orderBy = 'end_date DESC NULLS LAST, volume DESC NULLS LAST';
        break;
      default:
        orderBy = 'volume DESC NULLS LAST, question ASC';
    }

    const { rows } = await db.query(`
      SELECT
        condition_id,
        question,
        slug,
        COALESCE(last_price_yes, 0.5) as outcome_yes_price,
        COALESCE(last_price_no, 0.5) as outcome_no_price,
        volume,
        liquidity,
        COALESCE(resolved, false) as resolved,
        resolution_outcome,
        end_date,
        yes_token_id,
        no_token_id,
        image_url,
        icon_url,
        category,
        COALESCE(volume_24h, 0) as volume_24h,
        COALESCE(price_change_24h, 0) as price_change_24h,
        best_bid,
        best_ask
      FROM markets
      WHERE ($1::boolean IS NULL OR COALESCE(resolved, false) = $1)
        AND question IS NOT NULL
        AND ($3::boolean = false OR (
          COALESCE(last_price_yes, 0.5) >= 0.01
          AND COALESCE(last_price_yes, 0.5) <= 0.99
          AND COALESCE(volume, 0) >= $5
        ))
        AND ($4::text IS NULL OR category = $4)
        AND (end_date IS NULL OR end_date > NOW()) -- Exclude markets that have already ended
      ORDER BY ${orderBy}
      LIMIT $2 OFFSET $6
    `, [resolvedFilter, limit, tradeableOnly, category || null, minVolume, offset]);

    // Get total count for proper pagination
    const { rows: countRows } = await db.query(`
      SELECT COUNT(*) as total
      FROM markets
      WHERE ($1::boolean IS NULL OR COALESCE(resolved, false) = $1)
        AND question IS NOT NULL
        AND ($2::boolean = false OR (
          COALESCE(last_price_yes, 0.5) >= 0.01
          AND COALESCE(last_price_yes, 0.5) <= 0.99
          AND COALESCE(volume, 0) >= $4
        ))
        AND ($3::text IS NULL OR category = $3)
        AND (end_date IS NULL OR end_date > NOW())
    `, [resolvedFilter, tradeableOnly, category || null, minVolume]);

    const total = parseInt(countRows[0]?.total || '0');

    // Return with pagination metadata
    res.json({
      markets: rows,
      pagination: {
        offset,
        limit,
        count: rows.length,
        total,
        hasMore: offset + rows.length < total,
      }
    });
  } catch (err) {
    console.error('Error fetching markets:', err);
    res.status(500).json({ error: 'Failed to fetch markets' });
  }
});

// Get available categories
app.get('/api/markets/categories', async (_req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT DISTINCT category, COUNT(*) as count
      FROM markets
      WHERE category IS NOT NULL
        AND COALESCE(resolved, false) = false
      GROUP BY category
      ORDER BY count DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching categories:', err);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// Get market holders - DISABLED (subgraph doesn't support this query)
app.get('/api/markets/:conditionId/holders', async (_req, res) => {
  // The positions subgraph doesn't have a 'positions' root query
  // Return empty array until we find a working data source
  res.json([]);
});

// Trigger manual market sync
app.post('/api/markets/sync', async (_req, res) => {
  try {
    await marketSync.fullSync();
    const stats = await marketSync.getStats();
    res.json({ message: 'Market sync complete', stats });
  } catch (err) {
    console.error('Error syncing markets:', err);
    res.status(500).json({ error: 'Failed to sync markets' });
  }
});

// ============ ML PREDICTION ENDPOINTS ============

// Predict insider probability for a trade
app.post('/api/ml/predict/trade', async (req, res) => {
  try {
    const { wallet_address, condition_id, price, size_usd, side } = req.body;
    
    if (!wallet_address || !condition_id || price === undefined || !size_usd || !side) {
      return res.status(400).json({ 
        error: 'Missing required fields: wallet_address, condition_id, price, size_usd, side' 
      });
    }
    
    const prediction = await insiderPredictor.predictTrade(
      wallet_address,
      condition_id,
      parseFloat(price),
      parseFloat(size_usd),
      side.toUpperCase() as 'BUY' | 'SELL'
    );
    
    res.json(prediction);
  } catch (err) {
    console.error('Error predicting trade:', err);
    res.status(500).json({ error: 'Failed to predict trade' });
  }
});

// Get ML predictions for top wallets
app.get('/api/ml/predict/wallets', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const predictions = await insiderPredictor.predictWallets(limit);
    res.json(predictions);
  } catch (err) {
    console.error('Error predicting wallets:', err);
    res.status(500).json({ error: 'Failed to predict wallets' });
  }
});

// Export training data to CSV
app.post('/api/ml/export', async (req, res) => {
  try {
    const outputDir = './data';
    const { mkdirSync } = await import('fs');
    
    try { mkdirSync(outputDir, { recursive: true }); } catch {}
    
    const [tradesCount, walletsCount] = await Promise.all([
      trainingExporter.exportTradeFeatures(`${outputDir}/trades.csv`),
      trainingExporter.exportWalletFeatures(`${outputDir}/wallets.csv`)
    ]);
    
    res.json({ 
      message: 'Training data exported',
      trades: tradesCount,
      wallets: walletsCount,
      files: [`${outputDir}/trades.csv`, `${outputDir}/wallets.csv`]
    });
  } catch (err) {
    console.error('Error exporting training data:', err);
    res.status(500).json({ error: 'Failed to export training data' });
  }
});

// Get training data statistics
app.get('/api/ml/stats', async (_req, res) => {
  try {
    const stats = await trainingExporter.getTrainingStats();
    const modelLoaded = insiderPredictor.isModelLoaded();
    
    res.json({
      ...stats,
      modelLoaded,
      modelType: modelLoaded ? 'xgboost' : 'rule-based'
    });
  } catch (err) {
    console.error('Error getting ML stats:', err);
    res.status(500).json({ error: 'Failed to get ML stats' });
  }
});

// ============ TRADING ENDPOINTS ============

// Get trading status
app.get('/api/trading/status', async (_req, res) => {
  try {
    const executor = await getOrderExecutor();
    const status = await executor.getStatus();
    res.json(status);
  } catch (err) {
    console.error('Error getting trading status:', err);
    res.status(500).json({ error: 'Failed to get trading status' });
  }
});

// Place an order
app.post('/api/trading/order', async (req, res) => {
  try {
    const { tokenId, side, price, size, orderType, tickSize, negRisk } = req.body;
    
    // Validate required fields
    if (!tokenId || !side || price === undefined || !size) {
      return res.status(400).json({
        error: 'Missing required fields: tokenId, side, price, size'
      });
    }
    
    // Validate price range
    if (price < 0.01 || price > 0.99) {
      return res.status(400).json({
        error: 'Price must be between 0.01 and 0.99'
      });
    }
    
    // Validate side
    if (!['BUY', 'SELL'].includes(side.toUpperCase())) {
      return res.status(400).json({
        error: 'Side must be BUY or SELL'
      });
    }
    
    const orderRequest: OrderRequest = {
      tokenId,
      side: side.toUpperCase() as 'BUY' | 'SELL',
      price: parseFloat(price),
      size: parseFloat(size),
      orderType: orderType || 'GTC',
      tickSize: tickSize || '0.01',
      negRisk: negRisk || false,
    };
    
    const executor = await getOrderExecutor();
    const response = await executor.executeOrder(orderRequest);
    
    res.json(response);
  } catch (err) {
    console.error('Error placing order:', err);
    res.status(500).json({ error: 'Failed to place order' });
  }
});

// ============ CLOB API PROXY ============
// Full proxy to Polymarket CLOB API - forwards all requests with headers intact
// This allows frontend ClobClient to work through our backend (avoids CORS/geoblocking)
app.all('/api/clob/*', async (req, res) => {
  try {
    // Extract the path after /api/clob
    const clobPath = (req.params as Record<string, string>)[0] || '';
    const url = `https://clob.polymarket.com/${clobPath}`;

    console.log(`[CLOB Proxy] ${req.method} ${clobPath}`);

    // Build headers - include Polymarket auth headers and make request look like browser
    const forwardHeaders: Record<string, string> = {
      'Host': 'clob.polymarket.com',
      'Origin': 'https://polymarket.com',
      'Referer': 'https://polymarket.com/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
      'Content-Type': 'application/json',
    };

    // Forward Polymarket auth headers
    const polyHeaders = [
      'poly_api_key',
      'poly_signature',
      'poly_timestamp',
      'poly_nonce',
      'poly_passphrase',
      'poly_address',
    ];

    for (const header of polyHeaders) {
      const value = req.headers[header.toLowerCase()];
      if (value && typeof value === 'string') {
        forwardHeaders[header.toUpperCase()] = value;
      }
    }

    console.log(`[CLOB Proxy] Forwarding with headers:`, Object.keys(forwardHeaders));

    // Make request to Polymarket
    const response = await axios({
      method: req.method as any,
      url,
      headers: forwardHeaders,
      data: req.body,
      params: req.query,
      validateStatus: () => true, // Don't throw on non-2xx
    });

    console.log(`[CLOB Proxy] Response: ${response.status}`);

    // Forward response
    res.status(response.status).json(response.data);
  } catch (err: any) {
    console.error('[CLOB Proxy] Error:', err.message);
    res.status(500).json({
      success: false,
      errorMsg: err.message || 'Proxy error'
    });
  }
});

// Cancel an order
app.delete('/api/trading/order/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    const executor = await getOrderExecutor();
    const success = await executor.cancelOrder(orderId);
    
    res.json({ success, orderId });
  } catch (err) {
    console.error('Error cancelling order:', err);
    res.status(500).json({ error: 'Failed to cancel order' });
  }
});

// Get open orders
app.get('/api/trading/orders', async (_req, res) => {
  try {
    const executor = await getOrderExecutor();
    const orders = await executor.getOpenOrders();
    res.json(orders);
  } catch (err) {
    console.error('Error fetching orders:', err);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// Get trade history
app.get('/api/trading/history', async (_req, res) => {
  try {
    const executor = await getOrderExecutor();
    const trades = await executor.getTradeHistory();
    res.json(trades);
  } catch (err) {
    console.error('Error fetching trade history:', err);
    res.status(500).json({ error: 'Failed to fetch trade history' });
  }
});

// Get orderbook for a token (public - no auth required)
app.get('/api/trading/orderbook/:tokenId', async (req, res) => {
  try {
    const { tokenId } = req.params;

    if (!tokenId || tokenId === 'undefined' || tokenId === 'null') {
      return res.json({ bids: [], asks: [], market: null });
    }

    // Fetch directly from Polymarket CLOB API (public endpoint)
    const response = await clobClient.get('/book', {
      params: { token_id: tokenId },
    });

    // Log orderbook data for debugging
    const data = response.data;
    console.log('[Orderbook] Fetched:', {
      tokenId: tokenId.slice(0, 20) + '...',
      bidsCount: data.bids?.length || 0,
      asksCount: data.asks?.length || 0,
      bestBid: data.bids?.[0]?.price,
      bestAsk: data.asks?.[0]?.price,
    });

    res.json(data);
  } catch (err: any) {
    // Log but don't spam console for common 404s
    if (err.response?.status !== 404) {
      console.error('Error fetching orderbook:', err.message || err);
    }
    // Return empty orderbook instead of error to prevent frontend crashes
    res.json({ bids: [], asks: [], market: null });
  }
});

// Get market info (public - no auth required)
app.get('/api/trading/market/:tokenId', async (req, res) => {
  try {
    const { tokenId } = req.params;
    
    if (!tokenId || tokenId === 'undefined' || tokenId === 'null') {
      return res.status(400).json({ error: 'Invalid token ID' });
    }
    
    // Fetch from Polymarket CLOB API (public endpoint)
    const response = await clobClient.get(`/markets/${tokenId}`);
    
    if (!response.data) {
      return res.status(404).json({ error: 'Market not found' });
    }
    
    res.json(response.data);
  } catch (err: any) {
    if (err.response?.status === 404) {
      return res.status(404).json({ error: 'Market not found' });
    }
    console.error('Error fetching market:', err.message || err);
    res.status(500).json({ error: 'Failed to fetch market' });
  }
});

// Get order history from database
app.get('/api/trading/orders/history', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    
    const { rows } = await db.query(`
      SELECT 
        order_id,
        token_id,
        side,
        price,
        size,
        status,
        execution_path,
        transaction_hash,
        error_message,
        filled_size,
        avg_fill_price,
        retry_count,
        created_at,
        completed_at
      FROM trading_orders
      ORDER BY created_at DESC
      LIMIT $1
    `, [limit]);
    
    res.json(rows);
  } catch (err) {
    console.error('Error fetching order history:', err);
    res.status(500).json({ error: 'Failed to fetch order history' });
  }
});

// Get trading statistics
app.get('/api/trading/stats', async (_req, res) => {
  try {
    const [totals, daily, executor] = await Promise.all([
      db.query(`
        SELECT 
          COUNT(*) as total_orders,
          COUNT(*) FILTER (WHERE status = 'CONFIRMED') as filled_orders,
          COUNT(*) FILTER (WHERE status = 'FAILED') as failed_orders,
          COALESCE(SUM(size * price), 0) as total_volume,
          COALESCE(SUM(filled_size * avg_fill_price) FILTER (WHERE status = 'CONFIRMED'), 0) as filled_volume
        FROM trading_orders
      `),
      db.query(`
        SELECT 
          date,
          orders_placed,
          orders_filled,
          orders_failed,
          total_volume,
          realized_pnl
        FROM trading_stats
        ORDER BY date DESC
        LIMIT 7
      `),
      getOrderExecutor().then(e => e.getStatus()),
    ]);
    
    res.json({
      totals: totals.rows[0],
      daily: daily.rows,
      executor,
    });
  } catch (err) {
    console.error('Error fetching trading stats:', err);
    res.status(500).json({ error: 'Failed to fetch trading stats' });
  }
});

// ============ MULTI-USER TRADING ENDPOINTS ============

// Get authentication challenge (nonce to sign)
app.post('/api/auth/challenge', async (req, res) => {
  try {
    const { address } = req.body;
    
    if (!address) {
      return res.status(400).json({ error: 'Address is required' });
    }
    
    // Validate address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return res.status(400).json({ error: 'Invalid address format' });
    }
    
    console.log('[Auth] Challenge requested for', address);
    const challenge = await userManager.generateAuthChallenge(address);
    console.log('[Auth] Challenge generated, expires:', challenge.expiresAt);
    res.json(challenge);
  } catch (err: any) {
    console.error('Error generating auth challenge:', err);
    // Return more specific error messages
    if (err.message?.includes('migration')) {
      return res.status(500).json({ 
        error: 'Database not initialized. Please run migration 005_multi_user_trading.sql' 
      });
    }
    res.status(500).json({ error: 'Failed to generate challenge' });
  }
});

// Authenticate with signed message
app.post('/api/auth/login', async (req, res) => {
  try {
    const { address, signature } = req.body;
    
    if (!address || !signature) {
      return res.status(400).json({ error: 'Address and signature are required' });
    }
    
    // Validate address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return res.status(400).json({ error: 'Invalid address format' });
    }
    
    // Validate signature format
    if (!/^0x[a-fA-F0-9]{130}$/.test(signature)) {
      return res.status(400).json({ error: 'Invalid signature format' });
    }
    
    console.log('[Auth] Login attempt for', address);
    
    const ipAddress = req.ip || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];
    
    const session = await userManager.authenticateWithSignature(
      address,
      signature,
      ipAddress,
      userAgent
    );
    
    if (!session) {
      console.log('[Auth] Authentication failed for', address);
      return res.status(401).json({ 
        error: 'Authentication failed. Please request a new challenge and sign again.',
        hint: 'The challenge may have expired or was already used'
      });
    }
    
    console.log('[Auth] Login successful for', address, 'userId:', session.userId);
    res.json(session);
  } catch (err: any) {
    console.error('Error authenticating:', err);
    res.status(500).json({ error: 'Failed to authenticate' });
  }
});

// Logout (invalidate session)
app.post('/api/auth/logout', authMiddleware, async (req, res) => {
  try {
    const token = req.headers.authorization?.substring(7);
    if (token) {
      await userManager.invalidateSession(token);
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Error logging out:', err);
    res.status(500).json({ error: 'Failed to logout' });
  }
});

// Get current user profile
app.get('/api/user/me', authMiddleware, async (req, res) => {
  try {
    const user = await userManager.getUserById(req.user!.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(user);
  } catch (err) {
    console.error('Error fetching user:', err);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// Get user's live positions from Polymarket (via Goldsky subgraph)
app.get('/api/user/positions', authMiddleware, async (req, res) => {
  try {
    // Get proxy wallet from query param or user record
    let proxyWallet = req.query.proxyWallet as string;

    if (!proxyWallet) {
      // Fall back to stored proxy address in user record
      const user = await userManager.getUserById(req.user!.id);
      proxyWallet = user?.proxyAddress || '';
    }

    if (!proxyWallet) {
      return res.json([]); // No proxy wallet, no positions
    }

    console.log('[Positions] Fetching for proxy wallet:', proxyWallet);

    // Check Redis cache first (30 second TTL)
    const cacheKey = `positions:${proxyWallet.toLowerCase()}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      console.log('[Positions] Returning cached positions');
      return res.json(JSON.parse(cached));
    }

    // Fetch positions from Goldsky subgraph
    const rawPositions = await subgraphClient.getWalletPositions(proxyWallet);

    // Filter to only non-zero positions
    const activePositions = rawPositions.filter(p => parseFloat(p.balance) > 0.001);

    if (activePositions.length === 0) {
      await redis.setex(cacheKey, 30, JSON.stringify([]));
      return res.json([]);
    }

    // Get unique condition IDs to look up markets
    const conditionIds = [...new Set(activePositions.map(p => p.condition))];

    // Batch lookup markets from database
    const marketsResult = await db.query(`
      SELECT condition_id, question, slug, image_url, yes_token_id, no_token_id, outcome_yes_price, outcome_no_price
      FROM markets
      WHERE condition_id = ANY($1)
    `, [conditionIds]);

    const marketMap = new Map(marketsResult.rows.map(m => [m.condition_id, m]));

    // Enrich positions with market data and current prices
    const enrichedPositions = await Promise.all(
      activePositions.map(async (pos) => {
        const market = marketMap.get(pos.condition);
        const isYes = pos.outcomeIndex === 1;
        const tokenId = isYes ? market?.yes_token_id : market?.no_token_id;

        // Get current price - try from market table first, then CLOB
        let currentPrice = isYes
          ? (market?.outcome_yes_price || 0.5)
          : (market?.outcome_no_price || 0.5);

        // Try to get live price from CLOB (with caching)
        if (tokenId) {
          try {
            const priceCacheKey = `price:${tokenId}`;
            const cachedPrice = await redis.get(priceCacheKey);

            if (cachedPrice) {
              currentPrice = parseFloat(cachedPrice);
            } else {
              const bookResponse = await clobClient.get('/book', {
                params: { token_id: tokenId }
              });
              const { bids, asks } = bookResponse.data;
              const bestBid = bids?.[0]?.price ? parseFloat(bids[0].price) : null;
              const bestAsk = asks?.[0]?.price ? parseFloat(asks[0].price) : null;

              if (bestBid !== null && bestAsk !== null) {
                currentPrice = (bestBid + bestAsk) / 2;
              } else if (bestBid !== null) {
                currentPrice = bestBid;
              } else if (bestAsk !== null) {
                currentPrice = bestAsk;
              }

              // Cache price for 10 seconds
              await redis.setex(priceCacheKey, 10, currentPrice.toString());
            }
          } catch (priceErr) {
            console.error('[Positions] Failed to fetch price for', tokenId, priceErr);
          }
        }

        const size = parseFloat(pos.balance);
        const avgPrice = parseFloat(pos.averagePrice);

        // Calculate unrealized PnL
        // For YES: profit if current price > avg price
        // For NO: profit if current price < avg price (because NO price = 1 - YES price)
        const unrealizedPnl = isYes
          ? (currentPrice - avgPrice) * size
          : (avgPrice - currentPrice) * size;

        return {
          tokenId: tokenId || pos.condition,
          conditionId: pos.condition,
          marketQuestion: market?.question || `Market ${pos.condition.slice(0, 8)}...`,
          outcome: isYes ? 'YES' : 'NO',
          size,
          avgPrice,
          currentPrice,
          unrealizedPnl,
          realizedPnl: parseFloat(pos.realizedPnl),
          marketSlug: market?.slug,
        };
      })
    );

    // Cache enriched positions for 30 seconds
    await redis.setex(cacheKey, 30, JSON.stringify(enrichedPositions));

    console.log('[Positions] Returning', enrichedPositions.length, 'positions');
    res.json(enrichedPositions);
  } catch (err) {
    console.error('Error fetching positions:', err);
    res.status(500).json({ error: 'Failed to fetch positions' });
  }
});

// Get user's order history
app.get('/api/user/orders', authMiddleware, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const orders = await userManager.getUserOrders(req.user!.id, limit);
    res.json(orders);
  } catch (err) {
    console.error('Error fetching user orders:', err);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// Get user's rate limit status
app.get('/api/user/rate-limit', authMiddleware, async (req, res) => {
  try {
    const executor = await getMultiUserExecutor();
    const rateLimit = await executor.getUserRateLimitStatus(req.user!.id);
    res.json(rateLimit);
  } catch (err) {
    console.error('Error fetching rate limit:', err);
    res.status(500).json({ error: 'Failed to fetch rate limit' });
  }
});

// ============ TRADING CREDENTIALS ENDPOINTS ============

// Check if user has registered CLOB credentials
app.get('/api/user/credentials/status', authMiddleware, async (req, res) => {
  try {
    const hasCredentials = await credentialStore.hasCredentials(req.user!.id);
    const isConfigured = credentialStore.isConfigured();

    res.json({
      hasCredentials,
      encryptionConfigured: isConfigured,
      canTrade: hasCredentials && isConfigured,
    });
  } catch (err) {
    console.error('Error checking credentials:', err);
    res.status(500).json({ error: 'Failed to check credentials status' });
  }
});

// Register CLOB API credentials
app.post('/api/user/credentials', authMiddleware, async (req, res) => {
  try {
    const { apiKey, apiSecret, apiPassphrase } = req.body;

    // Validate input
    if (!apiKey || !apiSecret || !apiPassphrase) {
      return res.status(400).json({
        error: 'Missing required fields: apiKey, apiSecret, apiPassphrase'
      });
    }

    // Check if encryption is configured
    if (!credentialStore.isConfigured()) {
      return res.status(503).json({
        error: 'Trading credentials storage not configured. Contact admin.'
      });
    }

    // Validate credential format
    const validation = await credentialStore.validate({ apiKey, apiSecret, apiPassphrase });
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    // Store encrypted credentials
    await credentialStore.store(req.user!.id, { apiKey, apiSecret, apiPassphrase });

    console.log(`[Credentials] User ${req.user!.id} registered CLOB credentials`);
    res.json({ success: true, message: 'Credentials stored securely' });
  } catch (err) {
    console.error('Error storing credentials:', err);
    res.status(500).json({ error: 'Failed to store credentials' });
  }
});

// Delete CLOB API credentials
app.delete('/api/user/credentials', authMiddleware, async (req, res) => {
  try {
    await credentialStore.delete(req.user!.id);
    console.log(`[Credentials] User ${req.user!.id} deleted CLOB credentials`);
    res.json({ success: true, message: 'Credentials deleted' });
  } catch (err) {
    console.error('Error deleting credentials:', err);
    res.status(500).json({ error: 'Failed to delete credentials' });
  }
});

// ============ ORDER EXECUTION ENDPOINTS ============

// Place order (authenticated user)
app.post('/api/user/order', authMiddleware, async (req, res) => {
  try {
    const { tokenId, side, price, size, orderType, tickSize, negRisk } = req.body;

    console.log('[Order] Received:', {
      userId: req.user?.id,
      tokenId,
      side,
      price,
      size,
      orderType,
      priceType: typeof price
    });

    if (!tokenId || !side || price === undefined || price === null || !size) {
      console.log('[Order] Validation failed: missing fields');
      return res.status(400).json({
        error: 'Missing required fields: tokenId, side, price, size',
        received: { tokenId: !!tokenId, side: !!side, price, size }
      });
    }

    const priceNum = parseFloat(price);
    const sizeNum = parseFloat(size);

    if (isNaN(priceNum) || priceNum < 0.01 || priceNum > 0.99) {
      console.log('[Order] Validation failed: price out of range', { price, priceNum });
      return res.status(400).json({
        error: `Price must be between 0.01 and 0.99 (received: ${price})`,
        hint: 'For market orders, ensure orderbook has valid best bid/ask'
      });
    }

    if (isNaN(sizeNum) || sizeNum <= 0) {
      console.log('[Order] Validation failed: invalid size', { size, sizeNum });
      return res.status(400).json({ error: `Size must be greater than 0 (received: ${size})` });
    }

    if (!['BUY', 'SELL'].includes(side.toUpperCase())) {
      return res.status(400).json({ error: 'Side must be BUY or SELL' });
    }

    const executor = await getMultiUserExecutor();
    const response = await executor.executeOrder({
      userId: req.user!.id,
      tokenId,
      side: side.toUpperCase() as 'BUY' | 'SELL',
      price: priceNum,
      size: sizeNum,
      orderType: orderType || 'GTC',
      tickSize: tickSize || '0.01',
      negRisk: negRisk || false,
    });

    console.log('[Order] Response:', { orderId: response.orderId, status: response.status, error: response.errorMessage });
    res.json(response);
  } catch (err) {
    console.error('Error placing user order:', err);
    res.status(500).json({ error: 'Failed to place order' });
  }
});

// ============ PLATFORM ADMIN ENDPOINTS ============

// Get platform stats
app.get('/api/platform/stats', async (_req, res) => {
  try {
    // Get user stats (may fail if tables don't exist)
    let userStats = { totalUsers: 0, activeUsers24h: 0, totalVolume: 0, totalOrders: 0 };
    try {
      userStats = await userManager.getPlatformStats();
    } catch (e) {
      console.warn('[Platform] User stats table not ready');
    }
    
    // Get executor status (may fail if not initialized)
    let executorStatus: {
      initialized: boolean;
      tradingEnabled?: boolean;
      platformRateLimit: { dailyLimit: number; used: number; remaining: number; resetAt: Date } | null;
      activeUsers: number;
    } = { initialized: false, platformRateLimit: null, activeUsers: 0 };
    try {
      const executor = await getMultiUserExecutor();
      executorStatus = await executor.getStatus();
    } catch (e) {
      console.warn('[Platform] Executor not ready');
    }
    
    res.json({
      users: userStats,
      executor: executorStatus,
    });
  } catch (err) {
    console.error('Error fetching platform stats:', err);
    res.status(500).json({ error: 'Failed to fetch platform stats' });
  }
});

// Get all users (admin)
app.get('/api/platform/users', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const users = await userManager.getAllUsers(limit);
    res.json(users);
  } catch (err) {
    console.error('Error fetching users:', err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
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
  
  // Seed top wallets from Polymarket subgraph on startup
  console.log('[Server] Seeding top wallets from Polymarket subgraph...');
  await subgraphService.seedTopWallets();
  
  // Start market sync first (needed for insider detection)
  console.log('[Server] Starting market sync...');
  marketSync.startScheduled(15 * 60 * 1000);  // Every 15 minutes
  
  // Start trade polling
  await poller.start();
  
  // Start wallet scoring (runs every 5 minutes)
  walletScorer.startScheduled(5 * 60 * 1000);
  
  // Start insider detection (runs every 10 minutes)
  insiderDetector.startScheduled(10 * 60 * 1000);
});
