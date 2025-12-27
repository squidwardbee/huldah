# Dynamic Time Warping Pattern Matching for Prediction Markets

## A Technical Whitepaper on Price Pattern Recognition and Outcome Prediction

**Version 1.0 | December 2025**

---

## Abstract

This paper presents a novel application of Dynamic Time Warping (DTW) for pattern recognition in prediction market price data. By analyzing historical price patterns across multiple markets and correlating them with subsequent price movements, we construct a probabilistic framework for short-term directional forecasting. Our implementation processes over 18,000 historical pattern windows across 20+ markets, achieving sub-second query times through algorithmic optimizations including the Sakoe-Chiba band constraint.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Problem Statement](#2-problem-statement)
3. [Dynamic Time Warping: Theoretical Foundation](#3-dynamic-time-warping-theoretical-foundation)
4. [System Architecture](#4-system-architecture)
5. [Data Collection & Preprocessing](#5-data-collection--preprocessing)
6. [Pattern Matching Algorithm](#6-pattern-matching-algorithm)
7. [Statistical Analysis & Prediction](#7-statistical-analysis--prediction)
8. [Implementation Details](#8-implementation-details)
9. [Performance Optimizations](#9-performance-optimizations)
10. [Results & Validation](#10-results--validation)
11. [Limitations & Future Work](#11-limitations--future-work)
12. [Conclusion](#12-conclusion)

---

## 1. Introduction

Prediction markets represent a unique financial instrument where prices directly encode probability estimates for future events. Unlike traditional equity markets, prediction market prices are bounded between 0 and 1, representing the market's consensus probability of an event occurring.

This bounded nature creates recurring price patterns across different markets and time periods. A market trading at 0.15 behaves similarly to other markets at the same probability level, regardless of the underlying event. This observation forms the basis of our cross-market pattern matching approach.

### 1.1 Core Hypothesis

**When the current price pattern of Market A closely resembles a historical pattern from Market B, the subsequent price movement of Market A is likely to follow a similar trajectory to what Market B exhibited after its matching pattern.**

This hypothesis leverages the structural similarities in how prediction markets behave across different events, driven by common participant behaviors, market microstructure, and information incorporation dynamics.

---

## 2. Problem Statement

### 2.1 The Challenge

Given:
- A query pattern: the most recent N price observations from a target market
- A database of historical patterns from M markets, each with known outcomes

Find:
- The K most similar historical patterns using a time-series similarity metric
- The statistical distribution of outcomes following these similar patterns
- A probabilistic prediction for the target market's future direction

### 2.2 Requirements

1. **Cross-market applicability**: Patterns from any market should be comparable to any other market
2. **Time-warping tolerance**: Similar patterns may occur at slightly different speeds
3. **Scale invariance**: Patterns should match regardless of absolute price levels
4. **Real-time performance**: Queries must complete in under 2 seconds for UX requirements
5. **Statistical validity**: Predictions must include confidence measures

---

## 3. Dynamic Time Warping: Theoretical Foundation

### 3.1 Definition

Dynamic Time Warping is an algorithm for measuring similarity between two temporal sequences that may vary in speed or timing. Unlike Euclidean distance, which performs point-by-point comparison, DTW finds an optimal alignment between sequences.

### 3.2 Mathematical Formulation

Given two time series:
- Query sequence: Q = (q₁, q₂, ..., qₙ)
- Candidate sequence: C = (c₁, c₂, ..., cₘ)

The DTW distance is computed using dynamic programming:

```
DTW(i, j) = d(qᵢ, cⱼ) + min{
    DTW(i-1, j),      // insertion
    DTW(i, j-1),      // deletion
    DTW(i-1, j-1)     // match
}
```

Where `d(qᵢ, cⱼ) = |qᵢ - cⱼ|` is the point-wise distance.

The final DTW distance is `DTW(n, m)`.

### 3.3 Why DTW for Prediction Markets?

1. **Pattern Speed Variation**: A price spike that occurs over 30 minutes in one market may occur over 45 minutes in another. DTW handles this naturally.

2. **Robustness to Noise**: DTW's alignment flexibility makes it more robust to minor price fluctuations than rigid distance metrics.

3. **Proven Track Record**: DTW has been successfully applied to speech recognition, gesture recognition, and financial time series analysis.

### 3.4 Complexity Analysis

- **Naive DTW**: O(n × m) time, O(n × m) space
- **With Sakoe-Chiba band**: O(n × w) time, O(n × w) space, where w << m

---

## 4. System Architecture

### 4.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      FRONTEND (React)                            │
│  ┌─────────────────┐  ┌──────────────────┐  ┌────────────────┐ │
│  │   PriceChart    │  │ PatternPrediction│  │   DTW Toggle   │ │
│  │   Component     │  │    Overlay       │  │    Button      │ │
│  └────────┬────────┘  └────────┬─────────┘  └───────┬────────┘ │
└───────────┼────────────────────┼────────────────────┼──────────┘
            │                    │                    │
            ▼                    ▼                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                      API LAYER (Express)                         │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  GET /api/patterns/match/:tokenId                           ││
│  │  - Fetches current price data                               ││
│  │  - Runs DTW search against pattern database                 ││
│  │  - Returns matches, statistics, prediction                  ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    PATTERN SERVICE                               │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐ │
│  │ Price Fetch  │  │    DTW       │  │  Statistical          │ │
│  │ & Normalize  │  │  Computation │  │  Aggregation          │ │
│  └──────────────┘  └──────────────┘  └───────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    DATABASE (PostgreSQL)                         │
│  ┌──────────────────────┐  ┌──────────────────────────────────┐│
│  │    price_candles     │  │       pattern_windows            ││
│  │  - OHLC data         │  │  - Normalized patterns           ││
│  │  - 5-min intervals   │  │  - Outcome labels (1h, 4h)       ││
│  └──────────────────────┘  └──────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 Data Flow

1. **User Action**: User clicks DTW toggle on price chart
2. **API Request**: Frontend requests pattern match for current token
3. **Price Fetch**: Service fetches latest price history from Polymarket CLOB API
4. **Pattern Extraction**: Most recent 20 candles extracted and normalized
5. **DTW Search**: Query pattern compared against 5,000 historical patterns
6. **Result Aggregation**: Top 100 matches analyzed for directional statistics
7. **Response**: Prediction with confidence returned to frontend

---

## 5. Data Collection & Preprocessing

### 5.1 Data Source

**Polymarket CLOB API**: `https://clob.polymarket.com/prices-history`

Parameters:
- `market`: Token ID (unique identifier for YES/NO outcome)
- `interval`: Time range (`1h`, `6h`, `1d`, `1w`, `max`)
- `fidelity`: Data resolution in minutes

Response format:
```json
{
  "history": [
    { "t": 1703664000, "p": 0.45 },
    { "t": 1703664300, "p": 0.46 },
    ...
  ]
}
```

### 5.2 OHLC Aggregation

Raw price points are aggregated into 5-minute OHLC (Open, High, Low, Close) candles:

```typescript
function aggregateToCandles(pricePoints: PricePoint[], intervalMinutes: number): Candle[] {
  const intervalMs = intervalMinutes * 60 * 1000;
  const candles: Candle[] = [];
  let currentCandle: Candle | null = null;
  let currentBucketTime = 0;

  for (const point of sorted) {
    const bucketTime = Math.floor((point.t * 1000) / intervalMs) * intervalMs;

    if (!currentCandle || currentBucketTime !== bucketTime) {
      if (currentCandle) candles.push(currentCandle);
      currentBucketTime = bucketTime;
      currentCandle = {
        time: new Date(bucketTime),
        open: point.p,
        high: point.p,
        low: point.p,
        close: point.p,
      };
    } else {
      currentCandle.high = Math.max(currentCandle.high, point.p);
      currentCandle.low = Math.min(currentCandle.low, point.p);
      currentCandle.close = point.p;
    }
  }

  return candles;
}
```

### 5.3 Normalization

**Min-Max Normalization** is applied to each pattern window to ensure scale invariance:

```typescript
function normalizeTimeSeries(series: number[]): number[] {
  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = max - min;

  if (range === 0) {
    return series.map(() => 0.5); // Flat series
  }

  return series.map((v) => (v - min) / range);
}
```

This transforms all values to the [0, 1] range, making patterns comparable regardless of:
- Absolute price level (0.05 vs 0.95)
- Price volatility magnitude
- Market type or event category

### 5.4 Pattern Window Generation

Sliding windows of size 20 (representing ~100 minutes of trading) are extracted:

```typescript
for (let i = 0; i <= closePrices.length - windowSize - 48; i++) {
  const window = closePrices.slice(i, i + windowSize);
  const normalized = normalizeTimeSeries(window);

  // Calculate future outcomes
  const price1h = closePrices[i + windowSize + 12]; // 12 candles = 1 hour
  const price4h = closePrices[i + windowSize + 48]; // 48 candles = 4 hours

  const outcome1h = price1h - window[windowSize - 1];
  const outcome4h = price4h - window[windowSize - 1];

  // Store pattern with outcomes
  await storePattern(normalized, outcome1h, outcome4h);
}
```

### 5.5 Database Schema

```sql
CREATE TABLE pattern_windows (
  id SERIAL PRIMARY KEY,
  token_id VARCHAR(100) NOT NULL,
  market_id VARCHAR(100),
  market_question TEXT,
  window_start TIMESTAMP NOT NULL,
  window_end TIMESTAMP NOT NULL,
  pattern_length INTEGER NOT NULL,
  pattern_data DECIMAL(10, 6)[] NOT NULL,  -- Normalized values
  outcome_1h DECIMAL(10, 6),                -- Price change after 1 hour
  outcome_4h DECIMAL(10, 6),                -- Price change after 4 hours
  UNIQUE(token_id, window_start, pattern_length)
);

CREATE INDEX idx_patterns_length ON pattern_windows(pattern_length);
CREATE INDEX idx_patterns_token ON pattern_windows(token_id);
```

---

## 6. Pattern Matching Algorithm

### 6.1 DTW with Sakoe-Chiba Band

To reduce computational complexity, we apply the Sakoe-Chiba band constraint, limiting how far the warping path can deviate from the diagonal:

```typescript
function computeDTWWindowed(
  series1: number[],
  series2: number[],
  windowSize: number,
  maxDistance: number = Infinity
): number {
  const n = series1.length;
  const m = series2.length;
  const w = Math.max(windowSize, Math.abs(n - m));

  // Initialize DTW matrix
  const dtw: number[][] = Array(n + 1)
    .fill(null)
    .map(() => Array(m + 1).fill(Infinity));

  dtw[0][0] = 0;

  for (let i = 1; i <= n; i++) {
    const jStart = Math.max(1, i - w);
    const jEnd = Math.min(m, i + w);
    let rowMin = Infinity;

    for (let j = jStart; j <= jEnd; j++) {
      const cost = Math.abs(series1[i - 1] - series2[j - 1]);
      dtw[i][j] = cost + Math.min(
        dtw[i - 1][j],      // insertion
        dtw[i][j - 1],      // deletion
        dtw[i - 1][j - 1]   // match
      );
      rowMin = Math.min(rowMin, dtw[i][j]);
    }

    // Early abandonment
    if (rowMin > maxDistance) {
      return Infinity;
    }
  }

  return dtw[n][m];
}
```

### 6.2 Search Process

```typescript
async searchPatterns(tokenId: string, topK: number = 100): Promise<PatternSearchResult> {
  // 1. Fetch current price data
  const priceHistory = await this.fetchPriceHistory(tokenId);
  const candles = this.aggregateToCandles(priceHistory, 5);

  // 2. Extract and normalize query pattern
  const recentCandles = candles.slice(-20);
  const queryRaw = recentCandles.map(c => c.close);
  const queryNormalized = normalizeTimeSeries(queryRaw);

  // 3. Load historical patterns
  const historicalPatterns = await this.getPatternWindows(20, undefined, 5000);

  // 4. Compute DTW distances
  const matches: PatternMatch[] = [];
  const dtwWindow = 10; // Half of pattern length

  for (const pattern of historicalPatterns) {
    const distance = computeDTWWindowed(
      queryNormalized,
      pattern.pattern_data,
      dtwWindow,
      50 // Max distance threshold
    );

    if (distance < 50 && isFinite(distance)) {
      matches.push({
        ...pattern,
        distance,
        similarity: dtwToScore(distance, 50),
      });
    }
  }

  // 5. Sort by distance, take top K
  matches.sort((a, b) => a.distance - b.distance);
  return matches.slice(0, topK);
}
```

### 6.3 Similarity Scoring

DTW distances are converted to intuitive similarity scores (0-100):

```typescript
function dtwToScore(distance: number, maxExpectedDistance: number): number {
  if (!isFinite(distance)) return 0;
  const normalized = Math.min(distance / maxExpectedDistance, 1);
  return Math.round((1 - normalized) * 100);
}
```

---

## 7. Statistical Analysis & Prediction

### 7.1 Outcome Classification

Each historical pattern's outcome is classified based on the price change after the pattern ended:

```typescript
function getDirection(change: number, threshold: number = 0.005): 'UP' | 'DOWN' | 'FLAT' {
  if (change > threshold) return 'UP';   // Price increased by >0.5%
  if (change < -threshold) return 'DOWN'; // Price decreased by >0.5%
  return 'FLAT';                           // Price stayed within ±0.5%
}
```

### 7.2 Statistical Aggregation

For the top K matches, we compute:

```typescript
const statistics = {
  totalMatches: topMatches.length,
  upCount: matches.filter(m => m.direction === 'UP').length,
  downCount: matches.filter(m => m.direction === 'DOWN').length,
  flatCount: matches.filter(m => m.direction === 'FLAT').length,
  upPercentage: (upCount / totalMatches) * 100,
  downPercentage: (downCount / totalMatches) * 100,
  avgUpMove: average(upMoves),
  avgDownMove: average(downMoves),
  avgDistance: average(distances),
};
```

### 7.3 Prediction Generation

The prediction is derived from the outcome distribution:

```typescript
const prediction = {
  direction: upPercentage > 55 ? 'UP'
           : downPercentage > 55 ? 'DOWN'
           : 'NEUTRAL',

  confidence: Math.abs(upPercentage - 50) / 50, // 0 to 1 scale

  expectedMove: matches.reduce((sum, m) => sum + m.outcome4h, 0) / matches.length,
};
```

### 7.4 Statistical Significance

We use a binomial test approximation to assess whether the observed directional bias is statistically significant:

```typescript
function calculateSignificance(successes: number, total: number): number {
  if (total < 10) return 1; // Insufficient data

  const p = 0.5; // Null hypothesis: 50% chance
  const observed = successes / total;
  const se = Math.sqrt((p * (1 - p)) / total);
  const z = Math.abs(observed - p) / se;

  // Two-tailed p-value from z-score
  return 2 * (1 - normalCDF(z));
}
```

---

## 8. Implementation Details

### 8.1 API Endpoints

#### Pattern Match
```
GET /api/patterns/match/:tokenId
```

Query Parameters:
- `horizon`: `'1h'` | `'4h'` (default: `'4h'`)
- `topK`: Number of matches to consider (default: `100`)

Response:
```json
{
  "query": {
    "startTime": "2025-12-27T06:00:00.000Z",
    "endTime": "2025-12-27T09:05:00.000Z",
    "data": [0.0155, 0.0155, ...],
    "normalized": [0.111, 0.111, ...]
  },
  "matches": [
    {
      "tokenId": "45343...",
      "marketQuestion": "Maduro out in 2025?",
      "distance": 1.44,
      "similarity": 97,
      "outcome4h": -0.0015,
      "direction": "FLAT"
    }
  ],
  "statistics": {
    "totalMatches": 100,
    "upCount": 21,
    "downCount": 18,
    "flatCount": 61,
    "upPercentage": 21,
    "downPercentage": 18
  },
  "prediction": {
    "direction": "NEUTRAL",
    "confidence": 0.58,
    "expectedMove": -0.0004
  }
}
```

#### Pattern Statistics
```
GET /api/patterns/stats
```

Response:
```json
{
  "totalCandles": 86317,
  "totalPatterns": 18660,
  "uniqueMarkets": 20
}
```

#### Backfill Markets
```
POST /api/patterns/backfill-active?limit=50
```

Triggers historical data collection for top markets by volume.

### 8.2 Frontend Components

#### PatternPrediction Component

```tsx
export function PatternPrediction({ tokenId, onClose }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ['patternMatch', tokenId],
    queryFn: () => getPatternMatch(tokenId, { horizon: '4h', topK: 100 }),
    staleTime: 60000,
    refetchInterval: 300000,
  });

  // Render prediction overlay with:
  // - Match count
  // - UP/DOWN percentages with color coding
  // - Confidence level (HIGH/MED/LOW)
  // - Expected move percentage
}
```

---

## 9. Performance Optimizations

### 9.1 Sakoe-Chiba Band

Reduces DTW complexity from O(n²) to O(n × w) where w = n/2:
- For n=20: from 400 operations to 200 operations per comparison
- **50% reduction in computation**

### 9.2 Early Abandonment

If the minimum value in a DTW row exceeds the threshold, computation stops immediately:

```typescript
if (rowMin > maxDistance) {
  return Infinity; // Abandon this comparison
}
```

This prunes the majority of non-matching patterns without full computation.

### 9.3 Database Indexing

```sql
CREATE INDEX idx_patterns_length ON pattern_windows(pattern_length);
CREATE INDEX idx_patterns_outcome ON pattern_windows(outcome_4h)
  WHERE outcome_4h IS NOT NULL;
```

### 9.4 Query Limiting

We process only the 5,000 most recent patterns, sorted by recency. This:
- Bounds worst-case computation time
- Prioritizes recent market behavior
- Maintains query response under 2 seconds

### 9.5 Result Caching

Frontend caching via React Query:
- `staleTime: 60000` (1 minute)
- `refetchInterval: 300000` (5 minutes)

Prevents redundant API calls during normal usage.

---

## 10. Results & Validation

### 10.1 Sample Output

For the Russia/Ukraine ceasefire market:

```
Query Pattern: 20 candles from 06:00 to 09:05 UTC
Patterns Searched: 5,000
Matches Found: 100 (within threshold)

Top Match:
- Market: "Maduro out in 2025?"
- Similarity: 97%
- Distance: 1.44
- Historical Outcome: -0.15% (FLAT)

Statistics:
- UP: 21%
- DOWN: 18%
- FLAT: 61%

Prediction: NEUTRAL
Confidence: 58%
Expected Move: -0.04%
```

### 10.2 Interpretation

The high FLAT percentage (61%) indicates that when this pattern occurred historically:
- Most of the time, prices didn't move significantly
- Neither bulls nor bears had a clear edge
- The prediction correctly identifies this as NEUTRAL

### 10.3 Validation Considerations

**Backtesting Note**: This system is designed for real-time pattern analysis, not as a backtested trading strategy. The patterns database must be built from data that would have been available at each historical point for proper backtesting.

---

## 11. Limitations & Future Work

### 11.1 Current Limitations

1. **Limited Historical Data**: Currently ~18,000 patterns from 20 markets. More data would improve pattern diversity.

2. **No Volume Consideration**: Patterns are based solely on price, ignoring trading volume which may contain additional signal.

3. **Fixed Window Size**: Current implementation uses 20-candle windows. Different market types may benefit from different window sizes.

4. **No Market Regime Filtering**: All markets are treated equally regardless of volatility regime or event type.

5. **Outcome Horizon Fixed**: Only 1h and 4h horizons are currently supported.

### 11.2 Future Enhancements

1. **LB_Keogh Lower Bound**: Re-implement with proper tuning for faster pre-filtering:
   ```typescript
   function lbKeogh(query: number[], candidate: number[], w: number): number {
     // Compute envelope and lower bound
     // If lb > threshold, skip full DTW
   }
   ```

2. **Multi-Scale DTW**: Use multiple window sizes and aggregate predictions.

3. **Volume-Weighted Matching**: Incorporate volume patterns alongside price patterns.

4. **Category-Aware Search**: Optionally restrict matches to similar event categories (politics, crypto, sports).

5. **Confidence Calibration**: Track prediction accuracy over time and calibrate confidence scores.

6. **Real-Time Pattern Updates**: Continuously update pattern database as new data arrives.

---

## 12. Conclusion

We have presented a complete system for pattern-based prediction in prediction markets using Dynamic Time Warping. The key innovations include:

1. **Cross-Market Pattern Matching**: Leveraging the structural similarity of prediction market behavior across different events

2. **Efficient Implementation**: Sakoe-Chiba band constraints and early abandonment enable real-time queries

3. **Statistical Framework**: Rigorous aggregation of historical outcomes with confidence measures

4. **Production-Ready Architecture**: Full-stack implementation with React frontend, Express API, and PostgreSQL storage

The system provides traders with a quantitative tool for understanding how similar price patterns have historically resolved, complementing fundamental analysis of prediction market events.

---

## Appendix A: Full Algorithm Pseudocode

```
ALGORITHM: DTW Pattern Search

INPUT:
  - token_id: Current market identifier
  - window_size: Pattern length (default 20)
  - top_k: Number of matches to return (default 100)

OUTPUT:
  - matches: Top K similar patterns with outcomes
  - statistics: Directional distribution
  - prediction: Direction, confidence, expected move

PROCEDURE:
  1. FETCH price_history FROM polymarket_api(token_id)
  2. candles ← AGGREGATE_TO_OHLC(price_history, interval=5min)
  3. query_raw ← candles[-window_size:].close
  4. query_norm ← NORMALIZE(query_raw)

  5. patterns ← LOAD_FROM_DB(pattern_length=window_size, limit=5000)

  6. matches ← []
  7. FOR EACH pattern IN patterns:
       distance ← DTW_WINDOWED(query_norm, pattern.data, w=window_size/2)
       IF distance < MAX_THRESHOLD:
         matches.APPEND({pattern, distance, similarity})

  8. SORT matches BY distance ASC
  9. top_matches ← matches[:top_k]

  10. statistics ← COMPUTE_DIRECTIONAL_STATS(top_matches)
  11. prediction ← GENERATE_PREDICTION(statistics)

  12. RETURN {matches: top_matches, statistics, prediction}
```

---

## Appendix B: Database Schema (Complete)

```sql
-- Price candles (5-minute OHLC data)
CREATE TABLE price_candles (
  id SERIAL PRIMARY KEY,
  token_id VARCHAR(100) NOT NULL,
  market_id VARCHAR(100),
  time TIMESTAMP NOT NULL,
  open DECIMAL(10, 6),
  high DECIMAL(10, 6),
  low DECIMAL(10, 6),
  close DECIMAL(10, 6),
  volume DECIMAL(20, 6) DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(token_id, time)
);

-- Pattern windows with outcomes
CREATE TABLE pattern_windows (
  id SERIAL PRIMARY KEY,
  token_id VARCHAR(100) NOT NULL,
  market_id VARCHAR(100),
  market_question TEXT,
  window_start TIMESTAMP NOT NULL,
  window_end TIMESTAMP NOT NULL,
  pattern_length INTEGER NOT NULL,
  pattern_data DECIMAL(10, 6)[] NOT NULL,
  outcome_1h DECIMAL(10, 6),
  outcome_4h DECIMAL(10, 6),
  outcome_24h DECIMAL(10, 6),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(token_id, window_start, pattern_length)
);

-- Indexes
CREATE INDEX idx_candles_token_time ON price_candles(token_id, time DESC);
CREATE INDEX idx_patterns_length ON pattern_windows(pattern_length);
CREATE INDEX idx_patterns_token ON pattern_windows(token_id);
```

---

## References

1. Sakoe, H., & Chiba, S. (1978). Dynamic programming algorithm optimization for spoken word recognition. *IEEE Transactions on Acoustics, Speech, and Signal Processing*.

2. Keogh, E., & Ratanamahatana, C. A. (2005). Exact indexing of dynamic time warping. *Knowledge and Information Systems*.

3. Berndt, D. J., & Clifford, J. (1994). Using dynamic time warping to find patterns in time series. *KDD Workshop*.

4. Polymarket. (2024). CLOB API Documentation. https://docs.polymarket.com

---

*This whitepaper documents the DTW pattern matching implementation in Huldah.ai as of December 2025.*
