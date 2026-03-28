"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Button, Card, Badge, Spinner, EmptyState } from "@/components/ui";
import { formatPct, cn, signColor } from "@/lib/utils";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { STRATEGY_LABELS, HORIZON_LABELS } from "@/types";
import type { Strategy, Horizon } from "@/types";

// ─── Types ────────────────────────────────────────────────────────────

interface RunInfo {
  id: string;
  startedAt: string;
  completedAt: string | null;
  status: string;
  lookbackYears: number;
  totalDays: number;
  processedDays: number;
  lastProcessedDate: string | null;
}

interface AggMetric {
  strategy: string;
  horizon: string;
  totalPredictions: number;
  directionalAccuracy: number;
  intervalCoverage: number;
  avgPredictedReturn: number;
  avgActualReturn: number;
  avgAbsError: number;
  rankCorrelation: number;
  top10AvgReturn: number;
  universeAvgReturn: number;
  excessReturn: number;
}

interface DailyMetric {
  date: string;
  directionalAccuracy: number;
  intervalCoverage: number;
  avgPredictedReturn: number;
  avgActualReturn: number;
  top10Return: number;
  universeReturn: number;
  stockCount: number;
}

// ─── Page ─────────────────────────────────────────────────────────────

interface CacheStats {
  stocks: number;
  priceBars: number;
  priceRange: { from: string; to: string } | null;
  fundamentals: number;
  insiderTrades: number;
  analystRatings: number;
  earnings: number;
  news: number;
}

