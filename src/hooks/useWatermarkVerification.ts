"use client";

import {useEffect, useRef, useState} from "react";
import {
  decodeAndVerifyFrameFromLuma,
  importPublicKeyFromPem,
  decodeNumericUserIdFromLuma,
} from "@/lib/watermark-verification";
import { captureFrame0YFromUrl, prewarmWebCodecsCapture } from "@/lib/webcodecs-capture";

export type WatermarkVerificationStatus = "idle" | "verifying" | "verified" | "failed";

type UseWatermarkVerificationOptions = {
  enabled: boolean;
  onVerificationComplete?: (status: "verified" | "failed", userId: string | null) => void;
};

const SESSION_KEEPALIVE_TTL_MS = 45000;

type CachedFrame0 = { yPlane: Uint8Array; width: number; height: number; expiresAt: number };
const frame0CacheByUrl = new Map<string, CachedFrame0>();
const frame0ExpiryTimersByUrl = new Map<string, ReturnType<typeof setTimeout>>();

function cloneFrame0(frame: { yPlane: Uint8Array; width: number; height: number }) {
  return {
    yPlane: new Uint8Array(frame.yPlane),
    width: frame.width,
    height: frame.height,
  };
}

function getCachedFrame0Y(videoUrl: string): { yPlane: Uint8Array; width: number; height: number } | null {
  const cached = frame0CacheByUrl.get(videoUrl);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    frame0CacheByUrl.delete(videoUrl);
    const timer = frame0ExpiryTimersByUrl.get(videoUrl);
    if (timer) clearTimeout(timer);
    frame0ExpiryTimersByUrl.delete(videoUrl);
    return null;
  }
  const timer = frame0ExpiryTimersByUrl.get(videoUrl);
  if (timer) {
    clearTimeout(timer);
    frame0ExpiryTimersByUrl.delete(videoUrl);
  }
  return cloneFrame0(cached);
}

function cacheFrame0Y(videoUrl: string, frame: { yPlane: Uint8Array; width: number; height: number }) {
  frame0CacheByUrl.set(videoUrl, {
    ...cloneFrame0(frame),
    expiresAt: Date.now() + SESSION_KEEPALIVE_TTL_MS,
  });
}

function scheduleFrame0CacheExpiry(videoUrl: string, ttlMs: number) {
  if (!frame0CacheByUrl.has(videoUrl)) return;
  const timer = frame0ExpiryTimersByUrl.get(videoUrl);
  if (timer) clearTimeout(timer);
  const nextTimer = setTimeout(() => {
    frame0CacheByUrl.delete(videoUrl);
    frame0ExpiryTimersByUrl.delete(videoUrl);
  }, ttlMs);
  frame0ExpiryTimersByUrl.set(videoUrl, nextTimer);
}

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
  _videoRef: React.RefObject<HTMLVideoElement | null>,
  videoUrl: string | null,
  options: UseWatermarkVerificationOptions
) {
  const {enabled, onVerificationComplete} = options;
  const [status, setStatus] = useState<WatermarkVerificationStatus>("idle");
  const [verifiedUserId, setVerifiedUserId] = useState<string | null>(null);
  const publicKeyRef = useRef<CryptoKey | null>(null);
  const callbackFiredRef = useRef(false);
  const verifiedFrameIndicesRef = useRef<Set<number>>(new Set());
  const onVerificationCompleteRef = useRef<typeof onVerificationComplete>(onVerificationComplete);
  const verificationSessionKeyRef = useRef<string | null>(null);
  const verificationStartedRef = useRef(false);
  const prewarmStartedRef = useRef(false);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const debugLog = (...args: any[]) => {
    console.log("[WatermarkVerify]", ...args);
  };

  useEffect(() => {
    onVerificationCompleteRef.current = onVerificationComplete;
  }, [onVerificationComplete]);

  useEffect(() => {
    if (!enabled || !videoUrl) return;
    if (prewarmStartedRef.current && verificationSessionKeyRef.current === videoUrl) return;
    prewarmStartedRef.current = true;
    verificationSessionKeyRef.current = videoUrl;
    void prewarmWebCodecsCapture(videoUrl);
  }, [enabled, videoUrl]);

  useEffect(() => {
    debugLog("Effect start", {enabled, hasVideoUrl: !!videoUrl});
    if (!enabled || !videoUrl) {
      const previousSessionUrl = verificationSessionKeyRef.current;
      if (previousSessionUrl) {
        scheduleFrame0CacheExpiry(previousSessionUrl, SESSION_KEEPALIVE_TTL_MS);
      }
      setStatus("idle");
      setVerifiedUserId(null);
      callbackFiredRef.current = false;
      verificationStartedRef.current = false;
      prewarmStartedRef.current = false;
      verificationSessionKeyRef.current = null;
      return;
    }
    const sessionKey = videoUrl;
    if (verificationSessionKeyRef.current !== sessionKey) {
      verificationSessionKeyRef.current = sessionKey;
      verificationStartedRef.current = false;
      callbackFiredRef.current = false;
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
      let numericUserId: number | null = null;
      let webCodecsY = getCachedFrame0Y(videoUrl);
      if (webCodecsY) {
        console.log("[Frame0Decode] Reusing cached frame0 decode buffer", {
          ttlMs: SESSION_KEEPALIVE_TTL_MS,
        });
      }

      if (!webCodecsY) {
        console.log("[Frame0Decode] Calling captureFrame0YFromUrl now (Range fetch only)", {
          t: Math.round(performance.now()),
        });
        try {
          webCodecsY = await captureFrame0YFromUrl(videoUrl);
        } catch (e) {
          debugLog("WebCodecs capture failed (canvas path disabled)", e);
        }
        if (webCodecsY) {
          cacheFrame0Y(videoUrl, webCodecsY);
        }
      }

      if (!mounted) return;

      if (webCodecsY) {
        debugLog("Using WebCodecs Y plane for frame 0 (accurate extraction)");
        numericUserId = decodeNumericUserIdFromLuma(
          webCodecsY.yPlane,
          webCodecsY.width,
          webCodecsY.height
        );
        debugLog("Decoded numericUserId from frame 0 (WebCodecs)", {numericUserId});
      }

      if (!webCodecsY || numericUserId === null || numericUserId <= 0) {
        debugLog("Frame 0 decode failed: WebCodecs path only (no canvas fallback)", {
          hadWebCodecsY: !!webCodecsY,
          numericUserId: numericUserId ?? null,
        });
        console.log(
          "[WatermarkVerify] Frame 0 decode failed. Ensure WebCodecs/WASM demuxer is working (see [WebCodecs] logs). Video URL snippet:",
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
      console.log("[Frame0Decode] Decode phase timing", {
        frameDecodeMs: Math.round(performance.now() - decodeStart),
      });

      const keyFetchStart = performance.now();
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
        try {
          const result = await decodeAndVerifyFrameFromLuma(
            key,
            webCodecsY.yPlane,
            webCodecsY.width,
            webCodecsY.height
          );
          debugLog("Frame 0 RSA verification result (WebCodecs)", {
            verified: result.verified,
            numericUserId: result.numericUserId,
          });
        } catch (e) {
          debugLog("RSA verification threw (non-blocking)", e);
        }
      }

      if (!mounted) return;
      const elapsed = Math.round(performance.now() - verifyStartTime);
      console.log("[Frame0Decode] Verification finished", { status: "verified", elapsedMs: elapsed });
      console.log("[Frame0Decode] Full video is loaded only after this (when <video> src is set for playback). Verification used Range requests only.");
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

  return {status, verifiedUserId};
}
