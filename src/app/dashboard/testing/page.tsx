"use client";

/**
 * Verification test bench: plays a video through the real VideoPlayer + watermark verification and logs every
 * step (bootstrap, keyframe checks with timings, seeks, failures). Logged-in users only (dashboard layout).
 * Nothing is uploaded or stored: a local file plays from a blob URL in this tab.
 */

import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {VideoPlayer} from "@/components/video/VideoPlayer";
import type {VerificationDebugEvent} from "@/hooks/useWatermarkVerification";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {BACKEND_TEST_PUBLIC_KEY_PEM} from "./test-public-key";

type KeyMode = "api" | "test" | "custom";
type LoggedEvent = {atMs: number; event: VerificationDebugEvent | {type: "run_started"; source: string}};
type Run = {id: number; url: string; source: string; startedAt: number; pem: string | null};

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

function describe(e: LoggedEvent["event"]): string {
  switch (e.type) {
    case "run_started":
      return e.source;
    case "bootstrap":
      return `${e.format} · user ${e.userId} · frame ${e.frameIndex} · bootstrap RSA ${
        e.bootstrapRsa === null ? "not checked" : e.bootstrapRsa ? "pass" : "fail"
      } (informational) · ${e.elapsedMs} ms`;
    case "bootstrap_failed":
      return `${e.reason} · ${e.elapsedMs} ms`;
    case "queue_started":
      return `${e.format} · ${e.frameCount} frames · ${e.keyframes} keyframes after frame 0`;
    case "keyframe":
      return `#${e.index} @ ${e.time.toFixed(2)}s → ${e.result} (${e.reason}) · ${e.checkMs} ms · playhead ${e.mediaTime.toFixed(2)}s`;
    case "seek":
      return `to ${e.mediaTime.toFixed(2)}s · queue restarts at keyframe @ ${e.floorTime.toFixed(2)}s`;
    case "failed":
      return `${e.reason}${e.detail ? ` ${JSON.stringify(e.detail)}` : ""}`;
  }
}

