import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { getRunHistory } from "@/lib/services/persistence";

export async function GET() {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const runs = await getRunHistory(20);
    return NextResponse.json({ data: runs });
  } catch (err) {
    console.error("Run history error:", err);
    return NextResponse.json({ error: "Failed to fetch run history" }, { status: 500 });
  }
}
