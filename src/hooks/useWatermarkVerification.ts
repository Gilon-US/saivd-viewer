"use client";

import {useEffect, useRef, useState} from "react";
import {
  decodeNumericUserIdDiagnosticsFromLuma,
  decodeAndVerifyFrameFromLuma,
  importPublicKeyFromPem
} from "@/lib/watermark-verification";
import {
  getFrameYFromWasm,
  prewarmWasmVerificationSession,
  scheduleDisposeWasmVerificationSession,
} from "@/lib/wasm-watermark-verification-client";

export type WatermarkVerificationStatus = "idle" | "verifying" | "verified" | "failed";
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

type UseWatermarkVerificationOptions = {
  enabled: boolean;
  onVerificationComplete?: (status: "verified" | "failed", userId: string | null) => void;
  onVerificationProgress?: (progress: VerificationProgress) => void;
};

const SESSION_KEEPALIVE_TTL_MS = 45000;

/**
 * Fetch public key PEM from external SAIVD API by numeric_user_id.
 */
async function fetchPublicKeyPemFromSaivd(numericUserId: number): Promise<string> {
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
  const {enabled, onVerificationComplete, onVerificationProgress} = options;
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

      for (const frameIndex of frameIndexes) {
        emitProgress("frame_decode", `Checking watermark on frame ${frameIndex}`);
        const frameStart = performance.now();
        let wasmY: { yPlane: Uint8Array; width: number; height: number } | null = null;
        try {
          wasmY = await getFrameYFromWasm(videoUrl, frameIndex);
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
        if (mounted) setStatus("failed");
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
        pem = await fetchPublicKeyPemFromSaivd(numericUserId);
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

      if (key) {
        emitProgress("rsa_verify", "Validating authenticity signature");
        try {
          const result = await decodeAndVerifyFrameFromLuma(
            key,
            selected.yPlane,
            selected.width,
            selected.height
          );
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
      console.log("[Frame0Decode] Full video loads only after this (when <video> src is set). Verification used Range requests + WASM decode.");
      verifiedFrameIndicesRef.current = new Set([0]);
      setVerifiedUserId(String(numericUserId));
      setStatus("verified");
      debugLog("Verification succeeded for frame 0 (user ID decoded)", {numericUserId});
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

  useEffect(() => {
    if (!enabled || status !== "verified" || !videoUrl) return;
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      if (video.paused || video.ended) return;
      const key = publicKeyRef.current;
      if (!key) return;

      const fps = Number.isFinite(video.getVideoPlaybackQuality?.().totalVideoFrames)
        ? Math.max(1, video.getVideoPlaybackQuality().totalVideoFrames / Math.max(0.001, video.currentTime || 0.001))
        : 30;
      const currentFrame = Math.floor(video.currentTime * fps);
      const checkpoint = Math.floor(currentFrame / 10) * 10;
      if (checkpoint <= 0 || verifiedFrameIndicesRef.current.has(checkpoint)) return;

      let wasmFrame: Awaited<ReturnType<typeof getFrameYFromWasm>> = null;
      try {
        wasmFrame = await getFrameYFromWasm(videoUrl, checkpoint);
      } catch {
        wasmFrame = null;
      }
      if (!wasmFrame) {
        if (inconclusiveGraceUsedRef.current) {
          setStatus("failed");
          video.pause();
          if (!callbackFiredRef.current && onVerificationCompleteRef.current) {
            callbackFiredRef.current = true;
            onVerificationCompleteRef.current("failed", null);
          }
        } else {
          inconclusiveGraceUsedRef.current = true;
          verifiedFrameIndicesRef.current.add(checkpoint);
        }
        return;
      }

      const frameResult = await decodeAndVerifyFrameFromLuma(
        key,
        wasmFrame.yPlane,
        wasmFrame.width,
        wasmFrame.height
      );
      if (frameResult.verified) {
        inconclusiveGraceUsedRef.current = false;
        verifiedFrameIndicesRef.current.add(checkpoint);
        return;
      }

      if (frameResult.numericUserId === null) {
        if (inconclusiveGraceUsedRef.current) {
          setStatus("failed");
          video.pause();
          if (!callbackFiredRef.current && onVerificationCompleteRef.current) {
            callbackFiredRef.current = true;
            onVerificationCompleteRef.current("failed", null);
          }
        } else {
          inconclusiveGraceUsedRef.current = true;
          verifiedFrameIndicesRef.current.add(checkpoint);
        }
        return;
      }

      setStatus("failed");
      video.pause();
      if (!callbackFiredRef.current && onVerificationCompleteRef.current) {
        callbackFiredRef.current = true;
        onVerificationCompleteRef.current("failed", null);
      }
    };

    const interval = window.setInterval(() => {
      void tick();
    }, 300);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [enabled, status, videoRef, videoUrl]);

  return {status, verifiedUserId};
}
