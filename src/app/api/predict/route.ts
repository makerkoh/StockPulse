import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { runPrediction } from "@/lib/services/pipeline";
import { storePredictionRun } from "@/lib/services/persistence";
import type { Horizon, RankMode, Strategy } from "@/types";
import { HORIZONS, RANK_MODES, STRATEGIES } from "@/types";
import { DEFAULT_UNIVERSE, EXTENDED_UNIVERSE } from "@/lib/providers/interfaces";

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

    // API Limited toggle: true = free tier (40 stocks), false = full (100 stocks)
    const apiLimited = body.apiLimited !== false; // Default to limited
    const universe: string[] = Array.isArray(body.universe)
      ? body.universe
      : apiLimited
        ? DEFAULT_UNIVERSE
        : EXTENDED_UNIVERSE;

    const result = await runPrediction(horizon, rankMode, universe, strategy);

    // Persist the run to the database (non-blocking)
    const featureVectors = result.featureVectors || new Map();
    storePredictionRun(
      horizon, rankMode, strategy,
      result.meta.universe,
      result.stocks,
      featureVectors,
      result.meta.isDemo,
    ).then((runId) => {
      if (runId) {
        result.meta.runId = runId;
      }
    }).catch((err) => {
      console.error("Background persistence failed:", err);
    });

    // Don't send featureVectors to client (large, not needed in UI)
    const { featureVectors: _fv, ...clientResult } = result;

    return NextResponse.json({ data: clientResult });
  } catch (err) {
    console.error("Prediction error:", err);
    return NextResponse.json({ error: "Prediction failed" }, { status: 500 });
  }
}
