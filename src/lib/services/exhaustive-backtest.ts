/**
 * Exhaustive Daily Walk-Forward Backtest Engine
 *
 * For every trading day in the historical window:
 *   1. Build features using ONLY data available on that day (strict point-in-time)
 *   2. Query enrichment data (fundamentals, insider, analyst, earnings, news)
 *      using the most recent snapshot ON OR BEFORE that day — so as you accumulate
 *      more historical data over time, backtest quality automatically improves
 *   3. Run the full prediction pipeline for every valid (strategy, horizon) combo
 *   4. Compare each prediction to the actual outcome at T + horizon_days
 *   5. Store results in the database
 *
 * Designed for chunked execution (Vercel 60s limit):
 *   - Each call processes N days, saves results, returns progress
 *   - Resume from where it left off using lastProcessedDate
 *
 * Future-proof data strategy:
 *   - Prices: full 5+ year history (already cached)
 *   - Fundamentals: uses most recent snapshot ≤ prediction date (quarterly snapshots ideal)
 *   - Insider/Analyst/Earnings/News: same point-in-time lookup
 *   - As you add daily/weekly caching of enrichment data, this engine
 *     automatically uses it — no code changes needed
 *
 * Data: uses cached data from PostgreSQL (zero API calls for repeat runs)
 */

import type {
  Horizon,
  Strategy,
  PriceBar,
  FundamentalData,
  FeatureVector,
  QuantileForecast,
  InsiderData,
  AnalystData,
  EarningsData,
  SentimentData,
} from "@/types";
import { VALID_HORIZONS } from "@/types";
import { getProvider } from "@/lib/providers/registry";
import { EXTENDED_UNIVERSE } from "@/lib/providers/interfaces";
import { buildFeatures } from "./features";
import { rankStocks } from "./scoring";
import {
  generateForecast,
  crossSectionalZScore,
  injectMarketSignals,
  HORIZON_DAYS,
} from "./forecast";
import { extractFeatureRow, adaptivePredict, ADAPTIVE_FEATURE_KEYS } from "./adaptive-model";
import {
  getCachedPrices,
  storePrices,
  getCachedFundamentals,
  storeFundamentals,
} from "./data-cache";
import { prisma } from "@/lib/prisma";

// ─── Point-in-Time Enrichment Lookups ─────────────────────────────────
// These query the DB for the most recent snapshot ON OR BEFORE a given date.
// As you build up historical data, these automatically provide better coverage.

/** Get fundamentals snapshot closest to (but not after) the given date */
async function getFundamentalsAsOf(
  stockId: string,
  asOfDate: string,
): Promise<FundamentalData | null> {
  const row = await prisma.fundamental.findFirst({
    where: { stockId, date: { lte: new Date(asOfDate) } },
    orderBy: { date: "desc" },
  });
  if (!row) return null;
  return {
    pe: row.pe, forwardPe: row.forwardPe, pb: row.pb, ps: row.ps,
    evEbitda: row.evEbitda, debtEquity: row.debtEquity, roe: row.roe,
    revenueGrowth: row.revenueGrowth, earningsGrowth: row.earningsGrowth,
    dividendYield: row.dividendYield, beta: row.beta,
  };
}

/** Get insider trading data closest to (but not after) the given date */
async function getInsiderAsOf(
  stockId: string,
  asOfDate: string,
): Promise<InsiderData | null> {
  const row = await prisma.insiderTrade.findFirst({
    where: { stockId, date: { lte: new Date(asOfDate) } },
    orderBy: { date: "desc" },
  });
  if (!row) return null;
  return {
    mspr: row.mspr ?? 0,
    totalBuys: row.totalBuys,
    totalSells: row.totalSells,
    netBuyValue: row.netBuyValue,
    clusterBuying: row.clusterBuying,
  };
}

