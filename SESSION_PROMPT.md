# StockPulse — Next Session Prompt

Copy and paste everything below this line as your opening message in the next Claude session:

---

## Continue building my StockPulse stock intelligence platform MVP

**Repo**: `C:\Users\andri\github\pers_repos\stockpulse` (github.com/makerkoh/StockPulse)
**Live**: https://stock-pulse-makerkoh-3450s-projects.vercel.app (venturekoh.com has DNS issue)
**Stack**: Next.js 14, TypeScript, Tailwind, Prisma, Neon PostgreSQL, Vercel Hobby

### What Was Built (2026-03-28 session — ~3 hours)

**Prediction Model (10 iterations, all tested & validated):**
- Started at 49.6% directional accuracy (coin flip) with negative rank correlation
- Root cause: 7 critical flaws found (momentum signal attenuated 100x, systematic bearish bias, confidence inverted for volatile stocks, vol bug in scoring dividing by price, etc.)
- Built shared forecast module (`src/lib/services/forecast.ts`) — single source of truth for pipeline + backtest
- 20+ signal categories: momentum (multi-horizon, volume-confirmed), mean reversion (regime-aware), RSI/MACD/Bollinger, multi-SMA trend alignment, value/DCF/growth, sentiment, analyst, insider, earnings, macro, market regime (breadth/dispersion), momentum acceleration, momentum quality, feature confluence, volatility contraction breakout
- Horizon-adaptive weights: day trade = technicals, long term = fundamentals
- Cross-sectional z-scoring across 16+ features
- Walk-forward adaptive ML model (`src/lib/services/adaptive-model.ts`) — ridge regression learns from past periods, 30% blend with base model
- Signal shrinkage (0.7 factor) to reduce P50 forecast error
- Signal magnitude caps per horizon

**Final Model Performance (3-year walk-forward backtest, 89 stocks, 8 strategy/horizon combos):**
- Best directional accuracy: 72.5% (Long Term / 6 Months)
- Best excess return: +12.94% over benchmark (Swing / 3 Months)
- Best total return: +57.17% (Swing / 3 Months)
- 100% win rate for all 3-month combos (24 rebalance periods)
- 91.9% interval coverage (P10-P90 well calibrated)
- Sharpe ratio: 3.79
- All 8 combos profitable, all tested over 3 years including 2022 bear market

**Data Caching (all in PostgreSQL):**
- Prices: permanent cache (only fetches new days from API)
- Fundamentals: 24h TTL
- News: 30min TTL
- Insider trading: 12h TTL (NEW this session)
- Analyst ratings: 24h TTL (NEW)
- Earnings data: 24h TTL (NEW)
- Repeat prediction runs use ~2-5 API calls (vs ~91 first run)
- `prisma db push` runs automatically on every Vercel build

**Dynamic Stock Screening Funnel (built end of session):**
- "Screen Stocks" button on Dashboard triggers FMP stock screener (1 API call)
- Discovers ~500 liquid US stocks ($2B+ market cap, 500K+ volume, NYSE/NASDAQ)
- Scores by momentum, turnover, beta, cap tier — selects top 50
- Stores in ScreenedStock DB table; pipeline auto-uses screened universe
- Falls back to static DEFAULT_UNIVERSE if no screening has been run
- Full Finnhub scan (insider signals for 500 stocks) available as optional background task
- Key files: `src/lib/services/screener.ts`, `src/app/api/screen/route.ts`

**Other UI/UX Built:**
- Strategy Comparison page (`/compare`) — runs all 8 combos, progressive results, equity curve overlay, winner cards, interpretation guide
- Expected Return column added to ForecastTable (was hidden)
- Logout button in sidebar
- API limit warning banner (shows when FMP/AV daily limit reached, explains fallback to Finnhub)
- Updated API call count descriptions
- Null-safe formatting functions (fixed crash when API returns null data)

