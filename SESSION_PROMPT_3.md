# StockPulse — Session Continuation Prompt

Copy and paste everything below this line as your opening message in the next Claude session:

---

## Continue building my StockPulse stock intelligence platform MVP

**Repo**: `C:\Users\andri\github\pers_repos\stockpulse` (github.com/makerkoh/StockPulse)
**Live**: https://stock-pulse-makerkoh-3450s-projects.vercel.app (venturekoh.com has DNS issue)
**Stack**: Next.js 14, TypeScript, Tailwind, Prisma, Neon PostgreSQL (Launch plan), Vercel Hobby

---

### Complete Build History (Sessions 1-4)

#### Session 1 (2026-03-20): Foundation & Prediction Model
- Built the core StockPulse platform from scratch
- Prediction model went through 10 iterations, starting at 49.6% directional accuracy (coin flip)
- Found 7 critical flaws: momentum signal attenuated 100x, systematic bearish bias, confidence inverted for volatile stocks, vol bug dividing by price, etc.
- Built shared forecast module (`src/lib/services/forecast.ts`) — single source of truth for pipeline + backtest
- 20+ signal categories: momentum (multi-horizon, volume-confirmed), mean reversion (regime-aware), RSI/MACD/Bollinger, multi-SMA trend alignment, value/DCF/growth, sentiment, analyst, insider, earnings, macro, market regime, momentum acceleration/quality, feature confluence, volatility contraction breakout
- Horizon-adaptive weights: day trade = technicals, long term = fundamentals
- Cross-sectional z-scoring across 16+ features
- Walk-forward adaptive ML model (ridge regression, 30% blend with base model)
- Signal shrinkage (0.7 factor) and magnitude caps per horizon

#### Session 2 (2026-03-28 ~3hrs): Model Validation & Data Infrastructure
- Validated model through Compare page — 3-year walk-forward backtest, 89 stocks, 8 strategy/horizon combos
- Best results: 72.5% directional accuracy (LT/6M), +12.94% excess return (Swing/3M), Sharpe 3.79
- Built DB caching for all data types (prices permanent, fundamentals 24h, news 30min, insider 12h, analyst 24h, earnings 24h)
- Built dynamic stock screening funnel (FMP screener → top 50 by momentum/turnover/beta)
- Built Strategy Comparison page (`/compare`) with equity curves and interpretation guide
- Fixed critical null-safety crash in formatting functions

#### Session 3 (2026-03-28 continued): Exhaustive Backtest Engine
- Built exhaustive daily walk-forward backtest engine — tests EVERY trading day, every stock, every strategy/horizon combo
- Strict point-in-time: on simulated day T, model only sees data available through day T
- Bulk data cache API for batch fetching prices/enrichment for all stocks
- UI at `/exhaustive` with progress tracking, metrics table, time series charts
- Completed 5-year run (1,447 days × 89 stocks × 8 combos = 1,026,264 predictions)
- Hit Neon 512MB free tier limit, DB blocked

#### Session 4 (2026-03-28–29): Data Expansion & Bug Fixes
- Upgraded Neon to Launch plan (pay-as-you-go, ~$3-4/month)
- Fetched 10 years of price data for all 89 stocks via Finnhub (162K → 232,290 price bars, 2016-03-28 to 2026-03-27)
- Fetched enrichment data: insider (89→178), analyst (28→48), earnings (89→178), news (1,554→2,302)
- **Fixed Rank IC bug**: was hardcoded to 0.000, now computes proper Spearman rank correlation per-day using SQL window functions
- Changed exhaustive backtest lookback from 5yr to 8yr (uses 10yr price data minus 2yr for feature computation)
- Started 8-year exhaustive backtest run (will produce ~2,300 days × 89 stocks × 8 combos ≈ 1.6M+ predictions)

### Current State of Data

| Data Type | Count | Coverage |
|---|---|---|
| Price Bars | 232,290 | 89 stocks, 10 years (2016-03-28 to 2026-03-27) |
| Fundamentals | 89 | Current snapshot only (FMP daily limit prevents more) |
| Insider Trading | 178 | 89 stocks, current data |
| Analyst Ratings | 48 | ~48 stocks (some have no coverage) |
| Earnings Data | 178 | 89 stocks, current data |
| News Articles | 2,302 | 89 stocks, recent articles |

