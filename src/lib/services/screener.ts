/**
 * Dynamic Stock Screening Funnel
 *
 * 3-stage process:
 *   Stage 1: FMP stock screener (1 API call) → ~500 liquid US stocks
 *   Stage 2: Finnhub quick scan (500 calls, ~8 min) → score each stock
 *   Stage 3: Return top N for deep FMP analysis
 *
 * This replaces the hardcoded DEFAULT_UNIVERSE with dynamically
 * discovered stocks based on current market signals.
 */

import { prisma } from "@/lib/prisma";
import { FINNHUB_LIMITER } from "@/lib/providers/rate-limiter";

// ─── Stage 1: FMP Stock Screener ────────────────────────────────────
interface ScreenerResult {
  ticker: string;
  name: string;
  sector: string;
  marketCap: number;
  price: number;
  changePct: number;
  volume: number;
  beta: number;
}

/**
 * Use FMP's stock screener to get ~500 liquid US stocks WITH data.
 * The screener response includes price, change%, volume, market cap,
 * sector, and beta — enough to compute a quick score WITHOUT Finnhub.
 * Costs 1 FMP API call. Completes in <5 seconds.
 */
export async function discoverAndScoreUniverse(fmpApiKey: string): Promise<ScreenerResult[]> {
  try {
    const url = new URL("https://financialmodelingprep.com/api/v3/stock-screener");
    url.searchParams.set("apikey", fmpApiKey);
    url.searchParams.set("marketCapMoreThan", "2000000000"); // > $2B
    url.searchParams.set("volumeMoreThan", "500000");        // > 500K avg volume
    url.searchParams.set("exchange", "NYSE,NASDAQ");
    url.searchParams.set("country", "US");
    url.searchParams.set("isActivelyTrading", "true");
    url.searchParams.set("limit", "500");

    const res = await fetch(url.toString());
    if (!res.ok) {
      console.error(`[screener] FMP screener failed: ${res.status}`);
      return [];
    }

    const data = await res.json();
    if (!Array.isArray(data)) return [];

    const results: ScreenerResult[] = data
      .filter((s: any) => s.symbol && !s.symbol.includes(".") && !s.symbol.includes("-") && s.price > 0)
      .map((s: any) => ({
        ticker: s.symbol,
        name: s.companyName || s.symbol,
        sector: s.sector || "Unknown",
        marketCap: s.marketCap || 0,
        price: s.price || 0,
        changePct: s.changePercentage ?? s.changesPercentage ?? 0,
        volume: s.volume || 0,
        beta: s.beta || 1,
      }));

    console.log(`[screener] Discovered ${results.length} stocks from FMP screener`);
    return results;
  } catch (err) {
    console.error("[screener] Discovery error:", err);
    return [];
  }
}

// ─── Stage 2: Finnhub Quick Scan ────────────────────────────────────
interface QuickSignals {
  ticker: string;
  price: number;
  changePct: number;
  volume: number;
  // Insider
  mspr: number;
  // Analyst
  consensusScore: number;
  // Computed
  quickScore: number;
}

/**
 * Scan stocks via Finnhub to compute quick screening scores.
 * Uses Finnhub's per-minute rate limit (no daily cap).
 *
 * @param tickers List of tickers to scan
 * @param finnhubApiKey Finnhub API key
 * @param batchSize How many concurrent requests (respecting rate limit)
 * @returns Scored stocks sorted by quickScore descending
 */
export async function quickScan(
  tickers: string[],
  finnhubApiKey: string,
  batchSize: number = 10,
): Promise<QuickSignals[]> {
  const results: QuickSignals[] = [];
  const baseUrl = "https://finnhub.io/api/v1";

  async function finnhubFetch<T>(path: string, params: Record<string, string>): Promise<T | null> {
    await FINNHUB_LIMITER.acquire();
    const url = new URL(baseUrl + path);
    url.searchParams.set("token", finnhubApiKey);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    try {
      const res = await fetch(url.toString());
      if (!res.ok) return null;
      return res.json();
    } catch {
      return null;
    }
  }

  // Process in batches
  for (let i = 0; i < tickers.length; i += batchSize) {
    const batch = tickers.slice(i, i + batchSize);

    const batchResults = await Promise.all(
      batch.map(async (ticker) => {
        try {
          // Fetch quote + insider sentiment in parallel
          const [quote, sentiment] = await Promise.all([
            finnhubFetch<any>("/quote", { symbol: ticker }),
            finnhubFetch<any>("/stock/insider-sentiment", {
              symbol: ticker,
              from: new Date(Date.now() - 90 * 86_400_000).toISOString().split("T")[0],
              to: new Date().toISOString().split("T")[0],
            }),
          ]);

          if (!quote || quote.c === 0) return null;

          // Extract MSPR
          let mspr = 0;
          if (sentiment?.data && Array.isArray(sentiment.data) && sentiment.data.length > 0) {
            const msprValues = sentiment.data.map((d: any) => d.mspr || 0);
            mspr = msprValues.reduce((a: number, b: number) => a + b, 0) / msprValues.length;
          }

          const price = quote.c || 0;
          const changePct = quote.dp || 0;
          const volume = quote.v || 0;

          // Quick composite score:
          // - Absolute momentum (stocks moving = interesting)
          // - Volume (high volume = conviction)
          // - Insider buying (MSPR > 0 = bullish insiders)
          const momentumScore = Math.abs(changePct) * 2;
          const volumeScore = Math.min(volume / 10_000_000, 5); // Cap at 5
          const insiderScore = Math.max(-3, Math.min(5, mspr * 2));
          const quickScore = momentumScore + volumeScore + insiderScore;

          return {
            ticker,
            price,
            changePct,
            volume,
            mspr,
            consensusScore: 0, // Skip analyst to save API calls
            quickScore,
          } as QuickSignals;
        } catch {
          return null;
        }
      }),
    );

    for (const r of batchResults) {
      if (r) results.push(r);
    }

    if (i % 50 === 0 && i > 0) {
      console.log(`[screener] Stage 2: scanned ${i}/${tickers.length} stocks`);
    }
  }

  // Sort by quickScore descending
  results.sort((a, b) => b.quickScore - a.quickScore);
  console.log(`[screener] Stage 2: completed scan of ${results.length} stocks`);
  return results;
}

