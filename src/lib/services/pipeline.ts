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
  PriceBar,
} from "@/types";
import { getProvider, isDemo } from "@/lib/providers/registry";
import { DEFAULT_UNIVERSE } from "@/lib/providers/interfaces";
import { buildFeatures } from "./features";
import { rankStocks } from "./scoring";
import { generateForecast, crossSectionalZScore, injectMarketSignals } from "./forecast";
import { getScreenedUniverse } from "./screener";
import {
  getCachedPrices,
  storePrices,
  getCachedFundamentals,
  storeFundamentals,
  getCachedNews,
  storeNews,
  getCachedInsider,
  storeInsider,
  getCachedAnalyst,
  storeAnalyst,
  getCachedEarnings,
  storeEarnings,
} from "./data-cache";

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
function buildQuickFeatures(
  ticker: string,
  price: number,
  change: number,
  fundamentals: FundamentalData | null,
): FeatureVector {
  const features: Record<string, number> = {};

  features.return_1d = price > 0 ? change / price : 0;
  features.return_5d = 0;
  features.return_20d = 0;
  features.return_60d = 0;
  features.rsi_14 = 50;
  features.golden_cross = 0;

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

// ─── Cache-aware data fetchers ───────────────────────────────────────

/** Fetch historical prices using DB cache — only calls API for missing days. */
async function fetchPricesWithCache(
  provider: ReturnType<typeof getProvider>,
  ticker: string,
  from: Date,
  to: Date,
): Promise<PriceBar[]> {
  // Check DB cache first
  const { cached, fetchFrom } = await getCachedPrices(ticker, from, to);

  if (!fetchFrom) {
    // All data is in the DB — zero API calls
    return cached;
  }

  // Only fetch the gap from the API
  const fresh = await provider.getHistoricalPrices(ticker, fetchFrom, to);

  // Store fresh data in DB (non-blocking)
  storePrices(ticker, fresh).catch(() => {});

  // Merge cached + fresh, deduplicate by date
  const dateSet = new Set(cached.map((b) => b.date));
  const merged = [...cached];
  for (const bar of fresh) {
    if (!dateSet.has(bar.date)) {
      merged.push(bar);
      dateSet.add(bar.date);
    }
  }
  merged.sort((a, b) => a.date.localeCompare(b.date));
  return merged;
}

/** Fetch fundamentals using DB cache — only calls API if stale (>24h). */
async function fetchFundamentalsWithCache(
  provider: ReturnType<typeof getProvider>,
  ticker: string,
): Promise<FundamentalData | null> {
  // Check DB cache first
  const cached = await getCachedFundamentals(ticker);
  if (cached) return cached; // Still fresh — zero API calls

  // Cache miss or stale — fetch from API
  const fresh = await provider.getFundamentals(ticker);

  // Store in DB (non-blocking)
  if (fresh) storeFundamentals(ticker, fresh).catch(() => {});

  return fresh;
}

/** Fetch news using DB cache — only calls API if stale (>30min). */
async function fetchNewsWithCache(
  provider: ReturnType<typeof getProvider>,
  ticker: string,
  limit: number,
): Promise<NewsItem[]> {
  // Check DB cache first
  const cached = await getCachedNews(ticker, limit);
  if (cached) return cached; // Still fresh — zero API calls

  // Cache miss or stale — fetch from API
  const fresh = applyNewsSentiment(await provider.getNews(ticker, limit));

  // Store in DB (non-blocking)
  storeNews(ticker, fresh).catch(() => {});

  return fresh;
}

// ─── Run Full Prediction Pipeline ────────────────────────────────────
// Now uses DB-backed caching to minimize API calls.
//
// First run: ~91 calls (same as before, but data gets stored)
// Subsequent runs (same day): ~1 batch quote call + only stale data
//   - Fundamentals cached 24h → 0 calls
//   - Historical prices → only fetch today's new bar
//   - News cached 30min → 0 calls if recent
//
// Typical repeat run: ~2-5 API calls instead of ~91
export async function runPrediction(
  horizon: Horizon = "1W",
  rankMode: RankMode = "expected_return",
  universe?: string[],
  strategy: Strategy = "swing"
): Promise<PredictionResponse> {
  const provider = getProvider();

  // Use dynamic screened universe if available, otherwise fall back to static list
  let tickers: string[];
  if (universe && universe.length > 0) {
    tickers = universe;
  } else {
    const screened = await getScreenedUniverse(50);
    tickers = screened && screened.length > 10 ? screened : DEFAULT_UNIVERSE;
  }

  // ── PASS 1: Batch quotes + fundamentals ────────────────────────
  // Quotes are always live (1 API call via FMP batch endpoint)
  const quotes = await provider.getQuotes(tickers);
  const quoteMap = new Map(quotes.map((q) => [q.ticker, q]));

  // Fetch fundamentals with DB cache (only calls API if stale >24h)
  const batchSize = 10;
  const fundamentalsMap = new Map<string, FundamentalData | null>();
  for (let i = 0; i < tickers.length; i += batchSize) {
    const batch = tickers.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (t) => {
        const fund = await fetchFundamentalsWithCache(provider, t);
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

  // Market-level signals + cross-sectional z-score normalization (Pass 1)
  injectMarketSignals(featureVectors);
  crossSectionalZScore(featureVectors);

  // Generate initial forecasts and rank
  const forecasts: QuantileForecast[] = quotes
    .filter((q) => q.price > 0)
    .map((q) => {
      const fv = featureVectors.get(q.ticker)!;
      return generateForecast(q.ticker, q.name, q.sector, q.price, fv, horizon);
    });

  const scored = rankStocks(forecasts, featureVectors, rankMode, strategy);

  // ── PASS 2: Enrich top 10 with full data (cache-aware) ────────
  const topTickers = scored.slice(0, 10).map((s) => s.ticker);
  const to = new Date();
  const from = new Date(Date.now() - 365 * 86_400_000);

  const [enrichedPrices, enrichedNews, enrichedInsider, enrichedAnalyst, enrichedEarnings] = await Promise.all([
    // Historical prices — uses DB cache, only fetches missing days
    Promise.all(
      topTickers.map(async (t) => {
        const bars = await fetchPricesWithCache(provider, t, from, to);
        return [t, bars] as const;
      })
    ).then((entries) => new Map(entries)),
    // News — uses DB cache, only fetches if stale (>30 min)
    Promise.all(
      topTickers.map(async (t) => {
        const news = await fetchNewsWithCache(provider, t, 10);
        return [t, news] as const;
      })
    ).then((entries) => new Map(entries)),
    // Insider data — DB cached (12h TTL), only fetches if stale
    Promise.all(
      topTickers.map(async (t) => {
        const cached = await getCachedInsider(t);
        if (cached) return [t, cached] as const;
        const fresh = await provider.getInsiderData(t);
        if (fresh) storeInsider(t, fresh).catch(() => {});
        return [t, fresh] as const;
      })
    ).then((entries) => new Map(entries)),
    // Analyst data — DB cached (24h TTL), only fetches if stale
    Promise.all(
      topTickers.map(async (t) => {
        const cached = await getCachedAnalyst(t);
        if (cached) return [t, cached] as const;
        const fresh = await provider.getAnalystData(t);
        if (fresh) storeAnalyst(t, fresh).catch(() => {});
        return [t, fresh] as const;
      })
    ).then((entries) => new Map(entries)),
    // Earnings data — DB cached (24h TTL), only fetches if stale
    Promise.all(
      topTickers.map(async (t) => {
        const cached = await getCachedEarnings(t);
        if (cached) return [t, cached] as const;
        const fresh = await provider.getEarningsData(t);
        if (fresh) storeEarnings(t, fresh).catch(() => {});
        return [t, fresh] as const;
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

  // Market-level signals + cross-sectional z-score normalization (Pass 2)
  injectMarketSignals(featureVectors);
  crossSectionalZScore(featureVectors);

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
