import {NextRequest, NextResponse} from "next/server";
import {createClient} from "@/utils/supabase/server";
import {generatePresignedVideoUrl, extractKeyFromUrl} from "@/lib/wasabi-urls";

/**
 * GET /api/videos/[id]/play
 *
 * Generates a fresh playback URL for the requested video.
 *
 * - Authenticates the user
 * - Ensures the video belongs to the authenticated user
 * - Treats videos.original_url as the stable object key (new behavior)
 *   - For legacy rows where original_url is a full URL, extracts the key
 */
export async function GET(_request: NextRequest, context: {params: Promise<{id: string}>}) {
  try {
    const {id: videoId} = await context.params;

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

    // Determine the object key.
    // New behavior: original_url stores the key directly.
    // Legacy behavior: original_url may be a full URL, so extract the key.
    let key: string | null = null;

    if (video.original_url?.startsWith("http")) {
      key = extractKeyFromUrl(video.original_url);
    } else {
      key = video.original_url;
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
      userId: authData.user.id,
      original_url: video.original_url,
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
