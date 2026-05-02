/**
 * Single source of truth for ffmpeg.wasm URLs used by the watermark verification worker
 * and optional HTTP prewarm on the main thread (`/public/ffmpeg/`).
 */

export const FFMPEG_CORE_JS_PATH = "/ffmpeg/ffmpeg-core.js";
export const FFMPEG_CORE_WASM_PATH = "/ffmpeg/ffmpeg-core.wasm";

export function getFfmpegCoreUrls(origin: string): {coreURL: string; wasmURL: string} {
  const base = origin.replace(/\/$/, "");
  return {
    coreURL: `${base}${FFMPEG_CORE_JS_PATH}`,
    wasmURL: `${base}${FFMPEG_CORE_WASM_PATH}`,
  };
}

/** Best-effort cache warm for ffmpeg static assets (browser only).
 *  Uses default fetch options (mode: "cors" implied for cross-origin, but the
 *  URLs are same-origin to the document so this is effectively same-origin
 *  with credentials: "same-origin"). This MUST match how FFmpeg's internal
 *  loader fetches the WASM, otherwise the prewarm populates a different
 *  HTTP cache entry than what the loader will request, and the prewarm is
 *  wasted. Symptom of mismatch: "preloaded but not used within a few seconds"
 *  warning in the console, and the WASM downloads twice. */
export function prewarmFfmpegVerificationAssets(): void {
  if (typeof window === "undefined") return;
  const {coreURL, wasmURL} = getFfmpegCoreUrls(window.location.origin);
  void fetch(coreURL).catch(() => {});
  void fetch(wasmURL).catch(() => {});
}
