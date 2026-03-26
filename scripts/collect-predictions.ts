/**
 * Daily Prediction Collection Script
 *
 * Run manually or via cron to:
 * 1. Fetch latest market data for the universe
 * 2. Generate predictions for all horizons
 * 3. Store in database for historical tracking
 * 4. Score past predictions against actual outcomes
 *
 * Usage:
 *   npx ts-node scripts/collect-predictions.ts
 *
 * Or via npm script:
 *   npm run collect
 *
 * Requires DATABASE_URL and at least one API key in .env
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const HORIZONS = ["1W", "1M", "3M"] as const;
const RANK_MODES = ["expected_return", "sharpe", "momentum", "value"] as const;

async function collectPredictions() {
  console.log(`\n📊 StockPulse Daily Collection — ${new Date().toISOString()}`);
  console.log("─".repeat(60));

  // Dynamic import to get the pipeline (requires Next.js env setup)
  const { runPrediction } = await import("../src/lib/services/pipeline");
  const { storePredictionRun } = await import("../src/lib/services/persistence");
  const { isDemo } = await import("../src/lib/providers/registry");

  for (const horizon of HORIZONS) {
    for (const rankMode of RANK_MODES) {
      try {
        console.log(`\n▶ Running ${horizon} / ${rankMode}...`);
        const result = await runPrediction(horizon, rankMode, undefined, "swing");

        const runId = await storePredictionRun(
          horizon, rankMode, "swing",
          result.meta.universe,
          result.stocks,
          result.featureVectors || new Map(),
          isDemo(),
        );

        console.log(`  ✓ Stored run ${runId} — ${result.stocks.length} stocks ranked`);
        console.log(`    Top 3: ${result.stocks.slice(0, 3).map(s => `${s.ticker}(${s.score.toFixed(1)})`).join(", ")}`);
      } catch (err) {
        console.error(`  ✗ Failed: ${err}`);
      }
    }
  }

  // Score past predictions
  console.log("\n📈 Scoring past predictions...");
  await scorePastPredictions();

  console.log("\n✅ Collection complete");
  await prisma.$disconnect();
}

async function scorePastPredictions() {
  // Find runs that are old enough to evaluate (target date has passed)
  const pastRuns = await prisma.forecastRun.findMany({
    where: {
      status: "completed",
      completedAt: { lt: new Date(Date.now() - 7 * 86_400_000) }, // At least 1 week old
    },
    include: {
      forecasts: {
        where: { rank: { lte: 10 } }, // Only score top 10 predictions
        include: { stock: true },
      },
    },
    orderBy: { completedAt: "desc" },
    take: 5, // Score last 5 runs
  });

  if (pastRuns.length === 0) {
    console.log("  No past runs old enough to score yet");
    return;
  }

  for (const run of pastRuns) {
    let correct = 0;
    let total = 0;

    for (const forecast of run.forecasts) {
      // Check if the actual price moved in the predicted direction
      // This would require fetching current price vs predicted pMid
      // For now, just log what we have
      total++;
    }

    console.log(`  Run ${run.id.slice(0, 8)}... (${run.horizon}/${run.rankMode}) — ${total} forecasts to evaluate`);
  }
}

// Run
collectPredictions().catch((err) => {
  console.error("Collection failed:", err);
  process.exit(1);
});
