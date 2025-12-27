# DTW Pattern Matching Feature

> Historical pattern matching using Dynamic Time Warping to predict price movements

## Executive Summary

This feature uses DTW (Dynamic Time Warping) to find historical patterns similar to the current price/volume pattern, then analyzes what happened after those historical matches to provide a statistical prediction.

**User sees:** "This pattern matched 347 times in history. 62% went UP, 38% went DOWN"

---

## The Core Concept

### What DTW Does

DTW measures similarity between two time series that may vary in speed. Unlike Euclidean distance, DTW can match patterns even if they're stretched or compressed in time.

```
Current Pattern:     ╱╲__╱
Historical Match:   ╱ ╲___╱   (same shape, different timing)

DTW recognizes these as similar, Euclidean distance would not.
```

### The Algorithm Flow

```
1. CAPTURE CURRENT PATTERN
   └─> Take last N candles (e.g., 20 candles)
   └─> Normalize to [0,1] range
   └─> Store as query pattern

2. SEARCH HISTORICAL DATABASE
   └─> For each stored historical window:
       └─> Compute DTW distance to query
       └─> If distance < threshold, it's a match
   └─> Return top-K most similar patterns

3. ANALYZE OUTCOMES
   └─> For each match, look at what happened AFTER:
       └─> Did price go UP or DOWN in next M candles?
       └─> By how much?
   └─> Aggregate: X% went up, Y% went down

4. DISPLAY TO USER
   └─> Show current pattern highlighted on chart
   └─> Show match count and directional statistics
   └─> Optionally: Show example historical matches
```

---

## Data Requirements

### What We Need to Store

| Data Type | Granularity | Retention | Source |
|-----------|-------------|-----------|--------|
| Price history | 5-minute candles | All time | CLOB `/prices-history` |
| Volume/trade flow | 5-minute buckets | All time | Data API `/trades` (aggregated) |
| Market metadata | Snapshot | All time | Gamma API `/markets` |
| Resolution outcomes | Final | All time | Gamma API (resolved markets) |

### Storage Estimates

**Per Market:**
- ~288 candles/day (5-min intervals)
- ~105,000 candles/year
- ~8 bytes per candle (timestamp + price) = ~840KB/year raw

**For 1,000 markets over 2 years:**
- Raw price data: ~1.7 GB
- With volume data: ~3.4 GB
- With indexes: ~5-10 GB total

### Data Sources (Polymarket APIs)

#### 1. CLOB Price History
```
GET https://clob.polymarket.com/prices-history
  ?market={tokenId}
  &startTs={unixTimestamp}
  &endTs={unixTimestamp}
  &fidelity=5  // 5-minute resolution

Rate Limit: 1,000 requests / 10 seconds
```

**Response:**
```json
{
  "history": [
    { "t": 1697875200, "p": 0.75 },
    { "t": 1697875500, "p": 0.76 }
  ]
}
```

#### 2. Data API Trades (for volume)
```
GET https://data-api.polymarket.com/trades
  ?asset={tokenId}
  &after={timestamp}
  &before={timestamp}
  &limit=100

Rate Limit: 200 requests / 10 seconds
```

Must aggregate trades into volume buckets ourselves.

#### 3. Gamma API Markets
```
GET https://gamma-api.polymarket.com/markets
  ?active=true
  &limit=100

Rate Limit: 300 requests / 10 seconds
```

Returns all markets with metadata, volume metrics, and resolution status.

---

## Database Schema

### TimescaleDB Hypertables (Time-Series Optimized)

