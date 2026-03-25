"use client";

import { useState, useEffect } from "react";
import type { IpoEntry } from "@/types";
import { Card, Spinner, Badge, EmptyState } from "@/components/ui";
import { formatNumber, formatCurrency } from "@/lib/utils";

export default function IpoCalendarPage() {
  const [ipos, setIpos] = useState<IpoEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function fetchIpos() {
      try {
        const res = await fetch("/api/ipos");
        const json = await res.json();
        if (json.data) {
          setIpos(json.data);
        } else {
          setError(json.error || "Failed to load IPOs");
        }
      } catch {
        setError("Failed to load IPO calendar");
      } finally {
        setLoading(false);
      }
    }
    fetchIpos();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner size={32} />
      </div>
    );
  }

  const statusColor = (status: string) => {
    switch (status) {
      case "upcoming": return "accent";
      case "priced": return "positive";
      case "withdrawn": return "negative";
      default: return "default";
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl sm:text-3xl tracking-tight text-text-primary">
          IPO Calendar
        </h1>
        <p className="text-sm text-text-secondary mt-1">
          Upcoming initial public offerings — next 2 weeks
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-negative bg-negative/10 border border-negative/20 rounded-lg px-4 py-3">
          <span>⚠</span> {error}
        </div>
      )}

      {ipos.length === 0 && !error ? (
        <EmptyState
          title="No upcoming IPOs"
          description="No IPOs are scheduled in the next 2 weeks. Check back later."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-text-tertiary text-2xs uppercase tracking-wider">
                <th className="text-left py-3 px-4 font-medium">#</th>
                <th className="text-left py-3 px-4 font-medium">Ticker</th>
                <th className="text-left py-3 px-4 font-medium">Company</th>
                <th className="text-left py-3 px-4 font-medium">Expected Date</th>
                <th className="text-left py-3 px-4 font-medium">Exchange</th>
                <th className="text-right py-3 px-4 font-medium">Price Range</th>
                <th className="text-right py-3 px-4 font-medium">Shares</th>
                <th className="text-left py-3 px-4 font-medium">Sector</th>
                <th className="text-left py-3 px-4 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {ipos.map((ipo, i) => (
                <tr
                  key={ipo.id}
                  className="border-b border-border/50 hover:bg-surface-2/50 transition-colors"
                >
                  <td className="py-3.5 px-4 text-text-tertiary">{i + 1}</td>
                  <td className="py-3.5 px-4 font-mono font-semibold text-text-primary">
                    {ipo.ticker}
                  </td>
                  <td className="py-3.5 px-4 text-text-primary">{ipo.companyName}</td>
                  <td className="py-3.5 px-4 text-text-secondary font-mono">
                    {ipo.expectedDate}
                  </td>
                  <td className="py-3.5 px-4 text-text-secondary">{ipo.exchange}</td>
                  <td className="py-3.5 px-4 text-right text-text-secondary">
                    {formatCurrency(ipo.priceRangeLow, 2)} – {formatCurrency(ipo.priceRangeHigh, 2)}
                  </td>
                  <td className="py-3.5 px-4 text-right text-text-secondary font-mono">
                    {formatNumber(ipo.shares)}
                  </td>
                  <td className="py-3.5 px-4 text-text-secondary">{ipo.sector}</td>
                  <td className="py-3.5 px-4">
                    <Badge variant={statusColor(ipo.status)}>
                      {ipo.status}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
