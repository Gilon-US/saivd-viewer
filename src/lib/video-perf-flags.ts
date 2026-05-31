/**
 * Video playback / verification performance flags (rollback via env only).
 * Master switch: NEXT_PUBLIC_VIDEO_PERF=legacy|optimized (default legacy).
 */

export type VideoPerfMaster = "legacy" | "optimized";
export type MoovLadderMode = "legacy" | "faststart";
export type DashboardPreloadMode = "auto" | "metadata";
export type PlaybackContext = "dashboard" | "public";

const MB = 1024 * 1024;

export const MOOV_RANGE_LEGACY = [8 * MB, 16 * MB, 32 * MB];
export const MOOV_RANGE_FASTSTART = [256 * 1024, 1 * MB, 2 * MB, 8 * MB, 16 * MB, 32 * MB];

export function getVideoPerfMaster(): VideoPerfMaster {
  return process.env.NEXT_PUBLIC_VIDEO_PERF === "optimized" ? "optimized" : "legacy";
}

export function isVideoPerfOptimized(): boolean {
  return getVideoPerfMaster() === "optimized";
}

function envFlag(name: string): boolean {
  const raw = process.env[name];
  return raw === "1" || raw === "true";
}

export function isVerifyFirstLoadEnabled(): boolean {
  return isVideoPerfOptimized() && envFlag("NEXT_PUBLIC_VIDEO_VERIFY_FIRST");
}

export function isSsrShellEnabled(): boolean {
  return process.env.NEXT_PUBLIC_VIDEO_SSR_SHELL !== "0";
}

export function getMoovLadderMode(): MoovLadderMode {
  if (!isVideoPerfOptimized()) return "legacy";
  return process.env.NEXT_PUBLIC_VIDEO_MOOV_LADDER === "faststart" ? "faststart" : "legacy";
}

export function getMoovRangeSteps(): number[] {
  return getMoovLadderMode() === "faststart" ? MOOV_RANGE_FASTSTART : MOOV_RANGE_LEGACY;
}

export function getDashboardPreloadMode(): DashboardPreloadMode {
  if (!isVideoPerfOptimized()) return "auto";
  return process.env.NEXT_PUBLIC_VIDEO_DASHBOARD_PRELOAD === "metadata" ? "metadata" : "auto";
}

export function isPrewarmEnabled(): boolean {
  return isVideoPerfOptimized() && envFlag("NEXT_PUBLIC_VIDEO_PREWARM");
}

export function isParallelKeyFetchEnabled(): boolean {
  return isVideoPerfOptimized() && envFlag("NEXT_PUBLIC_VIDEO_PARALLEL_KEY");
}

export function getLargeBytesThreshold(): number {
  const raw = process.env.NEXT_PUBLIC_VIDEO_LARGE_BYTES ?? String(50 * MB);
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 50 * MB;
}

export function unknownSizeTreatedAsLarge(): boolean {
  if (!isVideoPerfOptimized()) return false;
  return process.env.NEXT_PUBLIC_VIDEO_UNKNOWN_AS_LARGE !== "0";
}

function meetsLargeThreshold(contentLengthBytes: number | null | undefined): boolean {
  if (contentLengthBytes == null) return unknownSizeTreatedAsLarge();
  return contentLengthBytes >= getLargeBytesThreshold();
}

export function shouldApplyVerifyFirstLoad(contentLengthBytes?: number | null): boolean {
  if (!isVerifyFirstLoadEnabled()) return false;
  return meetsLargeThreshold(contentLengthBytes);
}

export function shouldApplyDashboardMetadataPreload(
  context: PlaybackContext,
  contentLengthBytes?: number | null,
): boolean {
  if (context !== "dashboard") return false;
  if (getDashboardPreloadMode() !== "metadata") return false;
  return meetsLargeThreshold(contentLengthBytes);
}

/** SSR shell / PublicVideoShell preload attribute. */
export function getPublicVideoShellPreload(): "auto" | "metadata" {
  return "auto";
}

export type VideoElementPlaybackPlan = {
  src: string | undefined;
  preload: "auto" | "metadata" | "none";
  srcWithheld: boolean;
};

export function getVideoElementPlaybackPlan(options: {
  videoUrl: string;
  context: PlaybackContext;
  contentLengthBytes?: number | null;
  verificationStatus: "verifying" | "verified" | "failed" | null | undefined;
  playRequested: boolean;
}): VideoElementPlaybackPlan {
  const {videoUrl, contentLengthBytes, verificationStatus} = options;
  const verifyFirst = shouldApplyVerifyFirstLoad(contentLengthBytes);
  const verifying = verificationStatus === "verifying";

  // Always attach src so playback can start immediately; verification uses the worker Range path.
  // verify-first only lowers preload aggressiveness during verify (rollback via env flags).
  const preload: VideoElementPlaybackPlan["preload"] =
    verifyFirst && verifying ? "metadata" : "auto";

  return {src: videoUrl, preload, srcWithheld: false};
}

export function getVideoTelemetrySampleRate(): number {
  if (!isVideoPerfOptimized()) return 0;
  const raw = process.env.NEXT_PUBLIC_VIDEO_TELEMETRY_SAMPLE ?? "0";
  const rate = Number.parseFloat(raw);
  if (!Number.isFinite(rate)) return 0;
  return Math.min(1, Math.max(0, rate));
}

/** Snapshot for telemetry / debug (no secrets). */
export function getVideoPerfFlagsSnapshot(): Record<string, unknown> {
  return {
    master: getVideoPerfMaster(),
    verifyFirst: isVerifyFirstLoadEnabled(),
    moovLadder: getMoovLadderMode(),
    dashboardPreload: getDashboardPreloadMode(),
    prewarm: isPrewarmEnabled(),
    parallelKey: isParallelKeyFetchEnabled(),
    ssrShell: isSsrShellEnabled(),
    largeBytes: getLargeBytesThreshold(),
    unknownAsLarge: unknownSizeTreatedAsLarge(),
    telemetrySample: getVideoTelemetrySampleRate(),
  };
}