```sql
-- Enable TimescaleDB extension
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Price candles (5-minute OHLCV)
CREATE TABLE price_candles (
  time        TIMESTAMPTZ NOT NULL,
  token_id    VARCHAR(100) NOT NULL,
  market_id   VARCHAR(100) NOT NULL,
  open        DECIMAL(10, 6),
  high        DECIMAL(10, 6),
  low         DECIMAL(10, 6),
  close       DECIMAL(10, 6),
  volume      DECIMAL(20, 6),
  trade_count INTEGER,
  PRIMARY KEY (token_id, time)
);

-- Convert to hypertable for time-series optimization
SELECT create_hypertable('price_candles', 'time');

-- Compression policy (compress data older than 7 days)
ALTER TABLE price_candles SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'token_id'
);
SELECT add_compression_policy('price_candles', INTERVAL '7 days');

-- Continuous aggregate for hourly candles (for faster queries)
CREATE MATERIALIZED VIEW price_candles_1h
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 hour', time) AS time,
  token_id,
  market_id,
  first(open, time) AS open,
  max(high) AS high,
  min(low) AS low,
  last(close, time) AS close,
  sum(volume) AS volume,
  sum(trade_count) AS trade_count
FROM price_candles
GROUP BY time_bucket('1 hour', time), token_id, market_id;

-- Pattern index for fast subsequence search
CREATE INDEX idx_candles_token_time ON price_candles (token_id, time DESC);

-- Market outcomes (for backtesting pattern success)
CREATE TABLE market_outcomes (
  market_id       VARCHAR(100) PRIMARY KEY,
  condition_id    VARCHAR(100),
  question        TEXT,
  resolution      VARCHAR(10),  -- 'YES', 'NO', 'INVALID'
  resolved_at     TIMESTAMPTZ,
  final_price_yes DECIMAL(10, 6),
  final_price_no  DECIMAL(10, 6)
);
```

### Pattern Cache Table

```sql
-- Pre-computed pattern windows for fast DTW search
CREATE TABLE pattern_windows (
  id              SERIAL PRIMARY KEY,
  token_id        VARCHAR(100) NOT NULL,
  window_start    TIMESTAMPTZ NOT NULL,
  window_end      TIMESTAMPTZ NOT NULL,
  pattern_length  INTEGER NOT NULL,  -- number of candles
  pattern_data    FLOAT[] NOT NULL,  -- normalized price series
  outcome_1h      DECIMAL(10, 6),    -- price change after 1 hour
  outcome_4h      DECIMAL(10, 6),    -- price change after 4 hours
  outcome_24h     DECIMAL(10, 6),    -- price change after 24 hours
  outcome_final   DECIMAL(10, 6),    -- if market resolved
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_patterns_token ON pattern_windows (token_id);
CREATE INDEX idx_patterns_length ON pattern_windows (pattern_length);
```

---

## DTW Implementation Options

### Option A: Python Backend Service (Recommended)

Use the `dtaidistance` library - fastest available DTW implementation.

**Pros:**
- 30-300x faster than pure Python (C backend)
- Built-in parallel distance matrix computation
- Pruning and early abandonment optimizations
- LB_Keogh lower bound for fast filtering

**Cons:**
- Requires separate Python service
- Additional infrastructure complexity

```python
# Example usage
from dtaidistance import dtw
from dtaidistance import dtw_ndim
import numpy as np

def find_similar_patterns(query: np.ndarray,
                          historical: list[np.ndarray],
                          top_k: int = 50,
                          max_distance: float = 0.3) -> list[tuple[int, float]]:
    """
    Find top-K most similar historical patterns to query.

    Args:
        query: Current pattern (normalized 1D array)
        historical: List of historical patterns
        top_k: Number of matches to return
        max_distance: Maximum DTW distance threshold

    Returns:
        List of (index, distance) tuples
    """
    # Use pruning for speed
    distances = dtw.distance_matrix_fast(
        [query] + historical,
        use_pruning=True,
        max_dist=max_distance
    )

    # Get distances from query (first row) to all historical
    query_distances = distances[0, 1:]

    # Filter and sort
    matches = [
        (i, d) for i, d in enumerate(query_distances)
        if d < max_distance and not np.isinf(d)
    ]
    matches.sort(key=lambda x: x[1])

    return matches[:top_k]
```

### Option B: Node.js with WASM

Use a Rust-based DTW library compiled to WebAssembly.

**Pros:**
- Single codebase (Node.js backend)
- No Python dependency

**Cons:**
- Slower than native C
- Less mature libraries
- More development work

### Option C: PostgreSQL Extension

Use `pg_similarity` or custom extension.

**Pros:**
- All computation in database
- No separate service

**Cons:**
- Limited DTW support
- Harder to optimize
- Complex queries

### Recommendation: Option A (Python Service)

