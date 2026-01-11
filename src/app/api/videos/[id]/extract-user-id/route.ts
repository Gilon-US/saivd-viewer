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
  const requestStartTime = Date.now();
  
  try {
    const {id: videoId} = await context.params;
    const {searchParams} = new URL(request.url);
    const frameIndex = parseInt(searchParams.get("frame_index") || "0", 10);

    console.log("[ExtractUserID] Request received:", {
      videoId,
      frameIndex,
      timestamp: new Date().toISOString(),
    });

    if (!videoId) {
      console.warn("[ExtractUserID] Missing video ID");
      return NextResponse.json(
        {success: false, error: {code: "missing_video_id", message: "Video ID is required"}},
        {status: 400}
      );
    }

    if (isNaN(frameIndex) || frameIndex < 0) {
      console.warn("[ExtractUserID] Invalid frame index:", {videoId, frameIndex});
      return NextResponse.json(
        {success: false, error: {code: "invalid_frame_index", message: "frame_index must be a non-negative integer"}},
        {status: 400}
      );
    }

    const supabase = await createClient();
    const {data: authData} = await supabase.auth.getUser();

    if (!authData.user) {
      console.warn("[ExtractUserID] Unauthorized request:", {videoId});
      return NextResponse.json(
        {success: false, error: {code: "unauthorized", message: "Authentication required"}},
        {status: 401}
      );
    }

    // Load the video record and ensure it belongs to the user
    console.log("[ExtractUserID] Loading video from database:", {
      videoId,
      userId: authData.user.id,
    });

    const {data: video, error} = await supabase
      .from("videos")
      .select("*")
      .eq("id", videoId)
      .eq("user_id", authData.user.id)
      .single();

    if (error || !video) {
      console.error("[ExtractUserID] Video not found:", {
        videoId,
        userId: authData.user.id,
        error: error?.message,
      });
      return NextResponse.json({success: false, error: {code: "not_found", message: "Video not found"}}, {status: 404});
    }

    console.log("[ExtractUserID] Video loaded:", {
      videoId,
      filename: video.filename,
      hasProcessedUrl: !!video.processed_url,
      hasOriginalUrl: !!video.original_url,
      status: video.status,
    });

    // For user ID extraction, we need a watermarked video:
    // 1. Prefer processed_url if it exists (for videos that were processed after upload)
    // 2. Fall back to original_url (since in this app, uploaded videos are already watermarked)
    const watermarkedUrl = video.processed_url || video.original_url;
    
    console.log("[ExtractUserID] Determining watermarked video source:", {
      videoId,
      processedUrl: video.processed_url || null,
      originalUrl: video.original_url || null,
      selectedUrl: watermarkedUrl || null,
      usingProcessed: !!video.processed_url,
    });
    
    if (!watermarkedUrl) {
      console.error("[ExtractUserID] No watermarked video available:", {
        videoId,
        filename: video.filename,
      });
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

    // Extract S3 key from watermarked URL (handles both URL and key formats)
    let videoKey: string | null = null;
    if (watermarkedUrl.startsWith("http")) {
      videoKey = extractKeyFromUrl(watermarkedUrl);
    } else {
      videoKey = watermarkedUrl;
    }

    if (!videoKey) {
      console.error("[ExtractUserID] Failed to extract S3 key:", {
        videoId,
        watermarkedUrl,
      });
      return NextResponse.json(
        {success: false, error: {code: "invalid_data", message: "Missing or invalid processed video storage key"}},
        {status: 500}
      );
    }

    console.log("[ExtractUserID] S3 key extracted:", {
      videoId,
      videoKey,
      isUrl: watermarkedUrl.startsWith("http"),
    });

    // Get watermark service configuration
    const watermarkServiceUrl = process.env.WATERMARK_SERVICE_URL;
    const watermarkServiceApiKey = process.env.WATERMARK_SERVICE_API_KEY;
    const wasabiBucket = WASABI_BUCKET;

    console.log("[ExtractUserID] Checking watermark service configuration:", {
      videoId,
      hasServiceUrl: !!watermarkServiceUrl,
      hasApiKey: !!watermarkServiceApiKey,
      hasBucket: !!wasabiBucket,
      serviceUrl: watermarkServiceUrl ? `${watermarkServiceUrl.substring(0, 30)}...` : null,
    });

    if (!watermarkServiceUrl) {
      console.error("[ExtractUserID] WATERMARK_SERVICE_URL environment variable not set");
      return NextResponse.json(
        {success: false, error: {code: "service_unavailable", message: "Watermark service not configured"}},
        {status: 502}
      );
    }

    if (!wasabiBucket) {
      console.error("[ExtractUserID] WASABI_BUCKET_NAME environment variable not set");
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

      const watermarkApiUrl = `${watermarkServiceUrl}/extract_user_id`;
      const apiCallStartTime = Date.now();

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      // Add API key if provided
      if (watermarkServiceApiKey) {
        headers["Authorization"] = `Bearer ${watermarkServiceApiKey}`;
      }

      console.log("[ExtractUserID] Calling external watermark service:", {
        videoId,
        apiUrl: watermarkApiUrl,
        requestBody: {
          video_name: videoKey,
          frame_index: frameIndex,
          bucket: wasabiBucket,
        },
        hasAuth: !!watermarkServiceApiKey,
        timestamp: new Date().toISOString(),
      });

      const watermarkResponse = await fetch(watermarkApiUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
      });

      const apiCallDuration = Date.now() - apiCallStartTime;

      console.log("[ExtractUserID] Watermark service response received:", {
        videoId,
        status: watermarkResponse.status,
        statusText: watermarkResponse.statusText,
        durationMs: apiCallDuration,
        timestamp: new Date().toISOString(),
      });

      if (!watermarkResponse.ok) {
        const errorText = await watermarkResponse.text();
        console.error("[ExtractUserID] Watermark service error response:", {
          videoId,
          frameIndex,
          status: watermarkResponse.status,
          statusText: watermarkResponse.statusText,
          responseBody: errorText,
          durationMs: apiCallDuration,
          requestBody: {
            video_name: videoKey,
            frame_index: frameIndex,
            bucket: wasabiBucket,
          },
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

      console.log("[ExtractUserID] Watermark service response parsed:", {
        videoId,
        frameIndex,
        hasSuccess: !!watermarkData.success,
        hasUserId: !!watermarkData.user_id,
        userId: watermarkData.user_id || null,
        responseFrameIndex: watermarkData.frame_index ?? null,
        responseVideoName: watermarkData.video_name || null,
        durationMs: apiCallDuration,
      });

      // External service response structure: { success: true, user_id: "...", frame_index, video_name }
      if (!watermarkData.success || !watermarkData.user_id) {
        console.error("[ExtractUserID] Invalid watermark service response:", {
          videoId,
          frameIndex,
          response: watermarkData,
          durationMs: apiCallDuration,
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

      const totalDuration = Date.now() - requestStartTime;

      console.log("[ExtractUserID] Successfully extracted user ID:", {
        videoId,
        frameIndex,
        userId: watermarkData.user_id,
        apiCallDurationMs: apiCallDuration,
        totalDurationMs: totalDuration,
        timestamp: new Date().toISOString(),
      });

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
      const apiCallDuration = Date.now() - requestStartTime;
      const errorMessage = fetchError instanceof Error ? fetchError.message : String(fetchError);
      const errorStack = fetchError instanceof Error ? fetchError.stack : undefined;

      console.error("[ExtractUserID] Exception calling watermark service:", {
        videoId,
        frameIndex,
        error: errorMessage,
        stack: errorStack,
        durationMs: apiCallDuration,
        apiUrl: `${watermarkServiceUrl}/extract_user_id`,
        timestamp: new Date().toISOString(),
      });

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
    const totalDuration = Date.now() - requestStartTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    console.error("[ExtractUserID] Unexpected error:", {
      error: errorMessage,
      stack: errorStack,
      totalDurationMs: totalDuration,
      timestamp: new Date().toISOString(),
    });

    return NextResponse.json(
      {success: false, error: {code: "server_error", message: "Failed to extract user ID"}},
      {status: 500}
    );
  }
}
