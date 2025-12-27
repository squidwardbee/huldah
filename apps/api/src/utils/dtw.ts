/**
 * Dynamic Time Warping (DTW) Algorithm
 *
 * Computes the optimal alignment between two time series, allowing for
 * temporal shifts. Used to detect wallets whose trading patterns
 * correlate with future price movements.
 */

export interface TimeSeriesPoint {
  timestamp: number;
  value: number;
}

/**
 * Compute DTW distance between two time series
 * Lower distance = more similar patterns
 */
export function computeDTW(
  series1: number[],
  series2: number[],
  windowSize?: number
): { distance: number; path: [number, number][] } {
  const n = series1.length;
  const m = series2.length;

  if (n === 0 || m === 0) {
    return { distance: Infinity, path: [] };
  }

  // Initialize cost matrix with infinity
  const dtw: number[][] = Array(n + 1).fill(null).map(() =>
    Array(m + 1).fill(Infinity)
  );
  dtw[0][0] = 0;

  // Compute window constraint if specified
  const w = windowSize ?? Math.max(n, m);

  // Fill the cost matrix
  for (let i = 1; i <= n; i++) {
    const jStart = Math.max(1, i - w);
    const jEnd = Math.min(m, i + w);

    for (let j = jStart; j <= jEnd; j++) {
      const cost = Math.abs(series1[i - 1] - series2[j - 1]);
      dtw[i][j] = cost + Math.min(
        dtw[i - 1][j],     // insertion
        dtw[i][j - 1],     // deletion
        dtw[i - 1][j - 1]  // match
      );
    }
  }

  // Backtrack to find optimal path
  const path: [number, number][] = [];
  let i = n, j = m;

  while (i > 0 && j > 0) {
    path.unshift([i - 1, j - 1]);

    const diag = dtw[i - 1][j - 1];
    const left = dtw[i][j - 1];
    const up = dtw[i - 1][j];

    if (diag <= left && diag <= up) {
      i--; j--;
    } else if (left < up) {
      j--;
    } else {
      i--;
    }
  }

  return {
    distance: dtw[n][m],
    path
  };
}

/**
 * Normalize DTW distance to 0-1 range
 * 0 = perfect correlation, 1 = no correlation
 */
export function normalizeDTWDistance(distance: number, seriesLength: number): number {
  if (seriesLength === 0) return 1;
  // Normalize by path length to make comparable across different lengths
  const normalized = distance / seriesLength;
  // Clamp to 0-1
  return Math.min(1, Math.max(0, normalized));
}

/**
 * Convert DTW distance to a "predictive score" (0-100)
 * Higher = wallet trades predict price moves better
 */
export function dtwToScore(normalizedDistance: number): number {
  // Invert so lower distance = higher score
  // Apply sigmoid-like transformation for better distribution
  const inverted = 1 - normalizedDistance;
  return Math.round(inverted * 100);
}

/**
 * Create a trade signal time series from wallet trades
 * Positive values = buys, negative = sells, weighted by size
 */
export function createTradeSignal(
  trades: Array<{ timestamp: number; side: 'BUY' | 'SELL'; usdValue: number }>,
  timestamps: number[]
): number[] {
  const signal: number[] = new Array(timestamps.length).fill(0);

  for (const trade of trades) {
    // Find closest timestamp bucket
    let closestIdx = 0;
    let closestDiff = Infinity;

    for (let i = 0; i < timestamps.length; i++) {
      const diff = Math.abs(timestamps[i] - trade.timestamp);
      if (diff < closestDiff) {
        closestDiff = diff;
        closestIdx = i;
      }
    }

    // Add trade signal (positive for buy, negative for sell)
    const signalValue = trade.side === 'BUY' ? trade.usdValue : -trade.usdValue;
    signal[closestIdx] += signalValue;
  }

  return signal;
}

/**
 * Create price change time series with optional lag
 * lagPeriods > 0 means we're looking at future price changes
 */
export function createPriceChangeSeries(
  prices: Array<{ timestamp: number; price: number }>,
  lagPeriods: number = 1
): { timestamps: number[]; changes: number[] } {
  if (prices.length < lagPeriods + 1) {
    return { timestamps: [], changes: [] };
  }

  const timestamps: number[] = [];
  const changes: number[] = [];

  for (let i = 0; i < prices.length - lagPeriods; i++) {
    timestamps.push(prices[i].timestamp);
    // Future price change (positive = price went up)
    changes.push(prices[i + lagPeriods].price - prices[i].price);
  }

  return { timestamps, changes };
}

/**
 * Normalize a time series to zero mean and unit variance
 */
export function normalizeTimeSeries(series: number[]): number[] {
  if (series.length === 0) return [];

  const mean = series.reduce((a, b) => a + b, 0) / series.length;
  const variance = series.reduce((sum, x) => sum + (x - mean) ** 2, 0) / series.length;
  const std = Math.sqrt(variance) || 1;

  return series.map(x => (x - mean) / std);
}

/**
 * Calculate correlation coefficient between two series
 * Used as a simpler alternative to full DTW for quick checks
 */
export function pearsonCorrelation(series1: number[], series2: number[]): number {
  if (series1.length !== series2.length || series1.length === 0) return 0;

  const n = series1.length;
  const mean1 = series1.reduce((a, b) => a + b, 0) / n;
  const mean2 = series2.reduce((a, b) => a + b, 0) / n;

  let num = 0, den1 = 0, den2 = 0;

  for (let i = 0; i < n; i++) {
    const d1 = series1[i] - mean1;
    const d2 = series2[i] - mean2;
    num += d1 * d2;
    den1 += d1 * d1;
    den2 += d2 * d2;
  }

  const den = Math.sqrt(den1 * den2);
  return den === 0 ? 0 : num / den;
}
