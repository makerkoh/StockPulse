"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";
import type { StockDetail } from "@/types";
import { Card, Badge, Spinner, EmptyState } from "@/components/ui";
import {
  formatCurrency,
  formatPct,
  formatCompact,
  cn,
  signColor,
  confidenceLabel,
  confidenceColor,
} from "@/lib/utils";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

export default function StockDetailPage({
  params,
}: {
  params: Promise<{ ticker: string }>;
}) {
  const { ticker } = use(params);
  const [data, setData] = useState<StockDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/stocks?ticker=${ticker}`);
        const json = await res.json();
        if (json.error) setError(json.error);
        else setData(json.data);
      } catch {
        setError("Failed to load stock data.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [ticker]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner size={32} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <EmptyState
          title="Stock not found"
          description={error || `Could not load data for ${ticker}.`}
          action={
            <Link href="/stock" className="text-sm text-accent hover:text-accent-hover">
              ← Back to dashboard
            </Link>
          }
        />
      </Card>
    );
  }

  const { quote, fundamentals, prices, news, forecast } = data;

  return (
    <div className="space-y-6">
      {/* Back link + header */}
      <div>
        <Link href="/stock" className="text-xs text-text-tertiary hover:text-text-secondary transition-colors">
          ← Back to dashboard
        </Link>
        <div className="mt-3 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="font-display text-2xl sm:text-3xl tracking-tight">{quote.ticker}</h1>
              <Badge variant="accent">{quote.sector}</Badge>
            </div>
            <p className="text-sm text-text-secondary mt-0.5">{quote.name}</p>
          </div>
          <div className="text-right">
            <div className="text-2xl font-mono font-semibold">{formatCurrency(quote.price)}</div>
            <div className={cn("text-sm font-mono", signColor(quote.changePct))}>
              {formatPct(quote.changePct)} ({quote.change > 0 ? "+" : ""}{quote.change.toFixed(2)})
            </div>
          </div>
        </div>
      </div>

      {/* Price chart */}
      <Card className="p-5">
        <h2 className="text-sm font-semibold text-text-primary mb-4">Price History (1Y)</h2>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={prices.slice(-252)}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10 }}
                tickFormatter={(d: string) => {
                  const dt = new Date(d);
                  return dt.toLocaleDateString("en-US", { month: "short" });
                }}
                interval={Math.floor(prices.length / 6)}
              />
              <YAxis
                domain={["auto", "auto"]}
                tick={{ fontSize: 10 }}
                tickFormatter={(v: number) => "$" + v.toFixed(0)}
                width={55}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--surface-2)",
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                  fontSize: "12px",
                  color: "var(--text-primary)",
                }}
                labelFormatter={(d: string) => new Date(d).toLocaleDateString()}
                formatter={(v: number) => ["$" + v.toFixed(2), "Close"]}
              />
              <Line
                type="monotone"
                dataKey="close"
                stroke="var(--accent)"
                strokeWidth={1.5}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Fundamentals */}
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-text-primary mb-4">Fundamentals</h2>
          <div className="grid grid-cols-2 gap-x-6 gap-y-3">
            {[
              { label: "P/E", value: fundamentals.pe },
              { label: "Forward P/E", value: fundamentals.forwardPe },
              { label: "P/B", value: fundamentals.pb },
              { label: "P/S", value: fundamentals.ps },
              { label: "EV/EBITDA", value: fundamentals.evEbitda },
              { label: "D/E", value: fundamentals.debtEquity },
              { label: "ROE", value: fundamentals.roe, pct: true },
              { label: "Rev Growth", value: fundamentals.revenueGrowth, pct: true },
              { label: "EPS Growth", value: fundamentals.earningsGrowth, pct: true },
              { label: "Div Yield", value: fundamentals.dividendYield, pct: true },
              { label: "Beta", value: fundamentals.beta },
              { label: "Market Cap", value: quote.marketCap, compact: true },
            ].map((item) => (
              <div key={item.label} className="flex justify-between items-baseline">
                <span className="text-xs text-text-tertiary">{item.label}</span>
                <span className="text-xs font-mono text-text-primary">
                  {item.value == null
                    ? "—"
                    : item.compact
                    ? formatCompact(item.value)
                    : item.pct
                    ? formatPct(item.value * 100)
                    : item.value.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        </Card>

        {/* Forecast */}
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-text-primary mb-4">Quantile Forecast</h2>
          {forecast ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Badge variant="accent">{forecast.horizon}</Badge>
                <Badge className={confidenceColor(forecast.confidence)}>
                  {confidenceLabel(forecast.confidence)} confidence
                </Badge>
              </div>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <span className="text-2xs text-text-tertiary block">Bear (P10)</span>
                  <span className={cn("text-lg font-mono font-semibold", signColor(forecast.pLow - forecast.currentPrice))}>
                    {formatCurrency(forecast.pLow)}
                  </span>
                  <span className={cn("text-2xs font-mono block", signColor(forecast.pLow - forecast.currentPrice))}>
                    {formatPct(((forecast.pLow - forecast.currentPrice) / forecast.currentPrice) * 100)}
                  </span>
                </div>
                <div>
                  <span className="text-2xs text-text-tertiary block">Base (P50)</span>
                  <span className={cn("text-lg font-mono font-semibold", signColor(forecast.pMid - forecast.currentPrice))}>
                    {formatCurrency(forecast.pMid)}
                  </span>
                  <span className={cn("text-2xs font-mono block", signColor(forecast.pMid - forecast.currentPrice))}>
                    {formatPct(((forecast.pMid - forecast.currentPrice) / forecast.currentPrice) * 100)}
                  </span>
                </div>
                <div>
                  <span className="text-2xs text-text-tertiary block">Bull (P90)</span>
                  <span className={cn("text-lg font-mono font-semibold", signColor(forecast.pHigh - forecast.currentPrice))}>
                    {formatCurrency(forecast.pHigh)}
                  </span>
                  <span className={cn("text-2xs font-mono block", signColor(forecast.pHigh - forecast.currentPrice))}>
                    {formatPct(((forecast.pHigh - forecast.currentPrice) / forecast.currentPrice) * 100)}
                  </span>
                </div>
              </div>
              <div className="flex justify-between pt-2 border-t border-border">
                <div>
                  <span className="text-2xs text-text-tertiary block">Risk/Reward</span>
                  <span className="text-sm font-mono text-text-primary">{forecast.riskReward.toFixed(2)}x</span>
                </div>
                <div className="text-right">
                  <span className="text-2xs text-text-tertiary block">Expected Return</span>
                  <span className={cn("text-sm font-mono", signColor(forecast.expectedReturn))}>
                    {formatPct(forecast.expectedReturn * 100)}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-text-tertiary">Run a prediction from the dashboard to see forecasts.</p>
          )}
        </Card>
      </div>

      {/* News */}
      <Card className="p-5">
        <h2 className="text-sm font-semibold text-text-primary mb-4">Recent News</h2>
        {news.length === 0 ? (
          <p className="text-sm text-text-tertiary">No recent news available.</p>
        ) : (
          <div className="space-y-3">
            {news.map((item) => (
              <div key={item.id} className="flex items-start justify-between gap-4 py-2 border-b border-border last:border-0">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-text-primary line-clamp-1">{item.headline}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-2xs text-text-tertiary">{item.source}</span>
                    <span className="text-2xs text-text-tertiary">·</span>
                    <span className="text-2xs text-text-tertiary">
                      {new Date(item.publishedAt).toLocaleDateString("en-US", {
                        month: "short", day: "numeric",
                      })}
                    </span>
                  </div>
                </div>
                <Badge
                  variant={
                    item.sentiment > 0.3 ? "positive" :
                    item.sentiment < -0.3 ? "negative" : "default"
                  }
                >
                  {item.sentiment > 0 ? "+" : ""}{item.sentiment.toFixed(1)}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