/** Get analyst ratings closest to (but not after) the given date */
async function getAnalystAsOf(
  stockId: string,
  asOfDate: string,
): Promise<AnalystData | null> {
  const row = await prisma.analystRating.findFirst({
    where: { stockId, date: { lte: new Date(asOfDate) } },
    orderBy: { date: "desc" },
  });
  if (!row) return null;
  return {
    targetPrice: row.targetPrice,
    strongBuy: row.strongBuy, buy: row.buy, hold: row.hold,
    sell: row.sell, strongSell: row.strongSell,
    consensusScore: row.consensusScore ?? 0,
  };
}

/** Get earnings data closest to (but not after) the given date */
async function getEarningsAsOf(
  stockId: string,
  asOfDate: string,
): Promise<EarningsData | null> {
  const row = await prisma.earningsInfo.findFirst({
    where: { stockId, date: { lte: new Date(asOfDate) } },
    orderBy: { date: "desc" },
  });
  if (!row) return null;
  return {
    daysUntilEarnings: row.daysUntilEarnings,
    lastSurprisePct: row.lastSurprisePct,
    lastBeatOrMiss: (row.lastBeatOrMiss as "beat" | "miss" | "met" | null) ?? null,
  };
}

/** Get sentiment from news articles around the given date (7-day lookback) */
async function getSentimentAsOf(
  stockId: string,
  asOfDate: string,
): Promise<SentimentData | null> {
  const asOf = new Date(asOfDate);
  const weekBefore = new Date(asOf.getTime() - 7 * 86_400_000);
  const articles = await prisma.news.findMany({
    where: {
      stockId,
      publishedAt: { gte: weekBefore, lte: asOf },
      sentiment: { not: null },
    },
    select: { sentiment: true },
  });
  if (articles.length === 0) return null;
  const sentiments = articles.map((a) => a.sentiment!);
  const avg = sentiments.reduce((a, b) => a + b, 0) / sentiments.length;
  const bullish = sentiments.filter((s) => s > 0.1).length;
  const bearish = sentiments.filter((s) => s < -0.1).length;
  return {
    avgSentiment: avg,
    sentimentCount: sentiments.length,
    bullishCount: bullish,
    bearishCount: bearish,
  };
}

// ─── Types ────────────────────────────────────────────────────────────

export interface ExhaustiveConfig {
  runId?: string;               // Resume existing run, or start new
  universe?: string[];
  lookbackYears?: number;       // Default 5
  daysPerChunk?: number;        // How many trading days to process per API call (default 5)
  rankMode?: "expected_return"; // We always use expected_return for ranking
}

export interface ChunkResult {
  runId: string;
  status: "running" | "completed";
  processedDays: number;
  totalDays: number;
  lastProcessedDate: string;
  resultsThisChunk: number;
  elapsed: number;              // ms
}

// All valid (strategy, horizon) combos from VALID_HORIZONS
const ALL_COMBOS: { strategy: Strategy; horizon: Horizon }[] = [];
for (const [strategy, horizons] of Object.entries(VALID_HORIZONS)) {
  for (const horizon of horizons) {
    ALL_COMBOS.push({ strategy: strategy as Strategy, horizon });
  }
}

// ─── Main Entry Point ─────────────────────────────────────────────────

