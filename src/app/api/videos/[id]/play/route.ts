import {NextRequest, NextResponse} from "next/server";
import {createClient} from "@/utils/supabase/server";
import {generatePublicVideoUrl, extractKeyFromUrl} from "@/lib/wasabi-urls";

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
export async function GET(_request: NextRequest, {params}: {params: {id: string}}) {
  try {
    const videoId = params.id;

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

    // For now we generate a public URL from the key.
    // If the bucket is private later, this can be swapped to generatePresignedVideoUrl(key).
    const playbackUrl = generatePublicVideoUrl(key);

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
