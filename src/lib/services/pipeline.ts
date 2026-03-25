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

  // Base drift from momentum
  const momentumDrift = (f.return_5d || 0) * 0.3 + (f.return_20d || 0) * 0.5;

  // Mean reversion for extreme RSI (prefer AV-computed if available)
  const rsiVal = f.av_rsi_14 ?? f.rsi_14 ?? 50;
  const rsiSignal = (50 - rsiVal) / 200;

  // Trend alignment bonus
  const trendBonus = f.golden_cross ? 0.002 * days : -0.001 * days;

  // Value tilt
  const pe = f.pe || 25;
  const valueTilt = pe < 15 ? 0.001 * days : pe > 40 ? -0.001 * days : 0;

  // DCF intrinsic value bonus (from FMP extended fundamentals)
  const dcfBonus = f.dcf_upside != null
    ? Math.max(-0.02, Math.min(0.02, f.dcf_upside * 0.05)) * days
    : 0;

  // Sentiment bonus — positive news = bullish drift, negative = bearish
  const sentimentDrift = (f.avg_sentiment ?? 0) * 0.01 * days;

  // ADX trend strength amplifier (from Alpha Vantage)
  const adxMultiplier = f.adx != null && f.adx > 25 ? 1.2 : 1.0;

  // Economic regime adjustment
  let macroAdjust = 0;
  if (f.fed_rate != null && f.cpi_yoy != null) {
    // High rates + high inflation = defensive tilt
    if (f.fed_rate > 4 && f.cpi_yoy > 3) macroAdjust = -0.001 * days;
    // Low rates = growth tilt
    else if (f.fed_rate < 2) macroAdjust = 0.001 * days;
  }

  // Expected return (annualized scaled to horizon)
  const annualizedDrift = (momentumDrift + rsiSignal + trendBonus + valueTilt + dcfBonus + sentimentDrift + macroAdjust) * adxMultiplier;
  const periodReturn = annualizedDrift * (days / 252);

  // Volatility scaling
  const baseVol = f.volatility_20d ? f.volatility_20d / currentPrice : 0.02;
  const periodVol = baseVol * Math.sqrt(days);

  // Quantile forecasts (log-normal inspired)
  const pMid = currentPrice * (1 + periodReturn);
  const pLow = currentPrice * (1 + periodReturn - 1.28 * periodVol);
  const pHigh = currentPrice * (1 + periodReturn + 1.28 * periodVol);

  // Confidence based on data quality and volatility
  const volConfidence = Math.max(0, 1 - periodVol * 3);
  const featureCount = Object.keys(f).length;
  const dataConfidence = Math.min(featureCount / 30, 1);
  // Sentiment agreement boosts confidence
  const sentimentConfidence = f.sentiment_strength != null ? f.sentiment_strength * 0.1 : 0;
  const confidence = (volConfidence * 0.5 + dataConfidence * 0.35 + sentimentConfidence * 0.15) * (0.85 + rng() * 0.15);

  const expectedReturn = (pMid - currentPrice) / currentPrice;
  const downside = Math.max(currentPrice - pLow, 0.01);
  const upside = Math.max(pHigh - currentPrice, 0.01);
  const riskReward = upside / downside;

  return {
    ticker,
    name,
    sector,
    horizon,
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
export async function runPrediction(
  horizon: Horizon = "1W",
  rankMode: RankMode = "expected_return",
  universe?: string[]
): Promise<PredictionResponse> {
  const provider = getProvider();
  const tickers = universe && universe.length > 0 ? universe : DEFAULT_UNIVERSE;

  // Fetch quotes for all tickers
  const quotes = await provider.getQuotes(tickers);

  // Fetch historical prices, fundamentals, news, and economic context in parallel
  const to = new Date();
  const from = new Date(Date.now() - 365 * 86_400_000);

  const [pricesMap, fundamentalsMap, newsMap, economicContext] = await Promise.all([
    // Historical prices
    Promise.all(
      tickers.map(async (t) => {
        const bars = await provider.getHistoricalPrices(t, from, to);
        return [t, bars] as const;
      })
    ).then((entries) => new Map(entries)),

    // Fundamentals (FMP preferred, falls back to Finnhub)
    Promise.all(
      tickers.map(async (t) => {
        const fund = await provider.getFundamentals(t);
        return [t, fund] as const;
      })
    ).then((entries) => new Map(entries)),

    // News for sentiment
    Promise.all(
      tickers.map(async (t) => {
        const news = await provider.getNews(t, 10);
        return [t, news] as const;
      })
    ).then((entries) => new Map(entries)),

    // Economic context (single call, shared across all tickers)
    provider.getEconomicContext(),
  ]);

  // Build sentiment from news
  const sentimentMap = new Map<string, SentimentData>();
  for (const [ticker, news] of newsMap) {
    sentimentMap.set(ticker, buildSentiment(news));
  }

  // Build initial feature vectors (without AV technicals)
  const featureVectors = new Map<string, FeatureVector>();
  for (const ticker of tickers) {
    const bars = pricesMap.get(ticker) || [];
    const fund = fundamentalsMap.get(ticker) || null;
    const sentiment = sentimentMap.get(ticker) || null;
    featureVectors.set(
      ticker,
      buildFeatures(ticker, bars, fund, null, economicContext, sentiment)
    );
  }

  // Generate initial forecasts and do a preliminary ranking
  const initialForecasts: QuantileForecast[] = quotes.map((q) => {
    const fv = featureVectors.get(q.ticker)!;
    return generateForecast(q.ticker, q.name, q.sector, q.price, fv, horizon);
  });

  // Two-pass ranking: enrich top picks with Alpha Vantage technicals
  // Only fetch AV technicals for top ~4 tickers (respects 25/day rate limit)
  const prelimScored = rankStocks(initialForecasts, featureVectors, rankMode);
  const topTickers = prelimScored.slice(0, 4).map((s) => s.ticker);

  const technicalMap = new Map<string, TechnicalIndicators | null>();
  for (const ticker of topTickers) {
    const tech = await provider.getTechnicalIndicators(ticker);
    if (tech) {
      technicalMap.set(ticker, tech);
      // Rebuild features with AV technicals for enriched tickers
      const bars = pricesMap.get(ticker) || [];
      const fund = fundamentalsMap.get(ticker) || null;
      const sentiment = sentimentMap.get(ticker) || null;
      featureVectors.set(
        ticker,
        buildFeatures(ticker, bars, fund, tech, economicContext, sentiment)
      );
    }
  }

  // Final forecasts with enriched data
  const forecasts: QuantileForecast[] = quotes.map((q) => {
    const fv = featureVectors.get(q.ticker)!;
    return generateForecast(q.ticker, q.name, q.sector, q.price, fv, horizon);
  });

  // Final score and rank
  const scored: ScoredStock[] = rankStocks(forecasts, featureVectors, rankMode);

  // Fetch IPOs
  const ipos: IpoEntry[] = await provider.getUpcomingIpos();

  return {
    stocks: scored,
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
