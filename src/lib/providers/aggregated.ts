import type {
  StockQuote,
  PriceBar,
  FundamentalData,
  NewsItem,
  IpoEntry,
  TechnicalIndicators,
  EconomicContext,
} from "@/types";
import type {
  MarketDataProvider,
  FundamentalProvider,
  NewsProvider,
  IpoProvider,
  TechnicalProvider,
  EconomicProvider,
} from "./interfaces";
import type { FinnhubProvider, DemoProvider } from "./finnhub";
import type { FmpProvider } from "./fmp";
import type { AlphaVantageProvider } from "./alpha-vantage";

export class AggregatedProvider
  implements
    MarketDataProvider,
    FundamentalProvider,
    NewsProvider,
    IpoProvider,
    TechnicalProvider,
    EconomicProvider
{
  name: string;
  private finnhub?: FinnhubProvider;
  private fmp?: FmpProvider;
  private alphaVantage?: AlphaVantageProvider;
  private demo: DemoProvider;

  constructor(options: {
    finnhub?: FinnhubProvider;
    fmp?: FmpProvider;
    alphaVantage?: AlphaVantageProvider;
    demo: DemoProvider;
  }) {
    this.finnhub = options.finnhub;
    this.fmp = options.fmp;
    this.alphaVantage = options.alphaVantage;
    this.demo = options.demo;
    // "demo" if no real providers, "aggregated" otherwise
    this.name = this.finnhub || this.fmp || this.alphaVantage ? "aggregated" : "demo";
  }

  // ─── Quotes: Finnhub (real-time) → FMP (batch) → Demo ────────────
  async getQuote(ticker: string): Promise<StockQuote | null> {
    if (this.finnhub) {
      const result = await this.finnhub.getQuote(ticker);
      if (result) return result;
    }
    if (this.fmp) {
      const result = await this.fmp.getQuote(ticker);
      if (result) return result;
    }
    return this.demo.getQuote(ticker);
  }

  async getQuotes(tickers: string[]): Promise<StockQuote[]> {
    // Prefer FMP batch endpoint (1 API call for all tickers)
    if (this.fmp) {
      const results = await this.fmp.getQuotes(tickers);
      if (results.length > 0) return results;
    }
    if (this.finnhub) {
      return this.finnhub.getQuotes(tickers);
    }
    return this.demo.getQuotes(tickers);
  }

  // ─── Historical Prices: Finnhub → FMP → Demo ─────────────────────
  async getHistoricalPrices(ticker: string, from: Date, to: Date): Promise<PriceBar[]> {
    if (this.finnhub) {
      const result = await this.finnhub.getHistoricalPrices(ticker, from, to);
      if (result.length > 0) return result;
    }
    if (this.fmp) {
      const result = await this.fmp.getHistoricalPrices(ticker, from, to);
      if (result.length > 0) return result;
    }
    return this.demo.getHistoricalPrices(ticker, from, to);
  }

  // ─── Fundamentals: FMP (richer) → Finnhub → Demo ─────────────────
  async getFundamentals(ticker: string): Promise<FundamentalData | null> {
    if (this.fmp) {
      const result = await this.fmp.getFundamentals(ticker);
      if (result) return result;
    }
    if (this.finnhub) {
      const result = await this.finnhub.getFundamentals(ticker);
      if (result) return result;
    }
    return this.demo.getFundamentals(ticker);
  }

  // ─── News: Finnhub → Demo ────────────────────────────────────────
  async getNews(ticker: string, limit = 5): Promise<NewsItem[]> {
    if (this.finnhub) {
      const result = await this.finnhub.getNews(ticker, limit);
      if (result.length > 0) return result;
    }
    return this.demo.getNews(ticker, limit);
  }

  async getMarketNews(limit = 10): Promise<NewsItem[]> {
    if (this.finnhub) {
      const result = await this.finnhub.getMarketNews(limit);
      if (result.length > 0) return result;
    }
    return this.demo.getMarketNews(limit);
  }

  // ─── IPOs: Finnhub → Demo ────────────────────────────────────────
  async getUpcomingIpos(): Promise<IpoEntry[]> {
    if (this.finnhub) {
      const result = await this.finnhub.getUpcomingIpos();
      if (result.length > 0) return result;
    }
    return this.demo.getUpcomingIpos();
  }

  // ─── Technical Indicators: Alpha Vantage only ─────────────────────
  async getTechnicalIndicators(ticker: string): Promise<TechnicalIndicators | null> {
    if (this.alphaVantage) {
      return this.alphaVantage.getTechnicalIndicators(ticker);
    }
    return null;
  }

  // ─── Economic Context: Alpha Vantage only ─────────────────────────
  async getEconomicContext(): Promise<EconomicContext | null> {
    if (this.alphaVantage) {
      return this.alphaVantage.getEconomicContext();
    }
    return null;
  }
}
