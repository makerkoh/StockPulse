import type {
  StockQuote,
  PriceBar,
  FundamentalData,
  ExtendedFundamentals,
} from "@/types";
import type { MarketDataProvider, FundamentalProvider } from "./interfaces";
import { CachedFetcher, FMP_LIMITER, TTL } from "./rate-limiter";

const BASE_URL = "https://financialmodelingprep.com/api/v3";

export class FmpProvider implements MarketDataProvider, FundamentalProvider {
  name = "fmp";
  private apiKey: string;
  private fetcher: CachedFetcher;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.fetcher = new CachedFetcher(FMP_LIMITER, TTL.FUNDAMENTALS);
  }

  private url(path: string, params: Record<string, string> = {}): string {
    const url = new URL(BASE_URL + path);
    url.searchParams.set("apikey", this.apiKey);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return url.toString();
  }

  async getQuote(ticker: string): Promise<StockQuote | null> {
    const data = await this.fetcher.fetch<any[]>(
      this.url(`/quote/${encodeURIComponent(ticker)}`),
      TTL.QUOTE
    );
    if (!data || !data[0]) return null;
    const q = data[0];
    return {
      ticker,
      name: q.name || ticker,
      sector: q.sector || "Unknown",
      price: q.price ?? 0,
      change: q.change ?? 0,
      changePct: q.changesPercentage ?? 0,
      volume: q.volume ?? 0,
      marketCap: q.marketCap ?? 0,
      high52w: q.yearHigh ?? 0,
      low52w: q.yearLow ?? 0,
    };
  }

  async getQuotes(tickers: string[]): Promise<StockQuote[]> {
    // FMP supports batch quotes — single API call for all tickers
    const csv = tickers.join(",");
    const data = await this.fetcher.fetch<any[]>(
      this.url(`/quote/${encodeURIComponent(csv)}`),
      TTL.QUOTE
    );
    if (!data || !Array.isArray(data)) return [];
    return data.map((q) => ({
      ticker: q.symbol,
      name: q.name || q.symbol,
      sector: q.sector || "Unknown",
      price: q.price ?? 0,
      change: q.change ?? 0,
      changePct: q.changesPercentage ?? 0,
      volume: q.volume ?? 0,
      marketCap: q.marketCap ?? 0,
      high52w: q.yearHigh ?? 0,
      low52w: q.yearLow ?? 0,
    }));
  }

  async getHistoricalPrices(ticker: string, from: Date, to: Date): Promise<PriceBar[]> {
    const fromStr = from.toISOString().split("T")[0];
    const toStr = to.toISOString().split("T")[0];
    const data = await this.fetcher.fetch<any>(
      this.url(`/historical-price-full/${encodeURIComponent(ticker)}`, { from: fromStr, to: toStr }),
      TTL.PRICES
    );
    if (!data?.historical || !Array.isArray(data.historical)) return [];
    // FMP returns newest-first, reverse to oldest-first
    return data.historical
      .reverse()
      .map((bar: any) => ({
        date: bar.date,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
      }));
  }

  async getFundamentals(ticker: string): Promise<ExtendedFundamentals | null> {
    // Fetch ratios, key metrics, and DCF in parallel
    const [ratios, metrics, dcfData] = await Promise.all([
      this.fetcher.fetch<any[]>(
        this.url(`/ratios/${encodeURIComponent(ticker)}`, { limit: "1" }),
        TTL.FUNDAMENTALS
      ),
      this.fetcher.fetch<any[]>(
        this.url(`/key-metrics/${encodeURIComponent(ticker)}`, { limit: "1" }),
        TTL.FUNDAMENTALS
      ),
      this.fetcher.fetch<any[]>(
        this.url(`/discounted-cash-flow/${encodeURIComponent(ticker)}`),
        TTL.FUNDAMENTALS
      ),
    ]);

    const r = ratios?.[0] || {};
    const m = metrics?.[0] || {};
    const d = dcfData?.[0] || {};

    if (!ratios?.[0] && !metrics?.[0]) return null;

    return {
      // Base FundamentalData fields
      pe: r.priceEarningsRatio ?? null,
      forwardPe: r.forwardPE ?? r.priceEarningsRatio ?? null,
      pb: r.priceToBookRatio ?? null,
      ps: r.priceToSalesRatio ?? null,
      evEbitda: m.enterpriseValueOverEBITDA ?? null,
      debtEquity: r.debtEquityRatio ?? null,
      roe: r.returnOnEquity ?? null,
      revenueGrowth: m.revenueGrowth ?? null,
      earningsGrowth: m.netIncomeGrowth ?? null,
      dividendYield: r.dividendYield ?? null,
      beta: m.beta ?? null,
      // Extended fields
      dcf: d.dcf ?? null,
      currentRatio: r.currentRatio ?? null,
      quickRatio: r.quickRatio ?? null,
      grossMargin: r.grossProfitMargin ?? null,
      operatingMargin: r.operatingProfitMargin ?? null,
      netMargin: r.netProfitMargin ?? null,
      freeCashFlowPerShare: m.freeCashFlowPerShare ?? null,
      revenuePerShare: m.revenuePerShare ?? null,
      payoutRatio: r.payoutRatio ?? null,
    };
  }
}