export default function ExhaustiveBacktestPage() {
  const [runs, setRuns] = useState<RunInfo[]>([]);
  const [activeRun, setActiveRun] = useState<RunInfo | null>(null);
  const [metrics, setMetrics] = useState<AggMetric[]>([]);
  const [timeSeries, setTimeSeries] = useState<DailyMetric[]>([]);
  const [selectedCombo, setSelectedCombo] = useState<{ strategy: string; horizon: string } | null>(null);

  const [isRunning, setIsRunning] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [progress, setProgress] = useState({ processed: 0, total: 0, lastDate: "" });
  const abortRef = useRef(false);

  // Cache stats + bulk fetch state
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null);
  const [isCaching, setIsCaching] = useState(false);
  const [cacheProgress, setCacheProgress] = useState({ action: "", processed: 0, total: 0 });
  const cacheAbortRef = useRef(false);

  // Load runs + cache stats on mount
  useEffect(() => {
    fetchRuns();
    fetchCacheStats();
  }, []);

  async function fetchCacheStats() {
    try {
      const res = await fetch("/api/bulk-cache");
      const { data } = await res.json();
      if (data) setCacheStats(data);
    } catch {}
  }

  async function runBulkCache(action: "prices" | "fundamentals" | "enrichment" | "all") {
    setIsCaching(true);
    cacheAbortRef.current = false;
    let nextIndex: number | null = 0;

    while (nextIndex !== null && !cacheAbortRef.current) {
      try {
        const res: Response = await fetch("/api/bulk-cache", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, yearsBack: 7, batchSize: 5, startFromIndex: nextIndex }),
        });
        const json = await res.json();
        if (json.error) { console.error("Cache error:", json.error); break; }
        const data = json.data;

        setCacheProgress({
          action,
          processed: (data.startIndex || 0) + data.processed,
          total: data.total,
        });
        nextIndex = data.nextIndex;

        if (data.done) break;
      } catch (err) {
        console.error("Cache fetch failed:", err);
        break;
      }
    }

    setIsCaching(false);
    fetchCacheStats();
  }

  async function fetchRuns() {
    setIsLoading(true);
    try {
      const res = await fetch("/api/exhaustive-backtest?action=runs");
      const { data } = await res.json();
      setRuns(data || []);
      // Auto-select most recent run
      if (data?.length > 0) {
        const latest = data[0];
        setActiveRun(latest);
        if (latest.status === "completed" || latest.processedDays > 0) {
          fetchMetrics(latest.id);
        }
      }
    } catch (err) {
      console.error("Failed to fetch runs:", err);
    } finally {
      setIsLoading(false);
    }
  }

  async function fetchMetrics(runId: string) {
    try {
      const res = await fetch(`/api/exhaustive-backtest?action=metrics&runId=${runId}`);
      const { data } = await res.json();
      setMetrics(data || []);
    } catch (err) {
      console.error("Failed to fetch metrics:", err);
    }
  }

  async function fetchTimeSeries(runId: string, strategy: string, horizon: string) {
    try {
      const res = await fetch(
        `/api/exhaustive-backtest?action=timeseries&runId=${runId}&strategy=${strategy}&horizon=${horizon}`,
      );
      const { data } = await res.json();
      setTimeSeries(data || []);
    } catch (err) {
      console.error("Failed to fetch time series:", err);
    }
  }

  // Start or continue running the exhaustive backtest
  const startBacktest = useCallback(async (runId?: string) => {
    setIsRunning(true);
    abortRef.current = false;

    try {
      let currentRunId = runId;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (abortRef.current) break;

        const res = await fetch("/api/exhaustive-backtest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            runId: currentRunId,
            daysPerChunk: 3,
            lookbackYears: 5,
          }),
        });

        const { data, error } = await res.json();
        if (error) {
          console.error("Backtest error:", error);
          break;
        }

        currentRunId = data.runId;
        setProgress({
          processed: data.processedDays,
          total: data.totalDays,
          lastDate: data.lastProcessedDate,
        });

        // Update active run in state
        setActiveRun((prev) => {
          if (!prev || prev.id !== data.runId) return prev;
          return {
            ...prev,
            processedDays: data.processedDays,
            lastProcessedDate: data.lastProcessedDate,
            status: data.status,
          };
        });

        if (data.status === "completed") {
          fetchRuns();
          fetchMetrics(data.runId);
          break;
        }
      }
    } catch (err) {
      console.error("Backtest failed:", err);
    } finally {
      setIsRunning(false);
    }
  }, []);

  const stopBacktest = () => {
    abortRef.current = true;
  };

  const pctDone = progress.total > 0 ? (progress.processed / progress.total) * 100 : 0;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-display text-text-primary">Exhaustive Backtest</h1>
          <p className="text-sm text-text-secondary mt-1">
            Daily walk-forward: every trading day, every stock, every strategy/horizon combo.
            Strict point-in-time — only uses data available on each simulated day.
          </p>
        </div>
        <div className="flex gap-2">
          {isRunning ? (
            <Button variant="secondary" onClick={stopBacktest}>
              Stop
            </Button>
          ) : activeRun?.status === "running" ? (
            <Button onClick={() => startBacktest(activeRun.id)}>
              Resume
            </Button>
          ) : (
            <Button onClick={() => startBacktest()}>
              Start New Run
            </Button>
          )}
        </div>
      </div>

      {/* Data Cache Stats */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-text-primary">Cached Data</h2>
          <div className="flex gap-2">
            {isCaching ? (
              <Button variant="secondary" size="sm" onClick={() => { cacheAbortRef.current = true; }}>
                Stop Caching
              </Button>
            ) : (
              <>
                <Button variant="secondary" size="sm" onClick={() => runBulkCache("prices")}>
                  Fetch Prices (7yr)
                </Button>
                <Button variant="secondary" size="sm" onClick={() => runBulkCache("enrichment")}>
                  Fetch Enrichment
                </Button>
                <Button size="sm" onClick={() => runBulkCache("all")}>
                  Fetch All Data
                </Button>
              </>
            )}
          </div>
        </div>

        {isCaching && (
          <div className="mb-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-text-secondary">
                Caching {cacheProgress.action}: {cacheProgress.processed}/{cacheProgress.total} stocks
              </span>
              <span className="text-xs font-mono text-text-primary">
                {cacheProgress.total > 0 ? ((cacheProgress.processed / cacheProgress.total) * 100).toFixed(0) : 0}%
              </span>
            </div>
            <div className="w-full bg-surface-3 rounded-full h-1.5">
              <div
                className="bg-amber-500 h-1.5 rounded-full transition-all duration-300"
                style={{ width: `${cacheProgress.total > 0 ? (cacheProgress.processed / cacheProgress.total) * 100 : 0}%` }}
              />
            </div>
          </div>
        )}

        {cacheStats ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-surface-2 rounded-lg p-3">
              <div className="text-xs text-text-tertiary">Price Bars</div>
              <div className="text-lg font-mono text-text-primary">{cacheStats.priceBars.toLocaleString()}</div>
              {cacheStats.priceRange && (
                <div className="text-2xs text-text-tertiary">{cacheStats.priceRange.from} to {cacheStats.priceRange.to}</div>
              )}
            </div>
            <div className="bg-surface-2 rounded-lg p-3">
              <div className="text-xs text-text-tertiary">Fundamentals</div>
              <div className="text-lg font-mono text-text-primary">{cacheStats.fundamentals.toLocaleString()}</div>
              <div className="text-2xs text-text-tertiary">{cacheStats.stocks} stocks</div>
            </div>
            <div className="bg-surface-2 rounded-lg p-3">
              <div className="text-xs text-text-tertiary">Enrichment</div>
              <div className="text-lg font-mono text-text-primary">
                {(cacheStats.insiderTrades + cacheStats.analystRatings + cacheStats.earnings).toLocaleString()}
              </div>
              <div className="text-2xs text-text-tertiary">
                {cacheStats.insiderTrades} insider / {cacheStats.analystRatings} analyst / {cacheStats.earnings} earnings
              </div>
            </div>
            <div className="bg-surface-2 rounded-lg p-3">
              <div className="text-xs text-text-tertiary">News Articles</div>
              <div className="text-lg font-mono text-text-primary">{cacheStats.news.toLocaleString()}</div>
            </div>
          </div>
        ) : (
          <div className="text-sm text-text-tertiary">Loading cache stats...</div>
        )}
      </Card>

      {/* Progress Bar */}
      {(isRunning || activeRun?.status === "running") && (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-text-secondary">
              Processing day {progress.processed} of {progress.total}
              {progress.lastDate && ` (${progress.lastDate})`}
            </span>
            <span className="text-sm font-mono text-text-primary">{pctDone.toFixed(1)}%</span>
          </div>
          <div className="w-full bg-surface-3 rounded-full h-2">
            <div
              className="bg-accent h-2 rounded-full transition-all duration-300"
              style={{ width: `${pctDone}%` }}
            />
          </div>
          <p className="text-xs text-text-tertiary mt-2">
            8 strategy/horizon combos x ~89 stocks x {progress.total} days = {(8 * 89 * (progress.total || 1)).toLocaleString()} total predictions
          </p>
        </Card>
      )}

      {/* Previous Runs */}
      {runs.length > 0 && (
        <Card className="p-4">
          <h2 className="text-sm font-semibold text-text-primary mb-3">Runs</h2>
          <div className="space-y-2">
            {runs.map((r) => (
              <div
                key={r.id}
                className={cn(
                  "flex items-center justify-between p-3 rounded-lg cursor-pointer transition-colors",
                  activeRun?.id === r.id ? "bg-accent/10 border border-accent/30" : "bg-surface-2 hover:bg-surface-3",
                )}
                onClick={() => {
                  setActiveRun(r);
                  if (r.processedDays > 0) fetchMetrics(r.id);
                }}
              >
                <div>
                  <span className="text-sm text-text-primary">
                    {new Date(r.startedAt).toLocaleDateString()} — {r.lookbackYears}yr lookback
                  </span>
                  <span className="text-xs text-text-tertiary ml-2">
                    {r.processedDays}/{r.totalDays} days
                  </span>
                </div>
                <Badge variant={r.status === "completed" ? "positive" : r.status === "running" ? "warning" : "default"}>
                  {r.status}
                </Badge>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Aggregate Metrics Table */}
      {metrics.length > 0 && (
        <Card className="p-4 overflow-x-auto">
          <h2 className="text-sm font-semibold text-text-primary mb-3">
            Results by Strategy / Horizon
          </h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-text-tertiary text-xs border-b border-border">
                <th className="text-left py-2 px-2">Combo</th>
                <th className="text-right py-2 px-2">Predictions</th>
                <th className="text-right py-2 px-2">Dir. Accuracy</th>
                <th className="text-right py-2 px-2">Interval Coverage</th>
                <th className="text-right py-2 px-2">Avg Error</th>
                <th className="text-right py-2 px-2">Rank IC</th>
                <th className="text-right py-2 px-2">Top-10 Return</th>
                <th className="text-right py-2 px-2">Universe Return</th>
                <th className="text-right py-2 px-2">Excess Return</th>
              </tr>
            </thead>
            <tbody>
              {metrics.map((m) => {
                const label = `${STRATEGY_LABELS[m.strategy as Strategy] || m.strategy} / ${HORIZON_LABELS[m.horizon as Horizon] || m.horizon}`;
                return (
                  <tr
                    key={`${m.strategy}_${m.horizon}`}
                    className={cn(
                      "border-b border-border/50 cursor-pointer hover:bg-surface-2 transition-colors",
                      selectedCombo?.strategy === m.strategy && selectedCombo?.horizon === m.horizon && "bg-accent/5",
                    )}
                    onClick={() => {
                      setSelectedCombo({ strategy: m.strategy, horizon: m.horizon });
                      if (activeRun) fetchTimeSeries(activeRun.id, m.strategy, m.horizon);
                    }}
                  >
                    <td className="py-2 px-2 font-medium text-text-primary">{label}</td>
                    <td className="text-right py-2 px-2 font-mono text-text-secondary">
                      {m.totalPredictions.toLocaleString()}
                    </td>
                    <td className={cn("text-right py-2 px-2 font-mono", m.directionalAccuracy >= 0.55 ? "text-positive" : m.directionalAccuracy < 0.5 ? "text-negative" : "text-text-secondary")}>
                      {formatPct(m.directionalAccuracy * 100, 1)}
                    </td>
                    <td className={cn("text-right py-2 px-2 font-mono", m.intervalCoverage >= 0.8 ? "text-positive" : "text-text-secondary")}>
                      {formatPct(m.intervalCoverage * 100, 1)}
                    </td>
                    <td className="text-right py-2 px-2 font-mono text-text-secondary">
                      {formatPct(m.avgAbsError * 100, 2)}
                    </td>
                    <td className={cn("text-right py-2 px-2 font-mono", m.rankCorrelation > 0 ? "text-positive" : "text-negative")}>
                      {m.rankCorrelation.toFixed(3)}
                    </td>
                    <td className={cn("text-right py-2 px-2 font-mono", signColor(m.top10AvgReturn))}>
                      {formatPct(m.top10AvgReturn * 100, 2)}
                    </td>
                    <td className="text-right py-2 px-2 font-mono text-text-secondary">
                      {formatPct(m.universeAvgReturn * 100, 2)}
                    </td>
                    <td className={cn("text-right py-2 px-2 font-mono font-semibold", signColor(m.excessReturn))}>
                      {formatPct(m.excessReturn * 100, 2)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="text-xs text-text-tertiary mt-3">
            Click a row to view its daily time series below. Dir. Accuracy = % of predictions with correct direction.
            Rank IC = Spearman correlation between predicted and actual ranks. Excess Return = top-10 picks minus universe average.
          </p>
        </Card>
      )}

      {/* Time Series Chart */}
      {selectedCombo && timeSeries.length > 0 && (
        <Card className="p-4">
          <h2 className="text-sm font-semibold text-text-primary mb-3">
            Daily Accuracy: {STRATEGY_LABELS[selectedCombo.strategy as Strategy] || selectedCombo.strategy} / {HORIZON_LABELS[selectedCombo.horizon as Horizon] || selectedCombo.horizon}
          </h2>

          {/* Rolling directional accuracy chart */}
          <div className="h-64 mb-6">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={smoothTimeSeries(timeSeries, 20)}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis
                  dataKey="date"
                  tick={{ fill: "var(--color-text-tertiary)", fontSize: 11 }}
                  tickFormatter={(d) => d.slice(5)} // MM-DD
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fill: "var(--color-text-tertiary)", fontSize: 11 }}
                  tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
                  domain={[0.3, 0.8]}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--color-surface-2)",
                    border: "1px solid var(--color-border)",
                    borderRadius: "8px",
                    fontSize: "12px",
                  }}
                  formatter={(v: number) => formatPct(v * 100, 1)}
                />
                <Line
                  dataKey="directionalAccuracy"
                  name="Directional Accuracy (20d avg)"
                  stroke="#6366f1"
                  dot={false}
                  strokeWidth={2}
                />
                <Line
                  dataKey="intervalCoverage"
                  name="Interval Coverage (20d avg)"
                  stroke="#10b981"
                  dot={false}
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Top-10 excess return chart */}
          <h3 className="text-xs font-semibold text-text-secondary mb-2">
            Top-10 Picks vs Universe (cumulative)
          </h3>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={cumulativeReturns(timeSeries)}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis
                  dataKey="date"
                  tick={{ fill: "var(--color-text-tertiary)", fontSize: 11 }}
                  tickFormatter={(d) => d.slice(5)}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fill: "var(--color-text-tertiary)", fontSize: 11 }}
                  tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--color-surface-2)",
                    border: "1px solid var(--color-border)",
                    borderRadius: "8px",
                    fontSize: "12px",
                  }}
                  formatter={(v: number) => formatPct(v * 100, 2)}
                />
                <Line dataKey="top10Cumulative" name="Top 10 Picks" stroke="#6366f1" dot={false} strokeWidth={2} />
                <Line dataKey="universeCumulative" name="Universe Avg" stroke="#64748b" dot={false} strokeWidth={1.5} strokeDasharray="4 4" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {/* Empty state */}
      {!isRunning && metrics.length === 0 && runs.length === 0 && (
        <EmptyState
          title="No exhaustive backtest runs yet"
          description="Start a run to test every prediction across every trading day in the last 5 years. This will take a while but gives you the most statistically rigorous evaluation possible."
        />
      )}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────

