import type {
  PriceBar,
  FundamentalData,
  FeatureVector,
  TechnicalIndicators,
  EconomicContext,
  SentimentData,
  InsiderData,
} from "@/types";

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
  fundamentals: FundamentalData | null,
  technicalIndicators?: TechnicalIndicators | null,
  economicContext?: EconomicContext | null,
  sentiment?: SentimentData | null,
  insider?: InsiderData | null,
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

    // Extended fundamentals from FMP (type guard)
    if ("dcf" in fundamentals && fundamentals.dcf !== undefined) {
      const ext = fundamentals as import("@/types").ExtendedFundamentals;
      if (ext.dcf != null && currentPrice > 0) {
        features.dcf_upside = (ext.dcf - currentPrice) / currentPrice;
      }
      if (ext.currentRatio != null) features.current_ratio = ext.currentRatio;
      if (ext.quickRatio != null) features.quick_ratio = ext.quickRatio;
      if (ext.grossMargin != null) features.gross_margin = ext.grossMargin;
      if (ext.operatingMargin != null) features.operating_margin = ext.operatingMargin;
      if (ext.netMargin != null) features.net_margin = ext.netMargin;
      if (ext.freeCashFlowPerShare != null) features.fcf_per_share = ext.freeCashFlowPerShare;
      if (ext.payoutRatio != null) features.payout_ratio = ext.payoutRatio;
    }
  }

  // Alpha Vantage server-computed technical indicators (override local approximations)
  if (technicalIndicators) {
    if (technicalIndicators.rsi14 != null) features.av_rsi_14 = technicalIndicators.rsi14;
    if (technicalIndicators.macd != null) features.av_macd = technicalIndicators.macd;
    if (technicalIndicators.macdSignal != null) features.av_macd_signal = technicalIndicators.macdSignal;
    if (technicalIndicators.macdHist != null) features.av_macd_hist = technicalIndicators.macdHist;
    if (technicalIndicators.bollingerUpper != null) features.av_bb_upper = technicalIndicators.bollingerUpper;
    if (technicalIndicators.bollingerLower != null) features.av_bb_lower = technicalIndicators.bollingerLower;
    if (technicalIndicators.stochK != null) features.stoch_k = technicalIndicators.stochK;
    if (technicalIndicators.stochD != null) features.stoch_d = technicalIndicators.stochD;
    if (technicalIndicators.adx != null) features.adx = technicalIndicators.adx;
    if (technicalIndicators.cci != null) features.cci = technicalIndicators.cci;
  }

  // Economic context (same for all stocks in a run — market regime signal)
  if (economicContext) {
    if (economicContext.gdpGrowth != null) features.gdp_growth = economicContext.gdpGrowth;
    if (economicContext.cpiYoy != null) features.cpi_yoy = economicContext.cpiYoy;
    if (economicContext.unemploymentRate != null) features.unemployment = economicContext.unemploymentRate;
    if (economicContext.fedFundsRate != null) features.fed_rate = economicContext.fedFundsRate;
    if (economicContext.treasuryYield10y != null) features.treasury_10y = economicContext.treasuryYield10y;
  }

  // Sentiment features (from news)
  if (sentiment) {
    features.avg_sentiment = sentiment.avgSentiment;
    features.sentiment_count = sentiment.sentimentCount;
    features.bullish_ratio = sentiment.sentimentCount > 0
      ? sentiment.bullishCount / sentiment.sentimentCount
      : 0.5;
    features.bearish_ratio = sentiment.sentimentCount > 0
      ? sentiment.bearishCount / sentiment.sentimentCount
      : 0.5;
    // Sentiment strength: how polarized the news is
    features.sentiment_strength = Math.abs(sentiment.avgSentiment);
  }

  // Insider trading features
  if (insider) {
    // MSPR: -100 (all selling) to +100 (all buying)
    features.insider_mspr = insider.mspr;
    // Buy/sell ratio
    const totalTxns = insider.totalBuys + insider.totalSells;
    features.insider_buy_ratio = totalTxns > 0 ? insider.totalBuys / totalTxns : 0.5;
    // Cluster buying is a very strong signal
    features.insider_cluster = insider.clusterBuying ? 1 : 0;
    // Net buy value (normalized to a signal)
    features.insider_net_value = insider.netBuyValue > 0 ? 1 : insider.netBuyValue < 0 ? -1 : 0;
  }

  return {
    ticker,
    date: new Date().toISOString().split("T")[0],
    features,
  };
}
