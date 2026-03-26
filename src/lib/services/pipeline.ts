import type {
  Horizon,
  RankMode,
  Strategy,
  QuantileForecast,
  ScoredStock,
  IpoEntry,
  PredictionResponse,
  FeatureVector,
  SentimentData,
  NewsItem,
  FundamentalData,
} from "@/types";
import { getProvider, isDemo } from "@/lib/providers/registry";
import { DEFAULT_UNIVERSE } from "@/lib/providers/interfaces";
import { buildFeatures } from "./features";
import { rankStocks } from "./scoring";

const HORIZON_DAYS: Record<Horizon, number> = {
  "1D": 1, "1W": 5, "1M": 21, "3M": 63, "6M": 126,
};

// ─── Keyword-based sentiment scoring ────────────────────────────────
const BULLISH_KEYWORDS = [
  "upgrade", "beat", "surpass", "outperform", "bullish", "growth", "profit",
  "record", "strong", "surge", "rally", "soar", "boost", "exceed", "positive",
  "buy", "overweight", "raise", "higher", "gain", "expand", "innovation",
  "breakthrough", "partnership", "contract", "dividend", "buyback", "approval",
];
const BEARISH_KEYWORDS = [
  "downgrade", "miss", "underperform", "bearish", "decline", "loss", "weak",
  "cut", "sell", "underweight", "lower", "drop", "fall", "layoff", "lawsuit",
  "investigation", "recall", "warning", "debt", "default", "bankruptcy",
  "negative", "concern", "risk", "slowdown", "tariff", "sanction", "fine",
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

function buildSentiment(news: NewsItem[]): SentimentData {
  if (news.length === 0) {
    return { avgSentiment: 0, sentimentCount: 0, bullishCount: 0, bearishCount: 0 };
  }
  let sum = 0, bullish = 0, bearish = 0;
  for (const item of news) {
    sum += item.sentiment;
    if (item.sentiment > 0.1) bullish++;
    else if (item.sentiment < -0.1) bearish++;
  }
  return { avgSentiment: sum / news.length, sentimentCount: news.length, bullishCount: bullish, bearishCount: bearish };
}

// ─── Quick feature vector from quote + fundamentals only ────────────
// Used in Pass 1 to rank without burning API calls on historical prices.
// Now includes beta-derived volatility estimate instead of hardcoded 2%.
function buildQuickFeatures(
  ticker: string,
  price: number,
  change: number,
  fundamentals: FundamentalData | null,
): FeatureVector {
  const features: Record<string, number> = {};

  // Estimate returns from quote change
  features.return_1d = price > 0 ? change / price : 0;
  features.return_5d = 0;
  features.return_20d = 0;
  features.return_60d = 0;
  features.rsi_14 = 50;
  features.golden_cross = 0;

  // Use beta to estimate volatility (much better than hardcoded 2%)
  // S&P 500 annualized vol ~16%, so stock vol ≈ beta * 16%
  const beta = fundamentals?.beta ?? 1.0;
  features.volatility_20d = Math.abs(beta) * 0.16;
  features.volume_ratio = 1;
  features._has_60d_data = 0;
  features._has_200d_data = 0;
  features._has_fundamentals = fundamentals ? 1 : 0;

  if (fundamentals) {
    features.pe = fundamentals.pe ?? 0;
    features._pe_missing = fundamentals.pe == null ? 1 : 0;
    features.forward_pe = fundamentals.forwardPe ?? 0;
    features.pb = fundamentals.pb ?? 0;
    features._pb_missing = fundamentals.pb == null ? 1 : 0;
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
      if (ext.operatingMargin != null) features.operating_margin = ext.operatingMargin;
    }
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

  const annualizedDrift = (
    momentumDrift + rsiSignal + trendBonus + valueTilt + dcfBonus +
    sentimentDrift + insiderDrift + analystDrift + earningsDrift +
    mrzDrift + macroAdjust
  ) * adxMultiplier;

  const periodReturn = annualizedDrift * (days / 252);
  const annualVol = f.volatility_20d || 0.25;
  const periodVol = (annualVol / Math.sqrt(252)) * Math.sqrt(days) * earningsVolBoost;

  const pMid = currentPrice * (1 + periodReturn);
  const pLow = currentPrice * (1 + periodReturn - 1.28 * periodVol);
  const pHigh = currentPrice * (1 + periodReturn + 1.28 * periodVol);

  const volConfidence = Math.max(0, 1 - periodVol * 3);
  const featureCount = Object.keys(f).filter((k) => !k.startsWith("_")).length;
  const dataConfidence = Math.min(featureCount / 30, 1);
  const sentimentConfidence = f.sentiment_strength != null ? f.sentiment_strength * 0.1 : 0;
  const hasFullData = f._has_60d_data === 1 ? 0.1 : 0;
  const confidence = volConfidence * 0.45 + dataConfidence * 0.3 + sentimentConfidence * 0.1 + hasFullData + 0.05;

  const expectedReturn = (pMid - currentPrice) / currentPrice;
  const downside = Math.max(currentPrice - pLow, 0.01);
  const upside = Math.max(pHigh - currentPrice, 0.01);

  return {
    ticker, name, sector, horizon,
    currentPrice: +currentPrice.toFixed(2),
    pLow: +Math.max(pLow, 0.01).toFixed(2),
    pMid: +pMid.toFixed(2),
    pHigh: +pHigh.toFixed(2),
    confidence: +Math.min(Math.max(confidence, 0.1), 0.99).toFixed(3),
    expectedReturn: +expectedReturn.toFixed(4),
    riskReward: +(upside / downside).toFixed(2),
  };
}

// ─── Run Full Prediction Pipeline ────────────────────────────────────
// API-budget-aware: designed for free-tier limits
//
// API call budget per run:
//   Pass 1: 1 batch quote (FMP) + 40 fundamentals = ~41 calls
//   Pass 2: 10 historical prices + 10 news + 10 insider + 10 analyst + 10 earnings = ~50 calls
//   Total: ~91 calls → safe for 2-3 runs/day on FMP free (250/day)
//
// Pass 1 uses fundamentals + beta-derived volatility to rank
// Pass 2 enriches top 10 with full historical data + alternative signals
export async function runPrediction(
  horizon: Horizon = "1W",
  rankMode: RankMode = "expected_return",
  universe?: string[],
  strategy: Strategy = "swing"
): Promise<PredictionResponse> {
  const provider = getProvider();
  const tickers = universe && universe.length > 0 ? universe : DEFAULT_UNIVERSE;

  // ── PASS 1: Batch quotes + fundamentals (~41 API calls) ────────
  const quotes = await provider.getQuotes(tickers);
  const quoteMap = new Map(quotes.map((q) => [q.ticker, q]));

  // Fetch fundamentals in parallel batches of 10
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
    for (const [t, fund] of results) fundamentalsMap.set(t, fund);
  }

  // Build quick feature vectors (NO historical price calls — uses beta for vol)
  const featureVectors = new Map<string, FeatureVector>();
  for (const ticker of tickers) {
    const quote = quoteMap.get(ticker);
    const fund = fundamentalsMap.get(ticker) || null;
    featureVectors.set(
      ticker,
      buildQuickFeatures(ticker, quote?.price || 0, quote?.change || 0, fund)
    );
  }

  // Generate initial forecasts and rank
  const forecasts: QuantileForecast[] = quotes
    .filter((q) => q.price > 0)
    .map((q) => {
      const fv = featureVectors.get(q.ticker)!;
      return generateForecast(q.ticker, q.name, q.sector, q.price, fv, horizon);
    });

  const scored = rankStocks(forecasts, featureVectors, rankMode, strategy);

  // ── PASS 2: Enrich top 10 with full data (~50 API calls) ──────
  const topTickers = scored.slice(0, 10).map((s) => s.ticker);
  const to = new Date();
  const from = new Date(Date.now() - 365 * 86_400_000);

  const [enrichedPrices, enrichedNews, enrichedInsider, enrichedAnalyst, enrichedEarnings] = await Promise.all([
    Promise.all(
      topTickers.map(async (t) => {
        const bars = await provider.getHistoricalPrices(t, from, to);
        return [t, bars] as const;
      })
    ).then((entries) => new Map(entries)),
    Promise.all(
      topTickers.map(async (t) => {
        const news = applyNewsSentiment(await provider.getNews(t, 10));
        return [t, news] as const;
      })
    ).then((entries) => new Map(entries)),
    Promise.all(
      topTickers.map(async (t) => {
        const insider = await provider.getInsiderData(t);
        return [t, insider] as const;
      })
    ).then((entries) => new Map(entries)),
    Promise.all(
      topTickers.map(async (t) => {
        const analyst = await provider.getAnalystData(t);
        return [t, analyst] as const;
      })
    ).then((entries) => new Map(entries)),
    Promise.all(
      topTickers.map(async (t) => {
        const earnings = await provider.getEarningsData(t);
        return [t, earnings] as const;
      })
    ).then((entries) => new Map(entries)),
  ]);

  // Rebuild features for top 10 with FULL data (return-based vol, all signals)
  for (const ticker of topTickers) {
    const bars = enrichedPrices.get(ticker) || [];
    const fund = fundamentalsMap.get(ticker) || null;
    const news = enrichedNews.get(ticker) || [];
    const sentiment = buildSentiment(news);
    const insider = enrichedInsider.get(ticker) || null;
    const analyst = enrichedAnalyst.get(ticker) || null;
    const earnings = enrichedEarnings.get(ticker) || null;
    if (bars.length > 5) {
      featureVectors.set(
        ticker,
        buildFeatures(ticker, bars, fund, null, null, sentiment, insider, analyst, earnings)
      );
    }
  }

  // Re-generate forecasts and GLOBALLY re-rank
  const enrichedForecasts: QuantileForecast[] = [];
  for (const ticker of tickers) {
    const quote = quoteMap.get(ticker);
    if (!quote || quote.price <= 0) continue;
    const fv = featureVectors.get(ticker)!;
    enrichedForecasts.push(generateForecast(ticker, quote.name, quote.sector, quote.price, fv, horizon));
  }

  const finalStocks = rankStocks(enrichedForecasts, featureVectors, rankMode, strategy);

  // Fetch IPOs (1-2 API calls)
  const ipos: IpoEntry[] = await provider.getUpcomingIpos();

  return {
    stocks: finalStocks,
    ipos,
    featureVectors,
    meta: {
      horizon,
      rankMode,
      strategy,
      universe: tickers,
      generatedAt: new Date().toISOString(),
      isDemo: isDemo(),
    },
  };
}
