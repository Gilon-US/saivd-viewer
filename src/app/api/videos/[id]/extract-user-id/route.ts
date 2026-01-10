import {NextRequest, NextResponse} from "next/server";
import {createClient} from "@/utils/supabase/server";
import {extractKeyFromUrl} from "@/lib/wasabi-urls";
import {WASABI_BUCKET} from "@/lib/wasabi";

/**
 * GET /api/videos/[id]/extract-user-id
 *
 * Extracts the creator's user ID from a watermarked video frame.
 *
 * Query parameters:
 * - frame_index (optional, default: 0): Frame number to analyze
 *
 * - Authenticates the user
 * - Ensures the video belongs to the authenticated user
 * - Verifies video has processed_url (watermarked version)
 * - Calls external watermark service to extract user ID
 * - Returns extracted user ID
 */
export async function GET(request: NextRequest, context: {params: Promise<{id: string}>}) {
  try {
    const {id: videoId} = await context.params;
    const {searchParams} = new URL(request.url);
    const frameIndex = parseInt(searchParams.get("frame_index") || "0", 10);

    if (!videoId) {
      return NextResponse.json(
        {success: false, error: {code: "missing_video_id", message: "Video ID is required"}},
        {status: 400}
      );
    }

    if (isNaN(frameIndex) || frameIndex < 0) {
      return NextResponse.json(
        {success: false, error: {code: "invalid_frame_index", message: "frame_index must be a non-negative integer"}},
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

    // Verify video has processed_url (watermarked version)
    if (!video.processed_url) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "watermarked_not_available",
            message: "Watermarked version not available for this video. User ID extraction only works for watermarked videos.",
          },
        },
        {status: 400}
      );
    }

    // Extract S3 key from processed_url (handles both URL and key formats)
    let videoKey: string | null = null;
    if (video.processed_url.startsWith("http")) {
      videoKey = extractKeyFromUrl(video.processed_url);
    } else {
      videoKey = video.processed_url;
    }

    if (!videoKey) {
      return NextResponse.json(
        {success: false, error: {code: "invalid_data", message: "Missing or invalid processed video storage key"}},
        {status: 500}
      );
    }

    // Get watermark service configuration
    const watermarkServiceUrl = process.env.WATERMARK_SERVICE_URL;
    const watermarkServiceApiKey = process.env.WATERMARK_SERVICE_API_KEY;
    const wasabiBucket = WASABI_BUCKET;

    if (!watermarkServiceUrl) {
      console.error("WATERMARK_SERVICE_URL environment variable not set");
      return NextResponse.json(
        {success: false, error: {code: "service_unavailable", message: "Watermark service not configured"}},
        {status: 502}
      );
    }

    if (!wasabiBucket) {
      console.error("WASABI_BUCKET_NAME environment variable not set");
      return NextResponse.json(
        {success: false, error: {code: "service_unavailable", message: "Wasabi bucket not configured"}},
        {status: 502}
      );
    }

    // Call external watermark service
    try {
      const requestBody = {
        video_name: videoKey, // Full S3 key path with file extension
        frame_index: frameIndex,
        bucket: wasabiBucket,
      };

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      // Add API key if provided
      if (watermarkServiceApiKey) {
        headers["Authorization"] = `Bearer ${watermarkServiceApiKey}`;
      }

      const watermarkResponse = await fetch(`${watermarkServiceUrl}/extract_user_id`, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
      });

      if (!watermarkResponse.ok) {
        const errorText = await watermarkResponse.text();
        console.error("Watermark service error:", {
          status: watermarkResponse.status,
          statusText: watermarkResponse.statusText,
          body: errorText,
        });

        return NextResponse.json(
          {
            success: false,
            error: {
              code: "extraction_failed",
              message: "Failed to extract user ID from video frame",
            },
          },
          {status: 502}
        );
      }

      const watermarkData = await watermarkResponse.json();

      // External service response structure: { success: true, user_id: "...", frame_index, video_name }
      if (!watermarkData.success || !watermarkData.user_id) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: "extraction_failed",
              message: "Failed to extract user ID from video frame",
            },
          },
          {status: 502}
        );
      }

      // Return extracted user ID
      return NextResponse.json({
        success: true,
        data: {
          user_id: watermarkData.user_id,
          frame_index: watermarkData.frame_index ?? frameIndex,
          video_name: watermarkData.video_name ?? videoKey,
        },
      });
    } catch (fetchError) {
      console.error("Error calling watermark service:", fetchError);
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "service_error",
            message: "Failed to communicate with watermark service",
          },
        },
        {status: 502}
      );
    }
  } catch (error) {
    console.error("Error extracting user ID:", error);
    return NextResponse.json(
      {success: false, error: {code: "server_error", message: "Failed to extract user ID"}},
      {status: 500}
    );
  }
}
