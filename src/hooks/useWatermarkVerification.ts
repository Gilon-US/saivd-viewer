"use client";

import {useEffect, useRef, useState} from "react";
import {
  decodeNumericUserIdDiagnosticsFromLuma,
  decodeAndVerifyFrameFromLuma,
  importPublicKeyFromPem
} from "@/lib/watermark-verification";
import {
  getFrameYFromWasm,
  getFrameYuvFromWasm,
  getWasmVideoTrackInfo,
  prewarmWasmVerificationSession,
  scheduleDisposeWasmVerificationSession,
  WASM_SESSION_KEEPALIVE_MS,
  type WasmKeyframe,
} from "@/lib/wasm-watermark-verification-client";
import {isV3Reading, readFrameV3, verifyV3Signature, type V3FrameReading} from "@/lib/watermark-v3";
import {isParallelKeyFetchEnabled} from "@/lib/video-perf-flags";
import {flushVideoBeacon, markVideo, type VideoVerifyPhase} from "@/lib/perf/video-verify-marks";

export type WatermarkVerificationStatus = "idle" | "verifying" | "verified" | "failed";
/** Watermark format detected for the current video: v3 when frames carry a valid U/V user-ID block. */
export type WatermarkFormat = "v2" | "v3";

/**
 * Ongoing (post-bootstrap) verification policy. Keyframes are the watermarked frames (backend forces an
 * IDR on every watermarked frame), so the queue reads keyframes from the MP4 sample table.
 */
/** A keyframe the playhead has reached must be verified within this much wall-clock playing time. */
export const KEYFRAME_VERIFY_DEADLINE_MS = 6000;
/** How far ahead of the playhead (media seconds) the queue verifies keyframes. */
export const KEYFRAME_VERIFY_LOOKAHEAD_S = 4;
/** Tolerance between MP4 sample times and presented media times. */
const KEYFRAME_TIME_EPSILON_S = 0.05;
const QUEUE_IDLE_POLL_MS = 200;
const DEADLINE_TICK_MS = 250;

type KeyframeCheckResult = "verified" | "failed" | "error";
export type VerificationProgressPhase =
  | "prewarm"
  | "session_init"
  | "moov_parse"
  | "ffmpeg_load"
  | "frame_decode"
  | "key_fetch"
  | "rsa_verify"
  | "finalizing";
export type VerificationProgress = {
  phase: VerificationProgressPhase;
  detail?: string;
  ts: number;
};

/** Diagnostic events for the /testing page (timings, per-keyframe results). Not used in normal playback. */
export type VerificationDebugEvent =
  | {
      type: "bootstrap";
      format: WatermarkFormat;
      userId: number;
      frameIndex: number;
      /** Bootstrap-frame RSA result: informational only, never enforced. null = not checked. */
      bootstrapRsa: boolean | null;
      elapsedMs: number;
    }
  | {type: "bootstrap_failed"; reason: string; elapsedMs: number}
  | {type: "queue_started"; format: WatermarkFormat; frameCount: number; keyframes: number}
  | {
      type: "keyframe";
      format: WatermarkFormat;
      index: number;
      time: number;
      result: "verified" | "skipped" | "failed";
      reason: string;
      checkMs: number;
      mediaTime: number;
    }
  | {type: "seek"; mediaTime: number; floorTime: number}
  | {type: "failed"; reason: string; detail?: Record<string, unknown>};

type UseWatermarkVerificationOptions = {
  enabled: boolean;
  videoId?: string | null;
  onVerificationComplete?: (status: "verified" | "failed", userId: string | null) => void;
  onVerificationProgress?: (progress: VerificationProgress) => void;
  /** Diagnostics hook for the /testing page. */
  onDebugEvent?: (event: VerificationDebugEvent) => void;
  /**
   * Testing only: use this PEM instead of fetching the creator's key from the SAIVD API
   * (for files signed with a test key). Never set in normal playback.
   */
  publicKeyPemOverride?: string | null;
};

const SESSION_KEEPALIVE_TTL_MS = WASM_SESSION_KEEPALIVE_MS;

/** sessionStorage cache of creator public keys to avoid refetching across video plays.
 *  Keys are public-by-design; sessionStorage scope is per-tab and clears on close.
 *  Cache poisoning requires XSS, in which case verification is already trivially
 *  bypassable via direct DOM manipulation — the cache is not the weakest link.
 *  TTL bounds the impact of legitimate key rotation; clearCachedPem() lets callers
 *  invalidate on signature-verify failure and retry once. */
const PUBLIC_KEY_CACHE_PREFIX = "saivd-pubkey-v1:";
const PUBLIC_KEY_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

type CachedKey = {pem: string; fetchedAt: number};