**Key Architecture Files:**
- `src/lib/services/forecast.ts` — shared forecast generation, z-scoring, market signals, horizon-adaptive weights
- `src/lib/services/adaptive-model.ts` — walk-forward ridge regression (pure TypeScript, no ML libraries)
- `src/lib/services/backtest-engine.ts` — walk-forward backtest + adaptive ML integration
- `src/lib/services/pipeline.ts` — live prediction pipeline (2-pass: batch all → enrich top 10)
- `src/lib/services/scoring.ts` — strategy-specific ranking with z-score components
- `src/lib/services/features.ts` — 50+ feature computation from price bars + fundamentals
- `src/lib/services/data-cache.ts` — DB cache for prices, fundamentals, news, insider, analyst, earnings
- `src/lib/services/screener.ts` — dynamic stock screening funnel (FMP screener + Finnhub scan)
- `src/app/api/screen/route.ts` — screening API endpoint
- `src/app/(app)/compare/page.tsx` — strategy comparison UI
- `prisma/schema.prisma` — includes ScreenedStock, InsiderTrade, AnalystRating, EarningsInfo tables

### What Was Tested and Reverted
- Adaptive ML blend 40% (caused overfitting — reverted to 30%)
- Ridge lambda 5 (too aggressive — reverted to 10)
- Relative strength signal in base forecast (improved directional accuracy to 76.3% but hurt rank IC from +0.137 to +0.008 and excess return from +12.94% to +5.40% — disabled in base model, kept available for ML model to learn from)

### Priority Next Steps

**1. Dynamic Stock Screening — ✅ BUILT, needs testing with live API keys**
The screener is built and deployed but hasn't been validated end-to-end with real
API keys yet. On next session: run "Screen Stocks" → verify 50 stocks selected →
run prediction → verify it uses the screened universe instead of static 40.
If the Finnhub full scan is needed, set up as a scheduled background task.

**2. Offline ML Training (biggest accuracy gain remaining)**
The linear signal model is at its maximum (~72.5% accuracy). The next leap requires nonlinear ML:
- Export the backtest's (features, actual_returns) training data as CSV
- Train XGBoost/LightGBM in Python on the 50+ features
- Do proper train/test/validation split with walk-forward cross-validation
- Export the trained model weights and use them in the TypeScript forecast module
- This could push directional accuracy from 72% to 80%+

**2. S&P 500 Universe (more stocks = better ranking)**
- Add a third API tier with ~500 stocks
- Needs paid FMP API tier (free tier has 250 calls/day limit)
- More stocks = better cross-sectional z-scoring + more robust adaptive ML

**3. Fix venturekoh.com Domain**
- The custom domain returns 404 for all routes
- The Vercel default URL works fine
- Likely a DNS configuration issue in Vercel domain settings

**4. Historical Sentiment/Insider/Analyst for Backtesting**
- Currently the backtest only uses price + fundamentals (no historical sentiment/insider/analyst)
- If we start caching this data daily, after a few months we'll have historical snapshots
- These can then be used in backtests for more accurate validation

**5. Additional Platform Features**
- Portfolio tracking (user picks stocks, track performance)
- Alerts/notifications when predictions change significantly
- Prediction history (show past predictions vs actual outcomes)
- Mobile responsive improvements (ForecastTable grid overflows)

### API Keys (configured in /settings page)
- FMP, Finnhub, Alpha Vantage — all free tier
- Stored in Neon PostgreSQL ApiKey table

### Important Constraints
- Vercel Hobby plan: 60-second function timeout (backtests must complete within this)
- Daily backtests use DEFAULT_UNIVERSE (40 stocks) to avoid timeout
- Weekly+ backtests use EXTENDED_UNIVERSE (89 stocks)
- All backtest data is DB-cached — zero API calls for repeat runs
- Don't break what's working — v8 model is the proven baseline
- Always test changes via the Compare page before keeping them
- All formatting functions are null-safe (fixed crash with null API data)
- No trading on weekends — scheduled tasks run weekdays only

### Bug Fixed at End of Session
- "Application error: client-side exception" when running predictions
- Root cause: `formatNumber()` crashed on null values from API
- Fix: all formatting functions now return "—" for null/undefined/NaN
- Also fixed null-safety on `generatedAt` timestamp and IPO `expectedDate`

---
