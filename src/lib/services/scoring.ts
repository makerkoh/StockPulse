import type { QuantileForecast, ScoredStock, RankMode, FeatureVector, Strategy } from "@/types";
import { clamp } from "@/lib/utils";

// ─── Strategy-specific weight multipliers ────────────────────────────
// These amplify or dampen different signal categories based on trading style
interface StrategyWeights {
  momentum: number;     // Recent returns, RSI, volume
  volatility: number;   // Prefer high vol (day trade) or low vol (long term)
  fundamentals: number; // PE, DCF, margins, earnings
  sentiment: number;    // News sentiment
  insider: number;      // Insider trading signals
  liquidity: number;    // Volume, spread (important for day trade)
}

const STRATEGY_WEIGHTS: Record<Strategy, StrategyWeights> = {
  day_trade: {
    momentum: 2.5,      // Very high — need immediate price movement
    volatility: 2.0,    // High vol = more intraday opportunity
    fundamentals: 0.2,  // Nearly irrelevant for day trades
    sentiment: 1.5,     // News-driven moves matter
    insider: 0.3,       // Less relevant short-term
    liquidity: 3.0,     // Critical — need to enter/exit quickly
  },
  swing: {
    momentum: 1.5,      // Important but balanced
    volatility: 1.0,    // Neutral
    fundamentals: 1.0,  // Balanced
    sentiment: 1.2,     // Moderately important
    insider: 1.0,       // Standard weight
    liquidity: 1.0,     // Standard
  },
  long_term: {
    momentum: 0.5,      // Less important — can wait out dips
    volatility: -0.5,   // Prefer LOW volatility (negative = penalize high vol)
    fundamentals: 2.5,  // Very high — core of long-term investing
    sentiment: 0.5,     // Noise for long-term
    insider: 2.0,       // Very important — insiders know long-term value
    liquidity: 0.3,     // Less important — not trading frequently
  },
};

