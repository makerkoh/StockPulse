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

export const DEFAULT_UNIVERSE = [
  "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA",
  "META", "TSLA", "BRK.B", "JPM", "V",
  "UNH", "XOM", "JNJ", "WMT", "PG",
  "MA", "HD", "CVX", "MRK", "ABBV",
  "LLY", "PEP", "KO", "COST", "AVGO",
  "TMO", "MCD", "ACN", "CSCO", "DHR",
  "ABT", "NEE", "TXN", "PM", "LIN",
  "CMCSA", "VZ", "BMY", "RTX", "HON",
];
