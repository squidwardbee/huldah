import { useState, useEffect, useRef, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createChart, ColorType, LineStyle, LineSeries, CandlestickSeries, type IChartApi, type ISeriesApi, type Time } from 'lightweight-charts';
import { getPriceHistory, type PriceHistoryPoint } from '../../lib/tradingApi';

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

  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Line'> | ISeriesApi<'Candlestick'> | null>(null);

  // Fetch historical price data
  const { data: priceHistory = [], isLoading } = useQuery({
    queryKey: ['priceHistory', tokenId, interval],
    queryFn: () => getPriceHistory(tokenId, interval),
    enabled: !!tokenId,
    staleTime: 60000,
    refetchInterval: 30000,
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
        <div className="flex gap-1">
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
      </div>
    </div>
  );
}
