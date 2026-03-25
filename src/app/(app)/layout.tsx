import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import Link from "next/link";

const NAV_ITEMS = [
  { href: "/stock", label: "Dashboard", icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1" },
  { href: "/backtest", label: "Backtest", icon: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" },
  { href: "/settings", label: "Settings", icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session.isLoggedIn) redirect("/login");

  return (
    <div className="flex min-h-screen">
      <aside className="hidden md:flex flex-col w-56 bg-surface-1 border-r border-border shrink-0">
        <div className="px-5 py-6 border-b border-border">
          <Link href="/stock">
            <span className="font-display text-xl tracking-tight text-text-primary">StockPulse</span>
            <span className="block text-2xs text-text-tertiary uppercase tracking-widest mt-0.5">Intelligence</span>
          </Link>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV_ITEMS.map((item) => (
            <Link key={item.href} href={item.href}
              className="flex items-center gap-3 px-3 py-2.5 text-sm text-text-secondary hover:text-text-primary hover:bg-surface-2 rounded-lg transition-colors group">
              <svg className="w-[18px] h-[18px] text-text-tertiary group-hover:text-accent transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
              </svg>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="px-5 py-4 border-t border-border">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-positive animate-pulse" />
            <span className="text-2xs text-text-tertiary">System Online</span>
          </div>
        </div>
      </aside>
      <div className="md:hidden fixed top-0 inset-x-0 z-50 bg-surface-1/90 backdrop-blur-md border-b border-border px-4 py-3 flex items-center justify-between">
        <span className="font-display text-lg text-text-primary">StockPulse</span>
        <div className="flex gap-4">
          {NAV_ITEMS.map((item) => (
            <Link key={item.href} href={item.href} className="text-xs text-text-secondary hover:text-text-primary transition-colors">{item.label}</Link>
          ))}
        </div>
      </div>
      <main className="flex-1 md:pt-0 pt-14 overflow-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">{children}</div>
      </main>
    </div>
  );
}
