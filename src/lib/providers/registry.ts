import { FinnhubProvider, DemoProvider } from "./finnhub";
import type {
  MarketDataProvider,
  FundamentalProvider,
  NewsProvider,
  IpoProvider,
} from "./interfaces";

type UnifiedProvider = MarketDataProvider & FundamentalProvider & NewsProvider & IpoProvider;

let _provider: UnifiedProvider | null = null;

export function getProvider(): UnifiedProvider {
  if (_provider) return _provider;

  const finnhubKey = process.env.FINNHUB_API_KEY;
  if (finnhubKey && finnhubKey.length > 0) {
    _provider = new FinnhubProvider(finnhubKey);
  } else {
    _provider = new DemoProvider();
  }

  return _provider;
}

export function isDemo(): boolean {
  return getProvider().name === "demo";
}
