import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import type { AppSettings } from "@/types";
import { DEFAULT_UNIVERSE } from "@/lib/providers/interfaces";

// In-memory settings store (in production, use Prisma Setting model)
let currentSettings: AppSettings = {
  finnhubKey: process.env.FINNHUB_API_KEY || "",
  alphaVantageKey: process.env.ALPHA_VANTAGE_API_KEY || "",
  newsApiKey: process.env.NEWS_API_KEY || "",
  defaultHorizon: "1W",
  defaultRankMode: "expected_return",
  universe: DEFAULT_UNIVERSE,
  refreshInterval: 60,
};

export async function GET() {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Mask API keys for frontend display
  const masked: AppSettings = {
    ...currentSettings,
    finnhubKey: currentSettings.finnhubKey ? "••••" + currentSettings.finnhubKey.slice(-4) : "",
    alphaVantageKey: currentSettings.alphaVantageKey ? "••••" + currentSettings.alphaVantageKey.slice(-4) : "",
    newsApiKey: currentSettings.newsApiKey ? "••••" + currentSettings.newsApiKey.slice(-4) : "",
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

    // Only update non-masked fields
    if (body.finnhubKey && !body.finnhubKey.startsWith("••••")) {
      currentSettings.finnhubKey = body.finnhubKey;
    }
    if (body.alphaVantageKey && !body.alphaVantageKey.startsWith("••••")) {
      currentSettings.alphaVantageKey = body.alphaVantageKey;
    }
    if (body.newsApiKey && !body.newsApiKey.startsWith("••••")) {
      currentSettings.newsApiKey = body.newsApiKey;
    }

    if (body.defaultHorizon) currentSettings.defaultHorizon = body.defaultHorizon;
    if (body.defaultRankMode) currentSettings.defaultRankMode = body.defaultRankMode;
    if (Array.isArray(body.universe)) currentSettings.universe = body.universe;
    if (body.refreshInterval) currentSettings.refreshInterval = body.refreshInterval;

    return NextResponse.json({ data: { success: true } });
  } catch {
    return NextResponse.json({ error: "Failed to save settings" }, { status: 500 });
  }
}
