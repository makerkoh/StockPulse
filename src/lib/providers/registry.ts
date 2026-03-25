import { FinnhubProvider, DemoProvider } from "./finnhub";
import { FmpProvider } from "./fmp";
import { AlphaVantageProvider } from "./alpha-vantage";
import { AggregatedProvider } from "./aggregated";

let _provider: AggregatedProvider | null = null;

export function getProvider(): AggregatedProvider {
  if (_provider) return _provider;

  const demo = new DemoProvider();

  const finnhubKey = process.env.FINNHUB_API_KEY;
  const fmpKey = process.env.FMP_API_KEY;
  const avKey = process.env.ALPHA_VANTAGE_API_KEY;

  _provider = new AggregatedProvider({
    finnhub: finnhubKey && finnhubKey.length > 0 ? new FinnhubProvider(finnhubKey) : undefined,
    fmp: fmpKey && fmpKey.length > 0 ? new FmpProvider(fmpKey) : undefined,
    alphaVantage: avKey && avKey.length > 0 ? new AlphaVantageProvider(avKey) : undefined,
    demo,
  });

  return _provider;
}

export function isDemo(): boolean {
  return getProvider().name === "demo";
}
