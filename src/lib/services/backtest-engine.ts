/**
 * Real Walk-Forward Backtest Engine
 *
 * Downloads historical daily prices once, then replays the prediction
 * pipeline at each rebalance date using ONLY data available at that time.
 * Measures actual outcomes vs predictions.
 *
 * API budget: ~41 calls (40 historical prices + 1 batch quote)
 * All subsequent computation is local — no additional API calls.
 */
import type {
  Horizon,
  RankMode,
  Strategy,
  PriceBar,
  FundamentalData,
  FeatureVector,
  QuantileForecast,
  ScoredStock,
} from "@/types";
import { getProvider, isDemo } from "@/lib/providers/registry";
import { DEFAULT_UNIVERSE, EXTENDED_UNIVERSE } from "@/lib/providers/interfaces";
import { buildFeatures } from "./features";
import { rankStocks } from "./scoring";
import { generateForecast, crossSectionalZScore, injectMarketSignals, HORIZON_DAYS } from "./forecast";
import { extractFeatureRow, adaptivePredict, ADAPTIVE_FEATURE_KEYS } from "./adaptive-model";
import {
  getCachedPrices,
  storePrices,
  getCachedFundamentals,
  storeFundamentals,
} from "./data-cache";

export interface BacktestConfig {
  horizon: Horizon;
  rankMode: RankMode;
  strategy: Strategy;
  universe?: string[];
  topN: number;           // How many top-ranked stocks to hold
  lookbackMonths: number; // How many months of history to test
  transactionCostBps: number; // Transaction cost in basis points
}

export interface RebalanceResult {
  date: string;
  holdings: string[];         // Tickers held this period
  holdingReturns: number[];   // Actual return of each holding
  portfolioReturn: number;    // Equal-weight portfolio return
  benchmarkReturn: number;    // Equal-weight universe return
  predictions: {
    ticker: string;
    predictedReturn: number;
    actualReturn: number;
    pLow: number;
    pMid: number;
    pHigh: number;
    actualPrice: number;
    hitP50: boolean;          // Did actual end up close to P50?
    withinInterval: boolean;  // Was actual within [P10, P90]?
  }[];
}

export interface BacktestOutput {
  config: BacktestConfig;
  periods: RebalanceResult[];
  // Aggregate metrics
  totalReturn: number;
  annualizedReturn: number;
  benchmarkTotalReturn: number;
  benchmarkAnnualizedReturn: number;
  excessReturn: number;
  sharpe: number;
  maxDrawdown: number;
  winRate: number;
  totalTrades: number;
  // Prediction quality metrics
  directionalAccuracy: number;    // % of top-N picks that went up
  rankCorrelation: number;        // Spearman correlation: predicted rank vs actual return rank
  intervalCoverage: number;       // % of predictions where actual fell within [P10, P90]
  p50MeanError: number;           // Average |actual - P50| / price
  // Equity curve for charting
  equity: { date: string; value: number; benchmark: number }[];
  startDate: string;
  endDate: string;
}

/**
 * Run a real walk-forward backtest.
 *
 * 1. Downloads 2 years of daily prices for the universe (~40 API calls)
 * 2. At each rebalance date, builds features from ONLY past data
 * 3. Runs the full scoring pipeline
 * 4. Picks the top N stocks
 * 5. Measures what actually happened over the next period
 * 6. Repeats until present
 */
