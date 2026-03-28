/**
 * Shared Forecast Generation Module
 *
 * Single source of truth for generating quantile forecasts.
 * Used by both pipeline.ts (live predictions) and backtest-engine.ts (validation).
 *
 * Signal architecture:
 *   1. Momentum (multi-horizon, sqrt-scaled)
 *   2. Mean reversion (regime-aware)
 *   3. RSI (contrarian oscillator)
 *   4. Trend (continuous SMA-based)
 *   5. Value / Fundamentals (PE, DCF, PB)
 *   6. Sentiment & News
 *   7. Analyst consensus & price targets
 *   8. Insider trading
 *   9. Earnings momentum
 *  10. Macro environment
 */

import type { Horizon, QuantileForecast, FeatureVector } from "@/types";

// ─── Constants ───────────────────────────────────────────────────────
export const HORIZON_DAYS: Record<Horizon, number> = {
  "1D": 1, "1W": 5, "1M": 21, "3M": 63, "6M": 126,
};

/** Features to z-score across the universe before ranking */
export const Z_SCORE_KEYS = [
  "return_5d", "return_20d", "return_60d",
  "rsi_14", "volatility_20d", "mean_reversion_z",
  "pe", "pb", "dcf_upside", "roe", "revenue_growth",
  "avg_sentiment", "volume_ratio",
  "analyst_consensus", "target_upside",
  "insider_mspr",
];

// ─── Cross-Sectional Z-Score Normalization ──────────────────────────
/**
 * For each feature key, compute mean/std across all tickers in the universe,
 * then add a `z_{key}` feature with the winsorized z-score (±3).
 *
 * This ensures ranking reflects RELATIVE position, not absolute scale.
 * e.g., a PE of 15 means nothing alone — but being 2σ below universe mean does.
 */
export function crossSectionalZScore(
  featureVectors: Map<string, FeatureVector>,
  keysToNormalize: string[] = Z_SCORE_KEYS,
): void {
  const tickers = [...featureVectors.keys()];
  if (tickers.length < 5) return; // Need a minimum universe

  for (const key of keysToNormalize) {
    // Collect non-null, finite values
    const vals: { ticker: string; val: number }[] = [];
    for (const ticker of tickers) {
      const fv = featureVectors.get(ticker)!;
      const v = fv.features[key];
      if (v != null && isFinite(v) && v !== 0) vals.push({ ticker, val: v });
    }
    if (vals.length < 5) continue;

    const mean = vals.reduce((s, v) => s + v.val, 0) / vals.length;
    const variance = vals.reduce((s, v) => s + (v.val - mean) ** 2, 0) / vals.length;
    const std = Math.sqrt(variance);
    if (std < 1e-10) continue;

    // Write z-score (winsorized at ±3) as z_{key}
    for (const { ticker, val } of vals) {
      const fv = featureVectors.get(ticker)!;
      fv.features[`z_${key}`] = Math.max(-3, Math.min(3, (val - mean) / std));
    }
  }
}

// ─── Forecast Generation ────────────────────────────────────────────
/**
 * Generate a quantile forecast for a single stock.
 *
 * Key design principles:
 *   - Momentum returns are PERIOD returns, not annualized → no `* (days/252)` scaling
 *   - Each signal is independently scaled to the forecast horizon via sqrt(time)
 *   - No systematic bias (removed golden cross penalty)
 *   - Confidence based on signal-to-noise, not just volatility
 *   - All available data sources contribute to the composite signal
 */
