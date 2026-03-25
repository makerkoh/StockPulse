import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { getProvider } from "@/lib/providers/registry";
import { buildFeatures } from "@/lib/services/features";
import type { StockDetail } from "@/types";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ticker = req.nextUrl.searchParams.get("ticker");
  if (!ticker) {
    return NextResponse.json({ error: "Ticker required" }, { status: 400 });
  }

  try {
    const provider = getProvider();
    const to = new Date();
    const from = new Date(Date.now() - 365 * 86_400_000);

    const [quote, fundamentals, prices, news] = await Promise.all([
      provider.getQuote(ticker),
      provider.getFundamentals(ticker),
      provider.getHistoricalPrices(ticker, from, to),
      provider.getNews(ticker, 8),
    ]);

    if (!quote) {
      return NextResponse.json({ error: `Stock ${ticker} not found` }, { status: 404 });
    }

    // Build a quick forecast for the detail page
    const fv = buildFeatures(ticker, prices, fundamentals);
    const { seededRandom } = await import("@/lib/utils");
    const rng = seededRandom(ticker + "detail");
    const vol = fv.features.volatility_20d ? fv.features.volatility_20d / quote.price : 0.02;
    const drift = (fv.features.return_20d || 0) * 0.5;
    const pMid = quote.price * (1 + drift * 0.08);
    const pLow = quote.price * (1 - 1.28 * vol * Math.sqrt(5));
    const pHigh = quote.price * (1 + 1.28 * vol * Math.sqrt(5));

    const detail: StockDetail = {
      quote,
      fundamentals: fundamentals || {
        pe: null, forwardPe: null, pb: null, ps: null, evEbitda: null,
        debtEquity: null, roe: null, revenueGrowth: null, earningsGrowth: null,
        dividendYield: null, beta: null,
      },
      prices,
      news,
      forecast: {
        ticker,
        name: quote.name,
        sector: quote.sector,
        horizon: "1W",
        currentPrice: quote.price,
        pLow: +Math.max(pLow, 0.01).toFixed(2),
        pMid: +pMid.toFixed(2),
        pHigh: +pHigh.toFixed(2),
        confidence: +(0.55 + rng() * 0.35).toFixed(3),
        expectedReturn: +((pMid - quote.price) / quote.price).toFixed(4),
        riskReward: +((pHigh - quote.price) / Math.max(quote.price - pLow, 0.01)).toFixed(2),
      },
    };

    return NextResponse.json({ data: detail });
  } catch (err) {
    console.error("Stock detail error:", err);
    return NextResponse.json({ error: "Failed to fetch stock data" }, { status: 500 });
  }
}