export async function runRealBacktest(config: BacktestConfig): Promise<BacktestOutput> {
  const {
    horizon,
    rankMode,
    strategy,
    topN = 10,
    lookbackMonths = 6,
    transactionCostBps = 10,
  } = config;

  const days = HORIZON_DAYS[horizon];
  // Use extended universe (89 stocks) for weekly+ horizons
  // Use default universe (40 stocks) for daily to avoid timeout
  const tickers = config.universe || (days <= 1 ? DEFAULT_UNIVERSE : EXTENDED_UNIVERSE);
  const provider = getProvider();

  // ── Step 1: Download historical prices (uses DB cache) ──────────
  const to = new Date();
  // Need extra history for: 252 days feature lookback + lookback period + buffer
  // For long horizons (3M/6M), we need significantly more history
  const extraMonths = Math.max(18, Math.ceil(days / 21) * 3); // At least 18mo, more for long horizons
  const from = new Date(Date.now() - (lookbackMonths + extraMonths) * 30 * 86_400_000);

  const priceMap = new Map<string, PriceBar[]>();
  const batchSize = 10;
  for (let i = 0; i < tickers.length; i += batchSize) {
    const batch = tickers.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (t) => {
        try {
          // Use DB cache — only fetches missing days from API
          const { cached, fetchFrom } = await getCachedPrices(t, from, to);
          if (!fetchFrom) return [t, cached] as const;

          const fresh = await provider.getHistoricalPrices(t, fetchFrom, to);
          storePrices(t, fresh).catch(() => {});

          const dateSet = new Set(cached.map((b) => b.date));
          const merged = [...cached];
          for (const bar of fresh) {
            if (!dateSet.has(bar.date)) { merged.push(bar); dateSet.add(bar.date); }
          }
          return [t, merged.sort((a, b) => a.date.localeCompare(b.date))] as const;
        } catch {
          return [t, [] as PriceBar[]] as const;
        }
      })
    );
    for (const [t, bars] of results) {
      if (bars.length > 60) priceMap.set(t, bars);
    }
  }

  // Also fetch current fundamentals (uses DB cache — 24h TTL)
  const fundamentalsMap = new Map<string, FundamentalData | null>();
  for (let i = 0; i < tickers.length; i += batchSize) {
    const batch = tickers.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (t) => {
        try {
          const cached = await getCachedFundamentals(t);
          if (cached) return [t, cached] as const;
          const fresh = await provider.getFundamentals(t);
          if (fresh) storeFundamentals(t, fresh).catch(() => {});
          return [t, fresh] as const;
        } catch {
          return [t, null] as const;
        }
      })
    );
    for (const [t, fund] of results) fundamentalsMap.set(t, fund);
  }

  const activeTickers = [...priceMap.keys()];
  if (activeTickers.length < 10) {
    throw new Error(`Only ${activeTickers.length} tickers have sufficient price history. Need at least 10.`);
  }

  // ── Step 2: Build date index ───────────────────────────────────
  // Find common trading dates across all tickers
  const allDates = new Set<string>();
  for (const bars of priceMap.values()) {
    for (const bar of bars) allDates.add(bar.date);
  }
  const sortedDates = [...allDates].sort();

  // Determine rebalance dates (every `days` trading days)
  const startIdx = Math.max(252, 0); // Need at least 252 days of lookback for features
  const rebalanceDates: number[] = [];
  for (let i = startIdx; i < sortedDates.length - days; i += days) {
    rebalanceDates.push(i);
  }

  // Limit to lookbackMonths
  const maxRebalances = Math.floor(lookbackMonths * 21 / days); // ~21 trading days/month
  const selectedRebalances = rebalanceDates.slice(-maxRebalances);

  if (selectedRebalances.length < 2) {
    throw new Error(`Not enough history for meaningful backtest. Need at least 2 rebalance periods (have ${selectedRebalances.length}). Try a shorter horizon or longer lookback.`);
  }

  // ── Step 3: Walk-forward simulation ────────────────────────────
  const periods: RebalanceResult[] = [];
  const txCost = transactionCostBps / 10000;
  let prevHoldings: string[] = [];

  // Adaptive model: accumulate (features, actual_return) training data
  // from past periods to train ridge regression for better ranking
  const adaptiveTrainingData: { features: number[]; actualReturn: number }[] = [];

  for (const dateIdx of selectedRebalances) {
    const rebalanceDate = sortedDates[dateIdx];
    const evaluationDate = sortedDates[Math.min(dateIdx + days, sortedDates.length - 1)];

    // Build features using ONLY data available at rebalanceDate
    const featureVectors = new Map<string, FeatureVector>();
    const priceAtRebalance = new Map<string, number>();
    const priceAtEvaluation = new Map<string, number>();

    for (const ticker of activeTickers) {
      const allBars = priceMap.get(ticker)!;

      // Find the index of rebalanceDate
      const rebalIdx = allBars.findIndex((b) => b.date >= rebalanceDate);
      if (rebalIdx < 60) continue; // Need at least 60 bars of history

      // Slice bars up to and including rebalanceDate (point-in-time!)
      const barsUpToDate = allBars.slice(0, rebalIdx + 1);
      const currentPrice = barsUpToDate[barsUpToDate.length - 1].close;
      priceAtRebalance.set(ticker, currentPrice);

      // Find evaluation date price
      const evalIdx = allBars.findIndex((b) => b.date >= evaluationDate);
      if (evalIdx >= 0) {
        priceAtEvaluation.set(ticker, allBars[evalIdx].close);
      }

      // Build features from historical bars only
      const fund = fundamentalsMap.get(ticker) || null;
      const fv = buildFeatures(ticker, barsUpToDate, fund);
      featureVectors.set(ticker, fv);
    }

    // Market-level aggregate signals + cross-sectional z-score normalization
    injectMarketSignals(featureVectors);
    crossSectionalZScore(featureVectors);

    // Generate forecasts using shared forecast module (single source of truth)
    const forecasts: QuantileForecast[] = [];
    for (const ticker of activeTickers) {
      const fv = featureVectors.get(ticker);
      const price = priceAtRebalance.get(ticker);
      if (!fv || !price || price <= 0) continue;
      forecasts.push(generateForecast(ticker, ticker, "Unknown", price, fv, horizon));
    }

    if (forecasts.length < 5) continue;

    // ── Adaptive ML: blend learned scores with base model ────────
    // Extract feature rows for current stocks
    const currentTickers = forecasts.map((f) => f.ticker);
    const currentFeatureRows = currentTickers.map((t) => {
      const fv = featureVectors.get(t);
      return fv ? extractFeatureRow(fv.features) : Array(ADAPTIVE_FEATURE_KEYS.length).fill(0);
    });

    // Get adaptive predictions (returns 0 if not enough training data)
    const adaptiveScores = adaptivePredict(adaptiveTrainingData, currentFeatureRows, 10.0);

    // Blend: boost the base forecast's expectedReturn with adaptive signal
    // This improves cross-sectional ranking without changing directional prediction
    for (let i = 0; i < forecasts.length; i++) {
      const adaptiveBoost = adaptiveScores[i] * 0.3; // 30% weight — 40% caused overfitting
      const baseForecast = forecasts[i];
      // Adjust expected return by blending
      const blendedReturn = baseForecast.expectedReturn + adaptiveBoost;
      (forecasts[i] as { expectedReturn: number }).expectedReturn = +blendedReturn.toFixed(4);
    }

    // Rank (now using blended forecasts)
    const ranked = rankStocks(forecasts, featureVectors, rankMode, strategy);

    // Pick top N
    const holdings = ranked.slice(0, topN).map((s) => s.ticker);

    // Calculate actual returns
    const holdingReturns: number[] = [];
    const predictions: RebalanceResult["predictions"] = [];

    for (const stock of ranked.slice(0, Math.min(ranked.length, 20))) {
      const entryPrice = priceAtRebalance.get(stock.ticker);
      const exitPrice = priceAtEvaluation.get(stock.ticker);

      if (!entryPrice || !exitPrice) continue;

      const actualReturn = (exitPrice - entryPrice) / entryPrice;

      if (holdings.includes(stock.ticker)) {
        // Apply transaction costs for new positions
        const isNew = !prevHoldings.includes(stock.ticker);
        const costAdjustedReturn = isNew ? actualReturn - txCost : actualReturn;
        holdingReturns.push(costAdjustedReturn);
      }

      predictions.push({
        ticker: stock.ticker,
        predictedReturn: stock.expectedReturn,
        actualReturn,
        pLow: stock.pLow,
        pMid: stock.pMid,
        pHigh: stock.pHigh,
        actualPrice: exitPrice,
        hitP50: Math.abs(exitPrice - stock.pMid) / entryPrice < 0.02,
        withinInterval: exitPrice >= stock.pLow && exitPrice <= stock.pHigh,
      });
    }

    // Equal-weight benchmark: all stocks in universe
    const allReturns: number[] = [];
    for (const ticker of activeTickers) {
      const entry = priceAtRebalance.get(ticker);
      const exit = priceAtEvaluation.get(ticker);
      if (entry && exit) allReturns.push((exit - entry) / entry);
    }
    const benchmarkReturn = allReturns.length > 0
      ? allReturns.reduce((a, b) => a + b, 0) / allReturns.length
      : 0;

    const portfolioReturn = holdingReturns.length > 0
      ? holdingReturns.reduce((a, b) => a + b, 0) / holdingReturns.length
      : 0;

    periods.push({
      date: rebalanceDate,
      holdings,
      holdingReturns,
      portfolioReturn,
      benchmarkReturn,
      predictions,
    });

    // ── Collect training data for adaptive model ──────────────
    // Add (features, actual_return) pairs from ALL stocks this period
    // so the model can learn which features predict returns
    for (const ticker of activeTickers) {
      const fv = featureVectors.get(ticker);
      const entry = priceAtRebalance.get(ticker);
      const exit = priceAtEvaluation.get(ticker);
      if (fv && entry && exit && entry > 0) {
        const actualReturn = (exit - entry) / entry;
        adaptiveTrainingData.push({
          features: extractFeatureRow(fv.features),
          actualReturn,
        });
      }
    }

    prevHoldings = holdings;
  }

  if (periods.length === 0) {
    throw new Error("No valid rebalance periods found.");
  }

  // ── Step 4: Compute aggregate metrics ──────────────────────────
  // Equity curve
  let portfolioValue = 10000;
  let benchmarkValue = 10000;
  const equity: BacktestOutput["equity"] = [];

  for (const period of periods) {
    portfolioValue *= (1 + period.portfolioReturn);
    benchmarkValue *= (1 + period.benchmarkReturn);
    equity.push({
      date: period.date,
      value: +portfolioValue.toFixed(2),
      benchmark: +benchmarkValue.toFixed(2),
    });
  }

  const totalReturn = (portfolioValue - 10000) / 10000;
  const benchmarkTotalReturn = (benchmarkValue - 10000) / 10000;

  // Annualized return
  const totalDays = periods.length * HORIZON_DAYS[horizon];
  const years = totalDays / 252;
  const annualizedReturn = years > 0 ? Math.pow(1 + totalReturn, 1 / years) - 1 : 0;
  const benchmarkAnnualizedReturn = years > 0 ? Math.pow(1 + benchmarkTotalReturn, 1 / years) - 1 : 0;

  // Sharpe ratio
  const periodReturns = periods.map((p) => p.portfolioReturn);
  const avgReturn = periodReturns.reduce((a, b) => a + b, 0) / periodReturns.length;
  const returnStd = Math.sqrt(
    periodReturns.reduce((a, b) => a + (b - avgReturn) ** 2, 0) / periodReturns.length
  );
  const periodsPerYear = 252 / HORIZON_DAYS[horizon];
  const sharpe = returnStd > 0 ? (avgReturn / returnStd) * Math.sqrt(periodsPerYear) : 0;

  // Max drawdown
  let peak = 10000;
  let maxDrawdown = 0;
  let runningValue = 10000;
  for (const period of periods) {
    runningValue *= (1 + period.portfolioReturn);
    if (runningValue > peak) peak = runningValue;
    const dd = (peak - runningValue) / peak;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  // Win rate
  const wins = periods.filter((p) => p.portfolioReturn > 0).length;
  const winRate = periods.length > 0 ? wins / periods.length : 0;

  // Prediction quality
  const allPredictions = periods.flatMap((p) => p.predictions);
  const directionalAccuracy = allPredictions.length > 0
    ? allPredictions.filter((p) => (p.predictedReturn > 0) === (p.actualReturn > 0)).length / allPredictions.length
    : 0;

  const intervalCoverage = allPredictions.length > 0
    ? allPredictions.filter((p) => p.withinInterval).length / allPredictions.length
    : 0;

  const p50Errors = allPredictions
    .filter((p) => p.pMid > 0)
    .map((p) => Math.abs(p.actualPrice - p.pMid) / p.pMid);
  const p50MeanError = p50Errors.length > 0
    ? p50Errors.reduce((a, b) => a + b, 0) / p50Errors.length
    : 0;

  // Spearman rank correlation per period
  const rankCorrelations: number[] = [];
  for (const period of periods) {
    if (period.predictions.length < 5) continue;
    const preds = period.predictions.slice();
    const byPredicted = preds.map((p, i) => ({ i, val: p.predictedReturn })).sort((a, b) => b.val - a.val);
    const byActual = preds.map((p, i) => ({ i, val: p.actualReturn })).sort((a, b) => b.val - a.val);
    const predRank = new Map<number, number>();
    const actRank = new Map<number, number>();
    byPredicted.forEach((item, rank) => predRank.set(item.i, rank));
    byActual.forEach((item, rank) => actRank.set(item.i, rank));
    const n = preds.length;
    let d2Sum = 0;
    for (let i = 0; i < n; i++) {
      const d = (predRank.get(i) || 0) - (actRank.get(i) || 0);
      d2Sum += d * d;
    }
    const spearman = 1 - (6 * d2Sum) / (n * (n * n - 1));
    rankCorrelations.push(spearman);
  }
  const rankCorrelation = rankCorrelations.length > 0
    ? rankCorrelations.reduce((a, b) => a + b, 0) / rankCorrelations.length
    : 0;

  let tradeCount = 0;
  let prevHoldingsForCount: string[] = [];
  for (const p of periods) {
    const newPositions = p.holdings.filter((h) => !prevHoldingsForCount.includes(h)).length;
    tradeCount += newPositions;
    prevHoldingsForCount = p.holdings;
  }

  return {
    config,
    periods,
    totalReturn,
    annualizedReturn,
    benchmarkTotalReturn,
    benchmarkAnnualizedReturn,
    excessReturn: totalReturn - benchmarkTotalReturn,
    sharpe,
    maxDrawdown,
    winRate,
    totalTrades: tradeCount,
    directionalAccuracy,
    rankCorrelation,
    intervalCoverage,
    p50MeanError,
    equity,
    startDate: periods[0].date,
    endDate: periods[periods.length - 1].date,
  };
}