export function generateForecast(
  ticker: string,
  name: string,
  sector: string,
  currentPrice: number,
  features: FeatureVector,
  horizon: Horizon,
): QuantileForecast {
  const f = features.features;
  const days = HORIZON_DAYS[horizon];

  // ─── SIGNAL 1: Momentum (properly scaled) ────────────────────
  // return_Xd are fractional period returns (e.g., 0.05 = +5%).
  // Scale to forecast horizon via sqrt(time) ratio.
  const mom5d  = (f.return_5d  || 0) * Math.sqrt(days / 5)  * 0.25;
  const mom20d = (f.return_20d || 0) * Math.sqrt(days / 20) * 0.50;
  const mom60d = (f.return_60d || 0) * Math.sqrt(days / 60) * 0.25;
  const momentumSignal = mom5d + mom20d + mom60d;

  // ─── SIGNAL 2: Mean Reversion (regime-aware) ─────────────────
  // Only apply strongly when momentum is weak (sideways market).
  // When trending, reduce MRZ to avoid fighting the trend.
  const mrzRaw = f.mean_reversion_z ?? 0;
  const absMomentum = Math.abs(f.return_20d || 0);
  const mrzWeight = absMomentum < 0.03 ? 1.0 : 0.2; // Reduce when trending
  const meanReversionSignal = -mrzRaw * 0.01 * Math.sqrt(days / 21) * mrzWeight;

  // ─── SIGNAL 3: RSI (contrarian oscillator) ───────────────────
  // RSI 30 → bullish (+1% signal), RSI 70 → bearish (-1% signal)
  const rsiVal = f.av_rsi_14 ?? f.rsi_14 ?? 50;
  const rsiSignal = ((50 - rsiVal) / 100) * 0.05 * Math.sqrt(days / 5);

  // ─── SIGNAL 4: Trend (continuous, no bias) ───────────────────
  // Use price vs SMA50 — positive when above, negative when below.
  // Replaced golden_cross penalty which created systematic bearish bias.
  const trendSignal = (f.price_vs_sma50 ?? 0) * 0.15 * Math.sqrt(days / 21);

  // ─── SIGNAL 5: Value / Fundamentals ──────────────────────────
  // Continuous value signal centered at market median PE (~22)
  const pe = f.pe || 0;
  const peMissing = f._pe_missing === 1 || pe === 0;
  const valueSignal = peMissing ? 0 : Math.max(-0.03, Math.min(0.03,
    ((22 - pe) / 100) * Math.sqrt(days / 21),
  ));

  // DCF upside from fundamental model
  const dcfSignal = f.dcf_upside != null
    ? Math.max(-0.03, Math.min(0.03, f.dcf_upside * 0.10 * Math.sqrt(days / 21)))
    : 0;

  // ROE quality premium
  const roeSignal = f.roe != null && f.roe > 0
    ? Math.min(0.01, f.roe * 0.03) * Math.sqrt(days / 63)
    : 0;

  // ─── SIGNAL 6: Sentiment & News ──────────────────────────────
  const sentimentSignal = (f.avg_sentiment ?? 0) * 0.03 * Math.sqrt(days / 5);
  // Bullish/bearish ratio adds conviction
  const bullBearRatio = (f.bullish_ratio ?? 0.5) - (f.bearish_ratio ?? 0.5);
  const sentimentConviction = bullBearRatio * 0.01 * Math.sqrt(days / 5);

  // ─── SIGNAL 7: Analyst Consensus & Price Targets ─────────────
  let analystSignal = 0;
  if (f.analyst_consensus != null) {
    analystSignal += f.analyst_consensus * 0.02;
  }
  if (f.target_upside != null) {
    // Analyst price target upside, capped and scaled for longer horizons
    analystSignal += Math.max(-0.03, Math.min(0.03,
      f.target_upside * 0.08,
    )) * Math.sqrt(days / 63);
  }

  // ─── SIGNAL 8: Insider Trading ───────────────────────────────
  let insiderSignal = 0;
  if (f.insider_mspr != null) {
    insiderSignal += (f.insider_mspr / 100) * 0.04;
  }
  if (f.insider_cluster === 1) {
    insiderSignal += 0.03; // Cluster buying is a strong bullish signal
  }
  if (f.insider_buy_ratio != null && f.insider_buy_ratio > 0.8) {
    insiderSignal += 0.01; // Very high insider buy ratio
  }
  insiderSignal *= Math.sqrt(days / 21);

  // ─── SIGNAL 9: Earnings Momentum ─────────────────────────────
  let earningsSignal = 0;
  if (f.last_earnings_surprise != null) {
    earningsSignal += f.last_earnings_surprise * 0.003 * Math.sqrt(days / 5);
  }
  if (f.earnings_beat === 1) {
    earningsSignal += 0.005 * Math.sqrt(days / 5);
  }

  // ─── SIGNAL 10: Macro Environment ────────────────────────────
  let macroSignal = 0;
  if (f.fed_rate != null && f.cpi_yoy != null) {
    // Tight monetary policy + high inflation = headwind
    if (f.fed_rate > 4 && f.cpi_yoy > 3) macroSignal = -0.005;
    else if (f.fed_rate < 2) macroSignal = 0.005;
  }
  macroSignal *= Math.sqrt(days / 21);

  // ─── ADX trend strength multiplier ───────────────────────────
  // When ADX > 25, the stock is in a strong trend → amplify momentum signals
  const adxMultiplier = f.adx != null && f.adx > 25 ? 1.15 : 1.0;

  // ─── COMPOSITE: Expected period return ───────────────────────
  // Sum of all signals, amplified by trend strength.
  // NOTE: No `* (days/252)` — each signal is already horizon-scaled.
  const periodReturn = (
    momentumSignal +
    meanReversionSignal +
    rsiSignal +
    trendSignal +
    valueSignal + dcfSignal + roeSignal +
    sentimentSignal + sentimentConviction +
    analystSignal +
    insiderSignal +
    earningsSignal +
    macroSignal
  ) * adxMultiplier;

  // ─── VOLATILITY ENVELOPE ─────────────────────────────────────
  const annualVol = f.volatility_20d || 0.25;
  let earningsVolBoost = 1.0;
  if (f.earnings_imminent === 1) earningsVolBoost = 1.5;
  const periodVol = (annualVol / Math.sqrt(252)) * Math.sqrt(days) * earningsVolBoost;

  // Quantile prices
  const pMid = currentPrice * (1 + periodReturn);
  const pLow = currentPrice * (1 + periodReturn - 1.28 * periodVol);
  const pHigh = currentPrice * (1 + periodReturn + 1.28 * periodVol);

  // ─── CONFIDENCE (signal-to-noise based) ──────────────────────
  // High confidence = strong signal relative to noise + good data quality.
  // No longer penalizes volatile stocks — only penalizes WEAK signals.
  const signalToNoise = periodVol > 0
    ? Math.min(Math.abs(periodReturn) / periodVol, 1.0)
    : 0.5;
  const featureCount = Object.keys(f).filter((k) => !k.startsWith("_") && !k.startsWith("z_")).length;
  const dataConfidence = Math.min(featureCount / 30, 1);
  const hasFullData = f._has_60d_data === 1 ? 0.10 : 0;
  const sentimentConfidence = f.sentiment_strength != null
    ? Math.min(f.sentiment_strength * 0.15, 0.10)
    : 0;

  const confidence = signalToNoise * 0.35 +
    dataConfidence * 0.30 +
    hasFullData +
    sentimentConfidence +
    0.15; // Base confidence

  // ─── Output ──────────────────────────────────────────────────
  const expectedReturn = (pMid - currentPrice) / currentPrice;
  const downside = Math.max(currentPrice - pLow, 0.01);
  const upside = Math.max(pHigh - currentPrice, 0.01);

  return {
    ticker,
    name,
    sector,
    horizon,
    currentPrice: +currentPrice.toFixed(2),
    pLow: +Math.max(pLow, 0.01).toFixed(2),
    pMid: +pMid.toFixed(2),
    pHigh: +pHigh.toFixed(2),
    confidence: +Math.min(Math.max(confidence, 0.10), 0.99).toFixed(3),
    expectedReturn: +expectedReturn.toFixed(4),
    riskReward: +(upside / downside).toFixed(2),
  };
}
