"use client";

import { useState, useEffect } from "react";
import type { AppSettings, Horizon, RankMode } from "@/types";
import { HORIZONS, RANK_MODES, HORIZON_LABELS, RANK_MODE_LABELS } from "@/types";
import { Button, Card, Select, Spinner, Badge } from "@/components/ui";
import { DEFAULT_UNIVERSE } from "@/lib/providers/interfaces";

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings>({
    finnhubKey: "",
    fmpKey: "",
    alphaVantageKey: "",
    newsApiKey: "",
    defaultHorizon: "1W",
    defaultRankMode: "expected_return",
    universe: DEFAULT_UNIVERSE,
    refreshInterval: 60,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/settings");
        const json = await res.json();
        if (json.data) setSettings(json.data);
      } catch {
        // Use defaults
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const json = await res.json();
      if (!json.error) setSaved(true);
    } catch {
      // Handle silently
    } finally {
      setSaving(false);
      setTimeout(() => setSaved(false), 3000);
    }
  }

  function handleLogout() {
    fetch("/api/auth", { method: "DELETE" }).then(() => {
      window.location.href = "/login";
    });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner size={32} />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="font-display text-2xl sm:text-3xl tracking-tight text-text-primary">Settings</h1>
        <p className="text-sm text-text-secondary mt-1">Configure data providers and default parameters</p>
      </div>

      {/* API Keys */}
      <Card className="p-5 space-y-4">
        <h2 className="text-sm font-semibold text-text-primary">Data Provider API Keys</h2>
        <p className="text-xs text-text-tertiary">
          Without API keys the platform runs in demo mode with simulated data.
        </p>
        {[
          { key: "finnhubKey" as const, label: "Finnhub (quotes, news, IPOs)", placeholder: "pk_..." },
          { key: "fmpKey" as const, label: "Financial Modeling Prep (fundamentals, DCF)", placeholder: "Your key" },
          { key: "alphaVantageKey" as const, label: "Alpha Vantage (technicals, economics)", placeholder: "Your key" },
          { key: "newsApiKey" as const, label: "NewsAPI", placeholder: "Your key" },
        ].map((field) => (
          <div key={field.key}>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">
              {field.label}
            </label>
            <input
              type="password"
              value={settings[field.key]}
              onChange={(e) => setSettings({ ...settings, [field.key]: e.target.value })}
              placeholder={field.placeholder}
              className="w-full px-3 py-2 bg-surface-2 border border-border rounded-lg text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent/40 focus:ring-1 focus:ring-accent/20 transition-colors"
            />
          </div>
        ))}
      </Card>

      {/* Defaults */}
      <Card className="p-5 space-y-4">
        <h2 className="text-sm font-semibold text-text-primary">Default Parameters</h2>
        <div className="grid grid-cols-2 gap-4">
          <Select
            label="Default Horizon"
            value={settings.defaultHorizon}
            onChange={(e) => setSettings({ ...settings, defaultHorizon: e.target.value as Horizon })}
            options={HORIZONS.map((h) => ({ value: h, label: HORIZON_LABELS[h] }))}
          />
          <Select
            label="Default Ranking"
            value={settings.defaultRankMode}
            onChange={(e) => setSettings({ ...settings, defaultRankMode: e.target.value as RankMode })}
            options={RANK_MODES.map((m) => ({ value: m, label: RANK_MODE_LABELS[m] }))}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">
            Refresh Interval (minutes)
          </label>
          <input
            type="number"
            min={5}
            max={1440}
            value={settings.refreshInterval}
            onChange={(e) => setSettings({ ...settings, refreshInterval: parseInt(e.target.value) || 60 })}
            className="w-24 px-3 py-2 bg-surface-2 border border-border rounded-lg text-sm text-text-primary font-mono focus:border-accent/40 focus:ring-1 focus:ring-accent/20 transition-colors"
          />
        </div>
      </Card>

      {/* Universe */}
      <Card className="p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text-primary">Stock Universe</h2>
          <Badge variant="accent">{settings.universe.length} tickers</Badge>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {settings.universe.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 px-2 py-1 bg-surface-2 border border-border rounded-md text-2xs font-mono text-text-secondary"
            >
              {t}
              <button
                onClick={() =>
                  setSettings({
                    ...settings,
                    universe: settings.universe.filter((u) => u !== t),
                  })
                }
                className="text-text-tertiary hover:text-negative transition-colors ml-0.5"
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Add ticker (e.g. AAPL)"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const val = (e.target as HTMLInputElement).value.toUpperCase().trim();
                if (val && !settings.universe.includes(val)) {
                  setSettings({ ...settings, universe: [...settings.universe, val] });
                  (e.target as HTMLInputElement).value = "";
                }
              }
            }}
            className="flex-1 px-3 py-2 bg-surface-2 border border-border rounded-lg text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent/40 transition-colors"
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSettings({ ...settings, universe: DEFAULT_UNIVERSE })}
          >
            Reset
          </Button>
        </div>
      </Card>

      {/* Actions */}
      <div className="flex items-center justify-between pt-2">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? (
            <span className="flex items-center gap-2"><Spinner size={16} />Saving…</span>
          ) : saved ? (
            "✓ Saved"
          ) : (
            "Save Settings"
          )}
        </Button>
        <Button variant="ghost" onClick={handleLogout} className="text-negative hover:text-negative">
          Sign Out
        </Button>
      </div>
    </div>
  );
}
