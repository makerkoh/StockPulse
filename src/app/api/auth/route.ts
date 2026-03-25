import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import bcrypt from "bcryptjs";

// Default dev password: "stockpulse"
const DEFAULT_HASH = "$2a$10$8K1p/a0dL1LXMIgoEDFrwO5lPvHqKilAl5.jG3cOaGjU5OvPzU0y6";

export async function POST(req: NextRequest) {
  try {
    const { password } = await req.json();
    if (!password) {
      return NextResponse.json({ error: "Password required" }, { status: 400 });
    }

    const storedHash = process.env.APP_PASSWORD_HASH || DEFAULT_HASH;
    const valid = await bcrypt.compare(password, storedHash);

    if (!valid) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }

    const session = await getSession();
    session.isLoggedIn = true;
    session.loginAt = Date.now();
    await session.save();

    return NextResponse.json({ data: { success: true } });
  } catch (err) {
    console.error("Auth error:", err);
    return NextResponse.json({ error: "Authentication failed" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const session = await getSession();
    session.destroy();
    return NextResponse.json({ data: { success: true } });
  } catch {
    return NextResponse.json({ error: "Logout failed" }, { status: 500 });
  }
}
