import {NextRequest, NextResponse} from "next/server";
import {createClient} from "@/utils/supabase/server";
import {extractKeyFromUrl} from "@/lib/wasabi-urls";
import {getWatermarkBaseUrl, watermarkErrorBody} from "@/lib/watermark-api";

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
      console.warn("[ExtractUserID] Missing video ID");
      return NextResponse.json(watermarkErrorBody("user_profile_error", "Video ID is required"), {status: 400});
    }

    if (isNaN(frameIndex) || frameIndex < 0) {
      console.warn("[ExtractUserID] Invalid frame index:", {videoId, frameIndex});
      return NextResponse.json(watermarkErrorBody("user_profile_error", "frame_index must be a non-negative integer"), {status: 400});
    }

    const supabase = await createClient();
    const {data: authData} = await supabase.auth.getUser();

    if (!authData.user) {
      return NextResponse.json(watermarkErrorBody("unauthorized", "Authentication required"), {status: 401});
    }

    const {data: video, error} = await supabase
      .from("videos")
      .select("*")
      .eq("id", videoId)
      .eq("user_id", authData.user.id)
      .single();

    if (error || !video) {
      console.error("[ExtractUserID] Video not found:", {videoId, userId: authData.user.id, error: error?.message});
      return NextResponse.json(watermarkErrorBody("user_profile_error", "Video not found"), {status: 404});
    }

    // For user ID extraction, we need a watermarked video:
    // 1. Prefer processed_url if it exists (for videos that were processed after upload)
    // 2. Fall back to original_url (since in this app, uploaded videos are already watermarked)
    const watermarkedUrl = video.processed_url || video.original_url;

    if (!watermarkedUrl) {
      return NextResponse.json(
        watermarkErrorBody("extraction_failed", "Watermarked version not available for this video. User ID extraction only works for watermarked videos."),
        {status: 400}
      );
    }

    // Extract S3 key from watermarked URL (handles both URL and key formats)
    let videoKey: string | null = null;
    if (watermarkedUrl.startsWith("http")) {
      videoKey = extractKeyFromUrl(watermarkedUrl);
    } else {
      videoKey = watermarkedUrl;
    }

    if (!videoKey) {
      return NextResponse.json(
        watermarkErrorBody("extraction_failed", "Missing or invalid processed video storage key"),
        {status: 500}
      );
    }

    const baseUrl = getWatermarkBaseUrl();
    if (!baseUrl) {
      console.error("[ExtractUserID] WATERMARK_SERVICE_URL not set");
      return NextResponse.json(
        watermarkErrorBody("config_error", "Watermark service not configured"),
        {status: 502}
      );
    }

    const bucket = process.env.WASABI_BUCKET_NAME ?? "saivd-app";
    const watermarkApiUrl = `${baseUrl}/extract_user_id`;

    const requestBody = {
      video_name: videoKey,
      frame_index: frameIndex,
      bucket,
    };

    const headers: Record<string, string> = {"Content-Type": "application/json"};
    if (process.env.WATERMARK_SERVICE_API_KEY) {
      headers["Authorization"] = `Bearer ${process.env.WATERMARK_SERVICE_API_KEY}`;
    }

    console.log("[ExtractUserID] Calling external service:", {method: "POST", url: watermarkApiUrl, bodyLength: JSON.stringify(requestBody).length});

    try {
      const watermarkResponse = await fetch(watermarkApiUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
      });

      const bodyLength = watermarkResponse.headers.get("content-length") ?? "unknown";
      console.log("[ExtractUserID] Response:", {status: watermarkResponse.status, bodyLength});

      if (!watermarkResponse.ok) {
        const errorText = await watermarkResponse.text();
        if (process.env.NODE_ENV === "development") {
          console.error("[ExtractUserID] Error body:", errorText?.slice(0, 500));
        }
        return NextResponse.json(
          watermarkErrorBody("extraction_failed", "Failed to extract user ID from video frame"),
          {status: 502}
        );
      }

      const watermarkData = (await watermarkResponse.json()) as {
        success?: boolean;
        user_id?: string;
        frame_index?: number;
        video_name?: string;
        error?: string;
      };

      if (!watermarkData.success || !watermarkData.user_id) {
        const errMsg = watermarkData.error ?? "Failed to extract user ID from video frame";
        return NextResponse.json(
          watermarkErrorBody("extraction_failed", errMsg),
          {status: 502}
        );
      }

      return NextResponse.json({
        success: true,
        data: {
          user_id: watermarkData.user_id,
          frame_index: watermarkData.frame_index ?? frameIndex,
          video_name: watermarkData.video_name ?? videoKey,
        },
      });
    } catch (fetchError) {
      console.error("[ExtractUserID] Exception calling watermark service:", {
        error: fetchError instanceof Error ? fetchError.message : String(fetchError),
        url: watermarkApiUrl,
      });
      return NextResponse.json(
        watermarkErrorBody("extraction_failed", "Failed to communicate with watermark service"),
        {status: 502}
      );
    }
  } catch (error) {
    console.error("[ExtractUserID] Unexpected error:", error instanceof Error ? error.message : String(error));
    return NextResponse.json(
      watermarkErrorBody("server_error", "Failed to extract user ID"),
      {status: 500}
    );
  }
}
