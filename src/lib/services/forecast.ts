/**
 * Shared Forecast Generation Module — v2
 *
 * Single source of truth for generating quantile forecasts.
 * Used by both pipeline.ts (live predictions) and backtest-engine.ts (validation).
 *
 * v2 improvements over v1:
 *   - Horizon-adaptive signal weights (short-term = technicals, long-term = fundamentals)
 *   - Volume-confirmed momentum (strong volume = amplified signal)
 *   - MACD histogram as trend confirmation
 *   - Bollinger band position for short-term mean reversion
 *   - 52-week position and drawdown signals
 *   - Revenue/earnings growth signals
 *   - Multiple SMA trend signals (SMA20, SMA50, SMA200)
 *   - Signal magnitude cap to prevent unrealistic predictions
 *   - Better calibrated signal coefficients
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
  "pe", "pb", "dcf_upside", "roe", "revenue_growth", "earnings_growth",
  "avg_sentiment", "volume_ratio",
  "analyst_consensus", "target_upside",
  "insider_mspr",
  "bollinger_position", "year_position", "drawdown_from_high",
  "macd_histogram",
];

// ─── Horizon-Adaptive Weight Profiles ───────────────────────────────
// Short-term forecasts should rely on technicals/momentum.
// Long-term forecasts should rely on fundamentals/value/insider.
interface HorizonWeights {
  momentum: number;
  meanReversion: number;
  technicals: number;      // RSI, MACD, Bollinger
  trend: number;           // SMA-based
  value: number;           // PE, DCF, growth
  sentiment: number;
  analyst: number;
  insider: number;
  earnings: number;
  macro: number;
}

const HORIZON_WEIGHTS: Record<Horizon, HorizonWeights> = {
  "1D": {
    momentum: 1.8, meanReversion: 0.8, technicals: 1.5, trend: 0.8,
    value: 0.05, sentiment: 0.6, analyst: 0.05, insider: 0.05,
    earnings: 0.3, macro: 0.0,
  },
  "1W": {
    momentum: 1.5, meanReversion: 0.6, technicals: 1.2, trend: 1.0,
    value: 0.2, sentiment: 0.8, analyst: 0.2, insider: 0.3,
    earnings: 0.5, macro: 0.1,
  },
  "1M": {
    momentum: 1.0, meanReversion: 0.4, technicals: 0.8, trend: 1.0,
    value: 1.0, sentiment: 0.6, analyst: 0.8, insider: 1.0,
    earnings: 0.6, macro: 0.3,
  },
  "3M": {
    momentum: 0.5, meanReversion: 0.2, technicals: 0.3, trend: 0.8,
    value: 1.5, sentiment: 0.3, analyst: 1.2, insider: 1.5,
    earnings: 0.5, macro: 0.5,
  },
  "6M": {
    momentum: 0.3, meanReversion: 0.1, technicals: 0.2, trend: 0.6,
    value: 1.8, sentiment: 0.2, analyst: 1.5, insider: 1.8,
    earnings: 0.4, macro: 0.6,
  },
};

// Max expected return per horizon (cap to prevent unrealistic predictions)
const MAX_PERIOD_RETURN: Record<Horizon, number> = {
  "1D": 0.03,   // ±3% max for a single day
  "1W": 0.08,   // ±8% max for a week
  "1M": 0.15,   // ±15% max for a month
  "3M": 0.25,   // ±25% max for 3 months
  "6M": 0.40,   // ±40% max for 6 months
};

// ─── Cross-Sectional Z-Score Normalization ──────────────────────────
export function crossSectionalZScore(
  featureVectors: Map<string, FeatureVector>,
  keysToNormalize: string[] = Z_SCORE_KEYS,
): void {
  const tickers = [...featureVectors.keys()];
  if (tickers.length < 5) return;

  for (const key of keysToNormalize) {
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

    for (const { ticker, val } of vals) {
      const fv = featureVectors.get(ticker)!;
      fv.features[`z_${key}`] = Math.max(-3, Math.min(3, (val - mean) / std));
    }
  }
}

// ─── Helper: clamp a value ──────────────────────────────────────────
function clamp(val: number, min: number, max: number): number {
  return Math.min(Math.max(val, min), max);
}

// ─── Forecast Generation v2 ─────────────────────────────────────────
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
  const w = HORIZON_WEIGHTS[horizon];
  const sqrtDays = Math.sqrt(days);

  // ─── SIGNAL 1: Momentum (multi-horizon, volume-confirmed) ────
  const mom5d  = (f.return_5d  || 0) * Math.sqrt(days / 5);
  const mom20d = (f.return_20d || 0) * Math.sqrt(days / 20);
  const mom60d = (f.return_60d || 0) * Math.sqrt(days / 60);
  const rawMomentum = mom5d * 0.25 + mom20d * 0.50 + mom60d * 0.25;

  // Volume confirmation: strong volume amplifies momentum, weak dampens it
  const volRatio = f.volume_ratio ?? 1.0;
  const volumeMultiplier = volRatio > 1.5 ? 1.3 : volRatio < 0.5 ? 0.7 : 1.0;
  const momentumSignal = rawMomentum * volumeMultiplier * w.momentum;

  // ─── SIGNAL 2: Mean Reversion (regime-aware) ─────────────────
  const mrzRaw = f.mean_reversion_z ?? 0;
  const absMomentum = Math.abs(f.return_20d || 0);
  const mrzWeight = absMomentum < 0.03 ? 1.0 : absMomentum < 0.08 ? 0.3 : 0.1;
  const meanReversionSignal = -mrzRaw * 0.008 * sqrtDays / Math.sqrt(21) * mrzWeight * w.meanReversion;

  // ─── SIGNAL 3: Technicals (RSI + MACD + Bollinger) ───────────
  // RSI
  const rsiVal = f.av_rsi_14 ?? f.rsi_14 ?? 50;
  const rsiSignal = ((50 - rsiVal) / 100) * 0.04 * sqrtDays / Math.sqrt(5);

  // MACD histogram — positive = bullish trend accelerating
  const macdHist = f.macd_histogram ?? f.av_macd_hist ?? 0;
  const macdSignal = macdHist > 0
    ? Math.min(macdHist / currentPrice * 100, 0.02) * sqrtDays / Math.sqrt(5)
    : Math.max(macdHist / currentPrice * 100, -0.02) * sqrtDays / Math.sqrt(5);

  // Bollinger position (0=at lower band, 1=at upper band, 0.5=at mean)
  // For short-term: overbought (>0.9) is bearish, oversold (<0.1) is bullish
  const bollPos = f.bollinger_position ?? 0.5;
  const bollingerSignal = (0.5 - bollPos) * 0.03 * sqrtDays / Math.sqrt(5);

  const technicalsSignal = (rsiSignal + macdSignal + bollingerSignal) * w.technicals;

  // ─── SIGNAL 4: Trend (multi-SMA) ────────────────────────────
  const trendSMA20 = (f.price_vs_sma20 ?? 0) * 0.08;
  const trendSMA50 = (f.price_vs_sma50 ?? 0) * 0.12;
  const trendSMA200 = (f.price_vs_sma200 ?? 0) * 0.05;

  // 52-week position: above 0.8 = near highs (bullish), below 0.2 = near lows (caution)
  const yearPos = f.year_position ?? 0.5;
  const yearPosSignal = (yearPos - 0.5) * 0.02;

  // Drawdown signal: big drawdown = potential bounce (but risky)
  const drawdown = f.drawdown_from_high ?? 0;
  const drawdownSignal = drawdown < -0.20 ? -drawdown * 0.05 : 0; // Bounce from >20% drawdown

  const trendSignal = (trendSMA20 + trendSMA50 + trendSMA200 + yearPosSignal + drawdownSignal)
    * sqrtDays / Math.sqrt(21) * w.trend;

  // ADX trend strength: amplify trend signal when trend is strong
  const adxMultiplier = f.adx != null && f.adx > 25 ? 1.0 + (f.adx - 25) / 100 : 1.0;

  // ─── SIGNAL 5: Value / Fundamentals ──────────────────────────
  const pe = f.pe || 0;
  const forwardPe = f.forward_pe || 0;
  const peMissing = f._pe_missing === 1 || pe === 0;

  // Use forward PE if available (more predictive), else trailing
  const effectivePe = forwardPe > 0 ? forwardPe : pe;
  const valueSignal = peMissing ? 0 : clamp((22 - effectivePe) / 150, -0.02, 0.02);

  // DCF upside
  const dcfSignal = f.dcf_upside != null
    ? clamp(f.dcf_upside * 0.08, -0.03, 0.03)
    : 0;

  // ROE quality
  const roeSignal = f.roe != null && f.roe > 0
    ? Math.min(0.008, f.roe * 0.02)
    : 0;

  // Growth signals
  const revenueGrowthSignal = f.revenue_growth != null
    ? clamp(f.revenue_growth * 0.03, -0.015, 0.015)
    : 0;
  const earningsGrowthSignal = f.earnings_growth != null
    ? clamp(f.earnings_growth * 0.02, -0.015, 0.015)
    : 0;

  // PB value (lower = cheaper, centered at ~3)
  const pbSignal = f.pb != null && f.pb > 0 && f._pb_missing !== 1
    ? clamp((3 - f.pb) / 30, -0.01, 0.01)
    : 0;

  const fundamentalsSignal = (valueSignal + dcfSignal + roeSignal +
    revenueGrowthSignal + earningsGrowthSignal + pbSignal) *
    sqrtDays / Math.sqrt(21) * w.value;

  // ─── SIGNAL 6: Sentiment & News ──────────────────────────────
  const sentimentRaw = (f.avg_sentiment ?? 0) * 0.025;
  const bullBearRatio = (f.bullish_ratio ?? 0.5) - (f.bearish_ratio ?? 0.5);
  const sentimentConviction = bullBearRatio * 0.01;
  // Sentiment count weight: more articles = more reliable signal
  const sentimentCount = f.sentiment_count ?? 0;
  const sentimentReliability = Math.min(sentimentCount / 5, 1.0);

  const sentimentSignal = (sentimentRaw + sentimentConviction) *
    sentimentReliability * sqrtDays / Math.sqrt(5) * w.sentiment;

  // ─── SIGNAL 7: Analyst Consensus & Price Targets ─────────────
  let analystSignal = 0;
  if (f.analyst_consensus != null) {
    analystSignal += f.analyst_consensus * 0.015;
  }
  if (f.target_upside != null) {
    analystSignal += clamp(f.target_upside * 0.06, -0.03, 0.03);
  }
  // Analyst buy percentage
  if (f.analyst_buy_pct != null) {
    analystSignal += (f.analyst_buy_pct - 0.5) * 0.02;
  }
  analystSignal *= sqrtDays / Math.sqrt(63) * w.analyst;

  // ─── SIGNAL 8: Insider Trading ───────────────────────────────
  let insiderSignal = 0;
  if (f.insider_mspr != null) {
    insiderSignal += (f.insider_mspr / 100) * 0.03;
  }
  if (f.insider_cluster === 1) {
    insiderSignal += 0.025;
  }
  if (f.insider_buy_ratio != null) {
    insiderSignal += (f.insider_buy_ratio - 0.5) * 0.015;
  }
  if (f.insider_net_value === 1) {
    insiderSignal += 0.008;
  } else if (f.insider_net_value === -1) {
    insiderSignal -= 0.005;
  }
  insiderSignal *= sqrtDays / Math.sqrt(21) * w.insider;

  // ─── SIGNAL 9: Earnings Momentum ─────────────────────────────
  let earningsSignal = 0;
  if (f.last_earnings_surprise != null) {
    earningsSignal += clamp(f.last_earnings_surprise * 0.002, -0.01, 0.01);
  }
  if (f.earnings_beat === 1) {
    earningsSignal += 0.004;
  }
  // Earnings imminent — increase uncertainty but also opportunity
  if (f.earnings_imminent === 1) {
    earningsSignal *= 1.5;
  }
  earningsSignal *= sqrtDays / Math.sqrt(5) * w.earnings;

  // ─── SIGNAL 10: Macro Environment ────────────────────────────
  let macroSignal = 0;
  if (f.fed_rate != null && f.cpi_yoy != null) {
    if (f.fed_rate > 4 && f.cpi_yoy > 3) macroSignal = -0.004;
    else if (f.fed_rate < 2) macroSignal = 0.004;
    else if (f.cpi_yoy < 2 && f.fed_rate < 3) macroSignal = 0.002;
  }
  macroSignal *= sqrtDays / Math.sqrt(21) * w.macro;

  // ─── SIGNAL 11: Momentum Acceleration (2nd derivative) ──────
  // Is momentum speeding up or slowing down?
  const ret5d = f.return_5d || 0;
  const ret20d = f.return_20d || 0;
  const ret60d = f.return_60d || 0;
  // Short-term acceleration: 5d momentum vs 20d momentum
  const momAccel = ret5d - ret20d * (5 / 20); // Positive = accelerating
  const accelSignal = clamp(momAccel * 0.5, -0.015, 0.015) *
    sqrtDays / Math.sqrt(5) * w.momentum;

  // ─── SIGNAL 12: Multi-Timeframe Trend Alignment ────────────
  // When ALL moving averages agree (price > SMA20 > SMA50 > SMA200),
  // the trend is much stronger than any single SMA signal.
  const aboveSMA20 = (f.price_vs_sma20 ?? 0) > 0 ? 1 : -1;
  const aboveSMA50 = (f.price_vs_sma50 ?? 0) > 0 ? 1 : -1;
  const aboveSMA200 = (f.price_vs_sma200 ?? 0) > 0 ? 1 : -1;
  const trendAlignment = (aboveSMA20 + aboveSMA50 + aboveSMA200) / 3; // -1 to +1
  // Only activate when fully aligned (all same direction)
  const alignmentSignal = Math.abs(trendAlignment) === 1
    ? trendAlignment * 0.012 * sqrtDays / Math.sqrt(21) * w.trend
    : 0;

  // ─── SIGNAL 13: Nonlinear RSI Extremes ─────────────────────
  // RSI at extreme levels (< 25 or > 75) is much more predictive
  // than RSI at moderate levels. Apply extra contrarian weight.
  let rsiExtremeSignal = 0;
  if (rsiVal < 25) {
    rsiExtremeSignal = (25 - rsiVal) / 100 * 0.06; // Deeply oversold = strong buy
  } else if (rsiVal > 75) {
    rsiExtremeSignal = (75 - rsiVal) / 100 * 0.06; // Deeply overbought = strong sell
  }
  rsiExtremeSignal *= sqrtDays / Math.sqrt(5) * w.technicals;

  // ─── SIGNAL 14: Feature Interaction (confluence) ───────────
  // When momentum, trend, and volume ALL agree, the signal is
  // multiplicatively stronger (not just additive).
  const momDirection = rawMomentum > 0.005 ? 1 : rawMomentum < -0.005 ? -1 : 0;
  const trendDirection = trendAlignment > 0.3 ? 1 : trendAlignment < -0.3 ? -1 : 0;
  const volConfirm = volRatio > 1.2 ? 1 : 0;
  // Confluence: all three agree AND volume confirms
  const confluenceSignal = momDirection !== 0 && momDirection === trendDirection && volConfirm === 1
    ? momDirection * 0.01 * sqrtDays / Math.sqrt(5) * w.momentum
    : 0;

  // ─── SIGNAL 15: Volatility Contraction Breakout ────────────
  // When recent volatility is much lower than historical, a breakout
  // may be imminent. Direction guided by trend.
  const vol10d = f.volatility_10d ?? 0;
  const vol63d = f.volatility_63d ?? 0;
  let volBreakoutSignal = 0;
  if (vol63d > 0 && vol10d > 0) {
    const volRatioShortLong = vol10d / vol63d;
    if (volRatioShortLong < 0.6) {
      // Volatility contraction — breakout likely, use trend for direction
      volBreakoutSignal = trendAlignment * 0.008 * sqrtDays / Math.sqrt(5) * w.technicals;
    }
  }

  // ─── Z-SCORE BOOST: Use cross-sectional relative position ───
  // If z-scored features are available (after crossSectionalZScore),
  // blend them in to improve cross-sectional ranking.
  // z-scores tell us how a stock compares to the universe, not just its raw value.
  let zScoreBoost = 0;
  const zMom20 = f.z_return_20d ?? 0;
  const zMom60 = f.z_return_60d ?? 0;
  const zVol = f.z_volume_ratio ?? 0;
  const zSentiment = f.z_avg_sentiment ?? 0;
  const zInsider = f.z_insider_mspr ?? 0;
  const zAnalyst = f.z_analyst_consensus ?? 0;
  const zDcf = f.z_dcf_upside ?? 0;
  const zTarget = f.z_target_upside ?? 0;

  // Blend: stocks that are relatively strong across multiple factors get a boost
  zScoreBoost = (
    zMom20 * 0.004 * w.momentum +
    zMom60 * 0.002 * w.momentum +
    zVol * 0.001 * w.technicals +
    zSentiment * 0.002 * w.sentiment +
    zInsider * 0.003 * w.insider +
    zAnalyst * 0.002 * w.analyst +
    zDcf * 0.003 * w.value +
    zTarget * 0.002 * w.analyst
  ) * sqrtDays / Math.sqrt(5);

  // ─── COMPOSITE: Expected period return ───────────────────────
  const rawReturn = (
    momentumSignal +
    meanReversionSignal +
    technicalsSignal +
    trendSignal * adxMultiplier +
    fundamentalsSignal +
    sentimentSignal +
    analystSignal +
    insiderSignal +
    earningsSignal +
    macroSignal +
    accelSignal +
    alignmentSignal +
    rsiExtremeSignal +
    confluenceSignal +
    volBreakoutSignal +
    zScoreBoost
  );

  // Cap to prevent unrealistic predictions
  const maxRet = MAX_PERIOD_RETURN[horizon];
  const periodReturn = clamp(rawReturn, -maxRet, maxRet);

  // ─── VOLATILITY ENVELOPE ─────────────────────────────────────
  const annualVol = f.volatility_20d || 0.25;
  let earningsVolBoost = 1.0;
  if (f.earnings_imminent === 1) earningsVolBoost = 1.4;
  const periodVol = (annualVol / Math.sqrt(252)) * sqrtDays * earningsVolBoost;

  // Quantile prices
  // Use 1.65σ for wider P10/P90 (covers ~90% of normal distribution)
  // Add signal-driven uncertainty: when signals are strong, outcomes spread more
  const signalUncertainty = Math.abs(periodReturn) * 0.3; // Larger signals = wider range
  const effectiveVol = periodVol + signalUncertainty;
  const pMid = currentPrice * (1 + periodReturn);
  const pLow = currentPrice * (1 + periodReturn - 1.65 * effectiveVol);
  const pHigh = currentPrice * (1 + periodReturn + 1.65 * effectiveVol);

  // ─── CONFIDENCE (signal-to-noise + data quality + agreement) ─
  const signalToNoise = periodVol > 0
    ? Math.min(Math.abs(periodReturn) / periodVol, 1.0)
    : 0.5;

  const featureCount = Object.keys(f).filter((k) => !k.startsWith("_") && !k.startsWith("z_")).length;
  const dataConfidence = Math.min(featureCount / 30, 1);
  const hasFullData = f._has_60d_data === 1 ? 0.08 : 0;

  // Signal agreement: do multiple signals point the same direction?
  const signalDirections = [
    momentumSignal, meanReversionSignal, technicalsSignal, trendSignal,
    fundamentalsSignal, sentimentSignal, analystSignal, insiderSignal,
    accelSignal, alignmentSignal, confluenceSignal,
  ].filter(s => Math.abs(s) > 0.001);
  const positiveSignals = signalDirections.filter(s => s > 0).length;
  const agreementRatio = signalDirections.length > 0
    ? Math.abs(positiveSignals / signalDirections.length - 0.5) * 2  // 0 = split, 1 = unanimous
    : 0;
  const agreementConfidence = agreementRatio * 0.12;

  const confidence = signalToNoise * 0.30 +
    dataConfidence * 0.25 +
    hasFullData +
    agreementConfidence +
    0.15;

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
    confidence: +clamp(confidence, 0.10, 0.99).toFixed(3),
    expectedReturn: +expectedReturn.toFixed(4),
    riskReward: +(upside / downside).toFixed(2),
  };
}