// ─── Score a single stock under a given ranking mode + strategy ──────
export function scoreStock(
  forecast: QuantileForecast,
  features: FeatureVector,
  mode: RankMode,
  strategy: Strategy = "swing"
): ScoredStock {
  const breakdown: Record<string, number> = {};
  const f = features.features;
  const w = STRATEGY_WEIGHTS[strategy];

  // ─── Component scores ─────────────────────────────────────────────

  // Sentiment component
  const sentimentRaw = (f.avg_sentiment ?? 0) * 10;
  const sentimentBonus = sentimentRaw * w.sentiment;

  // Analyst consensus component
  let analystRaw = 0;
  if (f.analyst_consensus != null) {
    analystRaw += f.analyst_consensus * 10; // -10 to +10
  }
  if (f.target_upside != null) {
    analystRaw += clamp(f.target_upside * 20, -8, 12); // Price target signal
  }
  const analystBonus = analystRaw * w.fundamentals; // Weight by strategy

  // Earnings momentum component
  let earningsRaw = 0;
  if (f.earnings_beat === 1) earningsRaw += 5;
  if (f.last_earnings_surprise != null) {
    earningsRaw += clamp(f.last_earnings_surprise * 0.5, -5, 8);
  }
  // Earnings imminent = higher volatility = good for day traders
  if (f.earnings_imminent === 1) earningsRaw += w.volatility > 0 ? 5 : -3;

  // Insider trading component
  let insiderRaw = 0;
  if (f.insider_mspr != null) insiderRaw += (f.insider_mspr / 100) * 8;
  if (f.insider_cluster === 1) insiderRaw += 12;
  if (f.insider_buy_ratio != null && f.insider_buy_ratio > 0.7) insiderRaw += 5;
  const insiderBonus = insiderRaw * w.insider;

  // Volatility component (day traders want HIGH vol, long-term wants LOW)
  const vol = f.volatility_20d ? f.volatility_20d / forecast.currentPrice : 0.02;
  const volScore = w.volatility > 0
    ? Math.min(vol * 100, 10) * w.volatility     // Reward high vol
    : Math.max(10 - vol * 100, 0) * Math.abs(w.volatility); // Reward low vol

  // Liquidity component (volume ratio — high volume = more liquid)
  const volRatio = f.volume_ratio || 1;
  const liquidityScore = Math.min(volRatio, 3) * 5 * w.liquidity;

  let score = 0;

  switch (mode) {
    case "expected_return": {
      const ret = forecast.expectedReturn;
      const conf = forecast.confidence;
      breakdown.expected_return = ret * 100;
      breakdown.confidence_bonus = conf * 20;
      breakdown.risk_penalty = -Math.max(0, -forecast.riskReward) * 10;
      breakdown.sentiment = sentimentBonus;
      breakdown.insider = insiderBonus;
      breakdown.volatility = volScore;
      breakdown.liquidity = liquidityScore;
      breakdown.analyst = analystBonus;
      breakdown.earnings = earningsRaw;
      score = ret * 60 + conf * 25 + Math.min(forecast.riskReward, 3) * 5 +
        sentimentBonus + insiderBonus + analystBonus + earningsRaw + volScore + liquidityScore;
      break;
    }
    case "sharpe": {
      const ret = forecast.expectedReturn;
      const sharpe = ret / Math.max(vol, 0.001);
      breakdown.return_component = ret * 100;
      breakdown.volatility_penalty = -vol * 50;
      breakdown.sharpe_estimate = sharpe;
      breakdown.sentiment = sentimentBonus;
      breakdown.insider = insiderBonus;
      breakdown.analyst = analystBonus;
      breakdown.earnings = earningsRaw;
      score = sharpe * 30 + forecast.confidence * 20 +
        sentimentBonus + insiderBonus + analystBonus + earningsRaw + liquidityScore;
      break;
    }
    case "risk_adjusted": {
      const upside = (forecast.pHigh - forecast.currentPrice) / forecast.currentPrice;
      const downside = (forecast.currentPrice - forecast.pLow) / forecast.currentPrice;
      const rr = downside === 0 ? upside * 100 : upside / downside;
      breakdown.upside_pct = upside * 100;
      breakdown.downside_pct = -downside * 100;
      breakdown.risk_reward = rr;
      breakdown.confidence = forecast.confidence * 100;
      breakdown.sentiment = sentimentBonus;
      breakdown.insider = insiderBonus;
      breakdown.analyst = analystBonus;
      breakdown.earnings = earningsRaw;
      score = rr * 20 + forecast.confidence * 30 + upside * 50 +
        sentimentBonus + insiderBonus + analystBonus + earningsRaw + volScore;
      break;
    }
    case "momentum": {
      const ret5d = (f.return_5d || 0) * 100;
      const ret20d = (f.return_20d || 0) * 100;
      const ret60d = (f.return_60d || 0) * 100;
      const rsiVal = f.av_rsi_14 ?? f.rsi_14 ?? 50;
      const adxVal = f.adx ?? 0;
      breakdown.return_5d = ret5d;
      breakdown.return_20d = ret20d;
      breakdown.return_60d = ret60d;
      breakdown.rsi = rsiVal;
      breakdown.volume_ratio = volRatio;
      breakdown.sentiment = sentimentBonus;
      breakdown.insider = insiderBonus;
      breakdown.analyst = analystBonus;
      breakdown.earnings = earningsRaw;
      if (adxVal > 0) breakdown.adx_trend = adxVal;
      score = (ret5d * 3 + ret20d * 2 + ret60d * 1.5) * w.momentum +
        (rsiVal > 50 && rsiVal < 80 ? 10 : -5) +
        liquidityScore + sentimentBonus + insiderBonus + analystBonus + earningsRaw +
        (adxVal > 25 ? 8 : 0) + volScore;
      break;
    }
    case "value": {
      const pe = f.pe || 25;
      const pb = f.pb || 3;
      const ps = f.ps || 5;
      const dy = (f.dividend_yield || 0) * 100;
      const roe = (f.roe || 0) * 100;
      const dcfUpside = (f.dcf_upside ?? 0) * 100;
      const grossMargin = (f.gross_margin ?? 0) * 100;
      const netMargin = (f.net_margin ?? 0) * 100;

      breakdown.pe_score = clamp(30 - pe, -10, 20);
      breakdown.pb_score = clamp(5 - pb, -5, 10);
      breakdown.ps_score = clamp(5 - ps, -5, 10);
      breakdown.dividend_yield = dy;
      breakdown.roe = roe;
      breakdown.sentiment = sentimentBonus;
      breakdown.insider = insiderBonus;
      breakdown.analyst = analystBonus;
      breakdown.earnings = earningsRaw;
      if (dcfUpside !== 0) breakdown.dcf_upside = dcfUpside;
      if (grossMargin !== 0) breakdown.gross_margin = grossMargin;

      score = (breakdown.pe_score * 2 + breakdown.pb_score * 3 +
        breakdown.ps_score * 2 + dy * 5 + roe * 0.5 +
        clamp(dcfUpside * 0.3, -10, 15) +
        clamp(grossMargin * 0.1, 0, 8) +
        clamp(netMargin * 0.15, 0, 8)) * w.fundamentals +
        sentimentBonus + insiderBonus + analystBonus + earningsRaw;
      break;
    }
  }

  return {
    ...forecast,
    score: +score.toFixed(2),
    rank: 0,
    scoreBreakdown: breakdown,
  };
}

// ─── Score and rank a universe ───────────────────────────────────────
export function rankStocks(
  forecasts: QuantileForecast[],
  featureVectors: Map<string, FeatureVector>,
  mode: RankMode,
  strategy: Strategy = "swing"
): ScoredStock[] {
  const scored = forecasts.map((f) => {
    const fv = featureVectors.get(f.ticker) || {
      ticker: f.ticker,
      date: new Date().toISOString().split("T")[0],
      features: {},
    };
    return scoreStock(f, fv, mode, strategy);
  });

  scored.sort((a, b) => b.score - a.score);
  scored.forEach((s, i) => (s.rank = i + 1));

  return scored;
}
