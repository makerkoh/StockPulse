import type {
  StockQuote,
  PriceBar,
  FundamentalData,
  NewsItem,
  IpoEntry,
  TechnicalIndicators,
  EconomicContext,
  InsiderData,
  AnalystData,
  EarningsData,
} from "@/types";
import type {
  MarketDataProvider,
  FundamentalProvider,
  NewsProvider,
  IpoProvider,
  TechnicalProvider,
  EconomicProvider,
  InsiderProvider,
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
    EconomicProvider,
    InsiderProvider
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

  // ─── IPOs: Merge Finnhub + FMP for best coverage → Demo ──────────
  async getUpcomingIpos(): Promise<IpoEntry[]> {
    const results: IpoEntry[] = [];
    const seenTickers = new Set<string>();

    // Fetch from both sources in parallel
    const [finnhubIpos, fmpIpos] = await Promise.all([
      this.finnhub ? this.finnhub.getUpcomingIpos() : Promise.resolve([]),
      this.fmp ? this.fmp.getUpcomingIpos() : Promise.resolve([]),
    ]);

    // Merge, deduplicating by ticker
    for (const ipo of [...finnhubIpos, ...fmpIpos]) {
      if (!seenTickers.has(ipo.ticker)) {
        seenTickers.add(ipo.ticker);
        results.push(ipo);
      }
    }

    // Sort by date
    results.sort((a, b) => a.expectedDate.localeCompare(b.expectedDate));

    if (results.length > 0) return results;
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

  // ─── Insider Data: Finnhub only ───────────────────────────────────
  async getInsiderData(ticker: string): Promise<InsiderData | null> {
    if (this.finnhub) {
      return this.finnhub.getInsiderData(ticker);
    }
    return null;
  }

  // ─── Analyst Data: Finnhub only ───────────────────────────────────
  async getAnalystData(ticker: string): Promise<AnalystData | null> {
    if (this.finnhub) {
      return this.finnhub.getAnalystData(ticker);
    }
    return null;
  }

  // ─── Earnings Data: Finnhub only ──────────────────────────────────
  async getEarningsData(ticker: string): Promise<EarningsData | null> {
    if (this.finnhub) {
      return this.finnhub.getEarningsData(ticker);
    }
    return null;
  }
}
