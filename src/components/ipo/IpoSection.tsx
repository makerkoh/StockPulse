"use client";

import type { IpoEntry } from "@/types";
import { Card, Badge } from "@/components/ui";
import { formatCurrency, formatCompact, cn } from "@/lib/utils";

interface IpoSectionProps {
  ipos: IpoEntry[];
}

export default function IpoSection({ ipos }: IpoSectionProps) {
  if (ipos.length === 0) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-text-primary tracking-tight">Upcoming IPOs</h2>
        <Badge variant="accent">{ipos.length} tracked</Badge>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {ipos.map((ipo, i) => (
          <Card
            key={ipo.id}
            hover
            className="p-4 stagger-item"
            style={{ animationDelay: `${i * 60}ms` } as React.CSSProperties}
          >
            {/* Header */}
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-text-primary font-mono">
                    {ipo.ticker}
                  </span>
                  <Badge
                    variant={
                      ipo.status === "upcoming" ? "accent" :
                      ipo.status === "priced" ? "positive" : "warning"
                    }
                  >
                    {ipo.status}
                  </Badge>
                </div>
                <p className="text-xs text-text-secondary mt-0.5 line-clamp-1">
                  {ipo.companyName}
                </p>
              </div>
              <span className="text-2xs text-text-tertiary whitespace-nowrap">
                {ipo.expectedDate ? new Date(ipo.expectedDate).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                }) : "TBD"}
              </span>
            </div>

            {/* Price range bar */}
            <div className="mb-3">
              <div className="flex justify-between text-2xs text-text-tertiary mb-1">
                <span>{formatCurrency(ipo.priceRangeLow, 0)}</span>
                <span className="text-text-secondary">Price Range</span>
                <span>{formatCurrency(ipo.priceRangeHigh, 0)}</span>
              </div>
              <div className="h-1 bg-surface-3 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-accent/60 to-accent rounded-full"
                  style={{ width: "100%" }}
                />
              </div>
            </div>

            {/* Metrics row */}
            <div className="flex items-center justify-between">
              <div className="flex gap-3">
                <div>
                  <span className="text-2xs text-text-tertiary block">Shares</span>
                  <span className="text-xs font-medium text-text-primary font-mono">
                    {formatCompact(ipo.shares)}
                  </span>
                </div>
                <div>
                  <span className="text-2xs text-text-tertiary block">Sector</span>
                  <span className="text-xs text-text-secondary">{ipo.sector}</span>
                </div>
              </div>

              {/* Sentiment & Risk */}
              <div className="flex gap-2">
                <div className="text-center">
                  <span className="text-2xs text-text-tertiary block">Sent.</span>
                  <span
                    className={cn(
                      "text-xs font-mono font-medium",
                      ipo.sentiment > 0.3 ? "text-positive" :
                      ipo.sentiment < -0.3 ? "text-negative" : "text-text-secondary"
                    )}
                  >
                    {ipo.sentiment > 0 ? "+" : ""}{ipo.sentiment.toFixed(1)}
                  </span>
                </div>
                <div className="text-center">
                  <span className="text-2xs text-text-tertiary block">Risk</span>
                  <span
                    className={cn(
                      "text-xs font-mono font-medium",
                      ipo.riskScore > 0.7 ? "text-negative" :
                      ipo.riskScore > 0.4 ? "text-warning" : "text-positive"
                    )}
                  >
                    {(ipo.riskScore * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
