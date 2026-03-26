-- Add new columns to Forecast
ALTER TABLE "Forecast" ADD COLUMN IF NOT EXISTS "expectedReturn" DOUBLE PRECISION;
ALTER TABLE "Forecast" ADD COLUMN IF NOT EXISTS "riskReward" DOUBLE PRECISION;
ALTER TABLE "Forecast" ADD COLUMN IF NOT EXISTS "scoreBreakdown" JSONB;

-- Add new columns to ForecastRun
ALTER TABLE "ForecastRun" ADD COLUMN IF NOT EXISTS "strategy" TEXT NOT NULL DEFAULT 'swing';
ALTER TABLE "ForecastRun" ADD COLUMN IF NOT EXISTS "isDemo" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS "ForecastRun_horizon_rankMode_strategy_idx" ON "ForecastRun"("horizon", "rankMode", "strategy");

-- Add FeatureSnapshot table
CREATE TABLE IF NOT EXISTS "FeatureSnapshot" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "features" JSONB NOT NULL,
    CONSTRAINT "FeatureSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "FeatureSnapshot_runId_ticker_key" ON "FeatureSnapshot"("runId", "ticker");
CREATE INDEX IF NOT EXISTS "FeatureSnapshot_runId_idx" ON "FeatureSnapshot"("runId");

ALTER TABLE "FeatureSnapshot" ADD CONSTRAINT "FeatureSnapshot_runId_fkey"
    FOREIGN KEY ("runId") REFERENCES "ForecastRun"("id") ON DELETE CASCADE;
