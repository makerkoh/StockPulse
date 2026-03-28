"use client";

import { useState, useCallback } from "react";
import type { RankMode, Strategy, Horizon } from "@/types";
import { RANK_MODES, RANK_MODE_LABELS, STRATEGIES, STRATEGY_LABELS, HORIZON_LABELS, VALID_HORIZONS } from "@/types";
import { Button, Card, Select, Spinner, EmptyState, Badge } from "@/components/ui";
import { formatPct, cn, signColor } from "@/lib/utils";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";

interface ComparisonEntry {
  strategy: Strategy;
  horizon: Horizon;
  rankMode: RankMode;
  totalReturn: number;
  annualizedReturn: number;
  benchmarkReturn: number;
  excessReturn: number;
  sharpe: number;
  maxDrawdown: number;
  winRate: number;
  totalTrades: number;
  directionalAccuracy: number;
  rankCorrelation: number;
  intervalCoverage: number;
  p50MeanError: number;
  startDate: string;
  endDate: string;
  equity: { date: string; value: number; benchmark: number }[];
}

// Color palette for equity curves
const COMBO_COLORS = [
  "#6366f1", // indigo
  "#f59e0b", // amber
  "#10b981", // emerald
  "#ef4444", // red
  "#8b5cf6", // violet
  "#06b6d4", // cyan
  "#f97316", // orange
  "#ec4899", // pink
];

function comboLabel(strategy: Strategy, horizon: Horizon): string {
  return `${STRATEGY_LABELS[strategy]} / ${HORIZON_LABELS[horizon]}`;
}

// Build all valid combos
function getAllCombos(): { strategy: Strategy; horizon: Horizon }[] {
  const combos: { strategy: Strategy; horizon: Horizon }[] = [];
  for (const strategy of STRATEGIES) {
    for (const horizon of VALID_HORIZONS[strategy]) {
      combos.push({ strategy, horizon });
    }
  }
  return combos;
}