### Exhaustive Backtest Results (5-Year Run, Completed)

128,783 predictions per combo (1,447 days × ~89 stocks):

| Combo | Dir. Accuracy | Interval Coverage | Rank IC | Top-10 Return | Excess Return |
|---|---|---|---|---|---|
| Long Term / 6 Months | +57.0% | +76.1% | 0.030 | +5.62% | +0.78% |
| Long Term / 3 Months | +55.8% | +82.0% | 0.026 | +2.67% | +0.25% |
| Swing / 3 Months | +55.8% | +82.0% | 0.026 | +2.54% | +0.13% |
| Long Term / 1 Month | +53.6% | +81.3% | 0.017 | +1.04% | +0.24% |
| Swing / 1 Month | +53.6% | +81.3% | 0.017 | +1.01% | +0.21% |
| Day Trade / 1 Week | +51.6% | +75.9% | 0.004 | +0.25% | +0.06% |
| Swing / 1 Week | +51.6% | +75.9% | 0.004 | +0.25% | +0.06% |
| Day Trade / 1 Day | +50.4% | +72.8% | -0.025 | +0.04% | -0.00% |

**Key insights**: Longer horizons have higher Rank IC and better directional accuracy. Day trading is essentially coin-flip. The model's fundamental + momentum signals work best over 1-6 month horizons.

### Model Architecture (v8 — Proven Baseline)

**Signal Generation** (`src/lib/services/forecast.ts`):
- 20+ signal categories with horizon-adaptive weighting
- Cross-sectional z-scoring across 16+ features for each prediction day
- Market regime detection (breadth, dispersion, avg RSI)
- Signal shrinkage (0.7 factor) to reduce overconfidence

**Adaptive ML** (`src/lib/services/adaptive-model.ts`):
- Walk-forward ridge regression (pure TypeScript, no ML libraries)
- Learns from past backtest periods — no look-ahead bias
- 30% blend with base model (40% caused overfitting, reverted)
- Lambda=10 regularization (5 too aggressive, reverted)

**Exhaustive Backtest** (`src/lib/services/exhaustive-backtest.ts`):
- Daily walk-forward: for each trading day T, uses ONLY data available through T
- Generates predictions for all stocks × all strategy/horizon combos
- Computes actual returns at T+horizon and compares to predictions
- Stores: predicted return, actual return, P10/P50/P90 intervals, rank, direction correct, within interval
- Metrics computed via SQL: directional accuracy, interval coverage, Rank IC (Spearman per-day averaged), top-10 vs universe returns

**Data Pipeline** (`src/lib/services/data-cache.ts`):
- Prices: permanent DB cache, only fetches new days from API
- Fundamentals: 24h TTL via FMP
- News: 30min TTL, auto-delete after 7 days
- Insider/Analyst/Earnings: 12-24h TTL via Finnhub
- All cached in Neon PostgreSQL, zero API calls for repeat queries
- Provider priority: Finnhub first for prices (60/min, no daily cap), FMP first for fundamentals

### Key Architecture Files

| File | Purpose |
|---|---|
| `src/lib/services/forecast.ts` | Shared forecast generation, z-scoring, market signals, horizon-adaptive weights |
| `src/lib/services/adaptive-model.ts` | Walk-forward ridge regression (pure TypeScript) |
| `src/lib/services/exhaustive-backtest.ts` | Daily walk-forward exhaustive backtest engine + metrics |
| `src/lib/services/backtest-engine.ts` | Original walk-forward backtest (periodic rebalancing) |
| `src/lib/services/pipeline.ts` | Live prediction pipeline (2-pass: batch all → enrich top 10) |
| `src/lib/services/scoring.ts` | Strategy-specific ranking with z-score components |
| `src/lib/services/features.ts` | 50+ feature computation from price bars + fundamentals |
| `src/lib/services/data-cache.ts` | DB cache for prices, fundamentals, news, insider, analyst, earnings |
| `src/lib/services/screener.ts` | Dynamic stock screening funnel (FMP screener + Finnhub scan) |
| `src/lib/providers/aggregated.ts` | Multi-provider data aggregation (Finnhub → FMP → Demo fallback) |
| `src/app/api/exhaustive-backtest/route.ts` | Exhaustive backtest API (chunked processing) |
| `src/app/api/bulk-cache/route.ts` | Bulk data caching API (prices, fundamentals, enrichment) |
| `src/app/api/predict/route.ts` | Live prediction API |
| `src/app/api/screen/route.ts` | Stock screening API |
| `src/app/(app)/exhaustive/page.tsx` | Exhaustive backtest UI (progress, metrics, charts) |
| `src/app/(app)/compare/page.tsx` | Strategy comparison UI (equity curves, winner cards) |
| `prisma/schema.prisma` | DB schema: ExhaustiveBacktestResult, ScreenedStock, InsiderTrade, AnalystRating, EarningsInfo, etc. |

