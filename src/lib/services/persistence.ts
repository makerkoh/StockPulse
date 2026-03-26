/**
 * Persistence layer — stores forecast runs, predictions, and feature snapshots
 * in the database via Prisma.
 */
import { PrismaClient } from "@prisma/client";
import type {
  Horizon,
  RankMode,
  Strategy,
  ScoredStock,
  FeatureVector,
  IpoEntry,
  PredictionResponse,
} from "@/types";

// Singleton Prisma client
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };
const prisma = globalForPrisma.prisma || new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export { prisma };

// ─── Store a complete prediction run ─────────────────────────────────
export async function storePredictionRun(
  horizon: Horizon,
  rankMode: RankMode,
  strategy: Strategy,
  universe: string[],
  stocks: ScoredStock[],
  featureVectors: Map<string, FeatureVector>,
  isDemo: boolean,
): Promise<string> {
  try {
    const run = await prisma.forecastRun.create({
      data: {
        horizon,
        rankMode,
        strategy,
        universe,
        status: "completed",
        isDemo,
        completedAt: new Date(),
      },
    });

    // Ensure Stock records exist
    const stockUpserts = stocks.map((s) =>
      prisma.stock.upsert({
        where: { ticker: s.ticker },
        update: { name: s.name, sector: s.sector, updatedAt: new Date() },
        create: { ticker: s.ticker, name: s.name, sector: s.sector, updatedAt: new Date() },
      })
    );
    const stockRecords = await Promise.all(stockUpserts);
    const tickerToStockId = new Map(stockRecords.map((s) => [s.ticker, s.id]));

    // Store forecasts
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + ({ "1D": 1, "1W": 5, "1M": 21, "3M": 63, "6M": 126 }[horizon] || 5));

    const forecastData = stocks.map((s) => ({
      stockId: tickerToStockId.get(s.ticker)!,
      runId: run.id,
      horizon,
      targetDate,
      pLow: s.pLow,
      pMid: s.pMid,
      pHigh: s.pHigh,
      confidence: s.confidence,
      expectedReturn: s.expectedReturn,
      riskReward: s.riskReward,
      score: s.score,
      rank: s.rank,
      scoreBreakdown: s.scoreBreakdown || {},
    }));

    await prisma.forecast.createMany({ data: forecastData });

    // Store feature snapshots for top 20 (keep DB manageable)
    const snapshotData = stocks.slice(0, 20).map((s) => {
      const fv = featureVectors.get(s.ticker);
      return {
        runId: run.id,
        ticker: s.ticker,
        date: new Date(),
        features: fv?.features || {},
      };
    });

    await prisma.featureSnapshot.createMany({ data: snapshotData });

    return run.id;
  } catch (err) {
    console.error("Failed to store prediction run:", err);
    return "";
  }
}

// ─── Load latest prediction run ──────────────────────────────────────
export async function loadLatestRun(
  horizon: Horizon,
  rankMode: RankMode,
  strategy: Strategy,
): Promise<PredictionResponse | null> {
  try {
    const run = await prisma.forecastRun.findFirst({
      where: { horizon, rankMode, strategy, status: "completed" },
      orderBy: { completedAt: "desc" },
      include: {
        forecasts: {
          include: { stock: true },
          orderBy: { rank: "asc" },
        },
      },
    });

    if (!run) return null;

    const stocks: ScoredStock[] = run.forecasts.map((f) => ({
      ticker: f.stock.ticker,
      name: f.stock.name,
      sector: f.stock.sector || "Unknown",
      currentPrice: f.pMid, // Approximate — stored run doesn't have live price
      pLow: f.pLow,
      pMid: f.pMid,
      pHigh: f.pHigh,
      confidence: f.confidence,
      expectedReturn: f.expectedReturn || 0,
      riskReward: f.riskReward || 0,
      score: f.score || 0,
      rank: f.rank || 0,
      horizon: f.horizon as Horizon,
      scoreBreakdown: (f.scoreBreakdown as Record<string, number>) || {},
    }));

    return {
      stocks,
      ipos: [],
      meta: {
        horizon: run.horizon as Horizon,
        rankMode: run.rankMode as RankMode,
        strategy: run.strategy as Strategy,
        universe: run.universe,
        generatedAt: run.completedAt?.toISOString() || run.startedAt.toISOString(),
        isDemo: run.isDemo,
        runId: run.id,
      },
    };
  } catch (err) {
    console.error("Failed to load latest run:", err);
    return null;
  }
}

// ─── Get run history ─────────────────────────────────────────────────
export async function getRunHistory(limit = 10) {
  try {
    return await prisma.forecastRun.findMany({
      where: { status: "completed" },
      orderBy: { completedAt: "desc" },
      take: limit,
      select: {
        id: true,
        horizon: true,
        rankMode: true,
        strategy: true,
        startedAt: true,
        completedAt: true,
        isDemo: true,
        _count: { select: { forecasts: true } },
      },
    });
  } catch {
    return [];
  }
}
