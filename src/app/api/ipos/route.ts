import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { getProvider } from "@/lib/providers/registry";

export const maxDuration = 15;

export async function GET() {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const provider = getProvider();
    const ipos = await provider.getUpcomingIpos();

    // Filter to next 2 weeks
    const twoWeeksOut = new Date(Date.now() + 14 * 86_400_000).toISOString().split("T")[0];
    const today = new Date().toISOString().split("T")[0];
    const filtered = ipos.filter((ipo) => ipo.expectedDate >= today && ipo.expectedDate <= twoWeeksOut);

    // Sort by date
    filtered.sort((a, b) => a.expectedDate.localeCompare(b.expectedDate));

    return NextResponse.json({ data: filtered });
  } catch (err) {
    console.error("IPO fetch error:", err);
    return NextResponse.json({ error: "Failed to fetch IPO calendar" }, { status: 500 });
  }
}
