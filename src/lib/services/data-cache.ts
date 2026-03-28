/**
 * Database-backed data cache — stores prices, fundamentals, and news in
 * PostgreSQL so the pipeline only fetches what's new or stale from APIs.
 *
 * Staleness rules:
 *   Prices        → fetch from day after last stored date to today
 *   Fundamentals  → refetch if older than 24 hours
 *   News          → refetch if older than 30 minutes
 */
import { prisma } from "@/lib/prisma";
import type { PriceBar, FundamentalData, NewsItem, InsiderData, AnalystData, EarningsData } from "@/types";

// ─── Staleness thresholds ────────────────────────────────────────────
const FUNDAMENTALS_TTL_MS = 24 * 60 * 60_000; // 24 hours
const NEWS_TTL_MS = 30 * 60_000;               // 30 minutes
const INSIDER_TTL_MS = 12 * 60 * 60_000;       // 12 hours
const ANALYST_TTL_MS = 24 * 60 * 60_000;       // 24 hours
const EARNINGS_TTL_MS = 24 * 60 * 60_000;      // 24 hours

// ─── Helpers ─────────────────────────────────────────────────────────
function toDateOnly(d: Date): string {
  return d.toISOString().split("T")[0];
}

async function ensureStock(ticker: string): Promise<string> {
  const stock = await prisma.stock.upsert({
    where: { ticker },
    update: {},
    create: { ticker, name: ticker, updatedAt: new Date() },
  });
  return stock.id;
}

// ─── Prices ──────────────────────────────────────────────────────────

/** Returns cached price bars and the date from which new data is needed. */
export async function getCachedPrices(
  ticker: string,
  from: Date,
  to: Date,
): Promise<{ cached: PriceBar[]; fetchFrom: Date | null }> {
  try {
    const stock = await prisma.stock.findUnique({ where: { ticker } });
    if (!stock) return { cached: [], fetchFrom: from };

    const rows = await prisma.price.findMany({
      where: {
        stockId: stock.id,
        date: { gte: from, lte: to },
      },
      orderBy: { date: "asc" },
    });

    if (rows.length === 0) return { cached: [], fetchFrom: from };

    const cached: PriceBar[] = rows.map((r) => ({
      date: toDateOnly(r.date),
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      volume: r.volume,
    }));

    // Determine if we need more recent data
    const lastDate = rows[rows.length - 1].date;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // If last stored date is before yesterday, we need to fetch the gap
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (lastDate < yesterday) {
      const fetchFrom = new Date(lastDate);
      fetchFrom.setDate(fetchFrom.getDate() + 1);
      return { cached, fetchFrom };
    }

    // Data is current enough
    return { cached, fetchFrom: null };
  } catch (err) {
    console.error(`[data-cache] getCachedPrices error for ${ticker}:`, err);
    return { cached: [], fetchFrom: from };
  }
}

/** Store new price bars (skips duplicates via upsert). */
export async function storePrices(ticker: string, bars: PriceBar[]): Promise<void> {
  if (bars.length === 0) return;
  try {
    const stockId = await ensureStock(ticker);

    // Batch upsert in chunks to avoid overwhelming the DB
    const CHUNK = 50;
    for (let i = 0; i < bars.length; i += CHUNK) {
      const chunk = bars.slice(i, i + CHUNK);
      await Promise.all(
        chunk.map((bar) => {
          const date = new Date(bar.date + "T00:00:00Z");
          return prisma.price.upsert({
            where: { stockId_date: { stockId, date } },
            update: {
              open: bar.open,
              high: bar.high,
              low: bar.low,
              close: bar.close,
              volume: bar.volume,
            },
            create: {
              stockId,
              date,
              open: bar.open,
              high: bar.high,
              low: bar.low,
              close: bar.close,
              volume: bar.volume,
            },
          });
        }),
      );
    }
  } catch (err) {
    console.error(`[data-cache] storePrices error for ${ticker}:`, err);
  }
}

// ─── Fundamentals ────────────────────────────────────────────────────

/** Returns cached fundamentals if still fresh, or null if stale/missing. */
export async function getCachedFundamentals(
  ticker: string,
): Promise<FundamentalData | null> {
  try {
    const stock = await prisma.stock.findUnique({ where: { ticker } });
    if (!stock) return null;

    const latest = await prisma.fundamental.findFirst({
      where: { stockId: stock.id },
      orderBy: { date: "desc" },
    });

    if (!latest) return null;

    // Check freshness
    const age = Date.now() - latest.date.getTime();
    if (age > FUNDAMENTALS_TTL_MS) return null;

    return {
      pe: latest.pe,
      forwardPe: latest.forwardPe,
      pb: latest.pb,
      ps: latest.ps,
      evEbitda: latest.evEbitda,
      debtEquity: latest.debtEquity,
      roe: latest.roe,
      revenueGrowth: latest.revenueGrowth,
      earningsGrowth: latest.earningsGrowth,
      dividendYield: latest.dividendYield,
      beta: latest.beta,
    };
  } catch (err) {
    console.error(`[data-cache] getCachedFundamentals error for ${ticker}:`, err);
    return null;
  }
}

