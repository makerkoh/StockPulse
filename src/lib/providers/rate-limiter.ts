// ─── Token Bucket Rate Limiter ──────────────────────────────────────
export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillRate: number; // tokens per ms

  constructor(maxCalls: number, windowMs: number) {
    this.maxTokens = maxCalls;
    this.tokens = maxCalls;
    this.lastRefill = Date.now();
    this.refillRate = maxCalls / windowMs;
  }

  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }
    // Wait until a token is available
    const waitMs = Math.ceil((1 - this.tokens) / this.refillRate);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    this.refill();
    this.tokens -= 1;
  }

  private refill() {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }
}

// ─── Cached Fetcher ─────────────────────────────────────────────────
interface CacheEntry<T> {
  data: T;
  expiry: number;
}

export class CachedFetcher {
  private cache = new Map<string, CacheEntry<unknown>>();
  private limiter: RateLimiter;
  private defaultTtlMs: number;

  constructor(limiter: RateLimiter, defaultTtlMs: number) {
    this.limiter = limiter;
    this.defaultTtlMs = defaultTtlMs;
  }

  /** Count of API calls that returned rate limit errors (429 or limit messages) */
  rateLimitHits = 0;
  /** Count of total API calls made */
  totalCalls = 0;
  /** Whether we've detected the daily limit has been reached */
  limitReached = false;

  async fetch<T>(url: string, ttlMs?: number): Promise<T | null> {
    const ttl = ttlMs ?? this.defaultTtlMs;
    const cached = this.cache.get(url);
    if (cached && cached.expiry > Date.now()) {
      return cached.data as T;
    }

    await this.limiter.acquire();
    this.totalCalls++;
    try {
      const res = await fetch(url);
      if (res.status === 429) {
        this.rateLimitHits++;
        this.limitReached = true;
        console.warn(`[rate-limiter] 429 Rate limit hit on: ${url.split("?")[0]}`);
        return null;
      }
      if (!res.ok) return null;
      const data = await res.json();
      // Some APIs return error messages in JSON instead of HTTP 429
      if (data && typeof data === "object" && "Error Message" in data) {
        this.rateLimitHits++;
        this.limitReached = true;
        console.warn(`[rate-limiter] API limit message: ${data["Error Message"]}`);
        return null;
      }
      this.cache.set(url, { data, expiry: Date.now() + ttl });
      return data as T;
    } catch {
      return null;
    }
  }
}

// ─── Pre-configured limiters ────────────────────────────────────────
export const FINNHUB_LIMITER = new RateLimiter(55, 60_000);       // 60/min with margin
export const FMP_LIMITER = new RateLimiter(240, 86_400_000);      // 250/day with margin
export const AV_LIMITER = new RateLimiter(23, 86_400_000);        // 25/day with margin

/** Get API limit status across all providers */
export function getApiLimitStatus(): {
  fmpLimitReached: boolean;
  avLimitReached: boolean;
  fmpCalls: number;
  avCalls: number;
} {
  // Access the fetchers' limit status — they'll be imported by providers
  return {
    fmpLimitReached: _fmpFetcher?.limitReached ?? false,
    avLimitReached: _avFetcher?.limitReached ?? false,
    fmpCalls: _fmpFetcher?.totalCalls ?? 0,
    avCalls: _avFetcher?.totalCalls ?? 0,
  };
}

// Module-level references for status tracking
let _fmpFetcher: CachedFetcher | null = null;
let _avFetcher: CachedFetcher | null = null;
export function registerFetcher(provider: "fmp" | "av", fetcher: CachedFetcher) {
  if (provider === "fmp") _fmpFetcher = fetcher;
  if (provider === "av") _avFetcher = fetcher;
}

// TTL constants
export const TTL = {
  QUOTE: 5 * 60_000,           // 5 minutes
  PRICES: 60 * 60_000,         // 1 hour
  FUNDAMENTALS: 24 * 60 * 60_000, // 24 hours
  TECHNICALS: 24 * 60 * 60_000,   // 24 hours
  ECONOMIC: 24 * 60 * 60_000,     // 24 hours
  NEWS: 15 * 60_000,           // 15 minutes
} as const;