function isLikelyValidPem(pem: unknown): pem is string {
  return (
    typeof pem === "string" &&
    pem.includes("-----BEGIN PUBLIC KEY-----") &&
    pem.includes("-----END PUBLIC KEY-----") &&
    pem.length < 4096 // sanity bound — RSA-4096 PEMs are ~800 bytes
  );
}

function readCachedPem(numericUserId: number): string | null {
  try {
    const raw = sessionStorage.getItem(`${PUBLIC_KEY_CACHE_PREFIX}${numericUserId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedKey;
    if (!parsed || typeof parsed.fetchedAt !== "number") return null;
    if (Date.now() - parsed.fetchedAt > PUBLIC_KEY_CACHE_TTL_MS) return null;
    if (!isLikelyValidPem(parsed.pem)) return null;
    return parsed.pem;
  } catch {
    return null;
  }
}

function writeCachedPem(numericUserId: number, pem: string): void {
  if (!isLikelyValidPem(pem)) return;
  try {
    const value: CachedKey = {pem, fetchedAt: Date.now()};
    sessionStorage.setItem(`${PUBLIC_KEY_CACHE_PREFIX}${numericUserId}`, JSON.stringify(value));
  } catch {
    /* sessionStorage may be unavailable in sandboxed embed contexts; silently skip */
  }
}

/** Invalidate a cached public key. Call this after RSA verify fails to handle
 *  legitimate key rotation and to recover from any cache poisoning, then retry
 *  the fetch with bypassCache:true once before declaring the video unverified. */
export function clearCachedPublicKey(numericUserId: number): void {
  try {
    sessionStorage.removeItem(`${PUBLIC_KEY_CACHE_PREFIX}${numericUserId}`);
  } catch {
    /* ignore */
  }
}

/**
 * Fetch public key PEM from external SAIVD API by numeric_user_id.
 * Returns from sessionStorage cache when available and valid; otherwise fetches
 * fresh and writes the cache.
 */
async function fetchPublicKeyPemFromSaivd(
  numericUserId: number,
  options: {bypassCache?: boolean} = {}
): Promise<string> {
  if (!options.bypassCache) {
    const cached = readCachedPem(numericUserId);
    if (cached) return cached;
  }

  const SAIVD_API_ORIGIN =
    process.env.NEXT_PUBLIC_SAIVD_API_URL ?? "https://saivd.netlify.app";
  const res = await fetch(`${SAIVD_API_ORIGIN}/api/users/${numericUserId}/public-key`, {
    credentials: "omit",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error?.message ?? `Failed to fetch public key: ${res.status}`);
  }
  const data = await res.json();
  if (!data.success || !data.data?.public_key_pem) {
    throw new Error("Invalid public key response");
  }
  if (!isLikelyValidPem(data.data.public_key_pem)) {
    throw new Error("Invalid public key format");
  }
  writeCachedPem(numericUserId, data.data.public_key_pem);
  return data.data.public_key_pem;
}

/**
 * Frame 0 is the only frame with right-side data that can be read without the RSA key. We extract
 * the user ID from frame 0 (no key) via WebCodecs (demux → decode → Y plane). Canvas path is
 * disabled; verification fails if WebCodecs/WASM demuxer is unavailable.
 */
export function useWatermarkVerification(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  videoUrl: string | null,
  options: UseWatermarkVerificationOptions
) {
  const {enabled, videoId, onVerificationComplete, onVerificationProgress, onDebugEvent, publicKeyPemOverride} =
    options;
  const onDebugEventRef = useRef<typeof onDebugEvent>(onDebugEvent);
  onDebugEventRef.current = onDebugEvent;
  const publicKeyPemOverrideRef = useRef<string | null>(publicKeyPemOverride ?? null);
  publicKeyPemOverrideRef.current = publicKeyPemOverride ?? null;
  const emitDebug = (event: VerificationDebugEvent) => onDebugEventRef.current?.(event);
  /** The creator's PEM: the testing override when set, else the SAIVD API (cached). */
  const getPublicKeyPem = (numericUserId: number, opts: {bypassCache?: boolean} = {}): Promise<string> =>
    publicKeyPemOverrideRef.current
      ? Promise.resolve(publicKeyPemOverrideRef.current)
      : fetchPublicKeyPemFromSaivd(numericUserId, opts);
  const [status, setStatus] = useState<WatermarkVerificationStatus>("idle");
  const [verifiedUserId, setVerifiedUserId] = useState<string | null>(null);
  const publicKeyRef = useRef<CryptoKey | null>(null);
  const callbackFiredRef = useRef(false);
  const verifiedFrameIndicesRef = useRef<Set<number>>(new Set());
  const onVerificationCompleteRef = useRef<typeof onVerificationComplete>(onVerificationComplete);
  const verificationSessionKeyRef = useRef<string | null>(null);
  const verificationStartedRef = useRef(false);
  const inconclusiveGraceUsedRef = useRef(false);
  const prewarmStartedRef = useRef(false);
  const onVerificationProgressRef = useRef<typeof onVerificationProgress>(onVerificationProgress);
  const lastProgressRef = useRef<{phase: VerificationProgressPhase; detail?: string} | null>(null);
  const [watermarkFormat, setWatermarkFormat] = useState<WatermarkFormat | null>(null);
  const watermarkFormatRef = useRef<WatermarkFormat | null>(null);
  /** User id decoded at bootstrap; every later keyframe must carry the same one. */
  const bootstrapUserIdRef = useRef<number | null>(null);
  /** Clear-cache-and-refetch of the public key is allowed once per video (key rotation / stale cache). */
  const keyRefreshUsedRef = useRef(false);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const debugLog = (...args: any[]) => {
    console.log("[WatermarkVerify]", ...args);
  };

  useEffect(() => {
    onVerificationCompleteRef.current = onVerificationComplete;
  }, [onVerificationComplete]);
  useEffect(() => {
    onVerificationProgressRef.current = onVerificationProgress;
  }, [onVerificationProgress]);

  const emitProgress = (phase: VerificationProgressPhase, detail?: string) => {
    if (
      lastProgressRef.current &&
      lastProgressRef.current.phase === phase &&
      lastProgressRef.current.detail === detail
    ) {
      return;
    }
    lastProgressRef.current = {phase, detail};
    if (videoId && phase !== "prewarm") {
      markVideo(videoId, phase as VideoVerifyPhase);
    }
    onVerificationProgressRef.current?.({phase, detail, ts: Date.now()});
  };

  useEffect(() => {
    if (!enabled || !videoUrl) return;
    if (prewarmStartedRef.current && verificationSessionKeyRef.current === videoUrl) return;
    prewarmStartedRef.current = true;
    verificationSessionKeyRef.current = videoUrl;
    const t0 = performance.now();
    emitProgress("prewarm", "Warming verification engine");
    void prewarmWasmVerificationSession(videoUrl).finally(() => {
      console.log("[Frame0Decode] Prewarm complete", {
        prewarmMs: Math.round(performance.now() - t0),
      });
    });
  }, [enabled, videoUrl]);

  useEffect(() => {
    debugLog("Effect start", {enabled, hasVideoUrl: !!videoUrl});
    if (!videoUrl) {
      setStatus("idle");
      setVerifiedUserId(null);
      callbackFiredRef.current = false;
      verificationStartedRef.current = false;
      verificationSessionKeyRef.current = null;
      publicKeyRef.current = null;
      inconclusiveGraceUsedRef.current = false;
      prewarmStartedRef.current = false;
      verifiedFrameIndicesRef.current = new Set();
      lastProgressRef.current = null;
      watermarkFormatRef.current = null;
      setWatermarkFormat(null);
      bootstrapUserIdRef.current = null;
      keyRefreshUsedRef.current = false;
      scheduleDisposeWasmVerificationSession(SESSION_KEEPALIVE_TTL_MS);
      return;
    }
    if (!enabled) {
      // Keep warmed session alive while player remains open and URL is stable.
      return;
    }

    const sessionKey = videoUrl;
    if (verificationSessionKeyRef.current !== sessionKey) {
      verificationSessionKeyRef.current = sessionKey;
      verificationStartedRef.current = false;
      callbackFiredRef.current = false;
      inconclusiveGraceUsedRef.current = false;
      verifiedFrameIndicesRef.current = new Set();
      watermarkFormatRef.current = null;
      setWatermarkFormat(null);
      bootstrapUserIdRef.current = null;
      keyRefreshUsedRef.current = false;
    }
    if (verificationStartedRef.current) {
      debugLog("Skipping duplicate bootstrap verification in same session", {sessionKey});
      return;
    }
    verificationStartedRef.current = true;

    const verifyStartTime = performance.now();
    console.log("[Frame0Decode] Verification starting immediately (no video element wait)", {
      t: Math.round(verifyStartTime),
    });

    setStatus("verifying");
    let mounted = true;

    const runVerification = async () => {
      const decodeStart = performance.now();
      emitProgress("session_init", "Preparing secure verification");
      emitProgress("moov_parse", "Reading video structure");
      emitProgress("ffmpeg_load", "Loading verification engine");
      const frameIndexes = [0, 1, 2];
      const candidates: Array<{
        frameIndex: number;
        numericUserId: number;
        bestScore: number;
        repsUsed: number;
        yPlane: Uint8Array;
        width: number;
        height: number;
      }> = [];
      let strongFrame0Candidate: (typeof candidates)[number] | null = null;
      let parallelKeyPromise: Promise<string> | null = null;
      let parallelKeyUserId: number | null = null;
      let v3Bootstrap: {frameIndex: number; reading: V3FrameReading & {userIdUv: number}} | null = null;

      for (const frameIndex of frameIndexes) {
        emitProgress("frame_decode", `Checking watermark on frame ${frameIndex}`);
        const frameStart = performance.now();
        let wasmY: { yPlane: Uint8Array; width: number; height: number } | null = null;
        let v3Reading: V3FrameReading | null = null;
        try {
          // Y, U and V: the U/V user-ID block tells v3 from v2; v2 uses only the Y plane below.
          const yuv = await getFrameYuvFromWasm(videoUrl, frameIndex);
          if (yuv) {
            wasmY = {yPlane: yuv.y, width: yuv.width, height: yuv.height};
            v3Reading = readFrameV3(yuv);
          }
        } catch (e) {
          debugLog("WASM frame capture failed", {frameIndex, error: e});
        }
        if (!mounted) return;
        if (!wasmY) {
          console.log("[Frame0Decode] Bootstrap frame decode result", {
            frameIndex,
            elapsedMs: Math.round(performance.now() - frameStart),
            captured: false,
          });
          continue;
        }

        if (isV3Reading(v3Reading)) {
          console.log("[Frame0Decode] Bootstrap v3 frame", {
            frameIndex,
            elapsedMs: Math.round(performance.now() - frameStart),
            userIdUv: v3Reading.userIdUv,
            userIdY: v3Reading.userIdY,
            signatureReadable: v3Reading.signature !== null,
          });
          v3Bootstrap = {frameIndex, reading: v3Reading};
          break;
        }

        const diagnostics = decodeNumericUserIdDiagnosticsFromLuma(
          wasmY.yPlane,
          wasmY.width,
          wasmY.height
        );
        console.log("[Frame0Decode] Bootstrap frame decode result", {
          frameIndex,
          elapsedMs: Math.round(performance.now() - frameStart),
          numericUserId: diagnostics.numericUserId,
          bestScore: diagnostics.bestScore,
          repsUsed: diagnostics.repsUsed,
          validDigits: diagnostics.validDigits,
          rightSideLength: diagnostics.rightSideLength,
        });

        if (
          diagnostics.numericUserId !== null &&
          diagnostics.numericUserId > 0 &&
          diagnostics.validDigits
        ) {
          const candidate = {
            frameIndex,
            numericUserId: diagnostics.numericUserId,
            bestScore: diagnostics.bestScore,
            repsUsed: diagnostics.repsUsed,
            yPlane: wasmY.yPlane,
            width: wasmY.width,
            height: wasmY.height,
          };
          candidates.push(candidate);
          if (
            isParallelKeyFetchEnabled() &&
            !parallelKeyPromise &&
            diagnostics.numericUserId !== null
          ) {
            parallelKeyUserId = diagnostics.numericUserId;
            parallelKeyPromise = getPublicKeyPem(diagnostics.numericUserId);
          }
          if (frameIndex === 0 && diagnostics.bestScore === 0 && diagnostics.repsUsed >= 4) {
            strongFrame0Candidate = candidate;
            console.log("[Frame0Decode] Strong frame0 candidate short-circuit", {
              frameIndex,
              numericUserId: diagnostics.numericUserId,
              bestScore: diagnostics.bestScore,
              repsUsed: diagnostics.repsUsed,
            });
            break;
          }
        }
      }

      if (v3Bootstrap) {
        await finishV3Bootstrap(v3Bootstrap.frameIndex, v3Bootstrap.reading, decodeStart);
        return;
      }

      const votes = new Map<number, number>();
      for (const candidate of candidates) {
        votes.set(candidate.numericUserId, (votes.get(candidate.numericUserId) ?? 0) + 1);
      }
      let selected: (typeof candidates)[number] | null = null;
      let maxVotes = 0;
      for (const candidate of candidates) {
        const voteCount = votes.get(candidate.numericUserId) ?? 0;
        if (
          !selected ||
          voteCount > maxVotes ||
          (voteCount === maxVotes && candidate.bestScore < selected.bestScore)
        ) {
          selected = candidate;
          maxVotes = voteCount;
        }
      }

      const passesConsensus =
        !!selected &&
        (maxVotes >= 2 || (maxVotes === 1 && selected.bestScore === 0 && selected.repsUsed >= 4));
      const shouldShortCircuit = !!strongFrame0Candidate;
      if (shouldShortCircuit) {
        selected = strongFrame0Candidate;
      }

      console.log("[Frame0Decode] Bootstrap consensus summary", {
        candidates: candidates.map((c) => ({
          frameIndex: c.frameIndex,
          numericUserId: c.numericUserId,
          bestScore: c.bestScore,
          repsUsed: c.repsUsed,
          votes: votes.get(c.numericUserId) ?? 0,
        })),
        selectedNumericUserId: selected?.numericUserId ?? null,
        selectedFrameIndex: selected?.frameIndex ?? null,
        selectedVotes: selected ? votes.get(selected.numericUserId) ?? 0 : 0,
        pass: shouldShortCircuit ? true : passesConsensus,
        shortCircuitedOnFrame0: shouldShortCircuit,
      });

      if ((!passesConsensus && !shouldShortCircuit) || !selected) {
        debugLog("Bootstrap consensus failed: WASM verification path only", {
          candidateCount: candidates.length,
        });
        console.log(
          "[WatermarkVerify] Bootstrap decode failed. Ensure WASM worker/ffmpeg can load (see [WatermarkVerify] logs). Video URL snippet:",
          videoUrl?.slice(-80)
        );
        console.log("[Frame0Decode] Verification finished", { status: "failed", elapsedMs: Math.round(performance.now() - verifyStartTime) });
        if (videoId) {
          markVideo(videoId, "verify_end");
          flushVideoBeacon(videoId, {outcome: "failed", elapsedMs: Math.round(performance.now() - verifyStartTime)});
        }
        if (mounted) setStatus("failed");
        if (mounted) {
          emitDebug({
            type: "bootstrap_failed",
            reason: candidates.length === 0 ? "no_watermark_read_on_frames_0_2" : "user_id_consensus_failed",
            elapsedMs: Math.round(performance.now() - verifyStartTime),
          });
        }
        if (mounted && !callbackFiredRef.current && onVerificationCompleteRef.current) {
          callbackFiredRef.current = true;
          onVerificationCompleteRef.current("failed", null);
        }
        return;
      }

      const numericUserId = selected.numericUserId;
      console.log("[Frame0Decode] Decode phase timing", {
        frameDecodeMs: Math.round(performance.now() - decodeStart),
      });

      const keyFetchStart = performance.now();
      emitProgress("key_fetch", "Retrieving signer key");
      let pem: string | null = null;
      try {
        debugLog("Fetching public key PEM", {numericUserId});
        if (parallelKeyPromise && parallelKeyUserId === numericUserId) {
          pem = await parallelKeyPromise;
        } else {
          pem = await getPublicKeyPem(numericUserId);
        }
        debugLog("Fetched public key PEM length", {length: pem.length});
      } catch (e) {
        debugLog("Fetch public key failed (non-blocking)", e);
      }
      console.log("[Frame0Decode] Key fetch timing", {
        keyFetchMs: Math.round(performance.now() - keyFetchStart),
      });

      let key: CryptoKey | null = null;
      if (pem) {
        try {
          key = await importPublicKeyFromPem(pem);
          debugLog("Imported public key");
        } catch (e) {
          debugLog("Import key failed (non-blocking)", e);
        }
      }
      publicKeyRef.current = key;

      let bootstrapRsa: boolean | null = null;
      if (key) {
        emitProgress("rsa_verify", "Validating authenticity signature");
        try {
          const result = await decodeAndVerifyFrameFromLuma(
            key,
            selected.yPlane,
            selected.width,
            selected.height
          );
          bootstrapRsa = result.verified;
          debugLog("Bootstrap RSA verification result (WASM Y plane)", {
            verified: result.verified,
            numericUserId: result.numericUserId,
            frameIndex: selected.frameIndex,
          });
        } catch (e) {
          debugLog("RSA verification threw (non-blocking)", e);
        }
      }

      if (!mounted) return;
      emitProgress("finalizing", "Final checks");
      const elapsed = Math.round(performance.now() - verifyStartTime);
      console.log("[Frame0Decode] Verification finished", { status: "verified", elapsedMs: elapsed });
      if (videoId) {
        markVideo(videoId, "verify_end");
        flushVideoBeacon(videoId, {outcome: "verified", elapsedMs: elapsed});
      }
      verifiedFrameIndicesRef.current = new Set([0]);
      watermarkFormatRef.current = "v2";
      setWatermarkFormat("v2");
      bootstrapUserIdRef.current = numericUserId;
      setVerifiedUserId(String(numericUserId));
      setStatus("verified");
      emitDebug({
        type: "bootstrap",
        format: "v2",
        userId: numericUserId,
        frameIndex: selected.frameIndex,
        bootstrapRsa,
        elapsedMs: elapsed,
      });
      debugLog("Verification succeeded for frame 0 (user ID decoded)", {numericUserId});
      if (!callbackFiredRef.current && onVerificationCompleteRef.current) {
        callbackFiredRef.current = true;
        onVerificationCompleteRef.current("verified", String(numericUserId));
      }
    };

    /**
     * v3 bootstrap: the user id comes from the CRC-checked U/V block. By policy the bootstrap frame's RSA
     * result is logged but ignored, so playback starts without waiting on it; later keyframes are
     * enforced by the keyframe queue.
     */
    const finishV3Bootstrap = async (
      frameIndex: number,
      reading: V3FrameReading & {userIdUv: number},
      decodeStart: number
    ) => {
      const numericUserId = reading.userIdUv;
      if (reading.userIdY !== null && reading.userIdY !== numericUserId) {
        console.warn("[WatermarkVerify] v3 user id mismatch: Y payload differs from U/V block (U/V trusted)", {
          frameIndex,
          userIdUv: numericUserId,
          userIdY: reading.userIdY,
        });
      }
      console.log("[Frame0Decode] Decode phase timing", {
        frameDecodeMs: Math.round(performance.now() - decodeStart),
        format: "v3",
      });

      const keyFetchStart = performance.now();
      emitProgress("key_fetch", "Retrieving signer key");
      let key: CryptoKey | null = null;
      try {
        key = await importPublicKeyFromPem(await getPublicKeyPem(numericUserId));
      } catch (e) {
        debugLog("Fetch/import public key failed (non-blocking at bootstrap)", e);
      }
      console.log("[Frame0Decode] Key fetch timing", {
        keyFetchMs: Math.round(performance.now() - keyFetchStart),
      });
      if (!mounted) return;
      publicKeyRef.current = key;

      let bootstrapRsa: boolean | null = null;
      if (key && reading.signature) {
        emitProgress("rsa_verify", "Validating authenticity signature");
        try {
          const info = await getWasmVideoTrackInfo(videoUrl);
          const verified = info
            ? await verifyV3Signature(key, reading.signature, info.nbSamples, numericUserId)
            : false;
          bootstrapRsa = verified;
          debugLog("Bootstrap v3 RSA result (informational; not enforced on the bootstrap frame)", {
            verified,
            frameIndex,
            frameCount: info?.nbSamples ?? null,
          });
        } catch (e) {
          debugLog("Bootstrap v3 RSA threw (non-blocking)", e);
        }
      } else {
        debugLog("Bootstrap v3 RSA skipped (informational)", {
          hasKey: !!key,
          signatureReadable: reading.signature !== null,
        });
      }

      if (!mounted) return;
      emitProgress("finalizing", "Final checks");
      const elapsed = Math.round(performance.now() - verifyStartTime);
      console.log("[Frame0Decode] Verification finished", {status: "verified", elapsedMs: elapsed, format: "v3"});
      if (videoId) {
        markVideo(videoId, "verify_end");
        flushVideoBeacon(videoId, {outcome: "verified", elapsedMs: elapsed});
      }
      verifiedFrameIndicesRef.current = new Set([0]);
      watermarkFormatRef.current = "v3";
      setWatermarkFormat("v3");
      bootstrapUserIdRef.current = numericUserId;
      setVerifiedUserId(String(numericUserId));
      setStatus("verified");
      emitDebug({type: "bootstrap", format: "v3", userId: numericUserId, frameIndex, bootstrapRsa, elapsedMs: elapsed});
      if (!callbackFiredRef.current && onVerificationCompleteRef.current) {
        callbackFiredRef.current = true;
        onVerificationCompleteRef.current("verified", String(numericUserId));
      }
    };

    runVerification();

    return () => {
      mounted = false;
    };
  }, [enabled, videoUrl]);

  /**
   * Ongoing verification: a verify-ahead queue over the MP4's keyframes (the watermarked frames).
   * - Keyframe 0 is skipped by policy (playback starts without waiting on its RSA result).
   * - Keyframes are checked in time order, up to KEYFRAME_VERIFY_LOOKAHEAD_S ahead of the playhead.
   * - v3: a failed or uncorrectable (RS) signature, or a user id different from bootstrap, blocks playback.
   * - v2: only the Y-payload user id is checked; a user id different from bootstrap blocks playback.
   * - Decode / network errors use the one-skip allowance: the next error blocks; a success resets it.
   * - A keyframe the playhead has reached must be verified within KEYFRAME_VERIFY_DEADLINE_MS of
   *   wall-clock playing time (paused, seeking and buffering time don't count), or playback is blocked.
   * - The playhead comes from requestVideoFrameCallback media times; seeks move the queue's floor to the
   *   keyframe at or before the new position. currentTime is read only where rVFC is unavailable.
   */
  useEffect(() => {
    if (!enabled || status !== "verified" || !videoUrl) return;
    const video = videoRef.current;
    if (!video) return;
    const format = watermarkFormatRef.current;
    const expectedUserId = bootstrapUserIdRef.current;
    if (!format || expectedUserId === null) return;

    type RvfcVideo = HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: (now: number, meta: {mediaTime: number}) => void) => number;
      cancelVideoFrameCallback?: (handle: number) => void;
    };
    const rvfcVideo = video as RvfcVideo;
    const hasRvfc = typeof rvfcVideo.requestVideoFrameCallback === "function";

    let stopped = false;
    let keyframes: WasmKeyframe[] = [];
    let frameCount = 0;
    let mediaTime = 0;
    let floorTime = 0;
    let seekPending = false;
    let rvfcHandle: number | null = null;
    const overdueMs = new Map<number, number>();
    const done = verifiedFrameIndicesRef.current;

    const fail = (reason: string, detail?: Record<string, unknown>) => {
      if (stopped) return;
      stopped = true;
      console.warn("[WatermarkVerify] Ongoing verification failed", {reason, format, ...detail});
      emitDebug({type: "failed", reason, detail});
      setStatus("failed");
      video.pause();
      if (!callbackFiredRef.current && onVerificationCompleteRef.current) {
        callbackFiredRef.current = true;
        onVerificationCompleteRef.current("failed", null);
      }
    };

    const ensureKey = async (): Promise<CryptoKey | null> => {
      if (publicKeyRef.current) return publicKeyRef.current;
      try {
        const key = await importPublicKeyFromPem(await getPublicKeyPem(expectedUserId));
        publicKeyRef.current = key;
        return key;
      } catch (e) {
        debugLog("Public key fetch failed during ongoing verification", e);
        return null;
      }
    };

    /** Once per video: drop the cached key and refetch it (key rotation / stale cache) before failing. */
    const refreshKey = async (): Promise<CryptoKey | null> => {
      if (keyRefreshUsedRef.current) return null;
      keyRefreshUsedRef.current = true;
      clearCachedPublicKey(expectedUserId);
      try {
        const key = await importPublicKeyFromPem(
          await getPublicKeyPem(expectedUserId, {bypassCache: true})
        );
        publicKeyRef.current = key;
        return key;
      } catch {
        return null;
      }
    };

    type CheckOutcome = {result: KeyframeCheckResult; reason: string};

    const checkKeyframeV3 = async (index: number): Promise<CheckOutcome> => {
      let frame: Awaited<ReturnType<typeof getFrameYuvFromWasm>> = null;
      try {
        frame = await getFrameYuvFromWasm(videoUrl, index);
      } catch {
        frame = null;
      }
      if (!frame) return {result: "error", reason: "frame_decode_failed"};
      const reading = readFrameV3(frame);
      if (!reading) return {result: "failed", reason: "frame_too_small_for_v3"};
      if (reading.signature === null) return {result: "failed", reason: "signature_unreadable"};
      if (reading.userId === null) return {result: "failed", reason: "user_id_unreadable"};
      if (reading.userId !== expectedUserId) return {result: "failed", reason: "user_id_changed"};
      const key = await ensureKey();
      if (!key) return {result: "error", reason: "public_key_unavailable"};
      if (await verifyV3Signature(key, reading.signature, frameCount, reading.userId)) {
        return {result: "verified", reason: "ok"};
      }
      const fresh = await refreshKey();
      if (fresh && (await verifyV3Signature(fresh, reading.signature, frameCount, reading.userId))) {
        return {result: "verified", reason: "ok_after_key_refresh"};
      }
      return {result: "failed", reason: "signature_mismatch"};
    };

    /**
     * v2 keyframes: the Y-payload user id must match the bootstrap user id. The legacy v2 RSA
     * (decodeAndVerifyFrameFromLuma, 5-pixel groups) is not used here: those groups don't survive H.264 —
     * on real v2 outputs it failed on every keyframe (2026-11-23) — so v2 checks user-id consistency only.
     */
    const checkKeyframeV2 = async (index: number): Promise<CheckOutcome> => {
      let wasmFrame: Awaited<ReturnType<typeof getFrameYFromWasm>> = null;
      try {
        wasmFrame = await getFrameYFromWasm(videoUrl, index);
      } catch {
        wasmFrame = null;
      }
      if (!wasmFrame) return {result: "error", reason: "frame_decode_failed"};
      const {numericUserId} = decodeNumericUserIdDiagnosticsFromLuma(
        wasmFrame.yPlane,
        wasmFrame.width,
        wasmFrame.height
      );
      if (numericUserId === null) return {result: "error", reason: "user_id_unreadable"};
      if (numericUserId !== expectedUserId) return {result: "failed", reason: "user_id_changed"};
      return {result: "verified", reason: "ok"};
    };

    const applyOutcome = (kf: WasmKeyframe, outcome: CheckOutcome, checkMs: number) => {
      const index = kf.index;
      const report = (result: "verified" | "skipped" | "failed") =>
        emitDebug({type: "keyframe", format, index, time: kf.time, result, reason: outcome.reason, checkMs, mediaTime});
      if (outcome.result === "verified") {
        inconclusiveGraceUsedRef.current = false;
        done.add(index);
        overdueMs.delete(index);
        report("verified");
        return;
      }
      if (outcome.result === "error" && !inconclusiveGraceUsedRef.current) {
        inconclusiveGraceUsedRef.current = true;
        done.add(index);
        overdueMs.delete(index);
        debugLog("Keyframe check inconclusive; one-skip allowance used", {index, reason: outcome.reason});
        report("skipped");
        return;
      }
      report("failed");
      fail(outcome.reason, {index});
    };

    /** Earliest unverified keyframe in scope and within the look-ahead window. */
    const nextTarget = (): WasmKeyframe | null => {
      for (const kf of keyframes) {
        if (kf.time < floorTime - KEYFRAME_TIME_EPSILON_S || done.has(kf.index)) continue;
        return kf.time <= mediaTime + KEYFRAME_VERIFY_LOOKAHEAD_S ? kf : null;
      }
      return null;
    };

    /** Time of the keyframe at or before media time t (the keyframe whose GOP is on screen). */
    const keyframeFloorFor = (t: number): number => {
      let floor = 0;
      for (const kf of keyframes) {
        if (kf.time <= t + KEYFRAME_TIME_EPSILON_S) floor = kf.time;
        else break;
      }
      return floor;
    };

    const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

    const runQueue = async () => {
      let info: Awaited<ReturnType<typeof getWasmVideoTrackInfo>> = null;
      try {
        info = await getWasmVideoTrackInfo(videoUrl);
      } catch {
        info = null;
      }
      if (stopped) return;
      if (!info) {
        fail("track_info_unavailable");
        return;
      }
      frameCount = info.nbSamples;
      keyframes = info.keyframes.filter((kf) => kf.index !== 0).sort((a, b) => a.time - b.time);
      debugLog("Keyframe queue started", {format, frameCount, keyframes: keyframes.length});
      emitDebug({type: "queue_started", format, frameCount, keyframes: keyframes.length});
      while (!stopped) {
        const kf = seekPending ? null : nextTarget();
        if (!kf) {
          await sleep(QUEUE_IDLE_POLL_MS);
          continue;
        }
        const checkStart = performance.now();
        const outcome = format === "v3" ? await checkKeyframeV3(kf.index) : await checkKeyframeV2(kf.index);
        if (stopped) return;
        applyOutcome(kf, outcome, Math.round(performance.now() - checkStart));
      }
    };

    const onFrame = (_now: number, meta: {mediaTime: number}) => {
      mediaTime = meta.mediaTime;
      if (seekPending) {
        floorTime = keyframeFloorFor(mediaTime);
        overdueMs.clear();
        seekPending = false;
        emitDebug({type: "seek", mediaTime, floorTime});
      }
      if (!stopped && rvfcVideo.requestVideoFrameCallback) {
        rvfcHandle = rvfcVideo.requestVideoFrameCallback(onFrame);
      }
    };
    const onSeeking = () => {
      seekPending = true;
      overdueMs.clear();
    };
    const onSeeked = () => {
      if (hasRvfc) return; // the next presented frame (rVFC) settles the new position
      mediaTime = video.currentTime;
      floorTime = keyframeFloorFor(mediaTime);
      seekPending = false;
      emitDebug({type: "seek", mediaTime, floorTime});
    };

    let lastTick = performance.now();
    const deadlineTimer = window.setInterval(() => {
      const now = performance.now();
      const elapsed = now - lastTick;
      lastTick = now;
      if (stopped) return;
      if (!hasRvfc && !video.seeking) mediaTime = video.currentTime; // fallback for browsers without rVFC
      const playing = !video.paused && !video.ended && !video.seeking && video.readyState >= 3;
      if (!playing || seekPending) return;
      for (const kf of keyframes) {
        if (kf.time > mediaTime + KEYFRAME_TIME_EPSILON_S) break;
        if (kf.time < floorTime - KEYFRAME_TIME_EPSILON_S || done.has(kf.index)) continue;
        const spent = (overdueMs.get(kf.index) ?? 0) + elapsed;
        overdueMs.set(kf.index, spent);
        if (spent >= KEYFRAME_VERIFY_DEADLINE_MS) {
          fail("verification_deadline_exceeded", {index: kf.index, keyframeTime: kf.time, spentMs: Math.round(spent)});
          return;
        }
      }
    }, DEADLINE_TICK_MS);

    if (hasRvfc && rvfcVideo.requestVideoFrameCallback) {
      rvfcHandle = rvfcVideo.requestVideoFrameCallback(onFrame);
    }
    video.addEventListener("seeking", onSeeking);
    video.addEventListener("seeked", onSeeked);
    void runQueue();

    return () => {
      stopped = true;
      window.clearInterval(deadlineTimer);
      if (rvfcHandle !== null) rvfcVideo.cancelVideoFrameCallback?.(rvfcHandle);
      video.removeEventListener("seeking", onSeeking);
      video.removeEventListener("seeked", onSeeked);
    };
  }, [enabled, status, videoRef, videoUrl]);

  return {status, verifiedUserId, watermarkFormat};
}
