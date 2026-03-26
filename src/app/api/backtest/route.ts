import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { getProvider } from "@/lib/providers/registry";
import { buildFeatures } from "@/lib/services/features";
import { rankStocks } from "@/lib/services/scoring";
import type {
  BacktestResult,
  Horizon,
  RankMode,
  Strategy,
  PriceBar,
  QuantileForecast,
  FeatureVector,
} from "@/types";
import { HORIZONS, RANK_MODES, STRATEGIES } from "@/types";
import { DEFAULT_UNIVERSE } from "@/lib/providers/interfaces";

export const maxDuration = 30;

const HORIZON_DAYS: Record<string, number> = {
  "1D": 1, "1W": 5, "1M": 21, "3M": 63, "6M": 126,
};

// Simplified forecast generator for backtest (same logic as pipeline)
function backtestForecast(
  ticker: string,
  price: number,
  fv: FeatureVector,
  horizon: Horizon,
): QuantileForecast {
  const f = fv.features;
  const days = HORIZON_DAYS[horizon] || 5;

  const momentumDrift = (f.return_5d || 0) * 0.3 + (f.return_20d || 0) * 0.5;
  const rsiVal = f.rsi_14 ?? 50;
  const rsiSignal = (50 - rsiVal) / 200;
  const trendBonus = f.golden_cross ? 0.002 * days : -0.001 * days;
  const pe = f.pe || 25;
  const valueTilt = pe < 15 ? 0.001 * days : pe > 40 ? -0.001 * days : 0;
  const mrzDrift = f.mean_reversion_z != null ? -f.mean_reversion_z * 0.003 * days : 0;

  const annualizedDrift = (momentumDrift + rsiSignal + trendBonus + valueTilt + mrzDrift);
  const periodReturn = annualizedDrift * (days / 252);
  const annualVol = f.volatility_20d || 0.25;
  const periodVol = (annualVol / Math.sqrt(252)) * Math.sqrt(days);

  const pMid = price * (1 + periodReturn);
  const pLow = price * (1 + periodReturn - 1.28 * periodVol);
  const pHigh = price * (1 + periodReturn + 1.28 * periodVol);

  const featureCount = Object.keys(f).filter((k) => !k.startsWith("_")).length;
  const confidence = Math.min(0.95, Math.max(0.1,
    Math.max(0, 1 - periodVol * 3) * 0.5 + Math.min(featureCount / 30, 1) * 0.4 + 0.1
  ));

  const expectedReturn = (pMid - price) / price;
  const downside = Math.max(price - pLow, 0.01);
  const upside = Math.max(pHigh - price, 0.01);

  return {
    ticker,
    name: ticker,
    sector: "Unknown",
    horizon,
    currentPrice: price,
    pLow: Math.max(pLow, 0.01),
    pMid,
    pHigh,
    confidence,
    expectedReturn,
    riskReward: upside / downside,
  };
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const horizon: Horizon = HORIZONS.includes(body.horizon) ? body.horizon : "1W";
    const rankMode: RankMode = RANK_MODES.includes(body.rankMode) ? body.rankMode : "expected_return";
    const strategy: Strategy = STRATEGIES.includes(body.strategy) ? body.strategy : "swing";
    const topN = 5;
    const txCostBps = 10; // 10 basis points per trade

    // Use a subset of the universe for speed (backtest over 15 liquid names)
    const backtestUniverse = DEFAULT_UNIVERSE.slice(0, 15);
    const rebalanceDays = HORIZON_DAYS[horizon] || 5;

    const provider = getProvider();
    const endDate = new Date();
    const startDate = new Date(Date.now() - 3 * 365 * 86_400_000); // 3 years

    // Fetch 3 years of historical prices for all tickers
    const priceData = new Map<string, PriceBar[]>();
    const batchSize = 5;
    for (let i = 0; i < backtestUniverse.length; i += batchSize) {
      const batch = backtestUniverse.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(async (ticker) => {
          const bars = await provider.getHistoricalPrices(ticker, startDate, endDate);
          return [ticker, bars] as const;
        })
      );
      for (const [ticker, bars] of results) {
        priceData.set(ticker, bars);
      }
    }

    // Build a date-aligned price matrix
    // Find common trading dates
    const allDates = new Set<string>();
    for (const bars of priceData.values()) {
      for (const bar of bars) {
        allDates.add(bar.date.split("T")[0]);
      }
    }
    const sortedDates = [...allDates].sort();

    // Need at least 252 days of history before first trade
    const warmupDays = 252;
    if (sortedDates.length < warmupDays + rebalanceDays) {
      return NextResponse.json({
        data: {
          startDate: sortedDates[0] || startDate.toISOString().split("T")[0],
          endDate: sortedDates[sortedDates.length - 1] || endDate.toISOString().split("T")[0],
          totalReturn: 0,
          annualizedReturn: 0,
          sharpe: 0,
          maxDrawdown: 0,
          winRate: 0,
          totalTrades: 0,
          equity: [],
          isSimulated: false,
        } as BacktestResult,
      });
    }

    // Walk-forward backtest
    let portfolioValue = 10000;
    let benchmarkValue = 10000;
    const equity: { date: string; value: number; benchmark: number }[] = [];
    let totalTrades = 0;
    let wins = 0;
    let losses = 0;
    let peak = 10000;
    let maxDrawdown = 0;
    const periodReturns: number[] = [];

    // Get price lookup by ticker+date
    const priceLookup = new Map<string, number>();
    for (const [ticker, bars] of priceData.entries()) {
      for (const bar of bars) {
        priceLookup.set(`${ticker}:${bar.date.split("T")[0]}`, bar.close);
      }
    }

    // Rebalance loop
    for (let i = warmupDays; i < sortedDates.length - rebalanceDays; i += rebalanceDays) {
      const rebalanceDate = sortedDates[i];
      const forwardDate = sortedDates[Math.min(i + rebalanceDays, sortedDates.length - 1)];

      // At rebalance date: build features using only data available at that time
      const featureVectors = new Map<string, FeatureVector>();
      const forecasts: QuantileForecast[] = [];

      for (const ticker of backtestUniverse) {
        const allBars = priceData.get(ticker) || [];
        // Only use bars up to rebalance date (point-in-time)
        const availableBars = allBars.filter((b) => b.date.split("T")[0] <= rebalanceDate);
        if (availableBars.length < 60) continue;

        const currentPrice = availableBars[availableBars.length - 1].close;
        if (currentPrice <= 0) continue;

        const fv = buildFeatures(ticker, availableBars, null);
        featureVectors.set(ticker, fv);
        forecasts.push(backtestForecast(ticker, currentPrice, fv, horizon));
      }

      if (forecasts.length < topN) continue;

      // Rank and select top N
      const ranked = rankStocks(forecasts, featureVectors, rankMode, strategy);
      const portfolio = ranked.slice(0, topN);

      // Calculate actual forward returns
      let portfolioReturn = 0;
      let benchmarkReturn = 0;
      let validPicks = 0;

      for (const stock of portfolio) {
        const entryPrice = priceLookup.get(`${stock.ticker}:${rebalanceDate}`);
        const exitPrice = priceLookup.get(`${stock.ticker}:${forwardDate}`);
        if (entryPrice && exitPrice && entryPrice > 0) {
          const ret = (exitPrice - entryPrice) / entryPrice;
          portfolioReturn += ret;
          validPicks++;
          if (ret > 0) wins++;
          else losses++;
          totalTrades++;
        }
      }

      // Equal-weight portfolio return
      if (validPicks > 0) {
        portfolioReturn /= validPicks;
      }

      // Benchmark: equal-weight all stocks
      let benchPicks = 0;
      for (const ticker of backtestUniverse) {
        const entryPrice = priceLookup.get(`${ticker}:${rebalanceDate}`);
        const exitPrice = priceLookup.get(`${ticker}:${forwardDate}`);
        if (entryPrice && exitPrice && entryPrice > 0) {
          benchmarkReturn += (exitPrice - entryPrice) / entryPrice;
          benchPicks++;
        }
      }
      if (benchPicks > 0) benchmarkReturn /= benchPicks;

      // Apply transaction costs
      const txCost = (txCostBps / 10000) * 2; // Buy + sell
      portfolioReturn -= txCost;

      portfolioValue *= (1 + portfolioReturn);
      benchmarkValue *= (1 + benchmarkReturn);
      periodReturns.push(portfolioReturn);

      // Track drawdown
      if (portfolioValue > peak) peak = portfolioValue;
      const dd = (peak - portfolioValue) / peak;
      if (dd > maxDrawdown) maxDrawdown = dd;

      equity.push({
        date: rebalanceDate,
        value: +portfolioValue.toFixed(2),
        benchmark: +benchmarkValue.toFixed(2),
      });
    }

    // Calculate metrics
    const totalReturn = (portfolioValue - 10000) / 10000;
    const years = sortedDates.length / 252;
    const annualizedReturn = years > 0 ? Math.pow(1 + totalReturn, 1 / years) - 1 : 0;

    // Sharpe from period returns
    const avgReturn = periodReturns.length > 0
      ? periodReturns.reduce((a, b) => a + b, 0) / periodReturns.length
      : 0;
    const retVar = periodReturns.length > 1
      ? periodReturns.reduce((a, b) => a + (b - avgReturn) ** 2, 0) / (periodReturns.length - 1)
      : 1;
    const retStd = Math.sqrt(retVar);
    const periodsPerYear = 252 / (rebalanceDays || 5);
    const sharpe = retStd > 0 ? (avgReturn * periodsPerYear) / (retStd * Math.sqrt(periodsPerYear)) : 0;

    const winRate = totalTrades > 0 ? wins / totalTrades : 0;

    const result: BacktestResult = {
      startDate: sortedDates[warmupDays] || startDate.toISOString().split("T")[0],
      endDate: sortedDates[sortedDates.length - 1] || endDate.toISOString().split("T")[0],
      totalReturn: +totalReturn.toFixed(4),
      annualizedReturn: +annualizedReturn.toFixed(4),
      sharpe: +sharpe.toFixed(2),
      maxDrawdown: +maxDrawdown.toFixed(4),
      winRate: +winRate.toFixed(3),
      totalTrades,
      equity,
    };

    return NextResponse.json({ data: result });
  } catch (err) {
    console.error("Backtest error:", err);
    return NextResponse.json({ error: "Backtest failed" }, { status: 500 });
  }
}
