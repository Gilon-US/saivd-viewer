import {NextRequest, NextResponse} from "next/server";
import {createClient} from "@/utils/supabase/server";
import {HeadObjectCommand} from "@aws-sdk/client-s3";
import {wasabiClient, WASABI_BUCKET} from "@/lib/wasabi";

/**
 * POST /api/videos/confirm
 *
 * Confirms that a video has been successfully uploaded to Wasabi storage.
 *
 * Request body:
 * - key: The key of the uploaded file in Wasabi
 * - filename: The original name of the file
 * - filesize: The size of the file in bytes
 * - contentType: The MIME type of the file
 *
 * Response:
 * - success: Boolean indicating if the request was successful
 * - data: Object containing video information
 * - error: Object containing error details if request failed
 */
export async function POST(request: NextRequest) {
  try {
    // Get authenticated user
    const supabase = await createClient();
    const {data} = await supabase.auth.getUser();

    // Create a mutable copy of the data object for potential updates
    const userData = {user: data.user};

    // Require authentication
    if (!userData.user) {
      return NextResponse.json(
        {success: false, error: {code: "unauthorized", message: "Authentication required"}},
        {status: 401}
      );
    }

    // Parse request body
    const {key, filename, filesize, contentType, previewThumbnailData} = await request.json();

    // Validate input
    if (!key || !filename || !filesize || !contentType) {
      return NextResponse.json(
        {success: false, error: {code: "validation_error", message: "Missing required fields"}},
        {status: 400}
      );
    }

    // Verify the file exists in Wasabi
    try {
      const headCommand = new HeadObjectCommand({
        Bucket: WASABI_BUCKET,
        Key: key,
      });
      await wasabiClient.send(headCommand);
    } catch (error) {
      console.error("Error verifying file in Wasabi:", error);
      return NextResponse.json(
        {success: false, error: {code: "not_found", message: "Uploaded file not found or inaccessible"}},
        {status: 404}
      );
    }

    // We now treat the object key as the stable value to persist.
    // Public or presigned URLs will be generated on demand from this key.

    // Debug: Log the key and Wasabi config (but do not generate a URL here)
    console.log("Upload confirmation:", {
      key,
      filename,
      wasabi_endpoint: process.env.WASABI_ENDPOINT,
      wasabi_bucket: WASABI_BUCKET,
    });

    // Thumbnail generation is now handled in the browser via preview_thumbnail_data
    // Server-side thumbnail generation can be added later as an enhancement
    const thumbnailUrl = null;

    // Store video metadata in Supabase.
    // IMPORTANT: original_url now stores the stable object key, not a URL.
    const {data: video, error} = await supabase
      .from("videos")
      .insert({
        user_id: userData.user.id, // We know user is authenticated here
        filename,
        filesize,
        content_type: contentType,
        original_url: key,
        original_thumbnail_url: thumbnailUrl,
        preview_thumbnail_data: previewThumbnailData,
        status: "uploaded", // Explicitly set status
        upload_date: new Date().toISOString(),
      })
      .select()
      .single();

    // Debug: Log what was actually saved to the database
    if (video) {
      console.log("Saved to database:", {
        id: video.id,
        filename: video.filename,
        original_url_as_key: video.original_url,
      });
    }

    if (error) {
      console.error("Error storing video metadata:", error);
      return NextResponse.json(
        {success: false, error: {code: "database_error", message: "Failed to store video metadata"}},
        {status: 500}
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        id: video.id,
        key,
        filename: video.filename,
        originalUrl: video.original_url,
        thumbnailUrl: video.original_thumbnail_url,
        uploadedAt: video.upload_date,
      },
    });
  } catch (error: unknown) {
    console.error("Error confirming upload:", error);
    return NextResponse.json(
      {success: false, error: {code: "server_error", message: "Failed to confirm upload"}},
      {status: 500}
    );
  }
}
