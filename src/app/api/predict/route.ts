import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { runPrediction } from "@/lib/services/pipeline";
import type { Horizon, RankMode, Strategy } from "@/types";
import { HORIZONS, RANK_MODES, STRATEGIES } from "@/types";

export const maxDuration = 30;

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
    const universe: string[] | undefined = Array.isArray(body.universe) ? body.universe : undefined;

    const result = await runPrediction(horizon, rankMode, universe, strategy);

    return NextResponse.json({ data: result });
  } catch (err) {
    console.error("Prediction error:", err);
    return NextResponse.json({ error: "Prediction failed" }, { status: 500 });
  }
}
