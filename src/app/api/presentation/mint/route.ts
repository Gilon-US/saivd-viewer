import {NextRequest, NextResponse} from "next/server";

const SAIVD_API_ORIGIN = (
  process.env.NEXT_PUBLIC_SAIVD_API_URL ?? "https://saivd.netlify.app"
).replace(/\/+$/, "");

/** Proxy presentation QR mint to the creator app (avoids browser CORS). */
export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const upstream = `${SAIVD_API_ORIGIN}/api/presentation/mint`;
    const res = await fetch(upstream, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body,
      cache: "no-store",
    });
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: {
        "Content-Type": res.headers.get("Content-Type") ?? "application/json",
      },
    });
  } catch (error) {
    console.error("[viewer presentation/mint proxy] error:", error);
    return NextResponse.json(
      {success: false, error: {code: "server_error", message: "Failed to mint presentation token"}},
      {status: 500},
    );
  }
}
