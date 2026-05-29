import {createAdminClient} from "@/utils/supabase/admin";
import {extractKeyFromUrl, generatePresignedVideoUrl} from "@/lib/wasabi-urls";

export type ImageViewResult =
  | {ok: true; viewUrl: string}
  | {ok: false; status: number; code: string; message: string};

/**
 * Resolve a viewer image id to a presigned Wasabi URL for the watermarked file.
 * Uses processed_url when set, otherwise original_url (claimed images store the
 * watermarked PNG in original_url, mirroring the video model).
 */
export async function getPublicImageViewData(
  imageId: string | undefined | null,
): Promise<ImageViewResult> {
  if (!imageId?.trim()) {
    return {ok: false, status: 400, code: "validation_error", message: "Missing image id"};
  }

  let image: {id: string; original_url: string | null; processed_url: string | null} | null;
  try {
    const supabase = createAdminClient();
    const {data, error} = await supabase
      .from("images")
      .select("id, original_url, processed_url")
      .eq("id", imageId)
      .maybeSingle();

    if (error) {
      console.error("[image-view-url] Supabase error:", error);
      return {ok: false, status: 500, code: "server_error", message: "Failed to load image"};
    }
    image = data;
  } catch (err) {
    console.error("[image-view-url] Unexpected failure:", err);
    return {ok: false, status: 500, code: "server_error", message: "Failed to load image"};
  }

  if (!image) {
    return {ok: false, status: 404, code: "not_found", message: "Image not found"};
  }

  const storageRef = image.processed_url || image.original_url;
  if (!storageRef) {
    return {ok: false, status: 400, code: "not_available", message: "Image file not available"};
  }

  const key = storageRef.startsWith("http") ? extractKeyFromUrl(storageRef) : storageRef;
  if (!key) {
    return {ok: false, status: 500, code: "invalid_data", message: "Invalid image storage key"};
  }

  try {
    const viewUrl = await generatePresignedVideoUrl(key);
    return {ok: true, viewUrl};
  } catch (err) {
    console.error("[image-view-url] presign failed:", err);
    return {ok: false, status: 500, code: "server_error", message: "Failed to generate image URL"};
  }
}
