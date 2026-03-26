import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { getProvider } from "@/lib/providers/registry";
import { buildFeatures } from "@/lib/services/features";
import type { Horizon, StockDetail, SentimentData, NewsItem } from "@/types";

// Keyword-based sentiment (same as pipeline.ts — shared logic)
const BULLISH_KEYWORDS = [
  "upgrade", "beat", "surpass", "outperform", "bullish", "growth", "profit",
  "record", "strong", "surge", "rally", "soar", "boost", "exceed", "positive",
  "buy", "overweight", "raise", "higher", "gain", "expand", "approval",
];
const BEARISH_KEYWORDS = [
  "downgrade", "miss", "underperform", "bearish", "decline", "loss", "weak",
  "cut", "sell", "underweight", "lower", "drop", "fall", "layoff", "lawsuit",
  "investigation", "recall", "warning", "debt", "default", "bankruptcy",
];

function scoreHeadlineSentiment(headline: string): number {
  const lower = headline.toLowerCase();
  let score = 0;
  for (const kw of BULLISH_KEYWORDS) if (lower.includes(kw)) score += 0.15;
  for (const kw of BEARISH_KEYWORDS) if (lower.includes(kw)) score -= 0.15;
  return Math.max(-1, Math.min(1, score));
}

function applyNewsSentiment(news: NewsItem[]): NewsItem[] {
  return news.map((item) => ({
    ...item,
    sentiment: item.sentiment !== 0 ? item.sentiment : scoreHeadlineSentiment(item.headline),
  }));
}

export const maxDuration = 15;

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ticker = req.nextUrl.searchParams.get("ticker");
  const horizon = (req.nextUrl.searchParams.get("horizon") || "1W") as Horizon;
  if (!ticker) {
    return NextResponse.json({ error: "Ticker required" }, { status: 400 });
  }

  const HORIZON_DAYS: Record<string, number> = {
    "1D": 1, "1W": 5, "1M": 21, "3M": 63, "6M": 126,
  };

  try {
    const provider = getProvider();
    const to = new Date();
    const from = new Date(Date.now() - 365 * 86_400_000);

    // Fetch all data in parallel
    const [quote, fundamentals, prices, rawNews, insider, analyst, earnings] = await Promise.all([
      provider.getQuote(ticker),
      provider.getFundamentals(ticker),
      provider.getHistoricalPrices(ticker, from, to),
      provider.getNews(ticker, 8),
      provider.getInsiderData(ticker),
      provider.getAnalystData(ticker),
      provider.getEarningsData(ticker),
    ]);

    if (!quote) {
      return NextResponse.json({ error: `Stock ${ticker} not found` }, { status: 404 });
    }

    // Score news sentiment
    const news = applyNewsSentiment(rawNews);

    // Build sentiment
    let sentimentCount = 0, bullishCount = 0, bearishCount = 0, sentSum = 0;
    for (const n of news) {
      sentSum += n.sentiment;
      if (n.sentiment > 0.1) bullishCount++;
      else if (n.sentiment < -0.1) bearishCount++;
      sentimentCount++;
    }
    const sentiment: SentimentData = {
      avgSentiment: sentimentCount > 0 ? sentSum / sentimentCount : 0,
      sentimentCount, bullishCount, bearishCount,
    };

    // Build features using the SAME logic as the dashboard pipeline
    const fv = buildFeatures(ticker, prices, fundamentals, null, null, sentiment, insider, analyst, earnings);
    const f = fv.features;

    // Generate forecast using the SAME logic as pipeline.ts
    const days = HORIZON_DAYS[horizon] || 5;

    const momentumDrift = (f.return_5d || 0) * 0.3 + (f.return_20d || 0) * 0.5;
    const rsiVal = f.av_rsi_14 ?? f.rsi_14 ?? 50;
    const rsiSignal = (50 - rsiVal) / 200;
    const trendBonus = f.golden_cross ? 0.002 * days : -0.001 * days;
    const pe = f.pe || 25;
    const valueTilt = pe < 15 ? 0.001 * days : pe > 40 ? -0.001 * days : 0;
    const dcfBonus = f.dcf_upside != null ? Math.max(-0.02, Math.min(0.02, f.dcf_upside * 0.05)) * days : 0;
    const sentimentDrift = (f.avg_sentiment ?? 0) * 0.01 * days;
    const adxMultiplier = f.adx != null && f.adx > 25 ? 1.2 : 1.0;
    let analystDrift = 0;
    if (f.analyst_consensus != null) analystDrift = f.analyst_consensus * 0.01 * days;
    if (f.target_upside != null) analystDrift += Math.max(-0.02, Math.min(0.02, f.target_upside * 0.03)) * days;
    let earningsVolBoost = 1.0;
    if (f.earnings_imminent === 1) earningsVolBoost = 1.5;
    const earningsDrift = (f.last_earnings_surprise ?? 0) * 0.001 * days;
    let insiderDrift = 0;
    if (f.insider_mspr != null) insiderDrift = (f.insider_mspr / 100) * 0.015 * days;
    if (f.insider_cluster === 1) insiderDrift += 0.01 * days;
    const mrzDrift = f.mean_reversion_z != null ? -f.mean_reversion_z * 0.003 * days : 0;
    let macroAdjust = 0;
    if (f.fed_rate != null && f.cpi_yoy != null) {
      if (f.fed_rate > 4 && f.cpi_yoy > 3) macroAdjust = -0.001 * days;
      else if (f.fed_rate < 2) macroAdjust = 0.001 * days;
    }

    const annualizedDrift = (momentumDrift + rsiSignal + trendBonus + valueTilt + dcfBonus +
      sentimentDrift + insiderDrift + analystDrift + earningsDrift + mrzDrift + macroAdjust) * adxMultiplier;
    const periodReturn = annualizedDrift * (days / 252);

    const annualVol = f.volatility_20d || 0.25;
    const periodVol = (annualVol / Math.sqrt(252)) * Math.sqrt(days) * earningsVolBoost;

    const pMid = quote.price * (1 + periodReturn);
    const pLow = quote.price * (1 + periodReturn - 1.28 * periodVol);
    const pHigh = quote.price * (1 + periodReturn + 1.28 * periodVol);

    const volConfidence = Math.max(0, 1 - periodVol * 3);
    const featureCount = Object.keys(f).filter((k) => !k.startsWith("_")).length;
    const dataConfidence = Math.min(featureCount / 30, 1);
    const hasFullData = f._has_60d_data === 1 ? 0.1 : 0;
    const confidence = volConfidence * 0.45 + dataConfidence * 0.3 + hasFullData + 0.15;

    const expectedReturn = (pMid - quote.price) / quote.price;
    const downside = Math.max(quote.price - pLow, 0.01);
    const upside = Math.max(pHigh - quote.price, 0.01);

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
        horizon,
        currentPrice: quote.price,
        pLow: +Math.max(pLow, 0.01).toFixed(2),
        pMid: +pMid.toFixed(2),
        pHigh: +pHigh.toFixed(2),
        confidence: +Math.min(Math.max(confidence, 0.1), 0.99).toFixed(3),
        expectedReturn: +expectedReturn.toFixed(4),
        riskReward: +(upside / downside).toFixed(2),
      },
    };

    return NextResponse.json({ data: detail });
  } catch (err) {
    console.error("Stock detail error:", err);
    return NextResponse.json({ error: "Failed to fetch stock data" }, { status: 500 });
  }
}
