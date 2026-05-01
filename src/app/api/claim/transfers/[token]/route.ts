import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

const SAIVD_API_ORIGIN = (
  process.env.NEXT_PUBLIC_SAIVD_API_URL ?? "https://saivd.netlify.app"
).replace(/\/+$/, "");

/**
 * GET /api/claim/transfers/[token]
 * Proxies transfer metadata from the creator app so the browser never cross-origin
 * fetches SAIVD_API_ORIGIN (avoids CORS / Safari "Load failed" on claim links).
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "unauthorized", message: "Authentication required" },
      },
      { status: 401 },
    );
  }

  const upstream = `${SAIVD_API_ORIGIN}/api/public/transfers/${encodeURIComponent(token)}`;
  const res = await fetch(upstream, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  const body = await res.text();
  return new NextResponse(body, {
    status: res.status,
    headers: {
      "Content-Type": res.headers.get("Content-Type") ?? "application/json",
    },
  });
}
