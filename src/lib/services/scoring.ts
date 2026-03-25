import type { QuantileForecast, ScoredStock, RankMode, FeatureVector } from "@/types";
import { clamp } from "@/lib/utils";

// ─── Score a single stock under a given ranking mode ─────────────────
export function scoreStock(
  forecast: QuantileForecast,
  features: FeatureVector,
  mode: RankMode
): ScoredStock {
  const breakdown: Record<string, number> = {};
  let score = 0;

  switch (mode) {
    case "expected_return": {
      const ret = forecast.expectedReturn;
      const conf = forecast.confidence;
      breakdown.expected_return = ret * 100;
      breakdown.confidence_bonus = conf * 20;
      breakdown.risk_penalty = -Math.max(0, -forecast.riskReward) * 10;
      score = ret * 60 + conf * 25 + Math.min(forecast.riskReward, 3) * 5;
      break;
    }
    case "sharpe": {
      const ret = forecast.expectedReturn;
      const vol = features.features.volatility_20d || 0.01;
      const sharpe = ret / Math.max(vol / forecast.currentPrice, 0.001);
      breakdown.return_component = ret * 100;
      breakdown.volatility_penalty = -(vol / forecast.currentPrice) * 50;
      breakdown.sharpe_estimate = sharpe;
      score = sharpe * 30 + forecast.confidence * 20;
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
      score = rr * 20 + forecast.confidence * 30 + upside * 50;
      break;
    }
    case "momentum": {
      const f = features.features;
      const ret5d = (f.return_5d || 0) * 100;
      const ret20d = (f.return_20d || 0) * 100;
      const ret60d = (f.return_60d || 0) * 100;
      const rsiVal = f.rsi_14 || 50;
      const volRatio = f.volume_ratio || 1;
      breakdown.return_5d = ret5d;
      breakdown.return_20d = ret20d;
      breakdown.return_60d = ret60d;
      breakdown.rsi = rsiVal;
      breakdown.volume_ratio = volRatio;
      score = ret5d * 3 + ret20d * 2 + ret60d * 1.5 +
        (rsiVal > 50 && rsiVal < 80 ? 10 : -5) +
        Math.min(volRatio, 3) * 5;
      break;
    }
    case "value": {
      const f = features.features;
      const pe = f.pe || 25;
      const pb = f.pb || 3;
      const ps = f.ps || 5;
      const dy = (f.dividend_yield || 0) * 100;
      const roe = (f.roe || 0) * 100;
      breakdown.pe_score = clamp(30 - pe, -10, 20);
      breakdown.pb_score = clamp(5 - pb, -5, 10);
      breakdown.ps_score = clamp(5 - ps, -5, 10);
      breakdown.dividend_yield = dy;
      breakdown.roe = roe;
      score = breakdown.pe_score * 2 + breakdown.pb_score * 3 +
        breakdown.ps_score * 2 + dy * 5 + roe * 0.5;
      break;
    }
  }

  return {
    ...forecast,
    score: +score.toFixed(2),
    rank: 0, // assigned after sorting
    scoreBreakdown: breakdown,
  };
}

// ─── Score and rank a universe ───────────────────────────────────────
export function rankStocks(
  forecasts: QuantileForecast[],
  featureVectors: Map<string, FeatureVector>,
  mode: RankMode
): ScoredStock[] {
  const scored = forecasts.map((f) => {
    const fv = featureVectors.get(f.ticker) || {
      ticker: f.ticker,
      date: new Date().toISOString().split("T")[0],
      features: {},
    };
    return scoreStock(f, fv, mode);
  });

  scored.sort((a, b) => b.score - a.score);
  scored.forEach((s, i) => (s.rank = i + 1));

  return scored;
}
