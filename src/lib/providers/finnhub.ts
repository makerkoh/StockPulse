import type {
  StockQuote,
  PriceBar,
  FundamentalData,
  NewsItem,
  IpoEntry,
  InsiderData,
  AnalystData,
  EarningsData,
} from "@/types";
import type {
  MarketDataProvider,
  FundamentalProvider,
  NewsProvider,
  IpoProvider,
  InsiderProvider,
} from "./interfaces";
import { seededRandom } from "@/lib/utils";

const SECTORS = [
  "Technology", "Healthcare", "Finance", "Energy", "Consumer Discretionary",
  "Consumer Staples", "Industrials", "Materials", "Utilities", "Real Estate",
  "Communication Services",
];

const STOCK_NAMES: Record<string, string> = {
  AAPL: "Apple Inc.", MSFT: "Microsoft Corp.", GOOGL: "Alphabet Inc.",
  AMZN: "Amazon.com Inc.", NVDA: "NVIDIA Corp.", META: "Meta Platforms",
  TSLA: "Tesla Inc.", "BRK.B": "Berkshire Hathaway", JPM: "JPMorgan Chase",
  V: "Visa Inc.", UNH: "UnitedHealth Group", XOM: "Exxon Mobil",
  JNJ: "Johnson & Johnson", WMT: "Walmart Inc.", PG: "Procter & Gamble",
  MA: "Mastercard Inc.", HD: "Home Depot", CVX: "Chevron Corp.",
  MRK: "Merck & Co.", ABBV: "AbbVie Inc.", LLY: "Eli Lilly",
  PEP: "PepsiCo Inc.", KO: "Coca-Cola Co.", COST: "Costco Wholesale",
  AVGO: "Broadcom Inc.", TMO: "Thermo Fisher", MCD: "McDonald's Corp.",
  ACN: "Accenture plc", CSCO: "Cisco Systems", DHR: "Danaher Corp.",
  ABT: "Abbott Labs", NEE: "NextEra Energy", TXN: "Texas Instruments",
  PM: "Philip Morris", LIN: "Linde plc", CMCSA: "Comcast Corp.",
  VZ: "Verizon Comm.", BMY: "Bristol-Myers Squibb", RTX: "RTX Corp.",
  HON: "Honeywell Intl.",
};

function demoQuote(ticker: string): StockQuote {
  const rng = seededRandom(ticker + "quote");
  const price = 50 + rng() * 450;
  const changePct = (rng() - 0.48) * 8;
  return {
    ticker,
    name: STOCK_NAMES[ticker] || ticker,
    sector: SECTORS[Math.floor(rng() * SECTORS.length)],
    price: +price.toFixed(2),
    change: +(price * changePct / 100).toFixed(2),
    changePct: +changePct.toFixed(2),
    volume: Math.floor(rng() * 80_000_000) + 1_000_000,
    marketCap: Math.floor((rng() * 2_500 + 50) * 1e9),
    high52w: +(price * (1 + rng() * 0.4)).toFixed(2),
    low52w: +(price * (1 - rng() * 0.35)).toFixed(2),
  };
}

function demoPrices(ticker: string, from: Date, to: Date): PriceBar[] {
  const rng = seededRandom(ticker + "prices");
  const bars: PriceBar[] = [];
  let price = 100 + rng() * 300;
  const msPerDay = 86_400_000;
  for (let d = from.getTime(); d <= to.getTime(); d += msPerDay) {
    const dt = new Date(d);
    if (dt.getDay() === 0 || dt.getDay() === 6) continue;
    const ret = (rng() - 0.48) * 0.04;
    price *= 1 + ret;
    const high = price * (1 + rng() * 0.02);
    const low = price * (1 - rng() * 0.02);
    bars.push({
      date: dt.toISOString().split("T")[0],
      open: +(price * (1 + (rng() - 0.5) * 0.01)).toFixed(2),
      high: +high.toFixed(2),
      low: +low.toFixed(2),
      close: +price.toFixed(2),
      volume: Math.floor(rng() * 50_000_000) + 500_000,
    });
  }
  return bars;
}

function demoFundamentals(ticker: string): FundamentalData {
  const rng = seededRandom(ticker + "fund");
  return {
    pe: +(10 + rng() * 40).toFixed(1),
    forwardPe: +(8 + rng() * 35).toFixed(1),
    pb: +(1 + rng() * 15).toFixed(1),
    ps: +(0.5 + rng() * 20).toFixed(1),
    evEbitda: +(5 + rng() * 30).toFixed(1),
    debtEquity: +(rng() * 3).toFixed(2),
    roe: +(rng() * 0.4).toFixed(3),
    revenueGrowth: +((rng() - 0.3) * 0.5).toFixed(3),
    earningsGrowth: +((rng() - 0.3) * 0.6).toFixed(3),
    dividendYield: +(rng() * 0.05).toFixed(4),
    beta: +(0.5 + rng() * 1.5).toFixed(2),
  };
}