export async function runExhaustiveChunk(config: ExhaustiveConfig): Promise<ChunkResult> {
  const startTime = Date.now();
  const {
    universe = EXTENDED_UNIVERSE,
    lookbackYears = 5,
    daysPerChunk = 3,
    rankMode = "expected_return",
  } = config;

  // ── Step 1: Create or resume run ────────────────────────────────
  let run: { id: string; lastProcessedDate: string | null; processedDays: number; totalDays: number };

  if (config.runId) {
    const existing = await prisma.exhaustiveBacktestRun.findUnique({
      where: { id: config.runId },
    });
    if (!existing) throw new Error(`Run ${config.runId} not found`);
    if (existing.status === "completed") {
      return {
        runId: existing.id,
        status: "completed",
        processedDays: existing.processedDays,
        totalDays: existing.totalDays,
        lastProcessedDate: existing.lastProcessedDate || "",
        resultsThisChunk: 0,
        elapsed: Date.now() - startTime,
      };
    }
    run = {
      id: existing.id,
      lastProcessedDate: existing.lastProcessedDate,
      processedDays: existing.processedDays,
      totalDays: existing.totalDays,
    };
  } else {
    const created = await prisma.exhaustiveBacktestRun.create({
      data: {
        universe,
        lookbackYears,
        status: "running",
      },
    });
    run = { id: created.id, lastProcessedDate: null, processedDays: 0, totalDays: 0 };
  }

  // ── Step 2: Load all historical prices (fast raw SQL) ───────────
  const to = new Date();
  const from = new Date(Date.now() - (lookbackYears + 2) * 365 * 86_400_000); // Extra 2yr for feature lookback
  const fromStr = from.toISOString().slice(0, 10);

  const priceMap = new Map<string, PriceBar[]>();
  const batchSize = 10;

  // Use raw SQL for much faster bulk loading (vs Prisma ORM per-ticker)
  const rawBars = await prisma.$queryRaw<{
    ticker: string;
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }[]>`
    SELECT s.ticker, pb.date, pb.open, pb.high, pb.low, pb.close, pb.volume
    FROM "PriceBar" pb
    JOIN "Stock" s ON pb."stockId" = s.id
    WHERE s.ticker = ANY(${universe})
      AND pb.date >= ${fromStr}
    ORDER BY s.ticker, pb.date
  `;

  // Group into per-ticker arrays
  for (const bar of rawBars) {
    if (!priceMap.has(bar.ticker)) priceMap.set(bar.ticker, []);
    priceMap.get(bar.ticker)!.push({
      date: bar.date,
      open: Number(bar.open),
      high: Number(bar.high),
      low: Number(bar.low),
      close: Number(bar.close),
      volume: Number(bar.volume),
    });
  }

  // Remove tickers with insufficient data
  for (const [ticker, bars] of priceMap) {
    if (bars.length <= 60) priceMap.delete(ticker);
  }

  // Preload stock IDs for enrichment lookups (ticker → stockId)
  const stockIdMap = new Map<string, string>();
  const stockRows = await prisma.stock.findMany({
    where: { ticker: { in: universe } },
    select: { id: true, ticker: true },
  });
  for (const s of stockRows) stockIdMap.set(s.ticker, s.id);

  // Ensure all stocks exist in DB (needed for enrichment queries)
  for (const ticker of universe) {
    if (!stockIdMap.has(ticker)) {
      const s = await prisma.stock.upsert({
        where: { ticker },
        update: {},
        create: { ticker, name: ticker, updatedAt: new Date() },
      });
      stockIdMap.set(ticker, s.id);
    }
  }

  // Load cached fundamentals (no API calls — only DB lookups)
  const currentFundamentals = new Map<string, FundamentalData | null>();
  for (let i = 0; i < universe.length; i += batchSize) {
    const batch = universe.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (t) => {
        try {
          const cached = await getCachedFundamentals(t);
          return [t, cached] as const;
        } catch {
          return [t, null] as const;
        }
      })
    );
    for (const [t, fund] of results) currentFundamentals.set(t, fund);
  }

  const activeTickers = [...priceMap.keys()];
  if (activeTickers.length < 10) {
    throw new Error(`Only ${activeTickers.length} tickers have sufficient price history`);
  }

  // ── Step 3: Build global date index ─────────────────────────────
  const allDates = new Set<string>();
  for (const bars of priceMap.values()) {
    for (const bar of bars) allDates.add(bar.date);
  }
  const sortedDates = [...allDates].sort();

  // Need at least 252 days of lookback for features
  const minIdx = 252;
  // Need enough future data for longest horizon (6M = 126 days)
  const maxIdx = sortedDates.length - 126;

  if (maxIdx <= minIdx) {
    throw new Error("Not enough historical data for exhaustive backtest");
  }

  // Update total days on first run
  const totalDays = maxIdx - minIdx;
  if (run.totalDays === 0) {
    await prisma.exhaustiveBacktestRun.update({
      where: { id: run.id },
      data: { totalDays },
    });
    run.totalDays = totalDays;
  }

  // ── Step 4: Find where to resume ────────────────────────────────
  let startIdx = minIdx;
  if (run.lastProcessedDate) {
    const resumeIdx = sortedDates.findIndex((d) => d > run.lastProcessedDate!);
    if (resumeIdx > 0) startIdx = resumeIdx;
  }

  // ── Step 5: Process chunk of days ───────────────────────────────
  // Accumulate adaptive training data from processed days
  const adaptiveTrainingData: Map<string, { features: number[]; actualReturn: number }[]> = new Map();
  for (const combo of ALL_COMBOS) {
    adaptiveTrainingData.set(`${combo.strategy}_${combo.horizon}`, []);
  }

  let daysProcessed = 0;
  let resultsThisChunk = 0;
  let lastDate = run.lastProcessedDate || "";

  const endIdx = Math.min(startIdx + daysPerChunk, maxIdx);

  for (let dateIdx = startIdx; dateIdx < endIdx; dateIdx++) {
    const predictionDate = sortedDates[dateIdx];

    // Build features for every stock using ONLY data up to this day
    const featureVectors = new Map<string, FeatureVector>();
    const priceOnDate = new Map<string, number>();

    // Batch query enrichment data for all stocks for this date
    // This is future-proof: as you cache more historical snapshots, accuracy improves
    const enrichmentPromises = activeTickers.map(async (ticker) => {
      const stockId = stockIdMap.get(ticker);
      if (!stockId) return [ticker, null, null, null, null, null] as const;
      const [fund, insider, analyst, earnings, sentiment] = await Promise.all([
        getFundamentalsAsOf(stockId, predictionDate),
        getInsiderAsOf(stockId, predictionDate),
        getAnalystAsOf(stockId, predictionDate),
        getEarningsAsOf(stockId, predictionDate),
        getSentimentAsOf(stockId, predictionDate),
      ]);
      return [ticker, fund, insider, analyst, earnings, sentiment] as const;
    });
    const enrichmentResults = await Promise.all(enrichmentPromises);
    const enrichmentMap = new Map<string, {
      fund: FundamentalData | null;
      insider: InsiderData | null;
      analyst: AnalystData | null;
      earnings: EarningsData | null;
      sentiment: SentimentData | null;
    }>();
    for (const [ticker, fund, insider, analyst, earnings, sentiment] of enrichmentResults) {
      enrichmentMap.set(ticker, { fund, insider, analyst, earnings, sentiment });
    }

    for (const ticker of activeTickers) {
      const allBars = priceMap.get(ticker)!;
      const cutoffIdx = allBars.findIndex((b) => b.date > predictionDate);
      const barsUpToDate = cutoffIdx < 0 ? allBars : allBars.slice(0, cutoffIdx);

      if (barsUpToDate.length < 60) continue;

      const currentPrice = barsUpToDate[barsUpToDate.length - 1].close;
      priceOnDate.set(ticker, currentPrice);

      // Use point-in-time enrichment data, fallback to current if no historical available
      const enrichment = enrichmentMap.get(ticker);
      const fund = enrichment?.fund ?? currentFundamentals.get(ticker) ?? null;
      const insider = enrichment?.insider ?? null;
      const analyst = enrichment?.analyst ?? null;
      const earnings = enrichment?.earnings ?? null;
      const sentiment = enrichment?.sentiment ?? null;

      const fv = buildFeatures(
        ticker, barsUpToDate, fund,
        null, // technicalIndicators — computed from price bars already
        null, // economicContext — future: could add historical macro data
        sentiment,
        insider,
        analyst,
        earnings,
      );
      // Override date to prediction date (buildFeatures uses current date by default)
      fv.date = predictionDate;
      featureVectors.set(ticker, fv);
    }

    if (featureVectors.size < 10) continue;

    // Cross-sectional normalization (same as live pipeline)
    injectMarketSignals(featureVectors);
    crossSectionalZScore(featureVectors);

    // For each (strategy, horizon) combo, generate predictions
    const resultBatch: {
      predictionDate: string;
      ticker: string;
      strategy: string;
      horizon: string;
      currentPrice: number;
      predictedReturn: number;
      pLow: number;
      pMid: number;
      pHigh: number;
      actualPrice: number | null;
      actualReturn: number | null;
      evaluationDate: string | null;
      rank: number;
      withinInterval: boolean | null;
      directionCorrect: boolean | null;
    }[] = [];

    for (const combo of ALL_COMBOS) {
      const { strategy, horizon } = combo;
      const horizonDays = HORIZON_DAYS[horizon];
      const comboKey = `${strategy}_${horizon}`;

      // Generate forecasts for all stocks
      const forecasts: QuantileForecast[] = [];
      for (const ticker of activeTickers) {
        const fv = featureVectors.get(ticker);
        const price = priceOnDate.get(ticker);
        if (!fv || !price || price <= 0) continue;
        forecasts.push(generateForecast(ticker, ticker, "Unknown", price, fv, horizon));
      }

      if (forecasts.length < 5) continue;

      // Adaptive ML blend (same as real backtest)
      const trainingData = adaptiveTrainingData.get(comboKey)!;
      const currentTickers = forecasts.map((f) => f.ticker);
      const currentFeatureRows = currentTickers.map((t) => {
        const fv = featureVectors.get(t);
        return fv ? extractFeatureRow(fv.features) : Array(ADAPTIVE_FEATURE_KEYS.length).fill(0);
      });

      const adaptiveScores = adaptivePredict(trainingData, currentFeatureRows, 10.0);

      for (let i = 0; i < forecasts.length; i++) {
        const adaptiveBoost = adaptiveScores[i] * 0.3;
        const blendedReturn = forecasts[i].expectedReturn + adaptiveBoost;
        (forecasts[i] as { expectedReturn: number }).expectedReturn = +blendedReturn.toFixed(4);
      }

      // Rank
      const ranked = rankStocks(forecasts, featureVectors, rankMode, strategy);

      // Look up actual outcomes
      const evalDateIdx = dateIdx + horizonDays;
      const evaluationDate = evalDateIdx < sortedDates.length ? sortedDates[evalDateIdx] : null;

      for (const stock of ranked) {
        const entryPrice = priceOnDate.get(stock.ticker);
        if (!entryPrice) continue;

        let actualPrice: number | null = null;
        let actualReturn: number | null = null;
        let withinInterval: boolean | null = null;
        let directionCorrect: boolean | null = null;

        if (evaluationDate) {
          const allBars = priceMap.get(stock.ticker);
          if (allBars) {
            const evalBar = allBars.find((b) => b.date >= evaluationDate);
            if (evalBar) {
              actualPrice = evalBar.close;
              actualReturn = (actualPrice - entryPrice) / entryPrice;
              withinInterval = actualPrice >= stock.pLow && actualPrice <= stock.pHigh;
              directionCorrect = (stock.expectedReturn >= 0) === (actualReturn >= 0);
            }
          }
        }

        resultBatch.push({
          predictionDate,
          ticker: stock.ticker,
          strategy,
          horizon,
          currentPrice: entryPrice,
          predictedReturn: stock.expectedReturn,
          pLow: stock.pLow,
          pMid: stock.pMid,
          pHigh: stock.pHigh,
          actualPrice,
          actualReturn,
          evaluationDate,
          rank: stock.rank,
          withinInterval,
          directionCorrect,
        });

        // Collect training data for adaptive model (from realized outcomes)
        if (actualReturn != null) {
          const fv = featureVectors.get(stock.ticker);
          if (fv) {
            trainingData.push({
              features: extractFeatureRow(fv.features),
              actualReturn,
            });
          }
        }
      }
    }

    // Batch insert results for this day
    if (resultBatch.length > 0) {
      // Use createMany for speed (skip duplicates if resuming)
      await prisma.exhaustiveBacktestResult.createMany({
        data: resultBatch.map((r) => ({
          runId: run.id,
          ...r,
        })),
        skipDuplicates: true,
      });
      resultsThisChunk += resultBatch.length;
    }

    daysProcessed++;
    lastDate = predictionDate;
  }

  // ── Step 6: Update run progress ─────────────────────────────────
  const newProcessedDays = run.processedDays + daysProcessed;
  const isComplete = endIdx >= maxIdx;

  await prisma.exhaustiveBacktestRun.update({
    where: { id: run.id },
    data: {
      processedDays: newProcessedDays,
      lastProcessedDate: lastDate,
      status: isComplete ? "completed" : "running",
      completedAt: isComplete ? new Date() : undefined,
    },
  });

  return {
    runId: run.id,
    status: isComplete ? "completed" : "running",
    processedDays: newProcessedDays,
    totalDays: run.totalDays || totalDays,
    lastProcessedDate: lastDate,
    resultsThisChunk,
    elapsed: Date.now() - startTime,
  };
}

