import type {
  StockQuote,
  PriceBar,
  FundamentalData,
  NewsItem,
  IpoEntry,
  TechnicalIndicators,
  EconomicContext,
  InsiderData,
} from "@/types";

export interface MarketDataProvider {
  name: string;
  getQuote(ticker: string): Promise<StockQuote | null>;
  getQuotes(tickers: string[]): Promise<StockQuote[]>;
  getHistoricalPrices(
    ticker: string,
    from: Date,
    to: Date
  ): Promise<PriceBar[]>;
}

export interface FundamentalProvider {
  name: string;
  getFundamentals(ticker: string): Promise<FundamentalData | null>;
}

export interface NewsProvider {
  name: string;
  getNews(ticker: string, limit?: number): Promise<NewsItem[]>;
  getMarketNews(limit?: number): Promise<NewsItem[]>;
}

export interface IpoProvider {
  name: string;
  getUpcomingIpos(): Promise<IpoEntry[]>;
}

export interface TechnicalProvider {
  name: string;
  getTechnicalIndicators(ticker: string): Promise<TechnicalIndicators | null>;
}

export interface EconomicProvider {
  name: string;
  getEconomicContext(): Promise<EconomicContext | null>;
}

export interface InsiderProvider {
  name: string;
  getInsiderData(ticker: string): Promise<InsiderData | null>;
}

// ─── Stock Universe ──────────────────────────────────────────────────
// The pipeline adapts automatically to universe size:
// - Pass 1 batch-quotes all tickers (1 FMP call regardless of count)
// - Pass 1 fetches fundamentals (1 call per ticker)
// - Pass 2 enriches only the top 10 (fixed ~50 calls)
//
// API budget per run: N + 51 calls (N = universe size)
//   40 tickers → ~91 calls → 2-3 runs/day on free tier
//   100 tickers → ~151 calls → 1-2 runs/day on free tier
//   500 tickers → ~551 calls → needs paid plan

export const DEFAULT_UNIVERSE = [
  // Mega-cap tech
  "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA", "AVGO",
  // Finance
  "JPM", "V", "MA", "BRK.B",
  // Healthcare
  "UNH", "JNJ", "LLY", "ABBV", "MRK", "TMO", "ABT", "DHR", "BMY",
  // Consumer
  "WMT", "PG", "COST", "HD", "MCD", "PEP", "KO",
  // Energy
  "XOM", "CVX",
  // Industrial
  "HON", "RTX", "ACN", "LIN",
  // Telecom / Media
  "CMCSA", "VZ",
  // Tech
  "CSCO", "TXN",
  // Utilities / Tobacco
  "NEE", "PM",
];

// Uncomment below to expand to S&P 100 when you upgrade API tiers:
// export const EXTENDED_UNIVERSE = [
//   ...DEFAULT_UNIVERSE,
//   "ADBE", "AMD", "AMGN", "AXP", "BA", "BAC", "BLK", "C", "CAT",
//   "CL", "COP", "CRM", "CVS", "DE", "DIS", "DOW", "DUK", "EMR",
//   "F", "FDX", "GD", "GE", "GILD", "GM", "GS", "IBM", "INTC",
//   "ISRG", "KHC", "LOW", "MDT", "MMM", "MO", "MS", "NKE", "ORCL",
//   "PFE", "PYPL", "QCOM", "SBUX", "SCHW", "SO", "SPG", "T", "TGT",
//   "USB", "UNP", "UPS", "WFC",
// ];
