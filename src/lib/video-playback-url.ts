export type VideoStorageFields = {
  original_url: string | null;
  processed_url: string | null;
};

function extractKeyFromUrl(url: string): string | null {
  try {
    const urlObj = new URL(url);
    return urlObj.pathname.substring(1);
  } catch {
    return null;
  }
}

/** Resolve Wasabi object key for watermarked playback (processed, else original). */
export function resolveWatermarkedStorageKey(video: VideoStorageFields): string | null {
  const watermarkedRef = video.processed_url || video.original_url;
  if (!watermarkedRef) return null;
  if (watermarkedRef.startsWith("http")) {
    return extractKeyFromUrl(watermarkedRef);
  }
  return watermarkedRef;
}

/** Same-origin play URL that 307-redirects to a fresh presigned Wasabi URL. */
export function videoPlayProxyUrl(videoId: string, variant: "original" | "watermarked" = "watermarked"): string {
  const params = new URLSearchParams({variant, redirect: "1"});
  return `/api/videos/${encodeURIComponent(videoId)}/play?${params.toString()}`;
}

export function ssrVideoSelector(videoId: string): string {
  return `video[data-saivd-public-video="${CSS.escape(videoId)}"]`;
}
