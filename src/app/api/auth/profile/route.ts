import { NextResponse } from "next/server";
import { z } from "zod";
import { cookies } from "next/headers";
import { PROFILES, PROFILE_COOKIE, type ProfileId } from "@/lib/profiles";
import { createSessionToken, SESSION_COOKIE } from "@/lib/session";
import { sessionCookieOptions } from "@/lib/session-server";

export const dynamic = "force-dynamic";

const schema = z.object({
  profileId: z.enum(["printing", "dina", "nabil"]),
});

export async function GET() {
  const store = await cookies();
  const id = (store.get(PROFILE_COOKIE)?.value || "printing") as ProfileId;
  const profile = PROFILES[id] || PROFILES.printing;
  return NextResponse.json({ profile });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid profile" }, { status: 400 });
    }

    const { profileId } = parsed.data;
    const profile = PROFILES[profileId];

    // Create session token to authenticate future API calls
    const sessionToken = await createSessionToken();

    const response = NextResponse.json({ ok: true, profile });

    // Set cookies directly on response headers - 100% compatible with Node, Vercel, and Cloudflare Workers
    response.cookies.set(SESSION_COOKIE, sessionToken, sessionCookieOptions());
    response.cookies.set(PROFILE_COOKIE, profileId, {
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // 30 days
      sameSite: "lax",
      httpOnly: false,
    });

    return response;
  } catch (err) {
    console.error("[api/auth/profile] Error switching profile:", err);
    return NextResponse.json(
      {
        error: "Failed to switch profile",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(PROFILE_COOKIE, "", { path: "/", maxAge: 0 });
  response.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}

