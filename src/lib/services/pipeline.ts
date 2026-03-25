import type {
  Horizon,
  RankMode,
  QuantileForecast,
  ScoredStock,
  IpoEntry,
  PredictionResponse,
  FeatureVector,
  SentimentData,
  TechnicalIndicators,
  EconomicContext,
  NewsItem,
  PriceBar,
  FundamentalData,
  InsiderData,
} from "@/types";
import { getProvider, isDemo } from "@/lib/providers/registry";
import { DEFAULT_UNIVERSE } from "@/lib/providers/interfaces";
import { buildFeatures } from "./features";
import { rankStocks } from "./scoring";
import { seededRandom } from "@/lib/utils";

const HORIZON_DAYS: Record<Horizon, number> = {
  "1D": 1, "1W": 5, "1M": 21, "3M": 63, "6M": 126,
};

// ─── Build sentiment from news items ────────────────────────────────
function buildSentiment(news: NewsItem[]): SentimentData {
  if (news.length === 0) {
    return { avgSentiment: 0, sentimentCount: 0, bullishCount: 0, bearishCount: 0 };
  }
  let sum = 0;
  let bullish = 0;
  let bearish = 0;
  for (const item of news) {
    sum += item.sentiment;
    if (item.sentiment > 0.1) bullish++;
    else if (item.sentiment < -0.1) bearish++;
  }
  return {
    avgSentiment: sum / news.length,
    sentimentCount: news.length,
    bullishCount: bullish,
    bearishCount: bearish,
  };
}

// ─── Quick feature vector from quote data only (no historical bars) ─
function buildQuickFeatures(
  ticker: string,
  price: number,
  fundamentals: FundamentalData | null,
  sentiment?: SentimentData | null,
  economicContext?: EconomicContext | null,
): FeatureVector {
  const features: Record<string, number> = {};

  // Without price history, use basic signals
  features.return_1d = 0;
  features.return_5d = 0;
  features.return_20d = 0;
  features.return_60d = 0;
  features.rsi_14 = 50;
  features.golden_cross = 0;
  features.volatility_20d = price * 0.02; // assume 2% vol
  features.volume_ratio = 1;

  if (fundamentals) {
    features.pe = fundamentals.pe ?? 0;
    features.forward_pe = fundamentals.forwardPe ?? 0;
    features.pb = fundamentals.pb ?? 0;
    features.ps = fundamentals.ps ?? 0;
    features.ev_ebitda = fundamentals.evEbitda ?? 0;
    features.debt_equity = fundamentals.debtEquity ?? 0;
    features.roe = fundamentals.roe ?? 0;
    features.revenue_growth = fundamentals.revenueGrowth ?? 0;
    features.earnings_growth = fundamentals.earningsGrowth ?? 0;
    features.dividend_yield = fundamentals.dividendYield ?? 0;
    features.beta = fundamentals.beta ?? 0;

    if ("dcf" in fundamentals && fundamentals.dcf !== undefined) {
      const ext = fundamentals as import("@/types").ExtendedFundamentals;
      if (ext.dcf != null && price > 0) features.dcf_upside = (ext.dcf - price) / price;
      if (ext.grossMargin != null) features.gross_margin = ext.grossMargin;
      if (ext.netMargin != null) features.net_margin = ext.netMargin;
    }
  }

  if (sentiment) {
    features.avg_sentiment = sentiment.avgSentiment;
    features.sentiment_count = sentiment.sentimentCount;
    features.bullish_ratio = sentiment.sentimentCount > 0 ? sentiment.bullishCount / sentiment.sentimentCount : 0.5;
    features.sentiment_strength = Math.abs(sentiment.avgSentiment);
  }

  if (economicContext) {
    if (economicContext.gdpGrowth != null) features.gdp_growth = economicContext.gdpGrowth;
    if (economicContext.cpiYoy != null) features.cpi_yoy = economicContext.cpiYoy;
    if (economicContext.fedFundsRate != null) features.fed_rate = economicContext.fedFundsRate;
  }

  return { ticker, date: new Date().toISOString().split("T")[0], features };
}

