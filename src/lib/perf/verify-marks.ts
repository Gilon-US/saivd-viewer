export type VerifyPhase =
  | "img_visible"
  | "fetch_start"
  | "fetch_end"
  | "bitmap_ready"
  | "rowsums_done"
  | "pubkey_ready"
  | "verify_end";

export type VerifyPathLabel = "blob" | "img" | "img_then_blob" | "shadow";

type MarkRecord = {phase: VerifyPhase; t: number};

const marksByImage = new Map<string, MarkRecord[]>();

function shouldSample(): boolean {
  if (typeof window === "undefined") return false;
  const raw = process.env.NEXT_PUBLIC_VERIFY_TELEMETRY_SAMPLE ?? "1.0";
  const rate = Number.parseFloat(raw);
  if (!Number.isFinite(rate) || rate >= 1) return true;
  if (rate <= 0) return false;
  return Math.random() < rate;
}

export function mark(imageId: string, phase: VerifyPhase): void {
  if (typeof performance === "undefined") return;
  const list = marksByImage.get(imageId) ?? [];
  list.push({phase, t: performance.now()});
  marksByImage.set(imageId, list);
  if (typeof performance.mark === "function") {
    performance.mark(`verify:${imageId}:${phase}`);
  }
}

export function flushBeacon(imageId: string, extra?: Record<string, unknown>): void {
  if (typeof window === "undefined" || !shouldSample()) return;

  const records = marksByImage.get(imageId) ?? [];
  const phases = Object.fromEntries(records.map((r) => [r.phase, r.t]));

  const payload = {
    imageId,
    phases,
    ua: navigator.userAgent,
    ...extra,
  };

  marksByImage.delete(imageId);

  const body = JSON.stringify(payload);
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

/** Test helper */
export function resetVerifyMarksForTests(): void {
  marksByImage.clear();
}