export default function ComparePage() {
  const [rankMode, setRankMode] = useState<RankMode>("expected_return");
  const [results, setResults] = useState<ComparisonEntry[]>([]);
  const [errors, setErrors] = useState<{ strategy: string; horizon: string; error: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [globalError, setGlobalError] = useState("");

  const allCombos = getAllCombos();

  const runComparison = useCallback(async () => {
    setLoading(true);
    setGlobalError("");
    setResults([]);
    setErrors([]);

    const newResults: ComparisonEntry[] = [];
    const newErrors: { strategy: string; horizon: string; error: string }[] = [];

    for (let i = 0; i < allCombos.length; i++) {
      const combo = allCombos[i];
      const label = comboLabel(combo.strategy, combo.horizon);
      setProgress(`Running ${i + 1}/${allCombos.length}: ${label}…`);

      try {
        const res = await fetch("/api/backtest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            horizon: combo.horizon,
            rankMode,
            strategy: combo.strategy,
          }),
        });
        const json = await res.json();

        if (json.error) {
          newErrors.push({ strategy: combo.strategy, horizon: combo.horizon, error: json.error });
        } else {
          const d = json.data;
          newResults.push({
            strategy: combo.strategy,
            horizon: combo.horizon,
            rankMode,
            totalReturn: d.totalReturn,
            annualizedReturn: d.annualizedReturn,
            benchmarkReturn: d.benchmarkReturn ?? 0,
            excessReturn: d.excessReturn ?? 0,
            sharpe: d.sharpe,
            maxDrawdown: d.maxDrawdown,
            winRate: d.winRate,
            totalTrades: d.totalTrades,
            directionalAccuracy: d.directionalAccuracy ?? 0,
            rankCorrelation: d.rankCorrelation ?? 0,
            intervalCoverage: d.intervalCoverage ?? 0,
            p50MeanError: d.p50MeanError ?? 0,
            startDate: d.startDate,
            endDate: d.endDate,
            equity: d.equity || [],
          });
          // Update results progressively so user sees them appear
          setResults([...newResults]);
        }
        setErrors([...newErrors]);
      } catch {
        newErrors.push({ strategy: combo.strategy, horizon: combo.horizon, error: "Request failed or timed out" });
        setErrors([...newErrors]);
      }
    }

    setLoading(false);
    setProgress("");
  }, [rankMode, allCombos]);

  // Sort results by excess return (best → worst)
  const sortedResults = [...results].sort((a, b) => b.excessReturn - a.excessReturn);

  // Build combined equity curve data for overlay chart
  const equityOverlay = buildEquityOverlay(sortedResults);

  // Find the best in each category
  const best = sortedResults.length > 0 ? {
    totalReturn: sortedResults.reduce((a, b) => a.totalReturn > b.totalReturn ? a : b, sortedResults[0]),
    sharpe: sortedResults.reduce((a, b) => a.sharpe > b.sharpe ? a : b, sortedResults[0]),
    winRate: sortedResults.reduce((a, b) => a.winRate > b.winRate ? a : b, sortedResults[0]),
    directional: sortedResults.reduce((a, b) => a.directionalAccuracy > b.directionalAccuracy ? a : b, sortedResults[0]),
    drawdown: sortedResults.reduce((a, b) => a.maxDrawdown < b.maxDrawdown ? a : b, sortedResults[0]),
  } : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl tracking-tight text-text-primary">Strategy Comparison</h1>
          <p className="text-sm text-text-secondary mt-1">
            Walk-forward backtest across all {allCombos.length} valid strategy × horizon combinations
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Select label="Ranking Mode" value={rankMode}
            onChange={(e) => setRankMode(e.target.value as RankMode)}
            options={RANK_MODES.map((m) => ({ value: m, label: RANK_MODE_LABELS[m] }))} />
          <Button onClick={runComparison} disabled={loading}>
            {loading ? <span className="flex items-center gap-2"><Spinner size={16} />Running…</span> : "Run All Backtests"}
          </Button>
        </div>
      </div>

      {globalError && (
        <div className="flex items-center gap-2 px-4 py-3 bg-negative/10 border border-negative/20 rounded-lg">
          <span className="text-sm text-negative">{globalError}</span>
        </div>
      )}

      {/* Progress indicator */}
      {loading && (
        <Card className="p-5">
          <div className="flex items-center gap-4">
            <Spinner size={20} />
            <div className="flex-1">
              <p className="text-sm text-text-primary">{progress}</p>
              <div className="mt-2 h-2 bg-surface-2 rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent rounded-full transition-all duration-500"
                  style={{ width: `${(results.length / allCombos.length) * 100}%` }}
                />
              </div>
              <p className="text-2xs text-text-tertiary mt-1">
                {results.length} of {allCombos.length} complete • Prices are cached — each subsequent run is faster
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Results appear progressively */}
      {sortedResults.length > 0 && (
        <>
          {/* Winner Summary */}
          {best && !loading && (
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              <Card className="p-4">
                <span className="text-2xs text-text-tertiary uppercase tracking-wider block mb-1">Best Total Return</span>
                <span className={cn("text-lg font-mono font-semibold", signColor(best.totalReturn.totalReturn))}>
                  {formatPct(best.totalReturn.totalReturn * 100)}
                </span>
                <span className="text-2xs text-text-tertiary block mt-0.5">
                  {comboLabel(best.totalReturn.strategy, best.totalReturn.horizon)}
                </span>
              </Card>
              <Card className="p-4">
                <span className="text-2xs text-text-tertiary uppercase tracking-wider block mb-1">Best Sharpe</span>
                <span className="text-lg font-mono font-semibold text-text-primary">{best.sharpe.sharpe.toFixed(2)}</span>
                <span className="text-2xs text-text-tertiary block mt-0.5">
                  {comboLabel(best.sharpe.strategy, best.sharpe.horizon)}
                </span>
              </Card>
              <Card className="p-4">
                <span className="text-2xs text-text-tertiary uppercase tracking-wider block mb-1">Best Win Rate</span>
                <span className="text-lg font-mono font-semibold text-text-primary">{formatPct(best.winRate.winRate * 100)}</span>
                <span className="text-2xs text-text-tertiary block mt-0.5">
                  {comboLabel(best.winRate.strategy, best.winRate.horizon)}
                </span>
              </Card>
              <Card className="p-4">
                <span className="text-2xs text-text-tertiary uppercase tracking-wider block mb-1">Best Directional</span>
                <span className="text-lg font-mono font-semibold text-text-primary">{best.directional.directionalAccuracy}%</span>
                <span className="text-2xs text-text-tertiary block mt-0.5">
                  {comboLabel(best.directional.strategy, best.directional.horizon)}
                </span>
              </Card>
              <Card className="p-4">
                <span className="text-2xs text-text-tertiary uppercase tracking-wider block mb-1">Lowest Drawdown</span>
                <span className="text-lg font-mono font-semibold text-negative">{formatPct(best.drawdown.maxDrawdown * 100)}</span>
                <span className="text-2xs text-text-tertiary block mt-0.5">
                  {comboLabel(best.drawdown.strategy, best.drawdown.horizon)}
                </span>
              </Card>
            </div>
          )}

          {/* Comparison Table */}
          <Card className="p-5">
            <h2 className="text-sm font-semibold text-text-primary mb-4">
              All Combinations — Ranked by Excess Return over Benchmark
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-text-tertiary text-2xs uppercase tracking-wider">
                    <th className="text-left py-3 px-3 font-medium">#</th>
                    <th className="text-left py-3 px-3 font-medium">Strategy</th>
                    <th className="text-left py-3 px-3 font-medium">Horizon</th>
                    <th className="text-right py-3 px-3 font-medium">Total Ret.</th>
                    <th className="text-right py-3 px-3 font-medium">Benchmark</th>
                    <th className="text-right py-3 px-3 font-medium">Excess</th>
                    <th className="text-right py-3 px-3 font-medium">Sharpe</th>
                    <th className="text-right py-3 px-3 font-medium">Max DD</th>
                    <th className="text-right py-3 px-3 font-medium">Win Rate</th>
                    <th className="text-right py-3 px-3 font-medium">Dir. Acc.</th>
                    <th className="text-right py-3 px-3 font-medium">Rank IC</th>
                    <th className="text-right py-3 px-3 font-medium">P10-P90</th>
                    <th className="text-right py-3 px-3 font-medium">P50 Err.</th>
                    <th className="text-right py-3 px-3 font-medium">Trades</th>
                    <th className="text-left py-3 px-3 font-medium">Period</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedResults.map((r, i) => (
                    <tr key={`${r.strategy}-${r.horizon}`}
                      className={cn(
                        "border-b border-border/50 hover:bg-surface-2/50 transition-colors",
                        i === 0 && "bg-accent/5"
                      )}>
                      <td className="py-3 px-3 text-text-tertiary font-mono">{i + 1}</td>
                      <td className="py-3 px-3">
                        <Badge variant={r.strategy === "day_trade" ? "warning" : r.strategy === "swing" ? "accent" : "positive"}>
                          {STRATEGY_LABELS[r.strategy]}
                        </Badge>
                      </td>
                      <td className="py-3 px-3 font-mono text-text-secondary">{HORIZON_LABELS[r.horizon]}</td>
                      <td className={cn("py-3 px-3 text-right font-mono font-semibold", signColor(r.totalReturn))}>
                        {formatPct(r.totalReturn * 100)}
                      </td>
                      <td className={cn("py-3 px-3 text-right font-mono", signColor(r.benchmarkReturn))}>
                        {formatPct(r.benchmarkReturn * 100)}
                      </td>
                      <td className={cn("py-3 px-3 text-right font-mono font-semibold", signColor(r.excessReturn))}>
                        {formatPct(r.excessReturn * 100)}
                      </td>
                      <td className={cn("py-3 px-3 text-right font-mono", r.sharpe > 1 ? "text-positive" : "text-text-primary")}>
                        {r.sharpe.toFixed(2)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-negative">
                        {formatPct(r.maxDrawdown * 100)}
                      </td>
                      <td className={cn("py-3 px-3 text-right font-mono", r.winRate > 0.5 ? "text-positive" : "text-text-primary")}>
                        {formatPct(r.winRate * 100)}
                      </td>
                      <td className={cn("py-3 px-3 text-right font-mono",
                        r.directionalAccuracy > 55 ? "text-positive" :
                        r.directionalAccuracy > 50 ? "text-warning" : "text-negative"
                      )}>
                        {r.directionalAccuracy}%
                      </td>
                      <td className={cn("py-3 px-3 text-right font-mono",
                        r.rankCorrelation > 0.05 ? "text-positive" :
                        r.rankCorrelation > 0 ? "text-warning" : "text-negative"
                      )}>
                        {r.rankCorrelation.toFixed(3)}
                      </td>
                      <td className={cn("py-3 px-3 text-right font-mono",
                        Math.abs(r.intervalCoverage - 80) < 10 ? "text-positive" : "text-warning"
                      )}>
                        {r.intervalCoverage}%
                      </td>
                      <td className={cn("py-3 px-3 text-right font-mono",
                        r.p50MeanError < 3 ? "text-positive" :
                        r.p50MeanError < 5 ? "text-warning" : "text-negative"
                      )}>
                        {r.p50MeanError}%
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-text-secondary">{r.totalTrades}</td>
                      <td className="py-3 px-3 text-text-tertiary text-2xs font-mono whitespace-nowrap">{r.startDate} → {r.endDate}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Errors */}
          {errors.length > 0 && (
            <Card className="p-5">
              <h2 className="text-sm font-semibold text-negative mb-3">Failed Combinations</h2>
              <div className="space-y-2">
                {errors.map((e, i) => (
                  <div key={i} className="text-xs text-text-secondary">
                    <span className="font-mono">{STRATEGY_LABELS[e.strategy as Strategy]} / {HORIZON_LABELS[e.horizon as Horizon]}</span>: {e.error}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Overlay Equity Curves — only show when all done */}
          {!loading && equityOverlay.length > 0 && (
            <Card className="p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-text-primary">Equity Curves Comparison</h2>
                <span className="text-2xs text-text-tertiary">Starting capital: $10,000</span>
              </div>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={equityOverlay}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }}
                      tickFormatter={(d: string) => new Date(d).toLocaleDateString("en-US", { month: "short", year: "2-digit" })}
                      interval={Math.floor(equityOverlay.length / 6)} />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => "$" + v.toFixed(0)} width={55} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: "8px", fontSize: "11px", color: "var(--text-primary)" }}
                      labelFormatter={(d: string) => new Date(d).toLocaleDateString()}
                      formatter={(v: number, name: string) => ["$" + v.toFixed(2), name]} />
                    <Legend wrapperStyle={{ fontSize: "10px", color: "var(--text-secondary)" }} />
                    <Line type="monotone" dataKey="benchmark" name="Benchmark (Equal-Weight)" stroke="var(--text-tertiary)" strokeWidth={2} strokeDasharray="6 4" dot={false} />
                    {sortedResults.map((r, i) => (
                      <Line key={`${r.strategy}-${r.horizon}`}
                        type="monotone"
                        dataKey={`${r.strategy}_${r.horizon}`}
                        name={comboLabel(r.strategy, r.horizon)}
                        stroke={COMBO_COLORS[i % COMBO_COLORS.length]}
                        strokeWidth={i === 0 ? 2.5 : 1.5}
                        dot={false}
                        strokeOpacity={i === 0 ? 1 : 0.7} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}

          {/* Interpretation Guide */}
          {!loading && (
            <Card className="p-5">
              <h2 className="text-sm font-semibold text-text-primary mb-3">How to Read This</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-text-secondary">
                <div className="space-y-2">
                  <p><span className="font-semibold text-text-primary">Excess Return:</span> How much better (or worse) than buying and holding the entire 40-stock universe equally.</p>
                  <p><span className="font-semibold text-text-primary">Sharpe Ratio:</span> Risk-adjusted return. Above 1.0 is good, above 2.0 is excellent.</p>
                  <p><span className="font-semibold text-text-primary">Win Rate:</span> % of rebalance periods with positive returns. Above 50% means more winning periods.</p>
                  <p><span className="font-semibold text-text-primary">Max Drawdown:</span> Largest peak-to-trough decline. Lower is better — shows worst-case pain.</p>
                </div>
                <div className="space-y-2">
                  <p><span className="font-semibold text-text-primary">Directional Accuracy:</span> % of top picks that actually went up. Above 55% means a real signal.</p>
                  <p><span className="font-semibold text-text-primary">Rank IC:</span> Spearman correlation — does our ranking predict actual order? Above 0.03 is useful.</p>
                  <p><span className="font-semibold text-text-primary">P10-P90 Coverage:</span> % of actual prices within our forecast range. Target: ~80%.</p>
                  <p><span className="font-semibold text-text-primary">P50 Error:</span> Avg gap between our median forecast and reality. Lower = more accurate.</p>
                </div>
              </div>
            </Card>
          )}
        </>
      )}

      {/* Empty state — only show if not loading and no results */}
      {!loading && sortedResults.length === 0 && (
        <Card>
          <EmptyState
            title="Compare All Strategies"
            description={`Run walk-forward backtests across all ${allCombos.length} valid strategy × horizon combinations (Day Trade 1D/1W, Swing 1W/1M/3M, Long Term 1M/3M/6M) and see which performs best. Each backtest runs individually, so you see results progressively.`}
            action={<Button onClick={runComparison}>Run All Backtests</Button>}
          />
        </Card>
      )}
    </div>
  );
}

/** Merge all equity curves into a single array for overlay charting */
function buildEquityOverlay(results: ComparisonEntry[]): Record<string, number | string>[] {
  if (results.length === 0) return [];

  // Collect all unique dates across all combos
  const dateSet = new Set<string>();
  for (const r of results) {
    for (const point of r.equity) dateSet.add(point.date);
  }
  const dates = [...dateSet].sort();

  // Build lookup maps
  const lookups = results.map((r) => {
    const map = new Map<string, { value: number; benchmark: number }>();
    for (const point of r.equity) map.set(point.date, point);
    return { key: `${r.strategy}_${r.horizon}`, map };
  });

  // Build overlay rows
  return dates.map((date) => {
    const row: Record<string, number | string> = { date };
    for (const l of lookups) {
      const point = l.map.get(date);
      if (point) {
        if (!row.benchmark) row.benchmark = point.benchmark;
        row[l.key] = point.value;
      }
    }
    return row;
  });
}
