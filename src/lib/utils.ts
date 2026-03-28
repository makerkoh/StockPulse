
// Simple classname joiner (avoids clsx dependency)
export function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(" ");
}

// Format number with commas (null-safe)
export function formatNumber(n: number | null | undefined, decimals = 0): string {
  if (n == null || isNaN(n)) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// Format as currency (null-safe)
export function formatCurrency(n: number | null | undefined, decimals = 2): string {
  if (n == null || isNaN(n)) return "—";
  return "$" + formatNumber(n, decimals);
}

// Format percentage (null-safe)
export function formatPct(n: number | null | undefined, decimals = 2): string {
  if (n == null || isNaN(n)) return "—";
  const sign = n >= 0 ? "+" : "";
  return sign + n.toFixed(decimals) + "%";
}

// Format large numbers (1.2M, 3.4B, etc.) (null-safe)
export function formatCompact(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "—";
  if (n >= 1e12) return (n / 1e12).toFixed(1) + "T";
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toFixed(0);
}

// Deterministic pseudo-random from seed string
export function seededRandom(seed: string): () => number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  }
  return () => {
    h ^= h << 13;
    h ^= h >> 17;
    h ^= h << 5;
    return ((h >>> 0) / 4294967296);
  };
}

// Clamp value between min and max
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// Color class for positive/negative values
export function signColor(value: number): string {
  if (value > 0) return "text-positive";
  if (value < 0) return "text-negative";
  return "text-text-secondary";
}

// Confidence to label
export function confidenceLabel(c: number): string {
  if (c >= 0.8) return "High";
  if (c >= 0.6) return "Medium";
  if (c >= 0.4) return "Low";
  return "Very Low";
}

// Confidence to color
export function confidenceColor(c: number): string {
  if (c >= 0.8) return "bg-emerald-500/20 text-emerald-400";
  if (c >= 0.6) return "bg-sky-500/20 text-sky-400";
  if (c >= 0.4) return "bg-amber-500/20 text-amber-400";
  return "bg-red-500/20 text-red-400";
}

// Delay for async
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Safe JSON parse
export function safeJsonParse<T>(str: string, fallback: T): T {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}