/** Store fundamentals snapshot. */
export async function storeFundamentals(
  ticker: string,
  data: FundamentalData,
): Promise<void> {
  try {
    const stockId = await ensureStock(ticker);
    const date = new Date();
    date.setHours(0, 0, 0, 0); // normalize to day

    await prisma.fundamental.upsert({
      where: { stockId_date: { stockId, date } },
      update: {
        pe: data.pe,
        forwardPe: data.forwardPe,
        pb: data.pb,
        ps: data.ps,
        evEbitda: data.evEbitda,
        debtEquity: data.debtEquity,
        roe: data.roe,
        revenueGrowth: data.revenueGrowth,
        earningsGrowth: data.earningsGrowth,
        dividendYield: data.dividendYield,
        beta: data.beta,
      },
      create: {
        stockId,
        date,
        pe: data.pe,
        forwardPe: data.forwardPe,
        pb: data.pb,
        ps: data.ps,
        evEbitda: data.evEbitda,
        debtEquity: data.debtEquity,
        roe: data.roe,
        revenueGrowth: data.revenueGrowth,
        earningsGrowth: data.earningsGrowth,
        dividendYield: data.dividendYield,
        beta: data.beta,
      },
    });
  } catch (err) {
    console.error(`[data-cache] storeFundamentals error for ${ticker}:`, err);
  }
}

// ─── News ────────────────────────────────────────────────────────────

/** Returns cached news if still fresh, or null if stale/missing. */
export async function getCachedNews(
  ticker: string,
  limit: number,
): Promise<NewsItem[] | null> {
  try {
    const stock = await prisma.stock.findUnique({ where: { ticker } });
    if (!stock) return null;

    // Check when we last stored news for this stock
    const latest = await prisma.news.findFirst({
      where: { stockId: stock.id },
      orderBy: { createdAt: "desc" },
    });

    if (!latest) return null;

    // If last fetch is older than TTL, return null to trigger re-fetch
    const age = Date.now() - latest.createdAt.getTime();
    if (age > NEWS_TTL_MS) return null;

    const rows = await prisma.news.findMany({
      where: { stockId: stock.id },
      orderBy: { publishedAt: "desc" },
      take: limit,
    });

    return rows.map((r) => ({
      id: r.id,
      headline: r.headline,
      summary: r.summary || "",
      source: r.source || "",
      url: r.url || "",
      sentiment: r.sentiment || 0,
      publishedAt: r.publishedAt.toISOString(),
    }));
  } catch (err) {
    console.error(`[data-cache] getCachedNews error for ${ticker}:`, err);
    return null;
  }
}

/** Store news items for a ticker. */
export async function storeNews(ticker: string, items: NewsItem[]): Promise<void> {
  if (items.length === 0) return;
  try {
    const stockId = await ensureStock(ticker);

    // Delete old news for this stock (keep DB clean)
    await prisma.news.deleteMany({
      where: {
        stockId,
        publishedAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60_000) }, // older than 7 days
      },
    });

    // Insert new articles (skip if headline already exists)
    for (const item of items) {
      const publishedAt = new Date(item.publishedAt);
      // Use headline + publishedAt as a natural dedup key
      const existing = await prisma.news.findFirst({
        where: { stockId, headline: item.headline },
      });
      if (!existing) {
        await prisma.news.create({
          data: {
            stockId,
            headline: item.headline,
            summary: item.summary || null,
            source: item.source || null,
            url: item.url || null,
            sentiment: item.sentiment,
            publishedAt,
          },
        });
      }
    }
  } catch (err) {
    console.error(`[data-cache] storeNews error for ${ticker}:`, err);
  }
}

// ─── Insider Trading ──────────────────────────────────────────────────

/** Returns cached insider data if still fresh, or null if stale/missing. */
export async function getCachedInsider(ticker: string): Promise<InsiderData | null> {
  try {
    const stock = await prisma.stock.findUnique({ where: { ticker } });
    if (!stock) return null;

    const latest = await prisma.insiderTrade.findFirst({
      where: { stockId: stock.id },
      orderBy: { date: "desc" },
    });

    if (!latest) return null;
    if (Date.now() - latest.fetchedAt.getTime() > INSIDER_TTL_MS) return null;

    const totalTxns = latest.totalBuys + latest.totalSells;
    return {
      mspr: latest.mspr ?? 0,
      totalBuys: latest.totalBuys,
      totalSells: latest.totalSells,
      netBuyValue: latest.netBuyValue,
      clusterBuying: latest.clusterBuying,
    };
  } catch (err) {
    console.error(`[data-cache] getCachedInsider error for ${ticker}:`, err);
    return null;
  }
}

/** Store insider trading snapshot. */
export async function storeInsider(ticker: string, data: InsiderData): Promise<void> {
  try {
    const stockId = await ensureStock(ticker);
    const date = new Date();
    date.setHours(0, 0, 0, 0);

    await prisma.insiderTrade.upsert({
      where: { stockId_date: { stockId, date } },
      update: {
        mspr: data.mspr,
        totalBuys: data.totalBuys,
        totalSells: data.totalSells,
        netBuyValue: data.netBuyValue,
        clusterBuying: data.clusterBuying,
        fetchedAt: new Date(),
      },
      create: {
        stockId, date,
        mspr: data.mspr,
        totalBuys: data.totalBuys,
        totalSells: data.totalSells,
        netBuyValue: data.netBuyValue,
        clusterBuying: data.clusterBuying,
      },
    });
  } catch (err) {
    console.error(`[data-cache] storeInsider error for ${ticker}:`, err);
  }
}

