import {NextRequest, NextResponse} from "next/server";
import {createClient} from "@/utils/supabase/server";
import {generatePresignedVideoUrl, extractKeyFromUrl} from "@/lib/wasabi-urls";

/**
 * GET /api/videos/[id]/play
 *
 * Generates a fresh playback URL for the requested video.
 *
 * Query parameters:
 * - variant: "original" (default) or "watermarked"
 *
 * - Authenticates the user
 * - Ensures the video belongs to the authenticated user
 * - For "original" variant: Uses videos.original_url as the stable object key
 * - For "watermarked" variant: Uses videos.processed_url as the stable object key
 *   - For legacy rows where URLs are full URLs, extracts the key
 */
export async function GET(request: NextRequest, context: {params: Promise<{id: string}>}) {
  try {
    const {id: videoId} = await context.params;
    const {searchParams} = new URL(request.url);
    const variant = searchParams.get("variant") || "original";

    // Validate variant parameter
    if (variant !== "original" && variant !== "watermarked") {
      return NextResponse.json(
        {success: false, error: {code: "invalid_variant", message: 'Variant must be "original" or "watermarked"'}},
        {status: 400}
      );
    }

    const supabase = await createClient();
    const {data: authData} = await supabase.auth.getUser();

    if (!authData.user) {
      return NextResponse.json(
        {success: false, error: {code: "unauthorized", message: "Authentication required"}},
        {status: 401}
      );
    }

    // Load the video record and ensure it belongs to the user
    const {data: video, error} = await supabase
      .from("videos")
      .select("*")
      .eq("id", videoId)
      .eq("user_id", authData.user.id)
      .single();

    if (error || !video) {
      return NextResponse.json({success: false, error: {code: "not_found", message: "Video not found"}}, {status: 404});
    }

    // Determine the object key based on variant
    let key: string | null = null;

    if (variant === "watermarked") {
      // For watermarked variant:
      // 1. Prefer processed_url if it exists (for videos that were processed after upload)
      // 2. Fall back to original_url (since in this app, uploaded videos are already watermarked)
      const watermarkedUrl = video.processed_url || video.original_url;
      
      if (!watermarkedUrl) {
        return NextResponse.json(
          {
            success: false,
            error: {code: "watermarked_not_available", message: "Watermarked version not available for this video"},
          },
          {status: 400}
        );
      }

      if (watermarkedUrl.startsWith("http")) {
        key = extractKeyFromUrl(watermarkedUrl);
      } else {
        key = watermarkedUrl;
      }
    } else {
      // For original variant, use original_url
      if (video.original_url?.startsWith("http")) {
        key = extractKeyFromUrl(video.original_url);
      } else {
        key = video.original_url;
      }
    }

    if (!key) {
      return NextResponse.json(
        {success: false, error: {code: "invalid_data", message: "Missing or invalid video storage key"}},
        {status: 500}
      );
    }

    // Generate a presigned URL from the key so that objects can remain private in Wasabi.
    const playbackUrl = await generatePresignedVideoUrl(key);

    // Debug: log what we are returning to the client
    console.log("Playback URL generated:", {
      videoId,
      variant,
      userId: authData.user.id,
      url_field: variant === "watermarked" ? (video.processed_url || video.original_url) : video.original_url,
      has_processed_url: !!video.processed_url,
      resolved_key: key,
      playbackUrl,
    });

    return NextResponse.json({
      success: true,
      data: {
        playbackUrl,
      },
    });
  } catch (error) {
    console.error("Error generating playback URL:", error);
    return NextResponse.json(
      {success: false, error: {code: "server_error", message: "Failed to generate playback URL"}},
      {status: 500}
    );
  }
}