function demoNews(ticker: string, limit: number): NewsItem[] {
  const rng = seededRandom(ticker + "news");
  const headlines = [
    `${ticker} Reports Strong Quarterly Earnings Beat`,
    `Analysts Upgrade ${ticker} on Growth Outlook`,
    `${ticker} Announces Strategic Partnership`,
    `${ticker} Faces Regulatory Scrutiny in Key Market`,
    `Institutional Investors Increase ${ticker} Holdings`,
    `${ticker} Launches New Product Line Amid Competition`,
    `${ticker} CFO Discusses Capital Allocation Strategy`,
    `Market Volatility Impacts ${ticker} Trading Volume`,
  ];
  return headlines.slice(0, limit).map((h, i) => ({
    id: `news-${ticker}-${i}`,
    headline: h,
    summary: `Analysis and coverage of recent developments at ${STOCK_NAMES[ticker] || ticker}.`,
    source: ["Reuters", "Bloomberg", "CNBC", "WSJ", "MarketWatch"][Math.floor(rng() * 5)],
    url: "#",
    sentiment: +(rng() * 2 - 1).toFixed(2),
    publishedAt: new Date(Date.now() - i * 86_400_000 * (1 + rng() * 3)).toISOString(),
  }));
}

function demoIpos(): IpoEntry[] {
  const ipos = [
    { ticker: "RDDT", companyName: "Reddit Inc.", sector: "Technology" },
    { ticker: "SHEIN", companyName: "Shein Group", sector: "Consumer Discretionary" },
    { ticker: "STRP", companyName: "Stripe Inc.", sector: "Finance" },
    { ticker: "DBXQ", companyName: "Databricks", sector: "Technology" },
    { ticker: "KLRN", companyName: "Klarna Bank", sector: "Finance" },
    { ticker: "CNRY", companyName: "Canary Medical", sector: "Healthcare" },
  ];
  return ipos.map((ipo, i) => {
    const rng = seededRandom(ipo.ticker + "ipo");
    return {
      id: `ipo-${i}`,
      ticker: ipo.ticker,
      companyName: ipo.companyName,
      exchange: "NASDAQ",
      expectedDate: new Date(Date.now() + (i + 1) * 7 * 86_400_000).toISOString().split("T")[0],
      priceRangeLow: +(20 + rng() * 30).toFixed(2),
      priceRangeHigh: +(55 + rng() * 40).toFixed(2),
      shares: Math.floor((rng() * 50 + 10) * 1e6),
      status: "upcoming" as const,
      sector: ipo.sector,
      sentiment: +(rng() * 2 - 0.5).toFixed(2),
      riskScore: +(rng() * 0.8 + 0.1).toFixed(2),
    };
  });
}

