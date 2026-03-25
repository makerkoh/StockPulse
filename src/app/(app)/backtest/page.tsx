"use client";

import { useState } from "react";
import type { BacktestResult, Horizon, RankMode } from "@/types";
import { HORIZONS, RANK_MODES, HORIZON_LABELS, RANK_MODE_LABELS } from "@/types";
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

export default function BacktestPage() {
  const [horizon, setHorizon] = useState<Horizon>("1M");
  const [rankMode, setRankMode] = useState<RankMode>("expected_return");
  const [data, setData] = useState<BacktestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function runBacktest() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ horizon, rankMode }),
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
          <p className="text-sm text-text-secondary mt-1">Walk-forward simulation of the ranking strategy</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Select label="Horizon" value={horizon}
            onChange={(e) => setHorizon(e.target.value as Horizon)}
            options={HORIZONS.map((h) => ({ value: h, label: HORIZON_LABELS[h] }))} />
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
            <p className="text-sm text-text-tertiary mt-3">Simulating walk-forward backtest…</p>
          </div>
        </Card>
      ) : data ? (
        <>
          {/* Stats */}
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

          {/* Equity curve */}
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
                    formatter={(v: number, name: string) => ["$" + v.toFixed(2), name === "value" ? "Strategy" : "Benchmark"]} />
                  <Legend wrapperStyle={{ fontSize: "11px", color: "var(--text-secondary)" }} />
                  <Line type="monotone" dataKey="value" name="Strategy" stroke="var(--accent)" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="benchmark" name="S&P 500" stroke="var(--text-tertiary)" strokeWidth={1} strokeDasharray="4 4" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </>
      ) : (
        <Card>
          <EmptyState
            title="No backtest results"
            description="Select a horizon and ranking mode, then run a backtest to simulate historical performance."
            action={<Button onClick={runBacktest}>Run First Backtest</Button>}
          />
        </Card>
      )}
    </div>
  );
}
