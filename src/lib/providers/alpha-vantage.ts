import type {
  StockQuote,
  PriceBar,
  TechnicalIndicators,
  EconomicContext,
} from "@/types";
import type {
  MarketDataProvider,
  TechnicalProvider,
  EconomicProvider,
} from "./interfaces";
import { CachedFetcher, AV_LIMITER, TTL } from "./rate-limiter";

const BASE_URL = "https://www.alphavantage.co/query";

export class AlphaVantageProvider
  implements MarketDataProvider, TechnicalProvider, EconomicProvider
{
  name = "alphavantage";
  private apiKey: string;
  private fetcher: CachedFetcher;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.fetcher = new CachedFetcher(AV_LIMITER, TTL.TECHNICALS);
  }

  private url(params: Record<string, string>): string {
    const url = new URL(BASE_URL);
    url.searchParams.set("apikey", this.apiKey);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return url.toString();
  }

  // Extract the latest value from an AV technical indicator response
  private latestValue(data: any, seriesKey: string, valueKey: string): number | null {
    const series = data?.[seriesKey];
    if (!series) return null;
    const dates = Object.keys(series);
    if (dates.length === 0) return null;
    // AV returns newest first
    const val = parseFloat(series[dates[0]]?.[valueKey]);
    return isNaN(val) ? null : val;
  }

  async getQuote(ticker: string): Promise<StockQuote | null> {
    const data = await this.fetcher.fetch<any>(
      this.url({ function: "GLOBAL_QUOTE", symbol: ticker }),
      TTL.QUOTE
    );
    const q = data?.["Global Quote"];
    if (!q || !q["05. price"]) return null;
    return {
      ticker,
      name: ticker,
      sector: "Unknown",
      price: parseFloat(q["05. price"]) || 0,
      change: parseFloat(q["09. change"]) || 0,
      changePct: parseFloat(q["10. change percent"]?.replace("%", "")) || 0,
      volume: parseInt(q["06. volume"]) || 0,
      marketCap: 0,
      high52w: parseFloat(q["03. high"]) || 0,
      low52w: parseFloat(q["04. low"]) || 0,
    };
  }

  async getQuotes(tickers: string[]): Promise<StockQuote[]> {
    // AV has no batch endpoint — fetch sequentially to respect rate limits
    const results: StockQuote[] = [];
    for (const ticker of tickers) {
      const q = await this.getQuote(ticker);
      if (q) results.push(q);
    }
    return results;
  }

  async getHistoricalPrices(ticker: string, from: Date, to: Date): Promise<PriceBar[]> {
    const data = await this.fetcher.fetch<any>(
      this.url({ function: "TIME_SERIES_DAILY", symbol: ticker, outputsize: "full" }),
      TTL.PRICES
    );
    const series = data?.["Time Series (Daily)"];
    if (!series) return [];
    const fromStr = from.toISOString().split("T")[0];
    const toStr = to.toISOString().split("T")[0];
    return Object.entries(series)
      .filter(([date]) => date >= fromStr && date <= toStr)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, bar]: [string, any]) => ({
        date,
        open: parseFloat(bar["1. open"]),
        high: parseFloat(bar["2. high"]),
        low: parseFloat(bar["3. low"]),
        close: parseFloat(bar["4. close"]),
        volume: parseInt(bar["5. volume"]),
      }));
  }

  async getTechnicalIndicators(ticker: string): Promise<TechnicalIndicators | null> {
    // Fetch multiple indicators in parallel (each costs 1 API call)
    const [rsiData, macdData, bbandsData, stochData, adxData, cciData] = await Promise.all([
      this.fetcher.fetch<any>(
        this.url({ function: "RSI", symbol: ticker, interval: "daily", time_period: "14", series_type: "close" }),
        TTL.TECHNICALS
      ),
      this.fetcher.fetch<any>(
        this.url({ function: "MACD", symbol: ticker, interval: "daily", series_type: "close" }),
        TTL.TECHNICALS
      ),
      this.fetcher.fetch<any>(
        this.url({ function: "BBANDS", symbol: ticker, interval: "daily", time_period: "20", series_type: "close" }),
        TTL.TECHNICALS
      ),
      this.fetcher.fetch<any>(
        this.url({ function: "STOCH", symbol: ticker, interval: "daily" }),
        TTL.TECHNICALS
      ),
      this.fetcher.fetch<any>(
        this.url({ function: "ADX", symbol: ticker, interval: "daily", time_period: "14" }),
        TTL.TECHNICALS
      ),
      this.fetcher.fetch<any>(
        this.url({ function: "CCI", symbol: ticker, interval: "daily", time_period: "20" }),
        TTL.TECHNICALS
      ),
    ]);

    // If we got nothing back, return null
    if (!rsiData && !macdData) return null;

    // Also fetch SMA/EMA for completeness
    const [sma50Data, sma200Data] = await Promise.all([
      this.fetcher.fetch<any>(
        this.url({ function: "SMA", symbol: ticker, interval: "daily", time_period: "50", series_type: "close" }),
        TTL.TECHNICALS
      ),
      this.fetcher.fetch<any>(
        this.url({ function: "SMA", symbol: ticker, interval: "daily", time_period: "200", series_type: "close" }),
        TTL.TECHNICALS
      ),
    ]);

    return {
      sma50: this.latestValue(sma50Data, "Technical Analysis: SMA", "SMA"),
      sma200: this.latestValue(sma200Data, "Technical Analysis: SMA", "SMA"),
      ema12: null, // computed locally, not worth an API call
      ema26: null,
      rsi14: this.latestValue(rsiData, "Technical Analysis: RSI", "RSI"),
      macd: this.latestValue(macdData, "Technical Analysis: MACD", "MACD"),
      macdSignal: this.latestValue(macdData, "Technical Analysis: MACD", "MACD_Signal"),
      macdHist: this.latestValue(macdData, "Technical Analysis: MACD", "MACD_Hist"),
      bollingerUpper: this.latestValue(bbandsData, "Technical Analysis: BBANDS", "Real Upper Band"),
      bollingerLower: this.latestValue(bbandsData, "Technical Analysis: BBANDS", "Real Lower Band"),
      stochK: this.latestValue(stochData, "Technical Analysis: STOCH", "SlowK"),
      stochD: this.latestValue(stochData, "Technical Analysis: STOCH", "SlowD"),
      adx: this.latestValue(adxData, "Technical Analysis: ADX", "ADX"),
      cci: this.latestValue(cciData, "Technical Analysis: CCI", "CCI"),
    };
  }

  async getEconomicContext(): Promise<EconomicContext | null> {
    const [gdpData, cpiData, unempData, fedData, treasuryData] = await Promise.all([
      this.fetcher.fetch<any>(
        this.url({ function: "REAL_GDP", interval: "quarterly" }),
        TTL.ECONOMIC
      ),
      this.fetcher.fetch<any>(
        this.url({ function: "CPI", interval: "monthly" }),
        TTL.ECONOMIC
      ),
      this.fetcher.fetch<any>(
        this.url({ function: "UNEMPLOYMENT" }),
        TTL.ECONOMIC
      ),
      this.fetcher.fetch<any>(
        this.url({ function: "FEDERAL_FUNDS_RATE", interval: "daily" }),
        TTL.ECONOMIC
      ),
      this.fetcher.fetch<any>(
        this.url({ function: "TREASURY_YIELD", interval: "monthly", maturity: "10year" }),
        TTL.ECONOMIC
      ),
    ]);

    const latestFromSeries = (data: any): number | null => {
      const entries = data?.data;
      if (!Array.isArray(entries) || entries.length === 0) return null;
      const val = parseFloat(entries[0].value);
      return isNaN(val) ? null : val;
    };

    // Compute GDP growth as % change between two quarters
    let gdpGrowth: number | null = null;
    const gdpEntries = gdpData?.data;
    if (Array.isArray(gdpEntries) && gdpEntries.length >= 2) {
      const current = parseFloat(gdpEntries[0].value);
      const previous = parseFloat(gdpEntries[1].value);
      if (!isNaN(current) && !isNaN(previous) && previous !== 0) {
        gdpGrowth = ((current - previous) / previous) * 100;
      }
    }

    return {
      gdpGrowth,
      cpiYoy: latestFromSeries(cpiData),
      unemploymentRate: latestFromSeries(unempData),
      fedFundsRate: latestFromSeries(fedData),
      treasuryYield10y: latestFromSeries(treasuryData),
    };
  }
}
