"use client";

import { useState } from "react";
import Link from "next/link";
import type { ScoredStock, RankMode } from "@/types";
import { RANK_MODE_LABELS } from "@/types";
import { Badge } from "@/components/ui";
import {
  formatCurrency,
  formatPct,
  formatCompact,
  cn,
  signColor,
  confidenceLabel,
  confidenceColor,
} from "@/lib/utils";

interface ForecastTableProps {
  stocks: ScoredStock[];
  rankMode: RankMode;
}

export default function ForecastTable({ stocks, rankMode }: ForecastTableProps) {
  const [expandedTicker, setExpandedTicker] = useState<string | null>(null);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-text-primary tracking-tight">
          Ranked Forecasts
        </h2>
        <span className="text-2xs text-text-tertiary">
          Sorted by {RANK_MODE_LABELS[rankMode]} · {stocks.length} stocks
        </span>
      </div>

      <div className="bg-surface-1 border border-border rounded-xl overflow-hidden">
        {/* Table header */}
        <div className="grid grid-cols-[3rem_5rem_1fr_5.5rem_5rem_5rem_5rem_5rem_4.5rem_4rem] gap-2 px-4 py-2.5 text-2xs font-medium text-text-tertiary uppercase tracking-wider border-b border-border bg-surface-2/50">
          <span>#</span>
          <span>Ticker</span>
          <span>Name</span>
          <span className="text-right">Price</span>
          <span className="text-right">Exp. Ret</span>
          <span className="text-right">P10</span>
          <span className="text-right">P50</span>
          <span className="text-right">P90</span>
          <span className="text-right">Conf.</span>
          <span className="text-right">Score</span>
        </div>

        {/* Table rows */}
        {stocks.map((stock, i) => (
          <div key={stock.ticker}>
            <div
              className={cn(
                "grid grid-cols-[3rem_5rem_1fr_5.5rem_5rem_5rem_5rem_5rem_4.5rem_4rem] gap-2 px-4 py-3 items-center table-row-hover cursor-pointer stagger-item",
                expandedTicker === stock.ticker && "bg-surface-2/30",
                i < 3 && "border-l-2 border-l-accent/40"
              )}
              style={{ animationDelay: `${i * 30}ms` }}
              onClick={() => setExpandedTicker(expandedTicker === stock.ticker ? null : stock.ticker)}
            >
              <span className={cn(
                "text-xs font-mono",
                i < 3 ? "text-accent font-semibold" : "text-text-tertiary"
              )}>
                {stock.rank}
              </span>
              <Link
                href={`/stock/${stock.ticker}`}
                onClick={(e) => e.stopPropagation()}
                className="text-sm font-mono font-semibold text-text-primary hover:text-accent transition-colors"
              >
                {stock.ticker}
              </Link>
              <span className="text-xs text-text-secondary truncate">{stock.name}</span>
              <span className="text-xs font-mono text-text-primary text-right">
                {formatCurrency(stock.currentPrice)}
              </span>
              <span className={cn("text-xs font-mono font-semibold text-right", signColor(stock.expectedReturn))}>
                {formatPct(stock.expectedReturn * 100)}
              </span>
              <span className={cn("text-xs font-mono text-right", signColor(stock.pLow - stock.currentPrice))}>
                {formatCurrency(stock.pLow)}
              </span>
              <span className={cn("text-xs font-mono text-right", signColor(stock.pMid - stock.currentPrice))}>
                {formatCurrency(stock.pMid)}
              </span>
              <span className={cn("text-xs font-mono text-right", signColor(stock.pHigh - stock.currentPrice))}>
                {formatCurrency(stock.pHigh)}
              </span>
              <span className="text-right">
                <Badge className={confidenceColor(stock.confidence)}>
                  {confidenceLabel(stock.confidence)}
                </Badge>
              </span>
              <span className="text-xs font-mono font-semibold text-right text-accent">
                {stock.score.toFixed(1)}
              </span>
            </div>

            {/* Expanded score breakdown */}
            {expandedTicker === stock.ticker && (
              <div className="px-4 py-3 bg-surface-2/20 border-t border-border">
                <div className="flex flex-wrap gap-x-6 gap-y-2">
                  <div>
                    <span className="text-2xs text-text-tertiary block">Expected Return</span>
                    <span className={cn("text-sm font-mono", signColor(stock.expectedReturn))}>
                      {formatPct(stock.expectedReturn * 100)}
                    </span>
                  </div>
                  <div>
                    <span className="text-2xs text-text-tertiary block">Risk/Reward</span>
                    <span className="text-sm font-mono text-text-primary">
                      {stock.riskReward.toFixed(2)}x
                    </span>
                  </div>
                  <div>
                    <span className="text-2xs text-text-tertiary block">Sector</span>
                    <span className="text-sm text-text-secondary">{stock.sector}</span>
                  </div>
                  {Object.entries(stock.scoreBreakdown).map(([key, val]) => (
                    <div key={key}>
                      <span className="text-2xs text-text-tertiary block">
                        {key.replace(/_/g, " ")}
                      </span>
                      <span className={cn("text-sm font-mono", signColor(val))}>
                        {val.toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