// ─── Generate Quantile Forecast ──────────────────────────────────────
function generateForecast(
  ticker: string,
  name: string,
  sector: string,
  currentPrice: number,
  features: FeatureVector,
  horizon: Horizon
): QuantileForecast {
  const f = features.features;
  const days = HORIZON_DAYS[horizon];
  const rng = seededRandom(ticker + horizon + new Date().toISOString().split("T")[0]);

  const momentumDrift = (f.return_5d || 0) * 0.3 + (f.return_20d || 0) * 0.5;
  const rsiVal = f.av_rsi_14 ?? f.rsi_14 ?? 50;
  const rsiSignal = (50 - rsiVal) / 200;
  const trendBonus = f.golden_cross ? 0.002 * days : -0.001 * days;
  const pe = f.pe || 25;
  const valueTilt = pe < 15 ? 0.001 * days : pe > 40 ? -0.001 * days : 0;
  const dcfBonus = f.dcf_upside != null ? Math.max(-0.02, Math.min(0.02, f.dcf_upside * 0.05)) * days : 0;
  const sentimentDrift = (f.avg_sentiment ?? 0) * 0.01 * days;
  const adxMultiplier = f.adx != null && f.adx > 25 ? 1.2 : 1.0;

  // Insider trading signal — cluster buying is very strong
  let insiderDrift = 0;
  if (f.insider_mspr != null) {
    insiderDrift = (f.insider_mspr / 100) * 0.015 * days; // MSPR scaled to drift
  }
  if (f.insider_cluster === 1) {
    insiderDrift += 0.01 * days; // Strong bonus for cluster buying
  }

  let macroAdjust = 0;
  if (f.fed_rate != null && f.cpi_yoy != null) {
    if (f.fed_rate > 4 && f.cpi_yoy > 3) macroAdjust = -0.001 * days;
    else if (f.fed_rate < 2) macroAdjust = 0.001 * days;
  }

  const annualizedDrift = (momentumDrift + rsiSignal + trendBonus + valueTilt + dcfBonus + sentimentDrift + insiderDrift + macroAdjust) * adxMultiplier;
  const periodReturn = annualizedDrift * (days / 252);
  const baseVol = f.volatility_20d ? f.volatility_20d / currentPrice : 0.02;
  const periodVol = baseVol * Math.sqrt(days);

  const pMid = currentPrice * (1 + periodReturn);
  const pLow = currentPrice * (1 + periodReturn - 1.28 * periodVol);
  const pHigh = currentPrice * (1 + periodReturn + 1.28 * periodVol);

  const volConfidence = Math.max(0, 1 - periodVol * 3);
  const featureCount = Object.keys(f).length;
  const dataConfidence = Math.min(featureCount / 30, 1);
  const sentimentConfidence = f.sentiment_strength != null ? f.sentiment_strength * 0.1 : 0;
  const confidence = (volConfidence * 0.5 + dataConfidence * 0.35 + sentimentConfidence * 0.15) * (0.85 + rng() * 0.15);

  const expectedReturn = (pMid - currentPrice) / currentPrice;
  const downside = Math.max(currentPrice - pLow, 0.01);
  const upside = Math.max(pHigh - currentPrice, 0.01);
  const riskReward = upside / downside;

  return {
    ticker, name, sector, horizon,
    currentPrice: +currentPrice.toFixed(2),
    pLow: +Math.max(pLow, 0.01).toFixed(2),
    pMid: +pMid.toFixed(2),
    pHigh: +pHigh.toFixed(2),
    confidence: +Math.min(Math.max(confidence, 0.1), 0.99).toFixed(3),
    expectedReturn: +expectedReturn.toFixed(4),
    riskReward: +riskReward.toFixed(2),
  };
}

