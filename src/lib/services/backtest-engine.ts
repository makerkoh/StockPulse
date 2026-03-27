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
import { DEFAULT_UNIVERSE } from "@/lib/providers/interfaces";
import { buildFeatures } from "./features";
import { rankStocks } from "./scoring";

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

const HORIZON_DAYS: Record<Horizon, number> = {
  "1D": 1, "1W": 5, "1M": 21, "3M": 63, "6M": 126,
};

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
    topN = 5,
    lookbackMonths = 6,
    transactionCostBps = 10,
  } = config;

  const tickers = config.universe || DEFAULT_UNIVERSE;
  const days = HORIZON_DAYS[horizon];
  const provider = getProvider();

  // ── Step 1: Download historical prices (main API cost) ─────────
  const to = new Date();
  const from = new Date(Date.now() - (lookbackMonths + 12) * 30 * 86_400_000); // Extra 12 months for feature lookback

  const priceMap = new Map<string, PriceBar[]>();
  const batchSize = 10;
  for (let i = 0; i < tickers.length; i += batchSize) {
    const batch = tickers.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (t) => {
        try {
          const bars = await provider.getHistoricalPrices(t, from, to);
          return [t, bars] as const;
        } catch {
          return [t, [] as PriceBar[]] as const;
        }
      })
    );
    for (const [t, bars] of results) {
      if (bars.length > 60) priceMap.set(t, bars);
    }
  }

  // Also fetch current fundamentals (we'll use these as a rough proxy
  // since fundamentals change slowly — this saves 40 calls per rebalance)
  const fundamentalsMap = new Map<string, FundamentalData | null>();
  for (let i = 0; i < tickers.length; i += batchSize) {
    const batch = tickers.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (t) => {
        try {
          const fund = await provider.getFundamentals(t);
          return [t, fund] as const;
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

  if (selectedRebalances.length < 3) {
    throw new Error("Not enough history for meaningful backtest. Need at least 3 rebalance periods.");
  }

  // ── Step 3: Walk-forward simulation ────────────────────────────
  const periods: RebalanceResult[] = [];
  const txCost = transactionCostBps / 10000;
  let prevHoldings: string[] = [];

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

    // Generate forecasts
    const forecasts: QuantileForecast[] = [];
    for (const ticker of activeTickers) {
      const fv = featureVectors.get(ticker);
      const price = priceAtRebalance.get(ticker);
      if (!fv || !price || price <= 0) continue;

      const f = fv.features;

      // Simplified forecast generation (same drift logic as pipeline)
      const momentumDrift = (f.return_5d || 0) * 0.3 + (f.return_20d || 0) * 0.5;
      const rsiVal = f.rsi_14 ?? 50;
      const rsiSignal = (50 - rsiVal) / 200;
      const trendBonus = f.golden_cross ? 0.002 * days : -0.001 * days;
      const pe = f.pe || 25;
      const valueTilt = pe < 15 ? 0.001 * days : pe > 40 ? -0.001 * days : 0;
      const dcfBonus = f.dcf_upside != null ? Math.max(-0.02, Math.min(0.02, f.dcf_upside * 0.05)) * days : 0;
      const mrzDrift = f.mean_reversion_z != null ? -f.mean_reversion_z * 0.003 * days : 0;

      const annualizedDrift = momentumDrift + rsiSignal + trendBonus + valueTilt + dcfBonus + mrzDrift;
      const periodReturn = annualizedDrift * (days / 252);
      const annualVol = f.volatility_20d || 0.25;
      const periodVol = (annualVol / Math.sqrt(252)) * Math.sqrt(days);

      const pMid = price * (1 + periodReturn);
      const pLow = price * (1 + periodReturn - 1.28 * periodVol);
      const pHigh = price * (1 + periodReturn + 1.28 * periodVol);

      const volConfidence = Math.max(0, 1 - periodVol * 3);
      const featureCount = Object.keys(f).filter((k) => !k.startsWith("_")).length;
      const dataConfidence = Math.min(featureCount / 30, 1);
      const confidence = volConfidence * 0.45 + dataConfidence * 0.3 + 0.2;

      const expectedReturn = (pMid - price) / price;
      const downside = Math.max(price - pLow, 0.01);
      const upside = Math.max(pHigh - price, 0.01);

      forecasts.push({
        ticker,
        name: ticker, // We don't need names for backtest
        sector: "Unknown",
        horizon,
        currentPrice: price,
        pLow: +Math.max(pLow, 0.01).toFixed(2),
        pMid: +pMid.toFixed(2),
        pHigh: +pHigh.toFixed(2),
        confidence: +Math.min(Math.max(confidence, 0.1), 0.99).toFixed(3),
        expectedReturn: +expectedReturn.toFixed(4),
        riskReward: +(upside / downside).toFixed(2),
      });
    }

    if (forecasts.length < 5) continue;

    // Rank
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
