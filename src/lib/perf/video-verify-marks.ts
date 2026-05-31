import {getVideoPerfFlagsSnapshot, getVideoTelemetrySampleRate} from "@/lib/video-perf-flags";

export type VideoVerifyPhase =
  | "session_init"
  | "moov_parse"
  | "ffmpeg_load"
  | "frame_decode"
  | "key_fetch"
  | "rsa_verify"
  | "finalizing"
  | "verify_end";

type MarkRecord = {phase: VideoVerifyPhase; t: number};

const marksByVideo = new Map<string, MarkRecord[]>();

function shouldSample(): boolean {
  if (typeof window === "undefined") return false;
  const rate = getVideoTelemetrySampleRate();
  if (rate >= 1) return true;
  if (rate <= 0) return false;
  return Math.random() < rate;
}

export function markVideo(videoId: string, phase: VideoVerifyPhase): void {
  if (typeof performance === "undefined") return;
  const list = marksByVideo.get(videoId) ?? [];
  list.push({phase, t: performance.now()});
  marksByVideo.set(videoId, list);
  if (typeof performance.mark === "function") {
    performance.mark(`video-verify:${videoId}:${phase}`);
  }
}

export function flushVideoBeacon(videoId: string, extra?: Record<string, unknown>): void {
  if (typeof window === "undefined" || !shouldSample()) return;

  const records = marksByVideo.get(videoId) ?? [];
  const phases = Object.fromEntries(records.map((r) => [r.phase, r.t]));
  marksByVideo.delete(videoId);

  const body = JSON.stringify({
    videoId,
    kind: "video",
    phases,
    flags: getVideoPerfFlagsSnapshot(),
    ua: navigator.userAgent,
    ...extra,
  });

  const url = "/api/internal/verify-telemetry";
  if (typeof navigator.sendBeacon === "function") {
    const blob = new Blob([body], {type: "application/json"});
    if (navigator.sendBeacon(url, blob)) return;
  }

  void fetch(url, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body,
    keepalive: true,
    credentials: "same-origin",
  }).catch(() => {
    /* telemetry must not break verification */
  });
}

export function resetVideoVerifyMarksForTests(): void {
  marksByVideo.clear();
}