// ─── Run Full Prediction Pipeline ────────────────────────────────────
// Optimized for Vercel's 10-second timeout:
// Pass 1: Batch quotes (1 call) + parallel fundamentals for top sectors
// Pass 2: Enrich top 5 with historical prices + technicals
export async function runPrediction(
  horizon: Horizon = "1W",
  rankMode: RankMode = "expected_return",
  universe?: string[]
): Promise<PredictionResponse> {
  const provider = getProvider();
  const tickers = universe && universe.length > 0 ? universe : DEFAULT_UNIVERSE;

  // ── PASS 1: Fast batch data (should complete in 2-3 seconds) ──────
  // Batch quotes (FMP: 1 API call for all 40 tickers)
  const quotes = await provider.getQuotes(tickers);

  // Fetch fundamentals in parallel batches of 10 to stay within timeout
  const batchSize = 10;
  const fundamentalsMap = new Map<string, FundamentalData | null>();
  for (let i = 0; i < tickers.length; i += batchSize) {
    const batch = tickers.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (t) => {
        const fund = await provider.getFundamentals(t);
        return [t, fund] as const;
      })
    );
    for (const [t, fund] of results) {
      fundamentalsMap.set(t, fund);
    }
  }

  // Build quick feature vectors (no historical bars needed)
  const featureVectors = new Map<string, FeatureVector>();
  for (const ticker of tickers) {
    const quote = quotes.find((q) => q.ticker === ticker);
    const fund = fundamentalsMap.get(ticker) || null;
    featureVectors.set(
      ticker,
      buildQuickFeatures(ticker, quote?.price || 0, fund)
    );
  }

  // Generate initial forecasts and rank
  const forecasts: QuantileForecast[] = quotes.map((q) => {
    const fv = featureVectors.get(q.ticker)!;
    return generateForecast(q.ticker, q.name, q.sector, q.price, fv, horizon);
  });

  const scored: ScoredStock[] = rankStocks(forecasts, featureVectors, rankMode);

  // ── PASS 2: Enrich top 5 with detailed data ──────────────────────
  const topTickers = scored.slice(0, 5).map((s) => s.ticker);
  const to = new Date();
  const from = new Date(Date.now() - 365 * 86_400_000);

  // Fetch prices, news, and insider data for top 5 in parallel
  const [enrichedPrices, enrichedNews, enrichedInsider] = await Promise.all([
    Promise.all(
      topTickers.map(async (t) => {
        const bars = await provider.getHistoricalPrices(t, from, to);
        return [t, bars] as const;
      })
    ).then((entries) => new Map(entries)),
    Promise.all(
      topTickers.map(async (t) => {
        const news = await provider.getNews(t, 10);
        return [t, news] as const;
      })
    ).then((entries) => new Map(entries)),
    Promise.all(
      topTickers.map(async (t) => {
        const insider = await provider.getInsiderData(t);
        return [t, insider] as const;
      })
    ).then((entries) => new Map(entries)),
  ]);

  // Rebuild features for top 5 with full data including insider signals
  for (const ticker of topTickers) {
    const bars = enrichedPrices.get(ticker) || [];
    const fund = fundamentalsMap.get(ticker) || null;
    const news = enrichedNews.get(ticker) || [];
    const sentiment = buildSentiment(news);
    const insider = enrichedInsider.get(ticker) || null;
    if (bars.length > 0) {
      featureVectors.set(
        ticker,
        buildFeatures(ticker, bars, fund, null, null, sentiment, insider)
      );
    }
  }

  // Re-generate forecasts for enriched tickers
  const finalStocks: ScoredStock[] = scored.map((s) => {
    if (topTickers.includes(s.ticker)) {
      const quote = quotes.find((q) => q.ticker === s.ticker)!;
      const fv = featureVectors.get(s.ticker)!;
      const forecast = generateForecast(s.ticker, quote.name, quote.sector, quote.price, fv, horizon);
      const reScored = rankStocks([forecast], featureVectors, rankMode)[0];
      return { ...reScored, rank: s.rank };
    }
    return s;
  });

  // Fetch IPOs
  const ipos: IpoEntry[] = await provider.getUpcomingIpos();

  return {
    stocks: finalStocks,
    ipos,
    meta: {
      horizon,
      rankMode,
      universe: tickers,
      generatedAt: new Date().toISOString(),
      isDemo: isDemo(),
    },
  };
}