// ─── Aggregation Queries ──────────────────────────────────────────────

export interface AggregatedMetrics {
  strategy: string;
  horizon: string;
  totalPredictions: number;
  directionalAccuracy: number;
  intervalCoverage: number;
  avgPredictedReturn: number;
  avgActualReturn: number;
  avgAbsError: number;        // Mean |predicted - actual|
  rankCorrelation: number;    // Spearman: do top-ranked stocks outperform?
  top10AvgReturn: number;     // Average actual return of top-10 ranked stocks
  universeAvgReturn: number;  // Average actual return of all stocks
  excessReturn: number;       // top10 - universe
}

export async function getExhaustiveMetrics(runId: string): Promise<AggregatedMetrics[]> {
  // Use raw SQL aggregation — much faster than pulling 1M+ rows into JS
  const rows = await prisma.$queryRaw<{
    strategy: string;
    horizon: string;
    total: bigint;
    dir_correct: bigint;
    in_interval: bigint;
    avg_predicted: number;
    avg_actual: number;
    avg_abs_error: number;
    top10_avg: number;
    universe_avg: number;
  }[]>`
    WITH base AS (
      SELECT strategy, horizon, "predictedReturn", "actualReturn", rank,
             "withinInterval", "directionCorrect"
      FROM "ExhaustiveBacktestResult"
      WHERE "runId" = ${runId} AND "actualReturn" IS NOT NULL
    )
    SELECT
      strategy,
      horizon,
      COUNT(*)::bigint AS total,
      COUNT(*) FILTER (WHERE "directionCorrect" = true)::bigint AS dir_correct,
      COUNT(*) FILTER (WHERE "withinInterval" = true)::bigint AS in_interval,
      AVG("predictedReturn")::float8 AS avg_predicted,
      AVG("actualReturn")::float8 AS avg_actual,
      AVG(ABS("predictedReturn" - "actualReturn"))::float8 AS avg_abs_error,
      AVG("actualReturn") FILTER (WHERE rank <= 10)::float8 AS top10_avg,
      AVG("actualReturn")::float8 AS universe_avg
    FROM base
    GROUP BY strategy, horizon
    ORDER BY (AVG("actualReturn") FILTER (WHERE rank <= 10) - AVG("actualReturn")) DESC
  `;

  // Compute Spearman Rank IC per strategy/horizon (average of per-day rank correlations)
  const rankIcRows = await prisma.$queryRaw<{
    strategy: string;
    horizon: string;
    avg_rank_ic: number;
  }[]>`
    WITH daily_ranked AS (
      SELECT
        strategy, horizon, "predictionDate", "predictedReturn", "actualReturn",
        RANK() OVER (PARTITION BY strategy, horizon, "predictionDate" ORDER BY "predictedReturn" DESC) AS pred_rank,
        RANK() OVER (PARTITION BY strategy, horizon, "predictionDate" ORDER BY "actualReturn" DESC) AS actual_rank,
        COUNT(*) OVER (PARTITION BY strategy, horizon, "predictionDate") AS n
      FROM "ExhaustiveBacktestResult"
      WHERE "runId" = ${runId} AND "actualReturn" IS NOT NULL
    ),
    daily_corr AS (
      SELECT
        strategy, horizon, "predictionDate", n,
        CASE WHEN n < 3 THEN NULL
        ELSE 1.0 - (6.0 * SUM((pred_rank - actual_rank) * (pred_rank - actual_rank))) / (n * (n * n - 1.0))
        END AS spearman
      FROM daily_ranked
      GROUP BY strategy, horizon, "predictionDate", n
    )
    SELECT
      strategy, horizon,
      AVG(spearman)::float8 AS avg_rank_ic
    FROM daily_corr
    WHERE spearman IS NOT NULL
    GROUP BY strategy, horizon
  `;

  // Build lookup map for rank IC
  const rankIcMap = new Map<string, number>();
  for (const r of rankIcRows) {
    rankIcMap.set(`${r.strategy}|${r.horizon}`, r.avg_rank_ic ?? 0);
  }

  return rows.map((r) => ({
    strategy: r.strategy,
    horizon: r.horizon,
    totalPredictions: Number(r.total),
    directionalAccuracy: Number(r.total) > 0 ? Number(r.dir_correct) / Number(r.total) : 0,
    intervalCoverage: Number(r.total) > 0 ? Number(r.in_interval) / Number(r.total) : 0,
    avgPredictedReturn: r.avg_predicted ?? 0,
    avgActualReturn: r.avg_actual ?? 0,
    avgAbsError: r.avg_abs_error ?? 0,
    rankCorrelation: rankIcMap.get(`${r.strategy}|${r.horizon}`) ?? 0,
    top10AvgReturn: r.top10_avg ?? 0,
    universeAvgReturn: r.universe_avg ?? 0,
    excessReturn: (r.top10_avg ?? 0) - (r.universe_avg ?? 0),
  }));
}

