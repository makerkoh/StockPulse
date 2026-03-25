import type {
  Horizon,
  RankMode,
  QuantileForecast,
  ScoredStock,
  IpoEntry,
  PredictionResponse,
  FeatureVector,
} from "@/types";
import { getProvider, isDemo } from "@/lib/providers/registry";
import { DEFAULT_UNIVERSE } from "@/lib/providers/interfaces";
import { buildFeatures } from "./features";
import { rankStocks } from "./scoring";
import { seededRandom } from "@/lib/utils";

const HORIZON_DAYS: Record<Horizon, number> = {
  "1D": 1, "1W": 5, "1M": 21, "3M": 63, "6M": 126,
};

// ─── Generate Quantile Forecast ──────────────────────────────────────
// In production this would call a trained ML model (gradient boosting, etc.)
// For now, uses feature-based heuristics that produce realistic distributions
function generateForecast(
  ticker: string,
  name: string,
  sector: string,
  currentPrice: number,
  features: FeatureVector,
  horizon: Horizon
): QuantileForecast {
  const f = features.features;
  const days = HORIZON_DAYS[horizon];
  const rng = seededRandom(ticker + horizon + new Date().toISOString().split("T")[0]);

  // Base drift from momentum
  const momentumDrift = (f.return_5d || 0) * 0.3 + (f.return_20d || 0) * 0.5;

  // Mean reversion for extreme RSI
  const rsiSignal = f.rsi_14 ? (50 - f.rsi_14) / 200 : 0;

  // Trend alignment bonus
  const trendBonus = f.golden_cross ? 0.002 * days : -0.001 * days;

  // Value tilt
  const pe = f.pe || 25;
  const valueTilt = pe < 15 ? 0.001 * days : pe > 40 ? -0.001 * days : 0;

  // Expected return (annualized scaled to horizon)
  const annualizedDrift = momentumDrift + rsiSignal + trendBonus + valueTilt;
  const periodReturn = annualizedDrift * (days / 252);

  // Volatility scaling
  const baseVol = f.volatility_20d ? f.volatility_20d / currentPrice : 0.02;
  const periodVol = baseVol * Math.sqrt(days);

  // Quantile forecasts (log-normal inspired)
  const pMid = currentPrice * (1 + periodReturn);
  const pLow = currentPrice * (1 + periodReturn - 1.28 * periodVol); // ~10th pctile
  const pHigh = currentPrice * (1 + periodReturn + 1.28 * periodVol); // ~90th pctile

  // Confidence based on data quality and volatility
  const volConfidence = Math.max(0, 1 - periodVol * 3);
  const featureCount = Object.keys(f).length;
  const dataConfidence = Math.min(featureCount / 30, 1);
  const confidence = (volConfidence * 0.6 + dataConfidence * 0.4) * (0.85 + rng() * 0.15);

  const expectedReturn = (pMid - currentPrice) / currentPrice;
  const downside = Math.max(currentPrice - pLow, 0.01);
  const upside = Math.max(pHigh - currentPrice, 0.01);
  const riskReward = upside / downside;

  return {
    ticker,
    name,
    sector,
    horizon,
    currentPrice: +currentPrice.toFixed(2),
    pLow: +Math.max(pLow, 0.01).toFixed(2),
    pMid: +pMid.toFixed(2),
    pHigh: +pHigh.toFixed(2),
    confidence: +Math.min(Math.max(confidence, 0.1), 0.99).toFixed(3),
    expectedReturn: +expectedReturn.toFixed(4),
    riskReward: +riskReward.toFixed(2),
  };
}

// ─── Run Full Prediction Pipeline ────────────────────────────────────
export async function runPrediction(
  horizon: Horizon = "1W",
  rankMode: RankMode = "expected_return",
  universe?: string[]
): Promise<PredictionResponse> {
  const provider = getProvider();
  const tickers = universe && universe.length > 0 ? universe : DEFAULT_UNIVERSE;

  // Fetch quotes for all tickers
  const quotes = await provider.getQuotes(tickers);

  // Fetch historical prices and fundamentals in parallel
  const to = new Date();
  const from = new Date(Date.now() - 365 * 86_400_000);

  const [pricesMap, fundamentalsMap] = await Promise.all([
    Promise.all(
      tickers.map(async (t) => {
        const bars = await provider.getHistoricalPrices(t, from, to);
        return [t, bars] as const;
      })
    ).then((entries) => new Map(entries)),

    Promise.all(
      tickers.map(async (t) => {
        const fund = await provider.getFundamentals(t);
        return [t, fund] as const;
      })
    ).then((entries) => new Map(entries)),
  ]);

  // Build feature vectors
  const featureVectors = new Map<string, FeatureVector>();
  for (const ticker of tickers) {
    const bars = pricesMap.get(ticker) || [];
    const fund = fundamentalsMap.get(ticker) || null;
    featureVectors.set(ticker, buildFeatures(ticker, bars, fund));
  }

  // Generate forecasts
  const forecasts: QuantileForecast[] = quotes.map((q) => {
    const fv = featureVectors.get(q.ticker)!;
    return generateForecast(q.ticker, q.name, q.sector, q.price, fv, horizon);
  });

  // Score and rank
  const scored: ScoredStock[] = rankStocks(forecasts, featureVectors, rankMode);

  // Fetch IPOs
  const ipos: IpoEntry[] = await provider.getUpcomingIpos();

  return {
    stocks: scored,
    ipos,
    meta: {
      horizon,
      rankMode,
      universe: tickers,
      generatedAt: new Date().toISOString(),
      isDemo: isDemo(),
    },
  };
}
