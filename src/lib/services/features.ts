import type { PriceBar, FundamentalData, FeatureVector } from "@/types";

// ─── Technical Features from Price Bars ──────────────────────────────
function sma(prices: number[], window: number): number {
  if (prices.length < window) return prices[prices.length - 1] || 0;
  const slice = prices.slice(-window);
  return slice.reduce((a, b) => a + b, 0) / window;
}

function ema(prices: number[], window: number): number {
  if (prices.length === 0) return 0;
  const k = 2 / (window + 1);
  let e = prices[0];
  for (let i = 1; i < prices.length; i++) {
    e = prices[i] * k + e * (1 - k);
  }
  return e;
}

function stdDev(prices: number[], window: number): number {
  if (prices.length < window) return 0;
  const slice = prices.slice(-window);
  const mean = slice.reduce((a, b) => a + b, 0) / window;
  const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / window;
  return Math.sqrt(variance);
}

function rsi(prices: number[], window = 14): number {
  if (prices.length < window + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = prices.length - window; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

function macd(prices: number[]): { macd: number; signal: number; histogram: number } {
  const fast = ema(prices, 12);
  const slow = ema(prices, 26);
  const macdLine = fast - slow;
  // Simplified signal as we don't track full MACD history
  return { macd: macdLine, signal: macdLine * 0.8, histogram: macdLine * 0.2 };
}

function bollingerPosition(prices: number[], window = 20): number {
  const mean = sma(prices, window);
  const sd = stdDev(prices, window);
  if (sd === 0) return 0.5;
  const current = prices[prices.length - 1];
  return (current - (mean - 2 * sd)) / (4 * sd);
}

function returns(prices: number[], period: number): number {
  if (prices.length < period + 1) return 0;
  const old = prices[prices.length - 1 - period];
  const current = prices[prices.length - 1];
  return old === 0 ? 0 : (current - old) / old;
}

function volumeRatio(volumes: number[], window = 20): number {
  if (volumes.length < window + 1) return 1;
  const avgVol = sma(volumes, window);
  return avgVol === 0 ? 1 : volumes[volumes.length - 1] / avgVol;
}

function atr(bars: PriceBar[], window = 14): number {
  if (bars.length < window + 1) return 0;
  let sum = 0;
  for (let i = bars.length - window; i < bars.length; i++) {
    const tr = Math.max(
      bars[i].high - bars[i].low,
      Math.abs(bars[i].high - bars[i - 1].close),
      Math.abs(bars[i].low - bars[i - 1].close)
    );
    sum += tr;
  }
  return sum / window;
}

// ─── Build Feature Vector ────────────────────────────────────────────
export function buildFeatures(
  ticker: string,
  bars: PriceBar[],
  fundamentals: FundamentalData | null
): FeatureVector {
  const closes = bars.map((b) => b.close);
  const volumes = bars.map((b) => b.volume);
  const currentPrice = closes[closes.length - 1] || 0;

  const features: Record<string, number> = {};

  // Momentum
  features.return_1d = returns(closes, 1);
  features.return_5d = returns(closes, 5);
  features.return_20d = returns(closes, 20);
  features.return_60d = returns(closes, 60);

  // Moving averages
  features.sma_20 = sma(closes, 20);
  features.sma_50 = sma(closes, 50);
  features.sma_200 = sma(closes, 200);
  features.ema_12 = ema(closes, 12);
  features.ema_26 = ema(closes, 26);

  // Relative position
  features.price_vs_sma20 = features.sma_20 === 0 ? 0 : currentPrice / features.sma_20 - 1;
  features.price_vs_sma50 = features.sma_50 === 0 ? 0 : currentPrice / features.sma_50 - 1;
  features.price_vs_sma200 = features.sma_200 === 0 ? 0 : currentPrice / features.sma_200 - 1;
  features.golden_cross = features.sma_50 > features.sma_200 ? 1 : 0;

  // Oscillators
  features.rsi_14 = rsi(closes, 14);
  const m = macd(closes);
  features.macd = m.macd;
  features.macd_signal = m.signal;
  features.macd_histogram = m.histogram;

  // Volatility
  features.volatility_20d = stdDev(closes, 20);
  features.bollinger_position = bollingerPosition(closes, 20);
  features.atr_14 = atr(bars, 14);

  // Volume
  features.volume_ratio = volumeRatio(volumes, 20);

  // Fundamentals (if available)
  if (fundamentals) {
    features.pe = fundamentals.pe ?? 0;
    features.forward_pe = fundamentals.forwardPe ?? 0;
    features.pb = fundamentals.pb ?? 0;
    features.ps = fundamentals.ps ?? 0;
    features.ev_ebitda = fundamentals.evEbitda ?? 0;
    features.debt_equity = fundamentals.debtEquity ?? 0;
    features.roe = fundamentals.roe ?? 0;
    features.revenue_growth = fundamentals.revenueGrowth ?? 0;
    features.earnings_growth = fundamentals.earningsGrowth ?? 0;
    features.dividend_yield = fundamentals.dividendYield ?? 0;
    features.beta = fundamentals.beta ?? 0;
  }

  return {
    ticker,
    date: new Date().toISOString().split("T")[0],
    features,
  };
}