// ─── Finnhub Live Implementation ─────────────────────────────────────
export class FinnhubProvider
  implements MarketDataProvider, FundamentalProvider, NewsProvider, IpoProvider, InsiderProvider
{
  name = "finnhub";
  private apiKey: string;
  private baseUrl = "https://finnhub.io/api/v1";

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async fetch<T>(path: string, params: Record<string, string> = {}): Promise<T | null> {
    const url = new URL(this.baseUrl + path);
    url.searchParams.set("token", this.apiKey);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    try {
      const res = await fetch(url.toString(), { next: { revalidate: 300 } });
      if (!res.ok) return null;
      return res.json();
    } catch {
      return null;
    }
  }

  async getQuote(ticker: string): Promise<StockQuote | null> {
    const q = await this.fetch<any>("/quote", { symbol: ticker });
    const p = await this.fetch<any>("/stock/profile2", { symbol: ticker });
    if (!q || !p) return demoQuote(ticker);
    return {
      ticker,
      name: p.name || ticker,
      sector: p.finnhubIndustry || "Unknown",
      price: q.c,
      change: q.d,
      changePct: q.dp,
      volume: q.v || 0,
      marketCap: p.marketCapitalization ? p.marketCapitalization * 1e6 : 0,
      high52w: q.h,
      low52w: q.l,
    };
  }

  async getQuotes(tickers: string[]): Promise<StockQuote[]> {
    return Promise.all(tickers.map((t) => this.getQuote(t).then((q) => q || demoQuote(t))));
  }

  async getHistoricalPrices(ticker: string, from: Date, to: Date): Promise<PriceBar[]> {
    const data = await this.fetch<any>("/stock/candle", {
      symbol: ticker,
      resolution: "D",
      from: Math.floor(from.getTime() / 1000).toString(),
      to: Math.floor(to.getTime() / 1000).toString(),
    });
    if (!data || data.s !== "ok") return demoPrices(ticker, from, to);
    return data.t.map((t: number, i: number) => ({
      date: new Date(t * 1000).toISOString().split("T")[0],
      open: data.o[i],
      high: data.h[i],
      low: data.l[i],
      close: data.c[i],
      volume: data.v[i],
    }));
  }

  async getFundamentals(ticker: string): Promise<FundamentalData | null> {
    const data = await this.fetch<any>("/stock/metric", {
      symbol: ticker,
      metric: "all",
    });
    if (!data?.metric) return demoFundamentals(ticker);
    const m = data.metric;
    return {
      pe: m.peNormalizedAnnual || null,
      forwardPe: m.forwardPeAnnual || null,
      pb: m.pbAnnual || null,
      ps: m.psAnnual || null,
      evEbitda: m["ev/ebitdaAnnual"] || null,
      debtEquity: m.totalDebtToEquityAnnual || null,
      roe: m.roeAnnual || null,
      revenueGrowth: m.revenueGrowthQuarterlyYoy || null,
      earningsGrowth: m.epsGrowthQuarterlyYoy || null,
      dividendYield: m.dividendYieldIndicatedAnnual || null,
      beta: m.beta || null,
    };
  }

  async getNews(ticker: string, limit = 5): Promise<NewsItem[]> {
    const to = new Date().toISOString().split("T")[0];
    const from = new Date(Date.now() - 7 * 86_400_000).toISOString().split("T")[0];
    const data = await this.fetch<any[]>("/company-news", {
      symbol: ticker, from, to,
    });
    if (!data || !Array.isArray(data)) return demoNews(ticker, limit);
    return data.slice(0, limit).map((n, i) => ({
      id: `fh-${ticker}-${i}`,
      headline: n.headline,
      summary: n.summary || "",
      source: n.source || "Finnhub",
      url: n.url || "#",
      sentiment: 0, // Finnhub doesn't provide sentiment inline
      publishedAt: new Date(n.datetime * 1000).toISOString(),
    }));
  }

  async getMarketNews(limit = 10): Promise<NewsItem[]> {
    const data = await this.fetch<any[]>("/news", { category: "general" });
    if (!data || !Array.isArray(data)) return demoNews("MARKET", limit);
    return data.slice(0, limit).map((n, i) => ({
      id: `fh-mkt-${i}`,
      headline: n.headline,
      summary: n.summary || "",
      source: n.source || "Finnhub",
      url: n.url || "#",
      sentiment: 0,
      publishedAt: new Date(n.datetime * 1000).toISOString(),
    }));
  }

  async getUpcomingIpos(): Promise<IpoEntry[]> {
    const from = new Date().toISOString().split("T")[0];
    const to = new Date(Date.now() + 90 * 86_400_000).toISOString().split("T")[0];
    const data = await this.fetch<any>("/calendar/ipo", { from, to });
    if (!data?.ipoCalendar) return demoIpos();
    return data.ipoCalendar.slice(0, 10).map((ipo: any, i: number) => ({
      id: `fh-ipo-${i}`,
      ticker: ipo.symbol || "TBD",
      companyName: ipo.name,
      exchange: ipo.exchange || "NASDAQ",
      expectedDate: ipo.date,
      priceRangeLow: ipo.price ? ipo.price * 0.9 : 20,
      priceRangeHigh: ipo.price ? ipo.price * 1.1 : 40,
      shares: ipo.numberOfShares || 10_000_000,
      status: "upcoming" as const,
      sector: "Unknown",
      sentiment: 0,
      riskScore: 0.5,
    }));
  }

  async getInsiderData(ticker: string): Promise<InsiderData | null> {
    // Fetch insider sentiment (MSPR) from Finnhub
    const from = new Date(Date.now() - 90 * 86_400_000).toISOString().split("T")[0];
    const to = new Date().toISOString().split("T")[0];
    const [sentimentData, txnData] = await Promise.all([
      this.fetch<any>("/stock/insider-sentiment", { symbol: ticker, from, to }),
      this.fetch<any>("/stock/insider-transactions", { symbol: ticker }),
    ]);

    // Extract MSPR (Monthly Share Purchase Ratio)
    let mspr = 0;
    if (sentimentData?.data && Array.isArray(sentimentData.data) && sentimentData.data.length > 0) {
      // Average MSPR over available months
      const msprValues = sentimentData.data.map((d: any) => d.mspr || 0);
      mspr = msprValues.reduce((a: number, b: number) => a + b, 0) / msprValues.length;
    }

    // Count buys vs sells from transactions
    let totalBuys = 0;
    let totalSells = 0;
    let netBuyValue = 0;
    const recentBuyers = new Set<string>();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().split("T")[0];

    if (txnData?.data && Array.isArray(txnData.data)) {
      for (const txn of txnData.data) {
        const change = txn.change || 0;
        const value = Math.abs(change) * (txn.transactionPrice || 0);
        if (change > 0) {
          totalBuys++;
          netBuyValue += value;
          // Track recent buyers for cluster detection
          if (txn.filingDate >= thirtyDaysAgo) {
            recentBuyers.add(txn.name || txn.id);
          }
        } else if (change < 0) {
          totalSells++;
          netBuyValue -= value;
        }
      }
    }

    return {
      mspr,
      totalBuys,
      totalSells,
      netBuyValue,
      clusterBuying: recentBuyers.size >= 3,
    };
  }

  async getAnalystData(ticker: string): Promise<AnalystData | null> {
    const data = await this.fetch<any[]>("/stock/recommendation", { symbol: ticker });
    if (!data || !Array.isArray(data) || data.length === 0) return null;
    const latest = data[0];
    const sb = latest.strongBuy || 0;
    const b = latest.buy || 0;
    const h = latest.hold || 0;
    const s = latest.sell || 0;
    const ss = latest.strongSell || 0;
    const total = sb + b + h + s + ss;
    // Score: weighted average from -1 (all strong sell) to +1 (all strong buy)
    const consensusScore = total > 0
      ? (sb * 1 + b * 0.5 + h * 0 + s * -0.5 + ss * -1) / total
      : 0;

    // Also fetch price target
    const targetData = await this.fetch<any>("/stock/price-target", { symbol: ticker });
    const targetPrice = targetData?.targetMean ?? targetData?.targetMedian ?? null;

    return { targetPrice, strongBuy: sb, buy: b, hold: h, sell: s, strongSell: ss, consensusScore };
  }

  async getEarningsData(ticker: string): Promise<EarningsData | null> {
    const from = new Date().toISOString().split("T")[0];
    const to = new Date(Date.now() + 90 * 86_400_000).toISOString().split("T")[0];
    const [upcoming, surprises] = await Promise.all([
      this.fetch<any>("/calendar/earnings", { symbol: ticker, from, to }),
      this.fetch<any[]>("/stock/earnings", { symbol: ticker, limit: "1" }),
    ]);

    let daysUntilEarnings: number | null = null;
    if (upcoming?.earningsCalendar && Array.isArray(upcoming.earningsCalendar) && upcoming.earningsCalendar.length > 0) {
      const nextDate = upcoming.earningsCalendar[0].date;
      if (nextDate) {
        const diff = new Date(nextDate).getTime() - Date.now();
        daysUntilEarnings = Math.ceil(diff / 86_400_000);
      }
    }

    let lastSurprisePct: number | null = null;
    let lastBeatOrMiss: "beat" | "miss" | "met" | null = null;
    if (surprises && Array.isArray(surprises) && surprises.length > 0) {
      const last = surprises[0];
      if (last.actual != null && last.estimate != null && last.estimate !== 0) {
        lastSurprisePct = ((last.actual - last.estimate) / Math.abs(last.estimate)) * 100;
        lastBeatOrMiss = lastSurprisePct > 1 ? "beat" : lastSurprisePct < -1 ? "miss" : "met";
      }
    }

    return { daysUntilEarnings, lastSurprisePct, lastBeatOrMiss };
  }
}

// ─── Demo Provider (no API key needed) ───────────────────────────────
export class DemoProvider
  implements MarketDataProvider, FundamentalProvider, NewsProvider, IpoProvider
{
  name = "demo";

  async getQuote(ticker: string) { return demoQuote(ticker); }
  async getQuotes(tickers: string[]) { return tickers.map(demoQuote); }
  async getHistoricalPrices(ticker: string, from: Date, to: Date) { return demoPrices(ticker, from, to); }
  async getFundamentals(ticker: string) { return demoFundamentals(ticker); }
  async getNews(ticker: string, limit = 5) { return demoNews(ticker, limit); }
  async getMarketNews(limit = 10) { return demoNews("MARKET", limit); }
  async getUpcomingIpos() { return demoIpos(); }
}
