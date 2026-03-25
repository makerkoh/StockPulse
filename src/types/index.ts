// ─── Enums & Constants ───────────────────────────────────────────────
export const HORIZONS = ["1D", "1W", "1M", "3M", "6M"] as const;
export type Horizon = (typeof HORIZONS)[number];

export const RANK_MODES = [
  "expected_return",
  "sharpe",
  "risk_adjusted",
  "momentum",
  "value",
] as const;
export type RankMode = (typeof RANK_MODES)[number];

export const RANK_MODE_LABELS: Record<RankMode, string> = {
  expected_return: "Expected Return",
  sharpe: "Sharpe Ratio",
  risk_adjusted: "Risk-Adjusted",
  momentum: "Momentum",
  value: "Value",
};

export const STRATEGIES = ["day_trade", "swing", "long_term"] as const;
export type Strategy = (typeof STRATEGIES)[number];

export const STRATEGY_LABELS: Record<Strategy, string> = {
  day_trade: "Day Trade",
  swing: "Swing",
  long_term: "Long Term",
};

export const HORIZON_LABELS: Record<Horizon, string> = {
  "1D": "1 Day",
  "1W": "1 Week",
  "1M": "1 Month",
  "3M": "3 Months",
  "6M": "6 Months",
};

// ─── Domain Types ────────────────────────────────────────────────────
export interface StockQuote {
  ticker: string;
  name: string;
  sector: string;
  price: number;
  change: number;
  changePct: number;
  volume: number;
  marketCap: number;
  high52w: number;
  low52w: number;
}

export interface PriceBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface FundamentalData {
  pe: number | null;
  forwardPe: number | null;
  pb: number | null;
  ps: number | null;
  evEbitda: number | null;
  debtEquity: number | null;
  roe: number | null;
  revenueGrowth: number | null;
  earningsGrowth: number | null;
  dividendYield: number | null;
  beta: number | null;
}

export interface NewsItem {
  id: string;
  headline: string;
  summary: string;
  source: string;
  url: string;
  sentiment: number;
  publishedAt: string;
}

export interface IpoEntry {
  id: string;
  ticker: string;
  companyName: string;
  exchange: string;
  expectedDate: string;
  priceRangeLow: number;
  priceRangeHigh: number;
  shares: number;
  status: "upcoming" | "priced" | "withdrawn";
  sector: string;
  sentiment: number;
  riskScore: number;
}

// ─── Extended Fundamentals (FMP) ────────────────────────────────────
export interface ExtendedFundamentals extends FundamentalData {
  dcf: number | null;
  currentRatio: number | null;
  quickRatio: number | null;
  grossMargin: number | null;
  operatingMargin: number | null;
  netMargin: number | null;
  freeCashFlowPerShare: number | null;
  revenuePerShare: number | null;
  payoutRatio: number | null;
}

// ─── Technical Indicators (Alpha Vantage) ───────────────────────────
export interface TechnicalIndicators {
  sma50: number | null;
  sma200: number | null;
  ema12: number | null;
  ema26: number | null;
  rsi14: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHist: number | null;
  bollingerUpper: number | null;
  bollingerLower: number | null;
  stochK: number | null;
  stochD: number | null;
  adx: number | null;
  cci: number | null;
}

// ─── Economic Context (Alpha Vantage) ───────────────────────────────
export interface EconomicContext {
  gdpGrowth: number | null;
  cpiYoy: number | null;
  unemploymentRate: number | null;
  fedFundsRate: number | null;
  treasuryYield10y: number | null;
}

// ─── Sentiment Data ─────────────────────────────────────────────────
export interface SentimentData {
  avgSentiment: number;       // -1 to 1
  sentimentCount: number;     // number of articles analyzed
  bullishCount: number;
  bearishCount: number;
}

// ─── Insider Trading Data ────────────────────────────────────────────
export interface InsiderData {
  mspr: number;             // Monthly Share Purchase Ratio (-100 to 100)
  totalBuys: number;        // Number of buy transactions (last 3 months)
  totalSells: number;       // Number of sell transactions (last 3 months)
  netBuyValue: number;      // Net dollar value of insider purchases
  clusterBuying: boolean;   // 3+ insiders buying within 30 days
}

// ─── Analyst Data ───────────────────────────────────────────────────
export interface AnalystData {
  targetPrice: number | null;     // Consensus price target
  strongBuy: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell: number;
  consensusScore: number;         // -1 (strong sell) to +1 (strong buy)
}

// ─── Earnings Data ──────────────────────────────────────────────────
export interface EarningsData {
  daysUntilEarnings: number | null;  // Days until next earnings report
  lastSurprisePct: number | null;    // Last earnings surprise %
  lastBeatOrMiss: "beat" | "miss" | "met" | null;
}

// ─── Feature Vector ──────────────────────────────────────────────────
export interface FeatureVector {
  ticker: string;
  date: string;
  features: Record<string, number>;
}

// ─── Forecast & Scoring ──────────────────────────────────────────────
export interface QuantileForecast {
  ticker: string;
  name: string;
  sector: string;
  horizon: Horizon;
  currentPrice: number;
  pLow: number;   // 10th percentile
  pMid: number;   // 50th percentile (median)
  pHigh: number;  // 90th percentile
  confidence: number;
  expectedReturn: number;
  riskReward: number;
}

export interface ScoredStock extends QuantileForecast {
  score: number;
  rank: number;
  scoreBreakdown: Record<string, number>;
}

export interface PredictionResponse {
  stocks: ScoredStock[];
  ipos: IpoEntry[];
  meta: {
    horizon: Horizon;
    rankMode: RankMode;
    strategy: Strategy;
    universe: string[];
    generatedAt: string;
    isDemo: boolean;
  };
}

// ─── Backtest ────────────────────────────────────────────────────────
export interface BacktestResult {
  startDate: string;
  endDate: string;
  totalReturn: number;
  annualizedReturn: number;
  sharpe: number;
  maxDrawdown: number;
  winRate: number;
  totalTrades: number;
  equity: { date: string; value: number; benchmark: number }[];
}

// ─── Stock Detail ────────────────────────────────────────────────────
export interface StockDetail {
  quote: StockQuote;
  fundamentals: FundamentalData;
  prices: PriceBar[];
  news: NewsItem[];
  forecast: QuantileForecast | null;
}

// ─── Settings ────────────────────────────────────────────────────────
export interface AppSettings {
  finnhubKey: string;
  fmpKey: string;
  alphaVantageKey: string;
  newsApiKey: string;
  defaultHorizon: Horizon;
  defaultRankMode: RankMode;
  universe: string[];
  refreshInterval: number; // minutes
}

// ─── API Response Wrapper ────────────────────────────────────────────
export interface ApiResponse<T> {
  data?: T;
  error?: string;
}
