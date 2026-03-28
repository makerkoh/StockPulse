import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { getProvider, isDemo } from "@/lib/providers/registry";
import { EXTENDED_UNIVERSE } from "@/lib/providers/interfaces";
import { discoverAndScoreUniverse } from "@/lib/services/screener";
import {
  getCachedPrices,
  storePrices,
  storeFundamentals,
  storeInsider,
  storeAnalyst,
  storeEarnings,
} from "@/lib/services/data-cache";
import { prisma } from "@/lib/prisma";
import type { NewsItem } from "@/types";

export const maxDuration = 60;

/**
 * POST — Bulk fetch and cache data for the entire universe.
 *
 * Body: {
 *   action: "prices" | "fundamentals" | "enrichment" | "all" | "status",
 *   yearsBack?: number,           // For prices (default 7)
 *   batchSize?: number,           // Tickers per chunk (default 5)
 *   startFromIndex?: number,      // Resume from this ticker index
 * }
 *
 * Designed for chunked calls:
 *   - Each call processes batchSize tickers
 *   - Returns { processed, total, nextIndex } for the caller to continue
 *   - Respects API rate limits (Finnhub: 60/min, FMP: 250/day)
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (isDemo()) {
    return NextResponse.json({ error: "Cannot bulk cache in demo mode — configure API keys first" }, { status: 400 });
  }

  try {
    const body = await req.json();
    const action: string = body.action || "all";
    const yearsBack = body.yearsBack ?? 7;
    const batchSize = body.batchSize ?? 5;
    const startIdx = body.startFromIndex ?? 0;
    const provider = getProvider();

    // "discover" action: run FMP screener to find ~500 stocks, store tickers in DB
    if (action === "discover") {
      const fmpKey = process.env.FMP_API_KEY;
      if (!fmpKey) return NextResponse.json({ error: "FMP_API_KEY env var required for discovery" }, { status: 400 });
      const discovered = await discoverAndScoreUniverse(fmpKey);
      const tickers = discovered.map((s) => s.ticker);
      // Store in ScreenedStock table for persistence
      const now = new Date(); now.setHours(0, 0, 0, 0);
      let stored = 0;
      for (const s of discovered) {
        try {
          await prisma.screenedStock.upsert({
            where: { ticker_screenedAt: { ticker: s.ticker, screenedAt: now } },
            update: { name: s.name, sector: s.sector, marketCap: s.marketCap, price: s.price, volume: s.volume, quickScore: 0 },
            create: { ticker: s.ticker, name: s.name, sector: s.sector, marketCap: s.marketCap, price: s.price, volume: s.volume, quickScore: 0, screenedAt: now },
          });
          stored++;
        } catch {}
      }
      return NextResponse.json({
        data: { action: "discover", discovered: tickers.length, stored, tickers },
      });
    }

    // Allow custom universe from body, or fall back to EXTENDED_UNIVERSE
    // Use "screened" to auto-load the most recently discovered stocks
    let universe: string[] = EXTENDED_UNIVERSE;
    if (body.universe === "screened") {
      const recent = await prisma.screenedStock.findMany({
        where: { screenedAt: { gte: new Date(Date.now() - 7 * 86_400_000) } },
        orderBy: { quickScore: "desc" },
        select: { ticker: true },
      });
      if (recent.length > 0) universe = recent.map((s) => s.ticker);
    } else if (Array.isArray(body.universe) && body.universe.length > 0) {
      universe = body.universe;
    }

    // For "all" mode, reduce batch size since we're doing 6+ API calls per stock
    const effectiveBatchSize = action === "all" ? Math.min(batchSize, 3) : batchSize;
    const batch = universe.slice(startIdx, startIdx + effectiveBatchSize);
    if (batch.length === 0) {
      return NextResponse.json({
        data: { processed: 0, total: universe.length, nextIndex: null, done: true, action },
      });
    }

    const results: { ticker: string; action: string; success: boolean; error?: string }[] = [];

    // ── PRICES: Fetch full history (7+ years) ─────────────────────
    // getCachedPrices only checks if the *newest* bar is current, but we need
    // to also backfill older history. So: check if oldest cached bar is near
    // the requested `from` date. If not, fetch the gap.
    if (action === "prices" || action === "all") {
      const to = new Date();
      const from = new Date(Date.now() - yearsBack * 365.25 * 86_400_000);

      for (const ticker of batch) {
        try {
          const { cached } = await getCachedPrices(ticker, from, to);

          // Check if we have data going back far enough
          const oldestCached = cached.length > 0 ? new Date(cached[0].date) : null;
          const needsBackfill = !oldestCached || oldestCached.getTime() > from.getTime() + 30 * 86_400_000;

          if (!needsBackfill) {
            results.push({ ticker, action: "prices", success: true, error: `already cached (${cached.length} bars from ${cached[0].date})` });
            continue;
          }

          // Fetch from requested start to the oldest cached date (or to today if no cache)
          const fetchTo = oldestCached || to;
          const bars = await provider.getHistoricalPrices(ticker, from, fetchTo);
          if (bars.length > 0) {
            await storePrices(ticker, bars);
            results.push({ ticker, action: "prices", success: true, error: `backfilled ${bars.length} bars from ${from.toISOString().split("T")[0]}` });
          } else {
            results.push({ ticker, action: "prices", success: true, error: "no historical bars available from API" });
          }
        } catch (err) {
          results.push({ ticker, action: "prices", success: false, error: String(err) });
        }
      }
    }

    // ── FUNDAMENTALS: Fetch current snapshot ──────────────────────
    if (action === "fundamentals" || action === "all") {
      for (const ticker of batch) {
        try {
          const fund = await provider.getFundamentals(ticker);
          if (fund) {
            await storeFundamentals(ticker, fund);
            results.push({ ticker, action: "fundamentals", success: true });
          } else {
            results.push({ ticker, action: "fundamentals", success: false, error: "no data returned" });
          }
        } catch (err) {
          results.push({ ticker, action: "fundamentals", success: false, error: String(err) });
        }
      }
    }

    // ── ENRICHMENT: Insider + Analyst + Earnings + News ──────────
    if (action === "enrichment" || action === "all") {
      for (const ticker of batch) {
        // Insider data
        try {
          const data = await provider.getInsiderData(ticker);
          if (data) {
            await storeInsider(ticker, data);
            results.push({ ticker, action: "insider", success: true });
          }
        } catch (err) {
          results.push({ ticker, action: "insider", success: false, error: String(err) });
        }

        // Analyst data
        try {
          const data = await provider.getAnalystData(ticker);
          if (data) {
            await storeAnalyst(ticker, data);
            results.push({ ticker, action: "analyst", success: true });
          }
        } catch (err) {
          results.push({ ticker, action: "analyst", success: false, error: String(err) });
        }

        // Earnings data
        try {
          const data = await provider.getEarningsData(ticker);
          if (data) {
            await storeEarnings(ticker, data);
            results.push({ ticker, action: "earnings", success: true });
          }
        } catch (err) {
          results.push({ ticker, action: "earnings", success: false, error: String(err) });
        }

        // News (stores with sentiment for historical lookback)
        try {
          const articles = await provider.getNews(ticker, 10);
          if (articles.length > 0) {
            await storeNews(ticker, articles);
            results.push({ ticker, action: "news", success: true, error: `${articles.length} articles` });
          }
        } catch (err) {
          results.push({ ticker, action: "news", success: false, error: String(err) });
        }
      }
    }

    const nextIndex = startIdx + effectiveBatchSize;
    const done = nextIndex >= universe.length;

    return NextResponse.json({
      data: {
        action,
        processed: batch.length,
        total: universe.length,
        startIndex: startIdx,
        nextIndex: done ? null : nextIndex,
        done,
        results,
      },
    });
  } catch (err) {
    console.error("[bulk-cache] POST error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}

/**
 * GET — Cache stats
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [priceCount, fundamentalCount, insiderCount, analystCount, earningsCount, newsCount, stockCount] =
      await Promise.all([
        prisma.price.count(),
        prisma.fundamental.count(),
        prisma.insiderTrade.count(),
        prisma.analystRating.count(),
        prisma.earningsInfo.count(),
        prisma.news.count(),
        prisma.stock.count(),
      ]);

    // Get date range of cached prices
    const oldest = await prisma.price.findFirst({ orderBy: { date: "asc" }, select: { date: true } });
    const newest = await prisma.price.findFirst({ orderBy: { date: "desc" }, select: { date: true } });

    return NextResponse.json({
      data: {
        stocks: stockCount,
        priceBars: priceCount,
        priceRange: oldest && newest
          ? { from: oldest.date.toISOString().split("T")[0], to: newest.date.toISOString().split("T")[0] }
          : null,
        fundamentals: fundamentalCount,
        insiderTrades: insiderCount,
        analystRatings: analystCount,
        earnings: earningsCount,
        news: newsCount,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}

// ─── Helper: store news articles ──────────────────────────────────────
async function storeNews(ticker: string, articles: NewsItem[]): Promise<void> {
  const stock = await prisma.stock.findUnique({ where: { ticker } });
  if (!stock) return;

  for (const article of articles) {
    try {
      await prisma.news.upsert({
        where: { id: article.id || `${stock.id}_${article.publishedAt}` },
        update: {},
        create: {
          stockId: stock.id,
          headline: article.headline,
          summary: article.summary || null,
          source: article.source || null,
          url: article.url || null,
          sentiment: article.sentiment,
          publishedAt: new Date(article.publishedAt),
        },
      });
    } catch {
      // Skip duplicates / errors silently
    }
  }
}