// ─── Analyst Ratings ──────────────────────────────────────────────────

/** Returns cached analyst data if still fresh, or null if stale/missing. */
export async function getCachedAnalyst(ticker: string): Promise<AnalystData | null> {
  try {
    const stock = await prisma.stock.findUnique({ where: { ticker } });
    if (!stock) return null;

    const latest = await prisma.analystRating.findFirst({
      where: { stockId: stock.id },
      orderBy: { date: "desc" },
    });

    if (!latest) return null;
    if (Date.now() - latest.fetchedAt.getTime() > ANALYST_TTL_MS) return null;

    return {
      targetPrice: latest.targetPrice,
      strongBuy: latest.strongBuy,
      buy: latest.buy,
      hold: latest.hold,
      sell: latest.sell,
      strongSell: latest.strongSell,
      consensusScore: latest.consensusScore ?? 0,
    };
  } catch (err) {
    console.error(`[data-cache] getCachedAnalyst error for ${ticker}:`, err);
    return null;
  }
}

/** Store analyst rating snapshot. */
export async function storeAnalyst(ticker: string, data: AnalystData): Promise<void> {
  try {
    const stockId = await ensureStock(ticker);
    const date = new Date();
    date.setHours(0, 0, 0, 0);

    await prisma.analystRating.upsert({
      where: { stockId_date: { stockId, date } },
      update: {
        targetPrice: data.targetPrice,
        strongBuy: data.strongBuy,
        buy: data.buy,
        hold: data.hold,
        sell: data.sell,
        strongSell: data.strongSell,
        consensusScore: data.consensusScore,
        fetchedAt: new Date(),
      },
      create: {
        stockId, date,
        targetPrice: data.targetPrice,
        strongBuy: data.strongBuy,
        buy: data.buy,
        hold: data.hold,
        sell: data.sell,
        strongSell: data.strongSell,
        consensusScore: data.consensusScore,
      },
    });
  } catch (err) {
    console.error(`[data-cache] storeAnalyst error for ${ticker}:`, err);
  }
}

// ─── Earnings ──────────────────────────────────────────────────────────

/** Returns cached earnings data if still fresh, or null if stale/missing. */
export async function getCachedEarnings(ticker: string): Promise<EarningsData | null> {
  try {
    const stock = await prisma.stock.findUnique({ where: { ticker } });
    if (!stock) return null;

    const latest = await prisma.earningsInfo.findFirst({
      where: { stockId: stock.id },
      orderBy: { date: "desc" },
    });

    if (!latest) return null;
    if (Date.now() - latest.fetchedAt.getTime() > EARNINGS_TTL_MS) return null;

    return {
      daysUntilEarnings: latest.daysUntilEarnings,
      lastSurprisePct: latest.lastSurprisePct,
      lastBeatOrMiss: (latest.lastBeatOrMiss as "beat" | "miss" | "met" | null) ?? null,
    };
  } catch (err) {
    console.error(`[data-cache] getCachedEarnings error for ${ticker}:`, err);
    return null;
  }
}

/** Store earnings data snapshot. */
export async function storeEarnings(ticker: string, data: EarningsData): Promise<void> {
  try {
    const stockId = await ensureStock(ticker);
    const date = new Date();
    date.setHours(0, 0, 0, 0);

    await prisma.earningsInfo.upsert({
      where: { stockId_date: { stockId, date } },
      update: {
        daysUntilEarnings: data.daysUntilEarnings,
        lastSurprisePct: data.lastSurprisePct,
        lastBeatOrMiss: data.lastBeatOrMiss,
        fetchedAt: new Date(),
      },
      create: {
        stockId, date,
        daysUntilEarnings: data.daysUntilEarnings,
        lastSurprisePct: data.lastSurprisePct,
        lastBeatOrMiss: data.lastBeatOrMiss,
      },
    });
  } catch (err) {
    console.error(`[data-cache] storeEarnings error for ${ticker}:`, err);
  }
}

// ─── Cache Stats (for debugging / UI) ────────────────────────────────
export async function getCacheStats(): Promise<{
  totalPriceBars: number;
  totalFundamentals: number;
  totalNews: number;
  stocksCovered: number;
}> {
  try {
    const [totalPriceBars, totalFundamentals, totalNews, stocksCovered] = await Promise.all([
      prisma.price.count(),
      prisma.fundamental.count(),
      prisma.news.count(),
      prisma.stock.count({ where: { isActive: true } }),
    ]);
    return { totalPriceBars, totalFundamentals, totalNews, stocksCovered };
  } catch {
    return { totalPriceBars: 0, totalFundamentals: 0, totalNews: 0, stocksCovered: 0 };
  }
}
