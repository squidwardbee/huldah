/**
 * Pattern Matching utilities using Dynamic Time Warping (DTW)
 *
 * DTW measures similarity between two time series that may vary in speed.
 * Used to find historical patterns similar to current price action.
 */

/**
 * Compute DTW distance between two time series with early abandonment
 * Uses O(n*m) dynamic programming with pruning
 */
export function computeDTW(
  series1: number[],
  series2: number[],
  maxDistance: number = Infinity
): number {
  const n = series1.length;
  const m = series2.length;

  if (n === 0 || m === 0) return Infinity;

  // Use two rows for memory efficiency
  let prevRow = new Array(m + 1).fill(Infinity);
  let currRow = new Array(m + 1).fill(Infinity);
  prevRow[0] = 0;

  for (let i = 1; i <= n; i++) {
    currRow[0] = Infinity;
    let rowMin = Infinity;

    for (let j = 1; j <= m; j++) {
      const cost = Math.abs(series1[i - 1] - series2[j - 1]);
      currRow[j] = cost + Math.min(
        prevRow[j],     // insertion
        currRow[j - 1], // deletion
        prevRow[j - 1]  // match
      );
      rowMin = Math.min(rowMin, currRow[j]);
    }

    // Early abandonment - if minimum in row exceeds threshold, no point continuing
    if (rowMin > maxDistance) {
      return Infinity;
    }

    // Swap rows
    [prevRow, currRow] = [currRow, prevRow];
  }

  return prevRow[m];
}

/**
 * Compute DTW with window constraint (Sakoe-Chiba band)
 * Only allows warping within a window of size w
 */
export function computeDTWWindowed(
  series1: number[],
  series2: number[],
  windowSize: number,
  maxDistance: number = Infinity
): number {
  const n = series1.length;
  const m = series2.length;

  if (n === 0 || m === 0) return Infinity;

  // Adapt window size if series lengths differ significantly
  const w = Math.max(windowSize, Math.abs(n - m));

  // Initialize DTW matrix with infinity
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
        dtw[i - 1][j],
        dtw[i][j - 1],
        dtw[i - 1][j - 1]
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

/**
 * LB_Keogh lower bound for fast filtering
 * If LB_Keogh > threshold, then DTW > threshold (guaranteed)
 * Much faster than full DTW - use for pre-filtering
 */
export function lbKeogh(
  query: number[],
  candidate: number[],
  windowSize: number
): number {
  const n = query.length;
  let lbSum = 0;

  for (let i = 0; i < n; i++) {
    const jStart = Math.max(0, i - windowSize);
    const jEnd = Math.min(n - 1, i + windowSize);

    // Find upper and lower envelope of candidate in window
    let upper = -Infinity;
    let lower = Infinity;
    for (let j = jStart; j <= jEnd && j < candidate.length; j++) {
      upper = Math.max(upper, candidate[j]);
      lower = Math.min(lower, candidate[j]);
    }

    // If query point is outside envelope, add to lower bound
    if (query[i] > upper) {
      lbSum += (query[i] - upper) ** 2;
    } else if (query[i] < lower) {
      lbSum += (lower - query[i]) ** 2;
    }
  }

  return Math.sqrt(lbSum);
}

/**
 * Normalize a time series to [0, 1] range
 */
export function normalizeTimeSeries(series: number[]): number[] {
  if (series.length === 0) return [];

  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = max - min;

  if (range === 0) {
    // All values are the same
    return series.map(() => 0.5);
  }

  return series.map((v) => (v - min) / range);
}

/**
 * Z-score normalization (mean=0, std=1)
 * Better for DTW as it normalizes both location and scale
 */
export function zNormalize(series: number[]): number[] {
  if (series.length === 0) return [];

  const mean = series.reduce((a, b) => a + b, 0) / series.length;
  const variance =
    series.reduce((sum, val) => sum + (val - mean) ** 2, 0) / series.length;
  const std = Math.sqrt(variance);

  if (std === 0) {
    return series.map(() => 0);
  }

  return series.map((v) => (v - mean) / std);
}

/**
 * Convert DTW distance to a similarity score (0-100)
 * Lower distance = higher score
 */
export function dtwToScore(distance: number, maxExpectedDistance: number = 2): number {
  if (!isFinite(distance)) return 0;
  const normalized = Math.min(distance / maxExpectedDistance, 1);
  return Math.round((1 - normalized) * 100);
}

export interface PatternMatch {
  tokenId: string;
  marketId?: string;
  marketQuestion?: string;
  windowStart: Date;
  windowEnd: Date;
  distance: number;
  similarity: number;
  outcome1h?: number;
  outcome4h?: number;
  outcome24h?: number;
  direction?: 'UP' | 'DOWN' | 'FLAT';
  patternData?: number[]; // Normalized pattern data for visualization
}

export interface PatternSearchResult {
  query: {
    startTime: Date;
    endTime: Date;
    data: number[];
    normalized: number[];
  };
  matches: PatternMatch[];
  statistics: {
    totalMatches: number;
    upCount: number;
    downCount: number;
    flatCount: number;
    upPercentage: number;
    downPercentage: number;
    avgUpMove: number;
    avgDownMove: number;
    avgDistance: number;
  };
  prediction: {
    direction: 'UP' | 'DOWN' | 'NEUTRAL';
    confidence: number;
    expectedMove: number;
  };
}

/**
 * Determine direction from price change
 */
export function getDirection(change: number, threshold: number = 0.005): 'UP' | 'DOWN' | 'FLAT' {
  if (change > threshold) return 'UP';
  if (change < -threshold) return 'DOWN';
  return 'FLAT';
}

/**
 * Calculate statistical significance using binomial test approximation
 * Returns p-value for the hypothesis that success rate differs from 0.5
 */
export function calculateSignificance(successes: number, total: number): number {
  if (total < 10) return 1; // Not enough data

  const p = 0.5; // null hypothesis: 50% chance
  const observed = successes / total;
  const se = Math.sqrt((p * (1 - p)) / total);
  const z = Math.abs(observed - p) / se;

  // Approximate p-value from z-score (two-tailed)
  // Using error function approximation
  const pValue = 2 * (1 - normalCDF(z));
  return pValue;
}

/**
 * Standard normal CDF approximation
 */
function normalCDF(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);

  const t = 1.0 / (1.0 + p * x);
  const y =
    1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return 0.5 * (1.0 + sign * y);
}
