import {generatePresignedVideoUrl} from "@/lib/wasabi-urls";
import {resolveWatermarkedStorageKey, type VideoStorageFields} from "@/lib/video-playback-url";

/** Server-only: presign watermarked playback URL (uses Wasabi credentials). */
export async function presignWatermarkedPlaybackUrl(video: VideoStorageFields): Promise<string | null> {
  const key = resolveWatermarkedStorageKey(video);
  if (!key) return null;
  try {
    return await generatePresignedVideoUrl(key);
  } catch {
    return null;
  }
}
