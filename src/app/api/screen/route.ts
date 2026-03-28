import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { runScreeningPipeline, getScreenedUniverse } from "@/lib/services/screener";
import { prisma } from "@/lib/prisma";

// Screening can take several minutes (scanning 500 stocks)
export const maxDuration = 300;

/** GET: Return the current screened universe */
export async function GET() {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const universe = await getScreenedUniverse(50);
  if (!universe) {
    return NextResponse.json({
      data: null,
      message: "No screening results yet. Run a screen first.",
    });
  }

  return NextResponse.json({ data: { tickers: universe, count: universe.length } });
}

/** POST: Run the full screening pipeline */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Get API keys from DB
    const [fmpKey, finnhubKey] = await Promise.all([
      prisma.apiKey.findUnique({ where: { provider: "fmp" } }),
      prisma.apiKey.findUnique({ where: { provider: "finnhub" } }),
    ]);

    if (!fmpKey?.key || !finnhubKey?.key) {
      return NextResponse.json({
        error: "API keys not configured. Set FMP and Finnhub keys in Settings.",
      }, { status: 400 });
    }

    const topN = 50;
    const tickers = await runScreeningPipeline(fmpKey.key, finnhubKey.key, topN);

    if (tickers.length === 0) {
      return NextResponse.json({
        error: "Screening failed — no stocks returned. Check API keys and try again.",
      }, { status: 500 });
    }

    return NextResponse.json({
      data: {
        tickers,
        count: tickers.length,
        message: `Screened and ranked ${tickers.length} stocks from 500+ candidates`,
      },
    });
  } catch (err) {
    console.error("Screening error:", err);
    return NextResponse.json({
      error: err instanceof Error ? err.message : "Screening failed",
    }, { status: 500 });
  }
}
