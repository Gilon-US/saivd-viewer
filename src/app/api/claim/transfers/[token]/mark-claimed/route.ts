import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

const SAIVD_API_ORIGIN = (
  process.env.NEXT_PUBLIC_SAIVD_API_URL ?? "https://saivd.netlify.app"
).replace(/\/+$/, "");

/**
 * POST /api/claim/transfers/[token]/mark-claimed
 * Proxies mark-claimed to the creator app (same-origin from the browser).
 */
export async function POST(
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

  const upstream = `${SAIVD_API_ORIGIN}/api/public/transfers/${encodeURIComponent(token)}/mark-claimed`;
  const res = await fetch(upstream, { method: "POST", cache: "no-store" });
  const body = await res.text();
  return new NextResponse(body, {
    status: res.status,
    headers: {
      "Content-Type": res.headers.get("Content-Type") ?? "application/json",
    },
  });
}
