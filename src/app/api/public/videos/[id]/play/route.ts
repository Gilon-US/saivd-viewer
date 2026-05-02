import {NextRequest, NextResponse} from "next/server";
import {getPublicPlaybackData, type PlaybackVariant} from "@/lib/playback-url";

/** Lets `/api/public/.../play` work from sandboxed iframes (opaque origin) used by some site builders. */
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
} as const;

export async function OPTIONS() {
  return new NextResponse(null, {status: 204, headers: {...CORS_HEADERS}});
}

/**
 * GET /api/public/videos/[id]/play
 *
 * Public, unauthenticated playback URL generator. Anyone with a valid video id can
 * request a fresh presigned URL for that video. The actual Supabase + Wasabi
 * resolution lives in `@/lib/playback-url` so the v/[id] and embed/[id] server
 * components can prefetch the URL during render without going through this HTTP
 * round-trip.
 *
 * Query parameters:
 * - variant: "original" or "watermarked" (default: "watermarked")
 *
 * Auth model: this route is intentionally exempt from auth middleware (see
 * utils/supabase/middleware.ts). The shared helper uses a service-role Supabase
 * client to read a single row by id (RLS on `videos` is scoped to the owning user,
 * so an anon-keyed client would return nothing). Only the columns required to
 * resolve the storage key are selected.
 */
export async function GET(request: NextRequest, context: {params: Promise<{id: string}>}) {
  const {id: videoId} = await context.params;
  const {searchParams} = new URL(request.url);
  const variantParam = searchParams.get("variant") || "watermarked";
  const variant = variantParam as PlaybackVariant;

  const result = await getPublicPlaybackData(videoId, variant);

  if (!result.ok) {
    return NextResponse.json(
      {success: false, error: {code: result.code, message: result.message}},
      {status: result.status, headers: {...CORS_HEADERS}}
    );
  }

  return NextResponse.json(
    {success: true, data: {playbackUrl: result.playbackUrl}},
    {
      headers: {
        ...CORS_HEADERS,
        // Edge-cache the response briefly so reloads / multiple users hitting the
        // same video within a short window skip the Supabase + Wasabi presign work.
        // 30s is well under the 1-hour presigned URL expiry, so cached URLs always
        // have ~59 minutes of validity left when served.
        "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
        Vary: "Accept-Encoding",
      },
    }
  );
}
