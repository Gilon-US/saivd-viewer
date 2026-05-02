import {NextRequest, NextResponse} from "next/server";
import {createAdminClient} from "@/utils/supabase/admin";
import {generatePresignedVideoUrl, extractKeyFromUrl} from "@/lib/wasabi-urls";

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
 * request a fresh presigned URL for that video. Mirrors the resolution logic of
 * /api/videos/[id]/play but skips the user_id ownership check.
 *
 * Query parameters:
 * - variant: "original" or "watermarked" (default: "watermarked")
 *
 * Auth model: this route is intentionally exempt from auth middleware (see
 * utils/supabase/middleware.ts). It uses a service-role Supabase client to read a
 * single row by id (RLS on `videos` is scoped to the owning user, so an anon-keyed
 * client would return nothing). Only the columns required to resolve the storage
 * key are selected.
 */
export async function GET(request: NextRequest, context: {params: Promise<{id: string}>}) {
  try {
    const {id: videoId} = await context.params;
    const {searchParams} = new URL(request.url);
    const variant = searchParams.get("variant") || "watermarked";

    if (variant !== "original" && variant !== "watermarked") {
      return NextResponse.json(
        {success: false, error: {code: "invalid_variant", message: 'Variant must be "original" or "watermarked"'}},
        {status: 400, headers: {...CORS_HEADERS}}
      );
    }

    if (!videoId) {
      return NextResponse.json(
        {success: false, error: {code: "validation_error", message: "Missing video id"}},
        {status: 400, headers: {...CORS_HEADERS}}
      );
    }

    const supabase = createAdminClient();

    const {data: video, error} = await supabase
      .from("videos")
      .select("id, original_url, processed_url")
      .eq("id", videoId)
      .maybeSingle();

    if (error) {
      console.error("Error fetching public video:", error);
      return NextResponse.json(
        {success: false, error: {code: "server_error", message: "Failed to load video"}},
        {status: 500, headers: {...CORS_HEADERS}}
      );
    }

    if (!video) {
      return NextResponse.json(
        {success: false, error: {code: "not_found", message: "Video not found"}},
        {status: 404, headers: {...CORS_HEADERS}}
      );
    }

    // Determine the object key based on variant
    let key: string | null = null;

    if (variant === "watermarked") {
      const watermarkedUrl = video.processed_url || video.original_url;

      if (!watermarkedUrl) {
        return NextResponse.json(
          {
            success: false,
            error: {code: "watermarked_not_available", message: "Watermarked version not available for this video"},
          },
          {status: 400, headers: {...CORS_HEADERS}}
        );
      }

      key = watermarkedUrl.startsWith("http") ? extractKeyFromUrl(watermarkedUrl) : watermarkedUrl;
    } else {
      const originalUrl = video.original_url;
      if (!originalUrl) {
        return NextResponse.json(
          {success: false, error: {code: "invalid_data", message: "Missing or invalid video storage key"}},
          {status: 500, headers: {...CORS_HEADERS}}
        );
      }
      key = originalUrl.startsWith("http") ? extractKeyFromUrl(originalUrl) : originalUrl;
    }

    if (!key) {
      return NextResponse.json(
        {success: false, error: {code: "invalid_data", message: "Missing or invalid video storage key"}},
        {status: 500, headers: {...CORS_HEADERS}}
      );
    }

    const playbackUrl = await generatePresignedVideoUrl(key);

    return NextResponse.json(
      {
        success: true,
        data: {
          playbackUrl,
        },
      },
      {headers: {...CORS_HEADERS}}
    );
  } catch (error) {
    console.error("Error generating public playback URL:", error);
    return NextResponse.json(
      {success: false, error: {code: "server_error", message: "Failed to generate playback URL"}},
      {status: 500, headers: {...CORS_HEADERS}}
    );
  }
}
