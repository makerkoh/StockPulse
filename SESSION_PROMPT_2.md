# StockPulse — Session 3 Prompt (Exhaustive Backtest & Data Infrastructure)

Copy and paste everything below this line as your opening message in the next Claude session:

---

## Continue building my StockPulse stock intelligence platform
**Repo**: `C:\Users\andri\github\pers_repos\stockpulse` (github.com/makerkoh/StockPulse)
**Live**: https://stock-pulse-makerkoh-3450s-projects.vercel.app
**Stack**: Next.js 14, TypeScript, Tailwind, Prisma, Neon PostgreSQL (Launch plan), Vercel Hobby

---

### What Was Built (Session 2 — 2026-03-28)

See `SESSION_PROMPT.md` for full details. Key points:
- Prediction model with 20+ signal categories, 72.5% directional accuracy
- Walk-forward adaptive ML (ridge regression), 30% blend
- 8 strategy/horizon combos all profitable over 3-year backtest
- Dynamic stock screening, DB caching for all data types
- Strategy Comparison page, API limit warnings, null-safe formatting

---

### What Was Built (Session 3 — 2026-03-28, continued)

#### 1. Exhaustive Daily Walk-Forward Backtest Engine

**The Problem**: The original backtest only tested at rebalance points (every N days). We needed to test the prediction model on EVERY trading day — strict point-in-time, only using data available on that simulated day.

**What Was Built**:
- `src/lib/services/exhaustive-backtest.ts` — Core engine
  - For every trading day T in the historical window:
    - Builds features using ONLY price bars up to day T
    - Queries enrichment data (fundamentals, insider, analyst, earnings, sentiment) using most recent DB snapshot ON OR BEFORE day T
    - Runs all 8 strategy/horizon combos through the full pipeline (z-scoring, market signals, adaptive ML blend, ranking)
    - Compares each prediction to actual outcome at T+1D/1W/1M/3M/6M
  - Chunked execution: 3 days per API call (fits Vercel 60s timeout)
  - Resumable: saves progress, can stop/resume anytime
  - Aggregation queries for metrics and time series
  - Point-in-time enrichment lookups are FUTURE-PROOF: as you cache more historical data, backtest accuracy automatically improves without code changes

- `src/app/api/exhaustive-backtest/route.ts` — API route
  - POST: run chunks or start new run
  - GET: list runs, aggregate metrics, daily time series
  - DELETE: delete a run and all its results

- `src/app/(app)/exhaustive/page.tsx` — UI page at `/exhaustive`
  - Start/Resume/Stop controls
  - Progress bar with day count and date
  - Results table: directional accuracy, interval coverage, rank IC, excess return per combo
  - Click any row for daily time series chart (20-day rolling accuracy + cumulative returns)
  - Cache stats panel with fetch buttons

- `prisma/schema.prisma` — New models:
  - `ExhaustiveBacktestRun` (tracks run progress)
  - `ExhaustiveBacktestResult` (one row per date/ticker/strategy/horizon prediction)

- Navigation: "Full Backtest" added to sidebar

#### 2. Bulk Data Cache API

**The Problem**: Only had ~1.5 years of price history cached. Needed 7+ years for meaningful backtesting across market regimes.

**What Was Built**:
- `src/app/api/bulk-cache/route.ts` — Bulk fetch endpoint
  - POST: fetch prices (7yr backfill), fundamentals, enrichment (insider/analyst/earnings/news) for entire universe
  - GET: returns cache stats (total bars, date range, enrichment counts)
  - Chunked: 5 tickers/call for prices, 3 tickers/call for "all" mode
  - Price backfill logic: checks oldest cached date, fetches backward gap to requested start date
  - Handles rate limits gracefully (Finnhub 60/min, FMP 250/day)

- UI integration on exhaustive page:
  - Cache stats panel showing price bars, fundamentals, enrichment, news counts
  - "Fetch Prices (7yr)", "Fetch Enrichment", "Fetch All Data" buttons
  - Progress bar for bulk fetch operations

#### 3. Bug Fixes
- Fixed combo label split: `long_term_6M` was splitting on `_` breaking "long_term" — changed to `||` delimiter
- All labels now correctly show "Long Term / 6 Months", "Day Trade / 1 Day", etc.

---

### Current Data State

| Data Type | Count | Range |
|---|---|---|
| Price Bars | 162,603 | 2019-03-28 to 2026-03-27 (7 years) |
| Fundamentals | 89 | All 89 stocks (current snapshot) |
| Enrichment | 188 | 80 insider / 28 analyst / 80 earnings |
| News Articles | 806 | Recent articles with sentiment |
| Stocks | 89 | EXTENDED_UNIVERSE |

### Exhaustive Backtest Runs

1. **Run 1 (completed)**: 394/394 days, 27,346 predictions per combo — NEEDS DELETION (uses old limited data)
2. **Run 2 (stuck at 93.4%)**: 1,353/1,447 days — hit Neon 512MB free tier storage limit. Needs resume after DB upgrade.

### First Run Results (394 days, limited data):

