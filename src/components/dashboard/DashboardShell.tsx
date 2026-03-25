"use client";

import { useState, useCallback } from "react";
import type { PredictionResponse, Horizon, RankMode, Strategy } from "@/types";
import { HORIZONS, RANK_MODES, HORIZON_LABELS, RANK_MODE_LABELS, STRATEGIES, STRATEGY_LABELS } from "@/types";
import { Button, Card, Select, Spinner, EmptyState, SkeletonRows } from "@/components/ui";
import { formatPct, formatCurrency, cn, signColor } from "@/lib/utils";
import ForecastTable from "./ForecastTable";
import IpoSection from "@/components/ipo/IpoSection";

export default function DashboardShell() {
  const [horizon, setHorizon] = useState<Horizon>("1W");
  const [rankMode, setRankMode] = useState<RankMode>("expected_return");
  const [strategy, setStrategy] = useState<Strategy>("swing");
  const [data, setData] = useState<PredictionResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const runPrediction = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/predict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ horizon, rankMode, strategy }),
      });
      const json = await res.json();
      if (json.error) {
        setError(json.error);
      } else {
        setData(json.data);
      }
    } catch {
      setError("Failed to run prediction. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [horizon, rankMode, strategy]);

  // Summary stats
  const topStock = data?.stocks[0];
  const avgReturn = data
    ? data.stocks.reduce((sum, s) => sum + s.expectedReturn, 0) / data.stocks.length
    : 0;
  const bullishCount = data ? data.stocks.filter((s) => s.expectedReturn > 0).length : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl tracking-tight text-text-primary">
            Market Intelligence
          </h1>
          <p className="text-sm text-text-secondary mt-1">
            Quantile forecasts with transparent scoring
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <Select
            label="Strategy"
            value={strategy}
            onChange={(e) => setStrategy(e.target.value as Strategy)}
            options={STRATEGIES.map((s) => ({ value: s, label: STRATEGY_LABELS[s] }))}
          />
          <Select
            label="Horizon"
            value={horizon}
            onChange={(e) => setHorizon(e.target.value as Horizon)}
            options={HORIZONS.map((h) => ({ value: h, label: HORIZON_LABELS[h] }))}
          />
          <Select
            label="Ranking"
            value={rankMode}
            onChange={(e) => setRankMode(e.target.value as RankMode)}
            options={RANK_MODES.map((m) => ({ value: m, label: RANK_MODE_LABELS[m] }))}
          />
          <Button onClick={runPrediction} disabled={loading}>
            {loading ? (
              <span className="flex items-center gap-2">
                <Spinner size={16} />
                Running…
              </span>
            ) : (
              "Run Prediction"
            )}
          </Button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 px-4 py-3 bg-negative/10 border border-negative/20 rounded-lg">
          <svg className="w-4 h-4 text-negative shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-sm text-negative">{error}</span>
        </div>
      )}

      {/* Stats cards — show only when data exists */}
      {data && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Card className="p-4">
            <span className="text-2xs text-text-tertiary uppercase tracking-wider block mb-1">
              Top Pick
            </span>
            <span className="text-lg font-mono font-semibold text-accent">
              {topStock?.ticker}
            </span>
            <span className={cn("text-xs font-mono ml-2", signColor(topStock?.expectedReturn || 0))}>
              {formatPct((topStock?.expectedReturn || 0) * 100)}
            </span>
          </Card>
          <Card className="p-4">
            <span className="text-2xs text-text-tertiary uppercase tracking-wider block mb-1">
              Avg Expected Return
            </span>
            <span className={cn("text-lg font-mono font-semibold", signColor(avgReturn))}>
              {formatPct(avgReturn * 100)}
            </span>
          </Card>
          <Card className="p-4">
            <span className="text-2xs text-text-tertiary uppercase tracking-wider block mb-1">
              Bullish / Total
            </span>
            <span className="text-lg font-mono font-semibold text-text-primary">
              {bullishCount}
              <span className="text-text-tertiary text-sm"> / {data.stocks.length}</span>
            </span>
          </Card>
          <Card className="p-4">
            <span className="text-2xs text-text-tertiary uppercase tracking-wider block mb-1">
              Data Source
            </span>
            <span className="text-lg font-mono font-semibold text-text-primary">
              {data.meta.isDemo ? "Demo" : "Live"}
            </span>
            <span className="text-2xs text-text-tertiary ml-1">
              {new Date(data.meta.generatedAt).toLocaleTimeString()}
            </span>
          </Card>
        </div>
      )}

      {/* Main content */}
      {loading ? (
        <Card>
          <SkeletonRows rows={10} />
        </Card>
      ) : data ? (
        <>
          <ForecastTable stocks={data.stocks} rankMode={data.meta.rankMode as RankMode} />
          <IpoSection ipos={data.ipos} />
        </>
      ) : (
        <Card>
          <EmptyState
            title="No predictions yet"
            description="Configure your horizon and ranking mode, then run a prediction to see scored forecasts for the S&P 40 universe."
            action={
              <Button onClick={runPrediction}>Run First Prediction</Button>
            }
          />
        </Card>
      )}
    </div>
  );
}
