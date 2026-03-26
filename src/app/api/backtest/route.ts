import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { runRealBacktest, type BacktestConfig, type BacktestOutput } from "@/lib/services/backtest-engine";
import type { Horizon, RankMode, Strategy, BacktestResult } from "@/types";
import { HORIZONS, RANK_MODES, STRATEGIES } from "@/types";

export const maxDuration = 60; // Backtest needs more time

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

    const config: BacktestConfig = {
      horizon,
      rankMode,
      strategy,
      topN: body.topN || 5,
      lookbackMonths: body.lookbackMonths || 6,
      transactionCostBps: body.transactionCostBps || 10,
    };

    const output = await runRealBacktest(config);

    // Map to the UI's BacktestResult format + add validation metrics
    const result: BacktestResult & {
      benchmarkReturn?: number;
      excessReturn?: number;
      directionalAccuracy?: number;
      rankCorrelation?: number;
      intervalCoverage?: number;
      p50MeanError?: number;
    } = {
      startDate: output.startDate,
      endDate: output.endDate,
      totalReturn: +output.totalReturn.toFixed(4),
      annualizedReturn: +output.annualizedReturn.toFixed(4),
      sharpe: +output.sharpe.toFixed(2),
      maxDrawdown: +output.maxDrawdown.toFixed(4),
      winRate: +output.winRate.toFixed(3),
      totalTrades: output.totalTrades,
      equity: output.equity,
      // Validation metrics
      benchmarkReturn: +output.benchmarkTotalReturn.toFixed(4),
      excessReturn: +output.excessReturn.toFixed(4),
      directionalAccuracy: +(output.directionalAccuracy * 100).toFixed(1),
      rankCorrelation: +output.rankCorrelation.toFixed(3),
      intervalCoverage: +(output.intervalCoverage * 100).toFixed(1),
      p50MeanError: +(output.p50MeanError * 100).toFixed(2),
    };

    return NextResponse.json({ data: result });
  } catch (err) {
    console.error("Backtest error:", err);
    const message = err instanceof Error ? err.message : "Backtest failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