export default function VerificationTestingPage() {
  const [file, setFile] = useState<File | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [keyMode, setKeyMode] = useState<KeyMode>("api");
  const [customPem, setCustomPem] = useState("");
  const [run, setRun] = useState<Run | null>(null);
  const [status, setStatus] = useState<"verifying" | "verified" | "failed" | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [events, setEvents] = useState<LoggedEvent[]>([]);
  const [copied, setCopied] = useState(false);
  const blobUrlRef = useRef<string | null>(null);
  const runRef = useRef<Run | null>(null);

  useEffect(() => {
    return () => {
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    };
  }, []);

  const start = () => {
    let url: string;
    let source: string;
    if (file) {
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
      url = URL.createObjectURL(file);
      blobUrlRef.current = url;
      source = `file ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)`;
    } else {
      url = urlInput.trim();
      source = `url ${url.split("?")[0]}`;
    }
    const pem = keyMode === "test" ? BACKEND_TEST_PUBLIC_KEY_PEM : keyMode === "custom" ? customPem.trim() || null : null;
    const next: Run = {id: (run?.id ?? 0) + 1, url, source: `${source} · key: ${keyMode}`, startedAt: performance.now(), pem};
    runRef.current = next;
    setRun(next);
    setStatus("verifying");
    setUserId(null);
    setEvents([{atMs: 0, event: {type: "run_started", source: next.source}}]);
    setCopied(false);
  };

  const onDebugEvent = useCallback((event: VerificationDebugEvent) => {
    const current = runRef.current;
    if (!current) return;
    setEvents((prev) => [...prev, {atMs: Math.round(performance.now() - current.startedAt), event}]);
  }, []);

  const onVerificationComplete = useCallback((s: "verified" | "failed", id: string | null) => {
    setStatus(s);
    setUserId(id);
  }, []);

  const summary = useMemo(() => {
    const kf = events.flatMap((e) => (e.event.type === "keyframe" ? [{...e.event, atMs: e.atMs}] : []));
    const times = kf.map((k) => k.checkMs).sort((a, b) => a - b);
    const bootstrap = events.find((e) => e.event.type === "bootstrap" || e.event.type === "bootstrap_failed");
    // Seek latency: from each seek to the first later keyframe result at the new floor.
    const seekLatencies: number[] = [];
    events.forEach((e, i) => {
      if (e.event.type !== "seek") return;
      const floor = e.event.floorTime;
      const hit = events
        .slice(i + 1)
        .find((later) => later.event.type === "keyframe" && Math.abs(later.event.time - floor) < 0.05);
      if (hit) seekLatencies.push(hit.atMs - e.atMs);
    });
    return {
      verified: kf.filter((k) => k.result === "verified").length,
      skipped: kf.filter((k) => k.result === "skipped").length,
      failed: kf.filter((k) => k.result === "failed").length,
      p50: percentile(times, 50),
      p95: percentile(times, 95),
      max: times.length ? times[times.length - 1] : null,
      bootstrapMs: bootstrap ? bootstrap.atMs : null,
      seekLatencies,
    };
  }, [events]);

  const format = useMemo(() => {
    const b = events.find((e) => e.event.type === "bootstrap");
    return b && b.event.type === "bootstrap" ? b.event.format : null;
  }, [events]);

  const copyLog = async () => {
    const payload = {
      source: run?.source,
      userAgent: navigator.userAgent,
      status,
      userId,
      format,
      summary,
      events,
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const canStart = Boolean(file || urlInput.trim()) && (keyMode !== "custom" || customPem.trim().length > 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Verification testing</h1>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Plays a video through the real player and verification, and logs every check. Nothing is uploaded.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <label className="block text-sm font-medium">Video file (MP4)</label>
          <Input
            type="file"
            accept="video/mp4,video/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <label className="block text-sm font-medium pt-2">…or a video URL (must allow CORS + Range)</label>
          <Input
            placeholder="https://…"
            value={urlInput}
            disabled={!!file}
            onChange={(e) => setUrlInput(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <span className="block text-sm font-medium">Public key</span>
          {(
            [
              ["api", "Creator key from the SAIVD API (normal playback)"],
              ["test", "Backend test key (video_examples test files)"],
              ["custom", "Paste a PEM"],
            ] as const
          ).map(([mode, label]) => (
            <label key={mode} className="flex items-center gap-2 text-sm">
              <input type="radio" name="keyMode" checked={keyMode === mode} onChange={() => setKeyMode(mode)} />
              {label}
            </label>
          ))}
          {keyMode === "custom" && (
            <textarea
              className="w-full h-28 rounded-md border p-2 font-mono text-xs bg-transparent"
              placeholder="-----BEGIN PUBLIC KEY-----"
              value={customPem}
              onChange={(e) => setCustomPem(e.target.value)}
            />
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={start} disabled={!canStart}>
          {run ? "Restart" : "Start"}
        </Button>
        <Button variant="outline" onClick={copyLog} disabled={events.length === 0}>
          {copied ? "Copied" : "Copy log (JSON)"}
        </Button>
      </div>

      {run && (
        <div className="relative w-full h-[60vh] bg-black rounded-md overflow-hidden">
          <VideoPlayer
            key={run.id}
            embedded
            videoUrl={run.url}
            videoId={null}
            isOpen
            onClose={() => undefined}
            enableFrameAnalysis
            verificationStatus={status}
            verifiedUserId={userId}
            onVerificationComplete={onVerificationComplete}
            playbackContext="dashboard"
            onDebugEvent={onDebugEvent}
            publicKeyPemOverride={run.pem}
          />
        </div>
      )}

      {run && (
        <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Status" value={status ?? "-"} tone={status === "failed" ? "bad" : status === "verified" ? "good" : undefined} />
          <Stat label="Format / user" value={`${format ?? "-"} / ${userId ?? "-"}`} />
          <Stat label="Bootstrap" value={summary.bootstrapMs === null ? "-" : `${summary.bootstrapMs} ms`} />
          <Stat
            label="Keyframes ok / skipped / failed"
            value={`${summary.verified} / ${summary.skipped} / ${summary.failed}`}
            tone={summary.failed ? "bad" : undefined}
          />
          <Stat
            label="Check time p50 / p95 / max"
            value={summary.p50 === null ? "-" : `${summary.p50} / ${summary.p95} / ${summary.max} ms`}
          />
          <Stat
            label="Seek → floor keyframe checked"
            value={summary.seekLatencies.length ? summary.seekLatencies.map((ms) => `${ms} ms`).join(", ") : "-"}
          />
        </div>
      )}

      {events.length > 0 && (
        <div className="rounded-md border overflow-auto max-h-[50vh]">
          <table className="w-full text-xs font-mono">
            <thead className="sticky top-0 bg-gray-100 dark:bg-gray-800">
              <tr>
                <th className="text-left p-2 w-20">+ms</th>
                <th className="text-left p-2 w-32">event</th>
                <th className="text-left p-2">detail</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e, i) => {
                const bad =
                  e.event.type === "failed" ||
                  e.event.type === "bootstrap_failed" ||
                  (e.event.type === "keyframe" && e.event.result === "failed");
                const warn = e.event.type === "keyframe" && e.event.result === "skipped";
                return (
                  <tr key={i} className={bad ? "text-red-600" : warn ? "text-amber-600" : undefined}>
                    <td className="p-2 align-top">{e.atMs}</td>
                    <td className="p-2 align-top">{e.event.type}</td>
                    <td className="p-2 align-top break-all">{describe(e.event)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({label, value, tone}: {label: string; value: string; tone?: "good" | "bad"}) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={tone === "bad" ? "font-semibold text-red-600" : tone === "good" ? "font-semibold text-green-600" : "font-semibold"}>
        {value}
      </div>
    </div>
  );
}
