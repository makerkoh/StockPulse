import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { getProvider } from "@/lib/providers/registry";

export const maxDuration = 15;

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const provider = getProvider();
    const ipos = await provider.getUpcomingIpos();

    // Default to 30-day window (captures more IPOs than 2 weeks)
    const daysParam = req.nextUrl.searchParams.get("days");
    const days = daysParam ? parseInt(daysParam) : 30;
    const cutoff = new Date(Date.now() + days * 86_400_000).toISOString().split("T")[0];
    const today = new Date().toISOString().split("T")[0];

    const filtered = ipos.filter((ipo) => {
      if (!ipo.expectedDate) return true; // Include if no date (show all)
      return ipo.expectedDate >= today && ipo.expectedDate <= cutoff;
    });

    filtered.sort((a, b) => a.expectedDate.localeCompare(b.expectedDate));

    return NextResponse.json({ data: filtered });
  } catch (err) {
    console.error("IPO fetch error:", err);
    return NextResponse.json({ error: "Failed to fetch IPO calendar" }, { status: 500 });
  }
}