/** Rolling average smoothing for time series */
function smoothTimeSeries(data: DailyMetric[], window: number): DailyMetric[] {
  if (data.length < window) return data;
  const smoothed: DailyMetric[] = [];
  for (let i = window - 1; i < data.length; i++) {
    const slice = data.slice(i - window + 1, i + 1);
    smoothed.push({
      date: data[i].date,
      directionalAccuracy: avg(slice.map((d) => d.directionalAccuracy)),
      intervalCoverage: avg(slice.map((d) => d.intervalCoverage)),
      avgPredictedReturn: avg(slice.map((d) => d.avgPredictedReturn)),
      avgActualReturn: avg(slice.map((d) => d.avgActualReturn)),
      top10Return: avg(slice.map((d) => d.top10Return)),
      universeReturn: avg(slice.map((d) => d.universeReturn)),
      stockCount: avg(slice.map((d) => d.stockCount)),
    });
  }
  return smoothed;
}

/** Compute cumulative returns for charting */
function cumulativeReturns(data: DailyMetric[]): { date: string; top10Cumulative: number; universeCumulative: number }[] {
  let top10Cum = 0;
  let univCum = 0;
  return data.map((d) => {
    top10Cum += d.top10Return;
    univCum += d.universeReturn;
    return {
      date: d.date,
      top10Cumulative: top10Cum,
      universeCumulative: univCum,
    };
  });
}

function avg(arr: number[]): number {
  return arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}
