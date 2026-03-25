"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        router.push("/stock");
        router.refresh();
      }
    } catch {
      setError("Connection failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-0 px-4">
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[800px] h-[600px] rounded-full bg-accent/[0.04] blur-[120px]" />
      </div>
      <div className="relative w-full max-w-sm">
        <div className="text-center mb-10">
          <h1 className="font-display text-4xl tracking-tight text-text-primary mb-2">StockPulse</h1>
          <p className="text-sm text-text-tertiary tracking-wide uppercase">Intelligence Platform</p>
        </div>
        <div className="bg-surface-1 border border-border rounded-xl p-8">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="password" className="block text-xs font-medium text-text-secondary mb-2 uppercase tracking-wider">
                Access Code
              </label>
              <input
                id="password" type="password" value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password" autoFocus
                className="w-full px-4 py-3 bg-surface-2 border border-border rounded-lg text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent/40 focus:ring-1 focus:ring-accent/20 transition-colors"
              />
            </div>
            {error && (
              <div className="flex items-center gap-2 px-3 py-2.5 bg-negative/10 border border-negative/20 rounded-lg">
                <svg className="w-4 h-4 text-negative shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-sm text-negative">{error}</span>
              </div>
            )}
            <button type="submit" disabled={loading || !password}
              className="w-full py-3 px-4 bg-accent hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors">
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Authenticating…
                </span>
              ) : "Sign In"}
            </button>
          </form>
        </div>
        <p className="text-center mt-6 text-2xs text-text-tertiary">Protected system · Authorized access only</p>
      </div>
    </div>
  );
}
