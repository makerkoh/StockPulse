import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { seededRandom } from "@/lib/utils";
import type { BacktestResult, Horizon, RankMode } from "@/types";
import { HORIZONS, RANK_MODES } from "@/types";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const horizon: Horizon = HORIZONS.includes(body.horizon) ? body.horizon : "1M";
    const rankMode: RankMode = RANK_MODES.includes(body.rankMode) ? body.rankMode : "expected_return";

    // Generate realistic backtest simulation
    const rng = seededRandom(horizon + rankMode + "backtest2024");
    const startDate = "2022-01-03";
    const endDate = "2024-12-31";
    const tradingDays = 756; // ~3 years

    // Strategy and benchmark equity curves
    const equity: { date: string; value: number; benchmark: number }[] = [];
    let strategyValue = 10000;
    let benchmarkValue = 10000;

    const strategyDailyReturn = 0.0004 + (rankMode === "sharpe" ? 0.0001 : 0); // slight edge
    const strategyVol = 0.012;
    const benchmarkDailyReturn = 0.0003;
    const benchmarkVol = 0.011;

    const startMs = new Date(startDate).getTime();
    const msPerDay = 86_400_000;
    let dayCount = 0;

    for (let d = 0; d < tradingDays; d++) {
      const dt = new Date(startMs + d * msPerDay * (365 * 3 / tradingDays));
      const dayOfWeek = dt.getDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) continue;

      const sReturn = strategyDailyReturn + (rng() - 0.5) * strategyVol * 2;
      const bReturn = benchmarkDailyReturn + (rng() - 0.5) * benchmarkVol * 2;

      strategyValue *= (1 + sReturn);
      benchmarkValue *= (1 + bReturn);
      dayCount++;

      if (dayCount % 5 === 0) {
        equity.push({
          date: dt.toISOString().split("T")[0],
          value: +strategyValue.toFixed(2),
          benchmark: +benchmarkValue.toFixed(2),
        });
      }
    }

    const totalReturn = (strategyValue - 10000) / 10000;
    const years = 3;
    const annualizedReturn = Math.pow(1 + totalReturn, 1 / years) - 1;

    // Calculate max drawdown from equity curve
    let peak = 10000;
    let maxDrawdown = 0;
    for (const point of equity) {
      if (point.value > peak) peak = point.value;
      const dd = (peak - point.value) / peak;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }

    const result: BacktestResult = {
      startDate,
      endDate,
      totalReturn: +totalReturn.toFixed(4),
      annualizedReturn: +annualizedReturn.toFixed(4),
      sharpe: +(annualizedReturn / (strategyVol * Math.sqrt(252))).toFixed(2),
      maxDrawdown: +maxDrawdown.toFixed(4),
      winRate: +(0.48 + rng() * 0.12).toFixed(3),
      totalTrades: Math.floor(tradingDays / (horizon === "1D" ? 1 : horizon === "1W" ? 5 : 21)),
      equity,
    };

    return NextResponse.json({ data: result });
  } catch (err) {
    console.error("Backtest error:", err);
    return NextResponse.json({ error: "Backtest failed" }, { status: 500 });
  }
}
