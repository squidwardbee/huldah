import { useState, useEffect, useRef, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createChart, ColorType, LineStyle, LineSeries, CandlestickSeries, type IChartApi, type ISeriesApi, type Time } from 'lightweight-charts';
import { getPriceHistory, getPatternMatch, type PriceHistoryPoint } from '../../lib/tradingApi';
import { PatternPrediction } from './PatternPrediction';

interface PriceChartProps {
  tokenId: string;
  outcome?: 'YES' | 'NO';
}

type ChartType = 'line' | 'candle';
type TimeInterval = '1h' | '6h' | '1d' | '1w' | 'max';

interface CandleData {
  time: Time;
  open: number;
  high: number;
  low: number;
  close: number;
}

// Aggregate price history into OHLC candles
function aggregateToCandles(history: PriceHistoryPoint[], candleIntervalMinutes: number): CandleData[] {
  if (history.length === 0) return [];

  const candleIntervalMs = candleIntervalMinutes * 60 * 1000;
  const candles: CandleData[] = [];
  let currentCandle: CandleData | null = null;
  let currentCandleTime = 0;

  for (const point of history) {
    const candleStart = Math.floor(point.t * 1000 / candleIntervalMs) * candleIntervalMs / 1000;

    if (!currentCandle || currentCandleTime !== candleStart) {
      if (currentCandle) {
        candles.push(currentCandle);
      }
      currentCandleTime = candleStart;
      currentCandle = {
        time: candleStart as Time,
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

  if (currentCandle) {
    candles.push(currentCandle);
  }

  return candles;
}

export function PriceChart({ tokenId, outcome = 'YES' }: PriceChartProps) {
  const lineColor = outcome === 'YES' ? '#00ff88' : '#ff3366';
  const upColor = outcome === 'YES' ? '#00ff88' : '#ff3366';
  const downColor = outcome === 'YES' ? '#ff3366' : '#00ff88';
  const [chartType, setChartType] = useState<ChartType>('line');
  const [interval, setInterval] = useState<TimeInterval>('1d');
  const [showDTW, setShowDTW] = useState(false);
  const [selectedMatchIndex, setSelectedMatchIndex] = useState(0);
  const [lockedPrediction, setLockedPrediction] = useState<{
    queryEndTime: number;
    currentPrice: number;
    predictedPrice: number;
    direction: 'UP' | 'DOWN' | 'FLAT';
    similarity: number;
    queryData: { time: Time; value: number }[];
  } | null>(null);

  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Line'> | ISeriesApi<'Candlestick'> | null>(null);
  const patternSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const queryHighlightRef = useRef<ISeriesApi<'Line'> | null>(null);
  const lockedPredictionSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const lockedQuerySeriesRef = useRef<ISeriesApi<'Line'> | null>(null);

  // Fetch historical price data
  const { data: priceHistory = [], isLoading } = useQuery({
    queryKey: ['priceHistory', tokenId, interval],
    queryFn: () => getPriceHistory(tokenId, interval),
    enabled: !!tokenId,
    staleTime: 60000,
    refetchInterval: 30000,
  });

  // Fetch DTW pattern match data when DTW is enabled
  const { data: patternData } = useQuery({
    queryKey: ['patternMatch', tokenId],
    queryFn: () => getPatternMatch(tokenId, { horizon: '4h', topK: 100 }),
    enabled: !!tokenId && showDTW,
    staleTime: 60000,
    refetchInterval: 300000,
  });

  // Convert price history to chart data
  const chartData = useMemo(() => {
    if (priceHistory.length === 0) return { line: [], candles: [] };

    // Sort by timestamp and deduplicate (keep last value for each timestamp)
    const sorted = [...priceHistory].sort((a, b) => a.t - b.t);
    const deduped: PriceHistoryPoint[] = [];
    for (const point of sorted) {
      if (deduped.length === 0 || deduped[deduped.length - 1].t < point.t) {
        deduped.push(point);
      } else {
        // Same timestamp - update with latest value
        deduped[deduped.length - 1] = point;
      }
    }

    // Line data: convert timestamps to Time type
    const lineData = deduped.map(p => ({
      time: p.t as Time,
      value: p.p,
    }));

    // Candle interval based on selected timeframe
    const candleMinutes = interval === '1h' ? 5 : interval === '6h' ? 15 : interval === '1d' ? 60 : 240;
    const candles = aggregateToCandles(deduped, candleMinutes);

    return { line: lineData, candles };
  }, [priceHistory, interval]);

  // Initialize and update chart
  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Create chart
    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#666',
        fontFamily: 'JetBrains Mono, monospace',
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.05)' },
        horzLines: { color: 'rgba(255,255,255,0.05)' },
      },
      crosshair: {
        vertLine: { color: '#00fff5', width: 1, style: LineStyle.Dashed },
        horzLine: { color: '#00fff5', width: 1, style: LineStyle.Dashed },
      },
      rightPriceScale: {
        borderColor: 'rgba(255,255,255,0.1)',
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderColor: 'rgba(255,255,255,0.1)',
        timeVisible: true,
        secondsVisible: false,
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true },
      handleScale: { mouseWheel: true, pinch: true },
    });

    chartRef.current = chart;

    // Handle resize
    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        });
      }
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(chartContainerRef.current);

    return () => {
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      patternSeriesRef.current = null;
      queryHighlightRef.current = null;
      lockedPredictionSeriesRef.current = null;
      lockedQuerySeriesRef.current = null;
    };
  }, [tokenId]);

  // Update chart series when data or chart type changes
  useEffect(() => {
    if (!chartRef.current) return;

    // Remove existing series
    if (seriesRef.current) {
      chartRef.current.removeSeries(seriesRef.current);
      seriesRef.current = null;
    }

    if (chartType === 'line') {
      const lineSeries = chartRef.current.addSeries(LineSeries, {
        color: lineColor,
        lineWidth: 2,
        priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
      });

      if (chartData.line.length > 0) {
        // Ensure line data is sorted (already deduplicated in useMemo)
        const sortedLine = [...chartData.line].sort((a, b) => (a.time as unknown as number) - (b.time as unknown as number));
        lineSeries.setData(sortedLine);
      }
      seriesRef.current = lineSeries;
    } else {
      const candleSeries = chartRef.current.addSeries(CandlestickSeries, {
        upColor: upColor,
        downColor: downColor,
        borderUpColor: upColor,
        borderDownColor: downColor,
        wickUpColor: upColor,
        wickDownColor: downColor,
        priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
      });

      if (chartData.candles.length > 0) {
        // Ensure candles are sorted and deduplicated
        const sortedCandles = [...chartData.candles].sort((a, b) => (a.time as unknown as number) - (b.time as unknown as number));
        const dedupedCandles: CandleData[] = [];
        for (const candle of sortedCandles) {
          if (dedupedCandles.length === 0 || (dedupedCandles[dedupedCandles.length - 1].time as unknown as number) < (candle.time as unknown as number)) {
            dedupedCandles.push(candle);
          }
        }
        candleSeries.setData(dedupedCandles);
      }
      seriesRef.current = candleSeries;
    }

    // Fit content
    chartRef.current.timeScale().fitContent();
  }, [chartType, chartData, lineColor, upColor, downColor]);

  // Add DTW pattern overlay when enabled and data available
  useEffect(() => {
    if (!chartRef.current) return;

    // Remove existing pattern series
    if (patternSeriesRef.current) {
      chartRef.current.removeSeries(patternSeriesRef.current);
      patternSeriesRef.current = null;
    }
    if (queryHighlightRef.current) {
      chartRef.current.removeSeries(queryHighlightRef.current);
      queryHighlightRef.current = null;
    }

    if (!showDTW || !patternData || patternData.matches.length === 0) return;

    const match = patternData.matches[selectedMatchIndex];
    if (!match?.patternData || !patternData.query?.data) return;

    // Get the time range of the query (last 20 candles)
    const queryStartTime = new Date(patternData.query.startTime).getTime() / 1000;
    const queryEndTime = new Date(patternData.query.endTime).getTime() / 1000;
    const queryDuration = queryEndTime - queryStartTime;
    const timeStep = queryDuration / (patternData.query.data.length - 1);

    // Get the current price (end of query) to project from
    const currentPrice = patternData.query.data[patternData.query.data.length - 1];

    // Get the outcome value (price change after 4h)
    const outcomeValue = match.outcome4h ?? 0;
    const predictedPrice = currentPrice + outcomeValue;
    const predictionColor = match.direction === 'UP' ? '#00ff88' : match.direction === 'DOWN' ? '#ff3366' : '#ffaa00';

    // Create a SINGLE continuous line that goes from analyzed portion into prediction
    // The analyzed portion is solid magenta, the prediction portion is dashed colored

    // First, create the query highlight series (solid magenta for analyzed portion)
    const queryHighlight = chartRef.current.addSeries(LineSeries, {
      color: '#ff00ff', // Magenta for query pattern
      lineWidth: 3,
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
    });

    const queryHighlightData = patternData.query.data.map((value, i) => ({
      time: (queryStartTime + i * timeStep) as Time,
      value,
    }));
    queryHighlight.setData(queryHighlightData);
    queryHighlightRef.current = queryHighlight;

    // Create prediction line - starts from the LAST point of the query (to connect them)
    const patternSeries = chartRef.current.addSeries(LineSeries, {
      color: predictionColor,
      lineWidth: 3,
      lineStyle: LineStyle.Dashed,
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
    });

    // Prediction trajectory starts at current price (end of query) and extends 4h into future
    const futureTimeStep = timeStep;
    const predictionHorizon = 48; // 4 hours of 5-min candles

    // Start prediction from the end of the query line to visually connect them
    const predictionData: { time: Time; value: number }[] = [
      // First point overlaps with last point of query to create visual connection
      { time: queryEndTime as Time, value: currentPrice },
    ];

    // Add curved prediction path (ease-out curve for more natural look)
    for (let i = 1; i <= predictionHorizon; i++) {
      const progress = i / predictionHorizon;
      // Ease-out curve: starts fast, slows down
      const easedProgress = 1 - Math.pow(1 - progress, 2);
      const interpolatedPrice = currentPrice + (predictedPrice - currentPrice) * easedProgress;
      predictionData.push({
        time: (queryEndTime + i * futureTimeStep) as Time,
        value: interpolatedPrice,
      });
    }

    patternSeries.setData(predictionData);
    patternSeriesRef.current = patternSeries;

    // Fit content to show the prediction
    chartRef.current.timeScale().fitContent();

  }, [showDTW, patternData, selectedMatchIndex]);

  // Render locked prediction (persisted prediction to compare against actual price)
  useEffect(() => {
    if (!chartRef.current) return;

    // Remove existing locked prediction series
    if (lockedPredictionSeriesRef.current) {
      chartRef.current.removeSeries(lockedPredictionSeriesRef.current);
      lockedPredictionSeriesRef.current = null;
    }
    if (lockedQuerySeriesRef.current) {
      chartRef.current.removeSeries(lockedQuerySeriesRef.current);
      lockedQuerySeriesRef.current = null;
    }

    if (!lockedPrediction) return;

    // Create the locked query highlight (semi-transparent magenta)
    const lockedQuerySeries = chartRef.current.addSeries(LineSeries, {
      color: 'rgba(255, 0, 255, 0.4)', // Faded magenta
      lineWidth: 2,
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
    });
    lockedQuerySeries.setData(lockedPrediction.queryData);
    lockedQuerySeriesRef.current = lockedQuerySeries;

    // Create locked prediction line
    const predictionColor = lockedPrediction.direction === 'UP' ? 'rgba(0, 255, 136, 0.5)' :
                            lockedPrediction.direction === 'DOWN' ? 'rgba(255, 51, 102, 0.5)' : 'rgba(255, 170, 0, 0.5)';

    const lockedPredictionSeries = chartRef.current.addSeries(LineSeries, {
      color: predictionColor,
      lineWidth: 2,
      lineStyle: LineStyle.Dotted,
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
    });

    // Recreate the prediction curve from locked data
    const timeStep = 300; // 5 min in seconds
    const predictionHorizon = 48;
    const predictionData: { time: Time; value: number }[] = [
      { time: lockedPrediction.queryEndTime as Time, value: lockedPrediction.currentPrice },
    ];

    for (let i = 1; i <= predictionHorizon; i++) {
      const progress = i / predictionHorizon;
      const easedProgress = 1 - Math.pow(1 - progress, 2);
      const interpolatedPrice = lockedPrediction.currentPrice + (lockedPrediction.predictedPrice - lockedPrediction.currentPrice) * easedProgress;
      predictionData.push({
        time: (lockedPrediction.queryEndTime + i * timeStep) as Time,
        value: interpolatedPrice,
      });
    }

    lockedPredictionSeries.setData(predictionData);
    lockedPredictionSeriesRef.current = lockedPredictionSeries;

  }, [lockedPrediction]);

  if (!tokenId) {
    return (
      <div className="bg-terminal-surface/80 border border-terminal-border rounded-lg p-6 flex items-center justify-center h-full">
        <span className="text-terminal-muted text-sm">Select a market to view chart</span>
      </div>
    );
  }

  return (
    <div className="bg-terminal-surface/80 border border-terminal-border rounded-lg overflow-hidden flex flex-col h-full">
      {/* Header with controls - compact */}
      <div className="px-2 py-1 border-b border-terminal-border flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          {/* Time interval selector */}
          <div className="flex">
            {(['1h', '6h', '1d', '1w'] as const).map((int) => (
              <button
                key={int}
                onClick={() => setInterval(int)}
                className={`px-1.5 py-0.5 text-[9px] font-mono transition-all ${
                  interval === int
                    ? 'text-neon-cyan'
                    : 'text-terminal-muted hover:text-white'
                }`}
              >
                {int.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {/* Chart type selector */}
        <div className="flex gap-1 items-center">
          <button
            onClick={() => setChartType('line')}
            className={`px-1.5 py-0.5 text-[9px] font-mono transition-all ${
              chartType === 'line' ? 'text-neon-green' : 'text-terminal-muted hover:text-white'
            }`}
          >
            LINE
          </button>
          <button
            onClick={() => setChartType('candle')}
            className={`px-1.5 py-0.5 text-[9px] font-mono transition-all ${
              chartType === 'candle' ? 'text-neon-amber' : 'text-terminal-muted hover:text-white'
            }`}
          >
            CANDLE
          </button>
          <span className="text-terminal-border mx-1">|</span>
          <button
            onClick={() => setShowDTW(!showDTW)}
            className={`px-1.5 py-0.5 text-[9px] font-mono transition-all flex items-center gap-1 ${
              showDTW ? 'text-neon-magenta' : 'text-terminal-muted hover:text-neon-magenta'
            }`}
            title="Pattern matching prediction (DTW)"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            DTW
          </button>
        </div>
      </div>

      {/* Chart container */}
      <div className="flex-1 relative min-h-0">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-terminal-surface/80 z-10">
            <div className="text-terminal-muted text-xs animate-pulse">Loading...</div>
          </div>
        )}

        {!isLoading && priceHistory.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-terminal-muted text-[10px]">No data</div>
          </div>
        )}

        <div ref={chartContainerRef} className="w-full h-full" />

        {/* DTW Pattern Legend (when patterns are shown on chart) */}
        {showDTW && patternData && patternData.matches.length > 0 && (
          <div className="absolute bottom-2 left-2 z-20 bg-terminal-surface/90 border border-terminal-border rounded p-2 text-[9px] font-mono">
            <div className="flex items-center gap-3 mb-1">
              <div className="flex items-center gap-1">
                <div className="w-4 h-0.5 bg-neon-magenta"></div>
                <span className="text-terminal-muted">Analyzed</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-4 h-0.5 border-t-2 border-dashed" style={{ borderColor: patternData.matches[selectedMatchIndex]?.direction === 'UP' ? '#00ff88' : patternData.matches[selectedMatchIndex]?.direction === 'DOWN' ? '#ff3366' : '#ffaa00' }}></div>
                <span className="text-terminal-muted">4h Prediction</span>
              </div>
            </div>
            {/* Show the predicted move for this match */}
            {patternData.matches[selectedMatchIndex] && (
              <div className="flex items-center gap-2 mt-1">
                <span className={`font-bold ${
                  patternData.matches[selectedMatchIndex].direction === 'UP' ? 'text-neon-green' :
                  patternData.matches[selectedMatchIndex].direction === 'DOWN' ? 'text-neon-red' : 'text-neon-amber'
                }`}>
                  {patternData.matches[selectedMatchIndex].direction === 'UP' ? '+' : ''}
                  {((patternData.matches[selectedMatchIndex].outcome4h ?? 0) * 100).toFixed(2)}%
                </span>
                <span className="text-terminal-muted">
                  ({patternData.matches[selectedMatchIndex].similarity}% match)
                </span>
              </div>
            )}
            {patternData.matches.length > 1 && (
              <div className="flex items-center gap-1 mt-1">
                <button
                  onClick={() => setSelectedMatchIndex(Math.max(0, selectedMatchIndex - 1))}
                  disabled={selectedMatchIndex === 0}
                  className="px-1 py-0.5 text-terminal-muted hover:text-white disabled:opacity-30"
                >
                  &larr;
                </button>
                <span className="text-terminal-muted">
                  Match {selectedMatchIndex + 1}/{Math.min(10, patternData.matches.length)}
                </span>
                <button
                  onClick={() => setSelectedMatchIndex(Math.min(Math.min(9, patternData.matches.length - 1), selectedMatchIndex + 1))}
                  disabled={selectedMatchIndex >= Math.min(9, patternData.matches.length - 1)}
                  className="px-1 py-0.5 text-terminal-muted hover:text-white disabled:opacity-30"
                >
                  &rarr;
                </button>
              </div>
            )}
            {patternData.matches[selectedMatchIndex] && (
              <div className="mt-1 text-[8px] text-terminal-muted truncate max-w-[200px]">
                From: {patternData.matches[selectedMatchIndex].marketQuestion}
              </div>
            )}
            {/* Lock/Unlock prediction button */}
            <button
              onClick={() => {
                if (lockedPrediction) {
                  // Unlock
                  setLockedPrediction(null);
                } else if (patternData.matches[selectedMatchIndex]) {
                  // Lock current prediction
                  const match = patternData.matches[selectedMatchIndex];
                  const queryStartTime = new Date(patternData.query.startTime).getTime() / 1000;
                  const queryEndTime = new Date(patternData.query.endTime).getTime() / 1000;
                  const queryDuration = queryEndTime - queryStartTime;
                  const timeStep = queryDuration / (patternData.query.data.length - 1);
                  const currentPrice = patternData.query.data[patternData.query.data.length - 1];
                  const outcomeValue = match.outcome4h ?? 0;

                  setLockedPrediction({
                    queryEndTime,
                    currentPrice,
                    predictedPrice: currentPrice + outcomeValue,
                    direction: match.direction ?? 'FLAT',
                    similarity: match.similarity,
                    queryData: patternData.query.data.map((value, i) => ({
                      time: (queryStartTime + i * timeStep) as Time,
                      value,
                    })),
                  });
                }
              }}
              className={`mt-2 px-2 py-0.5 text-[8px] rounded border transition-all ${
                lockedPrediction
                  ? 'bg-neon-amber/20 border-neon-amber/50 text-neon-amber hover:bg-neon-amber/30'
                  : 'bg-terminal-border/50 border-terminal-border text-terminal-muted hover:text-white hover:border-neon-cyan'
              }`}
            >
              {lockedPrediction ? '🔒 UNLOCK' : '📌 LOCK PREDICTION'}
            </button>
            {lockedPrediction && (
              <div className="mt-1 text-[7px] text-neon-amber/70">
                Prediction locked - watch actual price vs prediction
              </div>
            )}
          </div>
        )}

        {/* DTW Pattern Prediction Overlay */}
        {showDTW && (
          <div className="absolute top-2 right-2 z-20 w-64">
            <PatternPrediction tokenId={tokenId} onClose={() => setShowDTW(false)} />
          </div>
        )}
      </div>
    </div>
  );
}
