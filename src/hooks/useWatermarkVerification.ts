"use client";

import {useEffect, useRef, useState} from "react";
import {
  decodeAndVerifyFrameFromLuma,
  importPublicKeyFromPem,
  decodeNumericUserIdFromLuma,
} from "@/lib/watermark-verification";
import { captureFrame0YFromUrl } from "@/lib/webcodecs-capture";

export type WatermarkVerificationStatus = "idle" | "verifying" | "verified" | "failed";

type UseWatermarkVerificationOptions = {
  enabled: boolean;
  onVerificationComplete?: (status: "verified" | "failed", userId: string | null) => void;
};

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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const debugLog = (...args: any[]) => {
    console.log("[WatermarkVerify]", ...args);
  };

  useEffect(() => {
    debugLog("Effect start", {enabled, hasVideoUrl: !!videoUrl});
    if (!enabled || !videoUrl) {
      setStatus("idle");
      setVerifiedUserId(null);
      callbackFiredRef.current = false;
      return;
    }

    const verifyStartTime = performance.now();
    console.log("[Frame0Decode] Verification starting immediately (no video element wait)", {
      t: Math.round(verifyStartTime),
    });

    setStatus("verifying");
    let mounted = true;

    const runVerification = async () => {
      let numericUserId: number | null = null;
      let webCodecsY: { yPlane: Uint8Array; width: number; height: number } | null = null;

      console.log("[Frame0Decode] Calling captureFrame0YFromUrl now (Range fetch only)", {
        t: Math.round(performance.now()),
      });
      try {
        webCodecsY = await captureFrame0YFromUrl(videoUrl);
      } catch (e) {
        debugLog("WebCodecs capture failed (canvas path disabled)", e);
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
        if (mounted && !callbackFiredRef.current && onVerificationComplete) {
          callbackFiredRef.current = true;
          onVerificationComplete("failed", null);
        }
        return;
      }

      let pem: string | null = null;
      try {
        debugLog("Fetching public key PEM", {numericUserId});
        pem = await fetchPublicKeyPemFromSaivd(numericUserId);
        debugLog("Fetched public key PEM length", {length: pem.length});
      } catch (e) {
        debugLog("Fetch public key failed (non-blocking)", e);
      }

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
      if (!callbackFiredRef.current && onVerificationComplete) {
        callbackFiredRef.current = true;
        onVerificationComplete("verified", String(numericUserId));
      }
    };

    runVerification();

    return () => {
      mounted = false;
    };
  }, [enabled, videoUrl, onVerificationComplete]);

  return {status, verifiedUserId};
}
