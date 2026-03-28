import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import {
  runExhaustiveChunk,
  getExhaustiveMetrics,
  getExhaustiveTimeSeries,
  listExhaustiveRuns,
} from "@/lib/services/exhaustive-backtest";
import { prisma } from "@/lib/prisma";

export const maxDuration = 60;

/**
 * POST — Run one chunk of the exhaustive backtest (or start a new run)
 * Body: { runId?: string, lookbackYears?: number, daysPerChunk?: number }
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const result = await runExhaustiveChunk({
      runId: body.runId,
      lookbackYears: body.lookbackYears ?? 5,
      daysPerChunk: body.daysPerChunk ?? 3,
    });
    return NextResponse.json({ data: result });
  } catch (err) {
    console.error("[exhaustive-backtest] POST error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}

/**
 * GET — Fetch results: runs list, aggregate metrics, or time series
 * ?action=runs                         — list all runs
 * ?action=metrics&runId=xxx            — aggregate metrics for a run
 * ?action=timeseries&runId=xxx&strategy=swing&horizon=1M  — daily time series
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const action = searchParams.get("action") || "runs";

  try {
    switch (action) {
      case "runs": {
        const runs = await listExhaustiveRuns();
        return NextResponse.json({ data: runs });
      }
      case "metrics": {
        const runId = searchParams.get("runId");
        if (!runId) return NextResponse.json({ error: "runId required" }, { status: 400 });
        const metrics = await getExhaustiveMetrics(runId);
        return NextResponse.json({ data: metrics });
      }
      case "timeseries": {
        const runId = searchParams.get("runId");
        const strategy = searchParams.get("strategy");
        const horizon = searchParams.get("horizon");
        if (!runId || !strategy || !horizon) {
          return NextResponse.json({ error: "runId, strategy, horizon required" }, { status: 400 });
        }
        const series = await getExhaustiveTimeSeries(runId, strategy, horizon);
        return NextResponse.json({ data: series });
      }
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    console.error("[exhaustive-backtest] GET error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}

/**
 * DELETE — Delete a run and all its results
 * Body: { runId: string }
 */
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const runId = body.runId;
    if (!runId) return NextResponse.json({ error: "runId required" }, { status: 400 });

    // Delete results first (cascade should handle this, but be explicit)
    const deleted = await prisma.exhaustiveBacktestResult.deleteMany({
      where: { runId },
    });
    await prisma.exhaustiveBacktestRun.delete({
      where: { id: runId },
    });

    return NextResponse.json({ data: { deleted: deleted.count, runId } });
  } catch (err) {
    console.error("[exhaustive-backtest] DELETE error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
