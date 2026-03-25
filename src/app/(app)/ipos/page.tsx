"use client";

import { useState, useEffect, useCallback } from "react";
import type { IpoEntry } from "@/types";
import { Card, Spinner, Badge, EmptyState, Select, Button } from "@/components/ui";
import { formatNumber, formatCurrency } from "@/lib/utils";

const TIME_FILTERS = [
  { value: "7", label: "Next 7 Days" },
  { value: "14", label: "Next 2 Weeks" },
  { value: "30", label: "Next 30 Days" },
  { value: "90", label: "Next 90 Days" },
];

export default function IpoCalendarPage() {
  const [ipos, setIpos] = useState<IpoEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [days, setDays] = useState("30");

  const fetchIpos = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/ipos?days=${days}`);
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
  }, [days]);

  useEffect(() => {
    fetchIpos();
  }, [fetchIpos]);

  const statusColor = (status: string) => {
    switch (status) {
      case "upcoming": return "accent";
      case "filed": return "warning";
      case "priced": return "positive";
      case "withdrawn": return "negative";
      default: return "default";
    }
  };

  const upcoming = ipos.filter((i) => i.status === "upcoming" || i.status === "filed");
  const priced = ipos.filter((i) => i.status === "priced");

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl tracking-tight text-text-primary">
            IPO Calendar
          </h1>
          <p className="text-sm text-text-secondary mt-1">
            Upcoming initial public offerings
          </p>
        </div>
        <div className="flex items-end gap-3">
          <Select
            label="Time Window"
            value={days}
            onChange={(e) => setDays(e.target.value)}
            options={TIME_FILTERS}
          />
          <Button onClick={fetchIpos} disabled={loading} variant="secondary" size="sm">
            {loading ? <Spinner size={14} /> : "Refresh"}
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="p-4">
          <span className="text-2xs text-text-tertiary uppercase tracking-wider block mb-1">Total IPOs</span>
          <span className="text-lg font-mono font-semibold text-text-primary">{ipos.length}</span>
        </Card>
        <Card className="p-4">
          <span className="text-2xs text-text-tertiary uppercase tracking-wider block mb-1">Upcoming</span>
          <span className="text-lg font-mono font-semibold text-accent">{upcoming.length}</span>
        </Card>
        <Card className="p-4">
          <span className="text-2xs text-text-tertiary uppercase tracking-wider block mb-1">Recently Priced</span>
          <span className="text-lg font-mono font-semibold text-positive">{priced.length}</span>
        </Card>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-negative bg-negative/10 border border-negative/20 rounded-lg px-4 py-3">
          <span>!</span> {error}
        </div>
      )}

      {loading ? (
        <Card><div className="flex items-center justify-center py-12"><Spinner size={24} /></div></Card>
      ) : ipos.length === 0 && !error ? (
        <Card>
          <EmptyState
            title="No upcoming IPOs"
            description={`No IPOs found in the next ${days} days. Try expanding the time window.`}
          />
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-text-tertiary text-2xs uppercase tracking-wider">
                  <th className="text-left py-3 px-4 font-medium">#</th>
                  <th className="text-left py-3 px-4 font-medium">Ticker</th>
                  <th className="text-left py-3 px-4 font-medium">Company</th>
                  <th className="text-left py-3 px-4 font-medium">Date</th>
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
                      {ipo.expectedDate || "TBD"}
                    </td>
                    <td className="py-3.5 px-4 text-text-secondary">{ipo.exchange}</td>
                    <td className="py-3.5 px-4 text-right text-text-secondary">
                      {ipo.priceRangeLow > 0 && ipo.priceRangeHigh > 0
                        ? `${formatCurrency(ipo.priceRangeLow)} – ${formatCurrency(ipo.priceRangeHigh)}`
                        : "TBD"}
                    </td>
                    <td className="py-3.5 px-4 text-right text-text-secondary font-mono">
                      {ipo.shares > 0 ? formatNumber(ipo.shares) : "TBD"}
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
        </Card>
      )}
    </div>
  );
}
