"use client";

import { useState } from "react";
import type { BacktestResult, Horizon, RankMode, Strategy } from "@/types";
import { RANK_MODES, HORIZON_LABELS, RANK_MODE_LABELS, STRATEGIES, STRATEGY_LABELS, VALID_HORIZONS, DEFAULT_HORIZON } from "@/types";
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

interface ExtendedBacktest extends BacktestResult {
  benchmarkReturn?: number;
  excessReturn?: number;
  directionalAccuracy?: number;
  rankCorrelation?: number;
  intervalCoverage?: number;
  p50MeanError?: number;
}

export default function BacktestPage() {
  const [strategy, setStrategy] = useState<Strategy>("swing");
  const [horizon, setHorizon] = useState<Horizon>(DEFAULT_HORIZON["swing"]);
  const [rankMode, setRankMode] = useState<RankMode>("expected_return");

  const handleStrategyChange = (newStrategy: Strategy) => {
    setStrategy(newStrategy);
    const validHorizons = VALID_HORIZONS[newStrategy];
    if (!validHorizons.includes(horizon)) {
      setHorizon(DEFAULT_HORIZON[newStrategy]);
    }
  };

  const availableHorizons = VALID_HORIZONS[strategy];
  const [data, setData] = useState<ExtendedBacktest | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function runBacktest() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ horizon, rankMode, strategy }),
      });
      const json = await res.json();
      if (json.error) setError(json.error);
      else setData(json.data);
    } catch {
      setError("Failed to run backtest.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl tracking-tight text-text-primary">Backtest</h1>
          <p className="text-sm text-text-secondary mt-1">Walk-forward validation using real historical data</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Select label="Strategy" value={strategy}
            onChange={(e) => handleStrategyChange(e.target.value as Strategy)}
            options={STRATEGIES.map((s) => ({ value: s, label: STRATEGY_LABELS[s] }))} />
          <Select label="Horizon" value={horizon}
            onChange={(e) => setHorizon(e.target.value as Horizon)}
            options={availableHorizons.map((h) => ({ value: h, label: HORIZON_LABELS[h] }))} />
          <Select label="Ranking" value={rankMode}
            onChange={(e) => setRankMode(e.target.value as RankMode)}
            options={RANK_MODES.map((m) => ({ value: m, label: RANK_MODE_LABELS[m] }))} />
          <Button onClick={runBacktest} disabled={loading}>
            {loading ? <span className="flex items-center gap-2"><Spinner size={16} />Running…</span> : "Run Backtest"}
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-4 py-3 bg-negative/10 border border-negative/20 rounded-lg">
          <span className="text-sm text-negative">{error}</span>
        </div>
      )}

      {loading ? (
        <Card className="p-8 flex items-center justify-center">
          <div className="text-center">
            <Spinner size={32} />
            <p className="text-sm text-text-tertiary mt-3">Running walk-forward backtest on real historical data…</p>
            <p className="text-2xs text-text-tertiary mt-1">This may take 30-60 seconds (fetching prices for 40 stocks)</p>
          </div>
        </Card>
      ) : data ? (
        <>
          {/* Performance Stats */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {[
              { label: "Total Return", value: formatPct(data.totalReturn * 100), color: signColor(data.totalReturn) },
              { label: "Annualized", value: formatPct(data.annualizedReturn * 100), color: signColor(data.annualizedReturn) },
              { label: "Sharpe Ratio", value: data.sharpe.toFixed(2), color: data.sharpe > 1 ? "text-positive" : "text-text-primary" },
              { label: "Max Drawdown", value: formatPct(data.maxDrawdown * 100), color: "text-negative" },
              { label: "Win Rate", value: formatPct(data.winRate * 100), color: data.winRate > 0.5 ? "text-positive" : "text-text-primary" },
            ].map((stat) => (
              <Card key={stat.label} className="p-4">
                <span className="text-2xs text-text-tertiary uppercase tracking-wider block mb-1">{stat.label}</span>
                <span className={cn("text-lg font-mono font-semibold", stat.color)}>{stat.value}</span>
              </Card>
            ))}
          </div>

          {/* Benchmark Comparison */}
          {data.benchmarkReturn != null && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Card className="p-4">
                <span className="text-2xs text-text-tertiary uppercase tracking-wider block mb-1">Benchmark Return</span>
                <span className={cn("text-lg font-mono font-semibold", signColor(data.benchmarkReturn))}>
                  {formatPct(data.benchmarkReturn * 100)}
                </span>
              </Card>
              <Card className="p-4">
                <span className="text-2xs text-text-tertiary uppercase tracking-wider block mb-1">Excess Return</span>
                <span className={cn("text-lg font-mono font-semibold", signColor(data.excessReturn || 0))}>
                  {formatPct((data.excessReturn || 0) * 100)}
                </span>
              </Card>
              <Card className="p-4">
                <span className="text-2xs text-text-tertiary uppercase tracking-wider block mb-1">Total Trades</span>
                <span className="text-lg font-mono font-semibold text-text-primary">{data.totalTrades}</span>
              </Card>
              <Card className="p-4">
                <span className="text-2xs text-text-tertiary uppercase tracking-wider block mb-1">Period</span>
                <span className="text-sm font-mono text-text-primary">{data.startDate} → {data.endDate}</span>
              </Card>
            </div>
          )}

          {/* Prediction Quality Metrics */}
          {data.directionalAccuracy != null && (
            <Card className="p-5">
              <h2 className="text-sm font-semibold text-text-primary mb-4">Prediction Quality Metrics</h2>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
                <div>
                  <span className="text-2xs text-text-tertiary uppercase tracking-wider block mb-1">Directional Accuracy</span>
                  <span className={cn(
                    "text-xl font-mono font-semibold",
                    (data.directionalAccuracy || 0) > 55 ? "text-positive" :
                    (data.directionalAccuracy || 0) > 50 ? "text-warning" : "text-negative"
                  )}>
                    {data.directionalAccuracy}%
                  </span>
                  <span className="text-2xs text-text-tertiary block mt-0.5">
                    {(data.directionalAccuracy || 0) > 55 ? "Strong signal" :
                     (data.directionalAccuracy || 0) > 50 ? "Weak signal" : "No signal"}
                  </span>
                </div>
                <div>
                  <span className="text-2xs text-text-tertiary uppercase tracking-wider block mb-1">Rank Correlation</span>
                  <span className={cn(
                    "text-xl font-mono font-semibold",
                    (data.rankCorrelation || 0) > 0.05 ? "text-positive" :
                    (data.rankCorrelation || 0) > 0 ? "text-warning" : "text-negative"
                  )}>
                    {data.rankCorrelation?.toFixed(3)}
                  </span>
                  <span className="text-2xs text-text-tertiary block mt-0.5">
                    Spearman IC ({">"} 0.03 = useful)
                  </span>
                </div>
                <div>
                  <span className="text-2xs text-text-tertiary uppercase tracking-wider block mb-1">Interval Coverage</span>
                  <span className={cn(
                    "text-xl font-mono font-semibold",
                    Math.abs((data.intervalCoverage || 0) - 80) < 10 ? "text-positive" : "text-warning"
                  )}>
                    {data.intervalCoverage}%
                  </span>
                  <span className="text-2xs text-text-tertiary block mt-0.5">
                    P10-P90 range (target: ~80%)
                  </span>
                </div>
                <div>
                  <span className="text-2xs text-text-tertiary uppercase tracking-wider block mb-1">P50 Mean Error</span>
                  <span className={cn(
                    "text-xl font-mono font-semibold",
                    (data.p50MeanError || 0) < 3 ? "text-positive" :
                    (data.p50MeanError || 0) < 5 ? "text-warning" : "text-negative"
                  )}>
                    {data.p50MeanError}%
                  </span>
                  <span className="text-2xs text-text-tertiary block mt-0.5">
                    Avg |actual - predicted| / price
                  </span>
                </div>
              </div>
            </Card>
          )}

          {/* Equity curve */}
          {data.equity.length > 0 && (
            <Card className="p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-text-primary">Equity Curve</h2>
                <div className="flex gap-3 text-2xs text-text-tertiary">
                  <span>{data.startDate} → {data.endDate}</span>
                  <Badge>{data.totalTrades} trades</Badge>
                </div>
              </div>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.equity}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }}
                      tickFormatter={(d: string) => new Date(d).toLocaleDateString("en-US", { month: "short", year: "2-digit" })}
                      interval={Math.floor(data.equity.length / 6)} />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => "$" + v.toFixed(0)} width={55} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: "8px", fontSize: "12px", color: "var(--text-primary)" }}
                      labelFormatter={(d: string) => new Date(d).toLocaleDateString()}
                      formatter={(v: number, name: string) => ["$" + v.toFixed(2), name]} />
                    <Legend wrapperStyle={{ fontSize: "11px", color: "var(--text-secondary)" }} />
                    <Line type="monotone" dataKey="value" name="Strategy" stroke="var(--accent)" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="benchmark" name="Benchmark" stroke="var(--text-tertiary)" strokeWidth={1} strokeDasharray="4 4" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}
        </>
      ) : (
        <Card>
          <EmptyState
            title="No backtest results"
            description="Select a strategy, horizon, and ranking mode, then run a real walk-forward backtest using historical market data. First run: ~40 API calls (cached after)."
            action={<Button onClick={runBacktest}>Run Backtest</Button>}
          />
        </Card>
      )}
    </div>
  );
}