The performance difference is significant enough that a separate Python service is worth the complexity. Run it as a microservice accessed via HTTP or gRPC.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         FRONTEND (React)                             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐      │
│  │   Price Chart   │  │ Pattern Display │  │ Prediction Box  │      │
│  │  (highlighted   │  │  (matches view) │  │  (% up/down)    │      │
│  │   pattern)      │  │                 │  │                 │      │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘      │
└────────────────────────────┬────────────────────────────────────────┘
                             │ REST API
┌────────────────────────────▼────────────────────────────────────────┐
│                      NODE.JS BACKEND                                 │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐      │
│  │  API Gateway    │  │  Pattern Cache  │  │  Data Ingestion │      │
│  │  /api/patterns  │  │  (Redis)        │  │  Service        │      │
│  └────────┬────────┘  └─────────────────┘  └────────┬────────┘      │
│           │                                          │               │
└───────────┼──────────────────────────────────────────┼───────────────┘
            │ HTTP/gRPC                                │
┌───────────▼──────────────────────────────────────────▼───────────────┐
│                     PYTHON DTW SERVICE                                │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐      │
│  │  Pattern Search │  │  DTW Compute    │  │ Outcome Analyzer │      │
│  │  (dtaidistance) │  │  (parallel)     │  │                  │      │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘      │
└────────────────────────────┬────────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────────┐
│                        DATA LAYER                                    │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐      │
│  │  TimescaleDB    │  │     Redis       │  │   PostgreSQL    │      │
│  │  (price_candles)│  │   (hot cache)   │  │   (patterns)    │      │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Data Collection Pipeline

### 1. Initial Historical Backfill

```
FOR each market in Gamma API:
  1. Get all token IDs
  2. For each token:
     a. Fetch full price history (interval=max)
     b. Aggregate into 5-min candles
     c. Store in TimescaleDB
  3. Store market metadata + resolution outcome

Rate limit considerations:
- 1,000 markets × 2 tokens = 2,000 requests
- At 1,000 req/10s = ~20 seconds for prices
- Run during off-peak hours
```

### 2. Continuous Price Collection

```python
# Background job every 5 minutes
async def collect_prices():
    markets = await get_active_markets()

    for market in markets:
        for token_id in market.token_ids:
            # Fetch last hour of 5-min data
            history = await fetch_price_history(
                token_id,
                interval='1h',
                fidelity=5
            )

            # Upsert into TimescaleDB
            await upsert_candles(token_id, history)
```

### 3. Pattern Window Generation

```python
# Nightly job to generate pattern windows
async def generate_pattern_windows():
    for token_id in all_token_ids:
        candles = await get_candles(token_id)

        # Sliding window of 20 candles
        window_size = 20
        for i in range(len(candles) - window_size - 24):  # -24 for outcome
            window = candles[i:i + window_size]

            # Normalize to [0, 1]
            normalized = normalize(window)

            # Calculate outcomes
            outcome_1h = candles[i + window_size + 12].close - window[-1].close
            outcome_4h = candles[i + window_size + 48].close - window[-1].close
            outcome_24h = candles[i + window_size + 288].close - window[-1].close

            await store_pattern_window(
                token_id=token_id,
                pattern=normalized,
                outcomes={
                    '1h': outcome_1h,
                    '4h': outcome_4h,
                    '24h': outcome_24h
                }
            )
```

---

## API Endpoints

### GET /api/patterns/match

Find patterns similar to current market state.

**Request:**
```json
{
  "token_id": "12345...",
  "window_size": 20,         // candles to use as pattern
  "prediction_horizon": "4h", // how far ahead to predict
  "max_distance": 0.3,       // DTW distance threshold
  "top_k": 100               // max matches to analyze
}
```

