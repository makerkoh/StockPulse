import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import type { AppSettings } from "@/types";
import { DEFAULT_UNIVERSE } from "@/lib/providers/interfaces";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Default settings — used when no persisted settings exist
const DEFAULTS: AppSettings = {
  finnhubKey: process.env.FINNHUB_API_KEY || "",
  fmpKey: process.env.FMP_API_KEY || "",
  alphaVantageKey: process.env.ALPHA_VANTAGE_API_KEY || "",
  newsApiKey: process.env.NEWS_API_KEY || "",
  defaultHorizon: "1W",
  defaultRankMode: "expected_return",
  universe: DEFAULT_UNIVERSE,
  refreshInterval: 60,
};

async function loadSettings(): Promise<AppSettings> {
  try {
    const rows = await prisma.setting.findMany();
    const stored: Record<string, string> = {};
    for (const row of rows) {
      stored[row.key] = row.value;
    }
    return {
      finnhubKey: stored.finnhubKey || DEFAULTS.finnhubKey,
      fmpKey: stored.fmpKey || DEFAULTS.fmpKey,
      alphaVantageKey: stored.alphaVantageKey || DEFAULTS.alphaVantageKey,
      newsApiKey: stored.newsApiKey || DEFAULTS.newsApiKey,
      defaultHorizon: (stored.defaultHorizon as AppSettings["defaultHorizon"]) || DEFAULTS.defaultHorizon,
      defaultRankMode: (stored.defaultRankMode as AppSettings["defaultRankMode"]) || DEFAULTS.defaultRankMode,
      universe: stored.universe ? JSON.parse(stored.universe) : DEFAULTS.universe,
      refreshInterval: stored.refreshInterval ? parseInt(stored.refreshInterval) : DEFAULTS.refreshInterval,
    };
  } catch {
    // DB not available — fall back to defaults (env vars)
    return { ...DEFAULTS };
  }
}

async function saveSetting(key: string, value: string): Promise<void> {
  try {
    await prisma.setting.upsert({
      where: { key },
      update: { value },
      create: { id: `setting-${key}`, key, value },
    });
  } catch (err) {
    console.error(`Failed to persist setting ${key}:`, err);
  }
}

export async function GET() {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const settings = await loadSettings();

  // Mask API keys for frontend display
  const masked: AppSettings = {
    ...settings,
    finnhubKey: settings.finnhubKey ? "••••" + settings.finnhubKey.slice(-4) : "",
    fmpKey: settings.fmpKey ? "••••" + settings.fmpKey.slice(-4) : "",
    alphaVantageKey: settings.alphaVantageKey ? "••••" + settings.alphaVantageKey.slice(-4) : "",
    newsApiKey: settings.newsApiKey ? "••••" + settings.newsApiKey.slice(-4) : "",
  };

  return NextResponse.json({ data: masked });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();

    // Persist non-masked API keys
    if (body.finnhubKey && !body.finnhubKey.startsWith("••••")) {
      await saveSetting("finnhubKey", body.finnhubKey);
    }
    if (body.fmpKey && !body.fmpKey.startsWith("••••")) {
      await saveSetting("fmpKey", body.fmpKey);
    }
    if (body.alphaVantageKey && !body.alphaVantageKey.startsWith("••••")) {
      await saveSetting("alphaVantageKey", body.alphaVantageKey);
    }
    if (body.newsApiKey && !body.newsApiKey.startsWith("••••")) {
      await saveSetting("newsApiKey", body.newsApiKey);
    }

    // Persist preferences
    if (body.defaultHorizon) await saveSetting("defaultHorizon", body.defaultHorizon);
    if (body.defaultRankMode) await saveSetting("defaultRankMode", body.defaultRankMode);
    if (Array.isArray(body.universe)) await saveSetting("universe", JSON.stringify(body.universe));
    if (body.refreshInterval) await saveSetting("refreshInterval", String(body.refreshInterval));

    return NextResponse.json({ data: { success: true } });
  } catch {
    return NextResponse.json({ error: "Failed to save settings" }, { status: 500 });
  }
}
