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
// Finnhub doesn't provide inline sentiment, so we score from headlines
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
  for (const kw of BULLISH_KEYWORDS) {
    if (lower.includes(kw)) score += 0.15;
  }
  for (const kw of BEARISH_KEYWORDS) {
    if (lower.includes(kw)) score -= 0.15;
  }
  return Math.max(-1, Math.min(1, score));
}

function applyNewsSentiment(news: NewsItem[]): NewsItem[] {
  return news.map((item) => ({
    ...item,
    sentiment: item.sentiment !== 0
      ? item.sentiment // Keep if provider already scored it
      : scoreHeadlineSentiment(item.headline),
  }));
}

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
// Uses return-based volatility (already annualized from features.ts)
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

  // --- Drift components ---
  const momentumDrift = (f.return_5d || 0) * 0.3 + (f.return_20d || 0) * 0.5;
  const rsiVal = f.av_rsi_14 ?? f.rsi_14 ?? 50;
  const rsiSignal = (50 - rsiVal) / 200;
  const trendBonus = f.golden_cross ? 0.002 * days : -0.001 * days;

  // Value signals
  const pe = f.pe || 25;
  const valueTilt = pe < 15 ? 0.001 * days : pe > 40 ? -0.001 * days : 0;
  const dcfBonus = f.dcf_upside != null ? Math.max(-0.02, Math.min(0.02, f.dcf_upside * 0.05)) * days : 0;

  // Sentiment (now keyword-scored for live data)
  const sentimentDrift = (f.avg_sentiment ?? 0) * 0.01 * days;

  // ADX trend multiplier
  const adxMultiplier = f.adx != null && f.adx > 25 ? 1.2 : 1.0;

  // Analyst consensus drift
  let analystDrift = 0;
  if (f.analyst_consensus != null) {
    analystDrift = f.analyst_consensus * 0.01 * days;
  }
  if (f.target_upside != null) {
    analystDrift += Math.max(-0.02, Math.min(0.02, f.target_upside * 0.03)) * days;
  }

  // Earnings proximity — increase volatility estimate near earnings
  let earningsVolBoost = 1.0;
  if (f.earnings_imminent === 1) {
    earningsVolBoost = 1.5;
  }
  const earningsDrift = (f.last_earnings_surprise ?? 0) * 0.001 * days;

  // Insider trading signal
  let insiderDrift = 0;
  if (f.insider_mspr != null) {
    insiderDrift = (f.insider_mspr / 100) * 0.015 * days;
  }
  if (f.insider_cluster === 1) {
    insiderDrift += 0.01 * days;
  }

  // Mean reversion (contrarian)
  const mrzDrift = f.mean_reversion_z != null
    ? -f.mean_reversion_z * 0.003 * days  // Mean revert: extreme z -> opposite drift
    : 0;

  // Macro
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

  // VOLATILITY: now return-based and already annualized from features.ts
  // volatility_20d is annualized return vol, so scale to period directly
  const annualVol = f.volatility_20d || 0.25; // Default 25% annual vol if missing
  const periodVol = (annualVol / Math.sqrt(252)) * Math.sqrt(days) * earningsVolBoost;

  const pMid = currentPrice * (1 + periodReturn);
  const pLow = currentPrice * (1 + periodReturn - 1.28 * periodVol);
  const pHigh = currentPrice * (1 + periodReturn + 1.28 * periodVol);

  // CONFIDENCE: deterministic, no random noise
  const volConfidence = Math.max(0, 1 - periodVol * 3);
  const featureCount = Object.keys(f).filter((k) => !k.startsWith("_")).length;
  const dataConfidence = Math.min(featureCount / 30, 1);
  const sentimentConfidence = f.sentiment_strength != null ? f.sentiment_strength * 0.1 : 0;
  const hasFullData = f._has_60d_data === 1 ? 0.1 : 0;
  const confidence = volConfidence * 0.45 + dataConfidence * 0.3 + sentimentConfidence * 0.1 + hasFullData + 0.05;

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
// Architecture: fetch ALL historical data for the full universe, then rank.
// No more crude pass-1 shortlisting — every stock gets real features.
export async function runPrediction(
  horizon: Horizon = "1W",
  rankMode: RankMode = "expected_return",
  universe?: string[],
  strategy: Strategy = "swing"
): Promise<PredictionResponse> {
  const provider = getProvider();
  const tickers = universe && universe.length > 0 ? universe : DEFAULT_UNIVERSE;
  const to = new Date();
  const from = new Date(Date.now() - 365 * 86_400_000);

  // ── Fetch all data in parallel batches ──────────────────────────
  // 1) Batch quotes (FMP: 1 API call for all tickers)
  const quotes = await provider.getQuotes(tickers);
  const quoteMap = new Map(quotes.map((q) => [q.ticker, q]));

  // 2) Fetch fundamentals + historical prices in parallel batches
  const batchSize = 8;
  const fundamentalsMap = new Map<string, FundamentalData | null>();
  const pricesMap = new Map<string, import("@/types").PriceBar[]>();

  for (let i = 0; i < tickers.length; i += batchSize) {
    const batch = tickers.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (t) => {
        const [fund, bars] = await Promise.all([
          provider.getFundamentals(t),
          provider.getHistoricalPrices(t, from, to),
        ]);
        return { ticker: t, fund, bars };
      })
    );
    for (const { ticker, fund, bars } of results) {
      fundamentalsMap.set(ticker, fund);
      pricesMap.set(ticker, bars);
    }
  }

  // 3) Build FULL feature vectors for every ticker
  const featureVectors = new Map<string, FeatureVector>();
  for (const ticker of tickers) {
    const bars = pricesMap.get(ticker) || [];
    const fund = fundamentalsMap.get(ticker) || null;
    if (bars.length > 5) {
      featureVectors.set(ticker, buildFeatures(ticker, bars, fund));
    } else {
      // Fallback: minimal features from quote only
      const quote = quoteMap.get(ticker);
      const price = quote?.price || 0;
      const features: Record<string, number> = {
        volatility_20d: 0.25, // Default 25% annual vol
        _has_60d_data: 0,
        _has_200d_data: 0,
        _has_fundamentals: fund ? 1 : 0,
      };
      if (fund) {
        features.pe = fund.pe ?? 0;
        features.pb = fund.pb ?? 0;
        features.roe = fund.roe ?? 0;
        features.dividend_yield = fund.dividendYield ?? 0;
      }
      featureVectors.set(ticker, { ticker, date: new Date().toISOString().split("T")[0], features });
    }
  }

  // 4) Generate forecasts for ALL tickers
  const forecasts: QuantileForecast[] = [];
  for (const ticker of tickers) {
    const quote = quoteMap.get(ticker);
    if (!quote || quote.price <= 0) continue;
    const fv = featureVectors.get(ticker)!;
    forecasts.push(generateForecast(ticker, quote.name, quote.sector, quote.price, fv, horizon));
  }

  // 5) Rank full universe
  const scored: ScoredStock[] = rankStocks(forecasts, featureVectors, rankMode, strategy);

  // ── PASS 2: Enrich top 10 with news, insider, analyst, earnings ──
  const topTickers = scored.slice(0, 10).map((s) => s.ticker);

  const [enrichedNews, enrichedInsider, enrichedAnalyst, enrichedEarnings] = await Promise.all([
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

  // Rebuild features for top 10 with all signal data
  for (const ticker of topTickers) {
    const bars = pricesMap.get(ticker) || [];
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

  // Re-score enriched tickers and globally re-rank
  const enrichedForecasts: QuantileForecast[] = [];
  for (const ticker of tickers) {
    const quote = quoteMap.get(ticker);
    if (!quote || quote.price <= 0) continue;
    const fv = featureVectors.get(ticker)!;
    enrichedForecasts.push(generateForecast(ticker, quote.name, quote.sector, quote.price, fv, horizon));
  }

  // GLOBAL re-rank — not path-dependent, every stock ranked from same features
  const finalStocks = rankStocks(enrichedForecasts, featureVectors, rankMode, strategy);

  // Fetch IPOs
  const ipos: IpoEntry[] = await provider.getUpcomingIpos();

  return {
    stocks: finalStocks,
    ipos,
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