// ─── Stage 3: Store and Return Top N ────────────────────────────────

/**
 * Run the screening pipeline and store results in the DB.
 *
 * Fast mode (default): Uses FMP screener data only (1 API call, <10 seconds)
 * Full mode: Also scans via Finnhub for insider signals (~8 minutes, needs background task)
 *
 * @returns Top N tickers for deep analysis
 */
export async function runScreeningPipeline(
  fmpApiKey: string,
  finnhubApiKey: string,
  topN: number = 50,
  fullScan: boolean = false,
): Promise<string[]> {
  console.log("[screener] Starting screening pipeline...");

  // Stage 1+2: Discover and score from FMP (1 API call, ~3 seconds)
  const universe = await discoverAndScoreUniverse(fmpApiKey);
  if (universe.length === 0) {
    console.error("[screener] No stocks discovered — using fallback");
    return [];
  }

  // Compute quick scores from FMP screener data
  type ScoredResult = ScreenerResult & { quickScore: number };
  const scored: ScoredResult[] = universe.map((s) => {
    // Score components:
    // - Absolute price change (stocks moving = interesting)
    const momentumScore = Math.min(Math.abs(s.changePct), 10) * 0.5;
    // - Volume relative to market cap (high turnover = conviction)
    const turnover = s.marketCap > 0 ? (s.volume * s.price) / s.marketCap : 0;
    const volumeScore = Math.min(turnover * 500, 5);
    // - Beta (higher beta = more responsive to market, more tradeable)
    const betaScore = Math.min(Math.abs(s.beta - 1) * 2, 3);
    // - Market cap tier bonus (mid-cap often has more alpha than mega-cap)
    const capScore = s.marketCap < 50e9 ? 1.5 : s.marketCap < 200e9 ? 1.0 : 0.5;

    return {
      ...s,
      quickScore: momentumScore + volumeScore + betaScore + capScore,
    };
  });

  // Sort by quick score descending
  scored.sort((a, b) => b.quickScore - a.quickScore);

  // Optional: Finnhub deep scan on top candidates (only if fullScan enabled)
  if (fullScan && finnhubApiKey) {
    const topForScan = scored.slice(0, Math.min(100, scored.length)).map((s) => s.ticker);
    const finnhubScored = await quickScan(topForScan, finnhubApiKey);

    // Merge Finnhub scores back
    const finnhubMap = new Map(finnhubScored.map((s) => [s.ticker, s]));
    for (const stock of scored) {
      const fh = finnhubMap.get(stock.ticker);
      if (fh) {
        stock.quickScore += fh.mspr * 2; // Insider buying boost
      }
    }
    scored.sort((a, b) => b.quickScore - a.quickScore);
  }

  // Stage 3: Store in DB and return top N
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  // Clear old screening results (older than 7 days)
  await prisma.screenedStock.deleteMany({
    where: { screenedAt: { lt: new Date(Date.now() - 7 * 86_400_000) } },
  }).catch(() => {});

  // Store today's results
  const topStocks = scored.slice(0, Math.min(topN, scored.length));
  for (const stock of topStocks) {
    await prisma.screenedStock.upsert({
      where: { ticker_screenedAt: { ticker: stock.ticker, screenedAt: now } },
      update: {
        name: stock.name,
        sector: stock.sector,
        marketCap: stock.marketCap,
        price: stock.price,
        changePct: stock.changePct,
        volume: stock.volume,
        quickScore: stock.quickScore,
        signals: { changePct: stock.changePct, beta: stock.beta },
      },
      create: {
        ticker: stock.ticker,
        name: stock.name,
        sector: stock.sector,
        marketCap: stock.marketCap,
        price: stock.price,
        changePct: stock.changePct,
        volume: stock.volume,
        quickScore: stock.quickScore,
        screenedAt: now,
        signals: { changePct: stock.changePct, beta: stock.beta },
      },
    }).catch(() => {});
  }

  const topTickers = topStocks.map((s) => s.ticker);
  console.log(`[screener] Pipeline complete: ${topTickers.length} stocks from ${universe.length} candidates`);
  console.log(`[screener] Top 10: ${topTickers.slice(0, 10).join(", ")}`);

  return topTickers;
}

/**
 * Get the most recent screened universe from the DB.
 * Returns null if no screening has been run recently (within 2 days).
 */
export async function getScreenedUniverse(topN: number = 50): Promise<string[] | null> {
  try {
    const cutoff = new Date(Date.now() - 2 * 86_400_000); // Within last 2 days
    const stocks = await prisma.screenedStock.findMany({
      where: { screenedAt: { gte: cutoff } },
      orderBy: { quickScore: "desc" },
      take: topN,
    });

    if (stocks.length === 0) return null;
    return stocks.map((s) => s.ticker);
  } catch {
    return null;
  }
}