**Response:**
```json
{
  "pattern": {
    "start_time": "2024-01-15T10:00:00Z",
    "end_time": "2024-01-15T11:40:00Z",
    "data": [0.45, 0.47, 0.46, ...],  // normalized
    "raw": [0.45, 0.47, 0.46, ...]    // actual prices
  },
  "matches": {
    "count": 347,
    "avg_distance": 0.12,
    "outcomes": {
      "up": 215,          // 62%
      "down": 132,        // 38%
      "avg_up_move": 0.034,
      "avg_down_move": -0.028
    }
  },
  "prediction": {
    "direction": "UP",
    "confidence": 0.62,
    "expected_move": 0.008,
    "statistical_significance": 0.023  // p-value
  },
  "examples": [
    {
      "token_id": "67890...",
      "market_question": "Will X happen?",
      "match_time": "2023-11-20T14:00:00Z",
      "distance": 0.05,
      "outcome": "UP",
      "move": 0.042
    },
    // ... more examples
  ]
}
```

### GET /api/patterns/statistics

Get overall pattern matching accuracy.

**Response:**
```json
{
  "total_predictions": 15420,
  "accuracy": {
    "1h": 0.53,
    "4h": 0.55,
    "24h": 0.52
  },
  "best_patterns": [
    {
      "description": "Sharp spike followed by consolidation",
      "accuracy": 0.68,
      "sample_count": 234
    }
  ]
}
```

---

## Frontend Visualization

### 1. Chart Overlay

```tsx
// Highlight current pattern window on price chart
<PriceChart>
  <PatternHighlight
    startTime={pattern.startTime}
    endTime={pattern.endTime}
    color="rgba(255, 0, 255, 0.2)"  // magenta overlay
  />
</PriceChart>
```

### 2. Prediction Display

```tsx
<PatternPrediction>
  <div className="prediction-box">
    <div className="match-count">347 matches found</div>
    <div className="direction">
      <span className="up">62% UP</span>
      <span className="down">38% DOWN</span>
    </div>
    <div className="confidence">
      Statistical significance: p=0.023
    </div>
  </div>
</PatternPrediction>
```

### 3. Example Matches Modal

Show 3-5 historical examples of similar patterns with their outcomes.

```tsx
<MatchExamples>
  {examples.map(ex => (
    <MiniChart
      data={ex.priceData}
      outcome={ex.outcome}
      marketQuestion={ex.question}
    />
  ))}
</MatchExamples>
```

---

## Performance Optimizations

### 1. Lower Bound Filtering (LB_Keogh)

Before computing full DTW, use LB_Keogh lower bound to quickly reject patterns that can't possibly match.

```python
from dtaidistance import dtw

# Create envelope around query
upper, lower = dtw.lb_keogh_envelope(query, window=5)

# Fast filter - only compute DTW for patterns within lower bound
candidates = [p for p in patterns if lb_keogh(p, upper, lower) < max_distance]
```

This can reduce computation by 90%+.

### 2. Hierarchical Search

1. First search hourly candles (coarse)
2. Then refine with 5-minute candles (fine)

### 3. Market Clustering

Group similar markets and search within clusters first:
- Political markets
- Sports markets
- Crypto markets
- Economic markets

Similar markets have more relevant patterns.

### 4. Caching Strategy

```
┌─────────────────────────────────────────┐
│  L1 Cache: Redis (hot patterns)         │
│  - Current patterns for active markets  │
│  - TTL: 5 minutes                       │
├─────────────────────────────────────────┤
│  L2 Cache: Pre-computed windows table   │
│  - All historical windows normalized    │
│  - Updated nightly                      │
├─────────────────────────────────────────┤
│  L3: Raw TimescaleDB                    │
│  - Full granular data                   │
│  - Only accessed for new patterns       │
└─────────────────────────────────────────┘
```

### 5. Batch Processing

Compute matches for all active markets in parallel using thread pools.

---

## Multi-Dimensional DTW (Optional Enhancement)

Instead of just price, use multiple series:

```python
# 2D pattern: [price, volume]
pattern_2d = np.column_stack([
    normalized_price,
    normalized_volume
])

# Use n-dimensional DTW
distance = dtw_ndim.distance(pattern_2d, historical_2d)
```

This captures "price going up on high volume" vs "price going up on low volume".

---

## Alternative Time Series (from conversation)

Instead of time-based candles, use:

### Dollar Bars
Each bar represents fixed $ traded, not fixed time.