| Combo | Dir. Accuracy | Interval Coverage | Rank IC | Excess Return |
|---|---|---|---|---|
| Long Term / 6 Months | 62.9% | 82.4% | 0.020 | +0.23% |
| Long Term / 1 Month | 54.8% | 83.0% | 0.025 | +0.09% |
| Swing / 1 Month | 54.8% | 83.0% | 0.025 | +0.06% |
| Day Trade / 1 Day | 50.6% | 73.0% | -0.003 | -0.01% |
| Swing / 1 Week | 52.2% | 76.5% | 0.008 | -0.02% |
| Day Trade / 1 Week | 52.2% | 76.5% | 0.008 | -0.04% |
| Long Term / 3 Months | 58.6% | 84.9% | 0.003 | -0.20% |
| Swing / 3 Months | 58.6% | 84.9% | 0.003 | -0.42% |

Key takeaway: Longer horizons show better directional accuracy (62.9% for 6M) and interval calibration (82-85%). Short-term day trading is near coin-flip. This aligns with the model's design (fundamentals matter more for longer horizons).

---

### Database Situation

**Neon PostgreSQL hit the free tier limits:**
- Storage: 1.12 GB used / 0.5 GB limit (2x over)
- Network transfer: 12.59 GB used / 5 GB limit (2.5x over)
- DB compute won't start — completely blocked

**Immediate action needed**: Upgrade Neon to Launch plan (pay-as-you-go, ~$3-4/month)

---

### Plan Going Forward

#### Phase 1 — Unblock & Finish Current Run
1. Upgrade Neon to Launch plan (~$4/month)
2. Delete old 394-day run via SQL Editor to free space
3. Resume the 93%-complete 1,447-day run
4. Review full 5-year results

#### Phase 2 — Full 10-Year, 500-Stock Data Collection
5. Expand stock universe to ~500 liquid US stocks (use FMP screener)
6. Fetch 10 years of daily price history for all 500 stocks
7. Fetch fundamentals (quarterly history if available via FMP)
8. Fetch insider, analyst, earnings, news for all 500
9. Consider upgrading FMP to Starter ($14/mo) for faster bulk fetch, or use free tier over multiple days

#### Phase 3 — Ultimate Exhaustive Backtest
10. Run exhaustive backtest: 500 stocks × ~2,400 days × 8 combos = ~9.6M predictions
11. Full results across: COVID crash (2020), 2021 bull, 2022 bear, 2023-2026 recovery
12. Analyze which combos work in which market regimes
13. Use results to identify model weaknesses and improve signals

#### Phase 4 — Self-Hosted Migration
14. Export entire Neon DB via `pg_dump`
15. Set up local PostgreSQL (or $5/mo cloud VM)
16. Switch app to local DB (`DATABASE_URL` change)
17. Cancel Neon — back to $0/month for DB
18. App only fetches "today forward" data going forward (minimal API calls)

#### Phase 5 — Model Improvements (based on exhaustive results)
19. Identify which signals are predictive vs noise across 10 years
20. Potentially train XGBoost/LightGBM on the 9.6M datapoints
21. Optimize signal weights per market regime
22. Push directional accuracy from ~60% toward 70-80%

---

### Key Architecture Files
- `src/lib/services/exhaustive-backtest.ts` — Exhaustive daily walk-forward engine + point-in-time enrichment lookups
- `src/lib/services/forecast.ts` — Shared forecast generation (20+ signals, horizon-adaptive weights)
- `src/lib/services/adaptive-model.ts` — Walk-forward ridge regression
- `src/lib/services/backtest-engine.ts` — Original rebalance-based backtest
- `src/lib/services/pipeline.ts` — Live prediction pipeline
- `src/lib/services/scoring.ts` — Strategy-specific ranking
- `src/lib/services/features.ts` — 50+ feature computation
- `src/lib/services/data-cache.ts` — DB cache for all data types
- `src/lib/services/screener.ts` — Dynamic stock screening
- `src/app/api/exhaustive-backtest/route.ts` — Exhaustive backtest API (POST/GET/DELETE)
- `src/app/api/bulk-cache/route.ts` — Bulk data fetch API
- `src/app/(app)/exhaustive/page.tsx` — Exhaustive backtest UI
- `prisma/schema.prisma` — Full DB schema including ExhaustiveBacktestRun/Result

### Important Constraints
- Vercel Hobby: 60-second function timeout (backtests must chunk)
- Neon Launch: pay-as-you-go (~$3-4/month at current usage)
- FMP Free: 250 calls/day (bottleneck for 500-stock fetch)
- Finnhub Free: 60 calls/min (better for bulk enrichment)
- All backtest data is DB-cached — zero API calls for repeat runs
- Exhaustive backtest engine is future-proof: automatically uses historical enrichment data as it accumulates
- Don't break the v8 prediction model — it's the proven baseline

### API Keys (configured in /settings page)
- FMP, Finnhub, Alpha Vantage — all free tier currently
- Stored in Neon PostgreSQL ApiKey table