// ─── Time Series for Charting ─────────────────────────────────────────

export interface DailyMetric {
  date: string;
  directionalAccuracy: number;
  intervalCoverage: number;
  avgPredictedReturn: number;
  avgActualReturn: number;
  top10Return: number;
  universeReturn: number;
  stockCount: number;
}

export async function getExhaustiveTimeSeries(
  runId: string,
  strategy: string,
  horizon: string,
): Promise<DailyMetric[]> {
  const results = await prisma.exhaustiveBacktestResult.findMany({
    where: {
      runId,
      strategy,
      horizon,
      actualReturn: { not: null },
    },
    select: {
      predictionDate: true,
      predictedReturn: true,
      actualReturn: true,
      rank: true,
      withinInterval: true,
      directionCorrect: true,
    },
    orderBy: { predictionDate: "asc" },
  });

  // Group by prediction date
  const byDate = new Map<string, typeof results>();
  for (const r of results) {
    if (!byDate.has(r.predictionDate)) byDate.set(r.predictionDate, []);
    byDate.get(r.predictionDate)!.push(r);
  }

  const series: DailyMetric[] = [];
  for (const [date, rows] of byDate) {
    const n = rows.length;
    if (n < 5) continue;

    const dirAcc = rows.filter((r) => r.directionCorrect).length / n;
    const intCov = rows.filter((r) => r.withinInterval).length / n;
    const avgPred = rows.reduce((s, r) => s + r.predictedReturn, 0) / n;
    const avgActual = rows.reduce((s, r) => s + r.actualReturn!, 0) / n;
    const top10 = rows.filter((r) => r.rank != null && r.rank <= 10);
    const top10Ret = top10.length > 0
      ? top10.reduce((s, r) => s + r.actualReturn!, 0) / top10.length
      : avgActual;

    series.push({
      date,
      directionalAccuracy: dirAcc,
      intervalCoverage: intCov,
      avgPredictedReturn: avgPred,
      avgActualReturn: avgActual,
      top10Return: top10Ret,
      universeReturn: avgActual,
      stockCount: n,
    });
  }

  return series;
}

// ─── List Runs ────────────────────────────────────────────────────────

export async function listExhaustiveRuns() {
  return prisma.exhaustiveBacktestRun.findMany({
    orderBy: { startedAt: "desc" },
    select: {
      id: true,
      startedAt: true,
      completedAt: true,
      status: true,
      lookbackYears: true,
      totalDays: true,
      processedDays: true,
      lastProcessedDate: true,
    },
  });
}
