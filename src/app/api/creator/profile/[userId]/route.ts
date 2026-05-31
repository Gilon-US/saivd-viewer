import {NextRequest, NextResponse} from "next/server";

const SAIVD_API_ORIGIN = (
  process.env.NEXT_PUBLIC_SAIVD_API_URL ?? "https://saivd.netlify.app"
).replace(/\/+$/, "");

/**
 * GET /api/creator/profile/[userId]
 * Proxies public creator profile metadata so the browser never cross-origin
 * fetches SAIVD_API_ORIGIN (avoids CORS in local dev and strict browsers).
 */
export async function GET(
  _request: NextRequest,
  context: {params: Promise<{userId: string}>},
) {
  const {userId} = await context.params;

  if (!/^[0-9]+$/.test(userId)) {
    return NextResponse.json({success: false, error: "Invalid user ID format"}, {status: 400});
  }

  const upstream = `${SAIVD_API_ORIGIN}/api/profile/${encodeURIComponent(userId)}`;
  const res = await fetch(upstream, {
    cache: "no-store",
    headers: {Accept: "application/json"},
  });
  const body = await res.text();
  return new NextResponse(body, {
    status: res.status,
    headers: {
      "Content-Type": res.headers.get("Content-Type") ?? "application/json",
      "Cache-Control": "no-store",
    },
  });
}