### What Was Tested and Reverted (Don't Repeat)
- Adaptive ML blend 40% → overfitting → reverted to 30%
- Ridge lambda 5 → too aggressive → reverted to 10
- Relative strength signal in base forecast → improved directional accuracy to 76.3% but destroyed rank IC from +0.137 to +0.008 and excess return from +12.94% to +5.40% → disabled in base model, kept for ML

### API Keys & Rate Limits
- **FMP** (free tier): 250 calls/day — used for fundamentals, stock screener, IPOs
- **Finnhub** (free tier): 60 calls/min, no daily cap — used for prices, insider, analyst, earnings, news
- **Alpha Vantage** (free tier): 25 calls/day — used for technical indicators, economic data
- All keys stored in Neon PostgreSQL `ApiKey` table, configured via `/settings` page

### Infrastructure
- **Neon PostgreSQL**: Launch plan (pay-as-you-go, ~$3-4/month). Currently ~1.5GB storage.
- **Vercel Hobby**: 60-second function timeout. Backtests must be chunked (3 days per API call).
- **Plan**: Eventually export all data to local PostgreSQL and cancel Neon. Change `DATABASE_URL` env var in Vercel.

### Priority Next Steps

**1. Complete 8-Year Exhaustive Backtest** (may be running or needs to be started)
- Should produce ~2,300 days × 89 stocks × 8 combos ≈ 1.6M predictions
- Runs autonomously in browser, ~3 days per chunk, ~800 chunks total
- Check `/exhaustive` page for current progress

**2. Expand to 500 Stocks (tomorrow when FMP resets)**
- "Discover 500 Stocks" button on `/exhaustive` page (uses 1 FMP call)
- Then "Fetch Prices (All)" → Finnhub, 500 stocks in ~8 min
- Then "Fetch Enrichment" → Finnhub, 500 stocks in ~30 min
- FMP fundamentals trickle in at 250/day (2 days for 500 stocks)

**3. Offline ML Training (biggest accuracy improvement)**
- Export (features, actual_returns) training data as CSV from backtest results
- Train XGBoost/LightGBM in Python on the 50+ features
- Walk-forward cross-validation to avoid look-ahead bias
- Could push directional accuracy from ~57% to 65%+

**4. Local PostgreSQL Migration**
- `pg_dump` Neon → local PostgreSQL
- Switch app to `DATABASE_URL=postgresql://localhost:5432/stockpulse`
- Cancel Neon Launch plan
- App keeps running locally or point Vercel to cloud VM ($5-6/mo)

**5. Fix venturekoh.com Domain**
- Custom domain returns 404 — likely DNS config issue in Vercel

**6. Historical Sentiment/Insider/Analyst for Better Backtesting**
- Currently backtest only uses price + fundamentals (no historical sentiment/insider)
- Start caching daily snapshots → after months, enables richer backtests

**7. Additional Platform Features**
- Portfolio tracking (user picks stocks, track performance)
- Alerts when predictions change significantly
- Prediction history (past predictions vs actual outcomes)
- Mobile responsive fixes (ForecastTable grid overflows)

### Important Constraints
- Vercel Hobby: 60-second function timeout — backtests MUST be chunked
- Don't break what's working — v8 model is the proven baseline
- Always test changes via Compare page before keeping them
- All formatting functions are null-safe (fixed crash with null API data)
- No trading on weekends — market data APIs return nothing
- `prisma db push` runs automatically on every Vercel build
