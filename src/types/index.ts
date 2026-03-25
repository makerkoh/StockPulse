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