```python
def create_dollar_bars(trades, bar_size=1000):
    bars = []
    current_bar = {'volume': 0, 'high': 0, 'low': float('inf'), 'open': None}

    for trade in trades:
        if current_bar['open'] is None:
            current_bar['open'] = trade.price

        current_bar['high'] = max(current_bar['high'], trade.price)
        current_bar['low'] = min(current_bar['low'], trade.price)
        current_bar['volume'] += trade.size * trade.price

        if current_bar['volume'] >= bar_size:
            current_bar['close'] = trade.price
            bars.append(current_bar)
            current_bar = {'volume': 0, 'high': 0, 'low': float('inf'), 'open': None}

    return bars
```

**Benefits:**
- More stationary statistical properties
- Filters out low-activity periods
- Each bar has equal "importance"

### Volume Bars
Each bar represents fixed number of shares/contracts traded.

### Tick Bars
Each bar represents fixed number of trades.

---

## Implementation Phases

### Phase 1: Data Infrastructure (Week 1)
- [ ] Set up TimescaleDB with hypertables
- [ ] Create backfill script for historical prices
- [ ] Implement continuous price collection service
- [ ] Create pattern_windows table and generation job

### Phase 2: Python DTW Service (Week 2)
- [ ] Set up Python FastAPI service
- [ ] Implement pattern search with dtaidistance
- [ ] Add LB_Keogh filtering
- [ ] Create gRPC/HTTP endpoints

### Phase 3: Node.js Integration (Week 3)
- [ ] Create /api/patterns/match endpoint
- [ ] Add Redis caching layer
- [ ] Integrate with frontend API

### Phase 4: Frontend (Week 4)
- [ ] Pattern highlight on chart
- [ ] Prediction display box
- [ ] Example matches modal
- [ ] Settings (window size, horizon)

### Phase 5: Optimization (Week 5)
- [ ] Add market clustering
- [ ] Implement hierarchical search
- [ ] Performance benchmarking
- [ ] Statistical validation

---

## Monitoring & Validation

### Accuracy Tracking

```sql
-- Track prediction accuracy over time
CREATE TABLE prediction_accuracy (
  id SERIAL PRIMARY KEY,
  token_id VARCHAR(100),
  predicted_direction VARCHAR(4),
  actual_direction VARCHAR(4),
  confidence DECIMAL(5, 4),
  horizon VARCHAR(10),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Accuracy over last 30 days
SELECT
  horizon,
  COUNT(*) as predictions,
  AVG(CASE WHEN predicted_direction = actual_direction THEN 1 ELSE 0 END) as accuracy
FROM prediction_accuracy
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY horizon;
```

### Key Metrics

| Metric | Target | Description |
|--------|--------|-------------|
| Pattern search latency | < 500ms | Time to find matches |
| Prediction accuracy | > 52% | Better than random |
| Match coverage | > 50% | % of patterns with matches |
| Data freshness | < 5min | Age of latest candle |

---

## Risk Factors & Disclaimers

### Why This Might Not Work

1. **Prediction markets ≠ Stock markets**
   - Prices are bounded [0, 1]
   - Resolution is binary
   - News events dominate

2. **Pattern matching limitations**
   - Past patterns don't guarantee future results
   - Markets are adaptive (patterns get arbitraged away)
   - Sample size issues for rare patterns

3. **Statistical significance**
   - 52-55% accuracy is barely above random
   - Transaction costs may eat profits
   - Survivorship bias in historical data

### Disclaimer for Users

```
PATTERN MATCHING DISCLAIMER

This feature shows historical pattern matches for educational purposes only.
- Past performance does not indicate future results
- Prediction markets are primarily driven by real-world events, not technical patterns
- Accuracy is only marginally better than random (if at all)
- Do not make trading decisions based solely on pattern matching

Use at your own risk.
```

---

## References

- [dtaidistance Library](https://github.com/wannesm/dtaidistance)
- [FastDTW Paper](https://cs.fit.edu/~pkc/papers/tdm04.pdf)
- [Dynamic Time Warping - Wikipedia](https://en.wikipedia.org/wiki/Dynamic_time_warping)
- [Advances in Financial ML (Lopez de Prado)](https://agorism.dev/book/finance/ml/) - Chapter on alternative bars
- [LB_Keogh Lower Bound](https://www.cs.ucr.edu/~eamonn/LB_Keogh.htm)
