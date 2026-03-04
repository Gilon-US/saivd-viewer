"use client";

import {useEffect, useState, useRef, RefObject} from "react";
import {
  captureFrameToImageData,
  decodeNumericUserIdFromFrame0,
  importPublicKeyFromPem,
  decodeAndVerifyFrame,
} from "@/lib/watermark-decode";

const VERIFY_INTERVAL = 10; // Every 10th frame (0, 10, 20, 30, …)

/**
 * Custom hook for ongoing watermark verification during playback.
 *
 * - Runs only when video is playing and initial verification has passed (videoId + initialNumericUserId set).
 * - Every 10th frame: captures frame, decodes numeric_user_id, compares with initial; optionally RSA-verifies.
 * - Sets verificationFailed if decode fails or numeric_user_id does not match.
 *
 * @param videoRef - Reference to the video element
 * @param isPlaying - Whether the video is currently playing
 * @param videoId - Optional; when set with initialNumericUserId, enables ongoing verification
 * @param initialNumericUserId - Decoded numeric user ID from frame 0 (from VideoPlayer)
 * @param publicKeyPem - Optional PEM for RSA verification of each 10th frame
 * @returns Object containing verificationFailed (true if any 10th-frame check failed)
 */
export function useFrameAnalysis(
  videoRef: RefObject<HTMLVideoElement | null>,
  isPlaying: boolean,
  videoId?: string,
  initialNumericUserId?: number | null,
  publicKeyPem?: string | null
): {verificationFailed: boolean} {
  const [verificationFailed, setVerificationFailed] = useState(false);

  const animationFrameRef = useRef<number | null>(null);
  const frameCountRef = useRef(0);
  const lastVerifyFrameRef = useRef(-1);
  const isVerifyingRef = useRef(false);
  /** Consecutive 10th-frames where decode returned null; fail only after this exceeds tolerance. */
  const consecutiveNullDecodesRef = useRef(0);

  const MAX_CONSECUTIVE_NULL_DECODES = 2;

  useEffect(() => {
    const analyzeFrame = () => {
      const video = videoRef.current;
      if (!video || !videoId || initialNumericUserId == null || initialNumericUserId <= 0) {
        return;
      }
      if (video.paused || video.ended || !isPlaying) {
        return;
      }

      const currentFrame = frameCountRef.current;

      // Verify every 10th frame (0, 10, 20, 30, …)
      const isTenthFrame = currentFrame % VERIFY_INTERVAL === 0;
      if (!isTenthFrame || isVerifyingRef.current) {
        frameCountRef.current = currentFrame + 1;
        if (isPlaying) {
          animationFrameRef.current = requestAnimationFrame(analyzeFrame);
        }
        return;
      }

      if (currentFrame === lastVerifyFrameRef.current) {
        if (isPlaying) {
          animationFrameRef.current = requestAnimationFrame(analyzeFrame);
        }
        return;
      }

      lastVerifyFrameRef.current = currentFrame;
      isVerifyingRef.current = true;

      const imageData = captureFrameToImageData(video);
      if (!imageData) {
        console.warn("[useFrameAnalysis] Frame capture failed at frame", currentFrame);
        setVerificationFailed(true);
        isVerifyingRef.current = false;
        frameCountRef.current = currentFrame + 1;
        if (isPlaying) {
          animationFrameRef.current = requestAnimationFrame(analyzeFrame);
        }
        return;
      }

      const decoded = decodeNumericUserIdFromFrame0(imageData);
      if (currentFrame <= 20) {
        console.log("[useFrameAnalysis] Frame", currentFrame, "decoded:", decoded, "expected:", initialNumericUserId);
      }

      if (decoded === null) {
        consecutiveNullDecodesRef.current += 1;
        if (consecutiveNullDecodesRef.current >= MAX_CONSECUTIVE_NULL_DECODES) {
          console.warn("[useFrameAnalysis] Too many consecutive decode failures (null) at frame", currentFrame);
          setVerificationFailed(true);
        } else {
          console.log("[useFrameAnalysis] Decode null at frame", currentFrame, "(tolerant, need", MAX_CONSECUTIVE_NULL_DECODES - consecutiveNullDecodesRef.current, "more consecutive to fail)");
        }
        isVerifyingRef.current = false;
        frameCountRef.current = currentFrame + 1;
        if (isPlaying) {
          animationFrameRef.current = requestAnimationFrame(analyzeFrame);
        }
        return;
      }

      consecutiveNullDecodesRef.current = 0;

      if (decoded !== initialNumericUserId) {
        console.warn("[useFrameAnalysis] Decode mismatch:", {
          frame: currentFrame,
          decoded,
          expected: initialNumericUserId,
        });
        setVerificationFailed(true);
        isVerifyingRef.current = false;
        frameCountRef.current = currentFrame + 1;
        if (isPlaying) {
          animationFrameRef.current = requestAnimationFrame(analyzeFrame);
        }
        return;
      }

      // Optional RSA verify for this frame (non-fatal per guide: decode match is primary)
      if (publicKeyPem) {
        importPublicKeyFromPem(publicKeyPem)
          .then((key) => decodeAndVerifyFrame(key, imageData))
          .then(({verified}) => {
            if (!verified) {
              console.warn("[useFrameAnalysis] RSA verify failed for frame", currentFrame, "(non-fatal)");
            }
          })
          .catch((err) => {
            console.warn("[useFrameAnalysis] RSA verify error for frame", currentFrame, "(non-fatal):", err);
          })
          .finally(() => {
            isVerifyingRef.current = false;
            frameCountRef.current = currentFrame + 1;
            if (isPlaying) {
              animationFrameRef.current = requestAnimationFrame(analyzeFrame);
            }
          });
      } else {
        isVerifyingRef.current = false;
        frameCountRef.current = currentFrame + 1;
        if (isPlaying) {
          animationFrameRef.current = requestAnimationFrame(analyzeFrame);
        }
      }
    };

    if (isPlaying && videoId && initialNumericUserId != null && initialNumericUserId > 0) {
      frameCountRef.current = 0;
      animationFrameRef.current = requestAnimationFrame(analyzeFrame);
    }

    return () => {
      if (animationFrameRef.current != null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [videoRef, isPlaying, videoId, initialNumericUserId, publicKeyPem]);

  // Reset verificationFailed and frame count when dependencies change
  useEffect(() => {
    if (!videoId || initialNumericUserId == null) {
      setVerificationFailed(false);
      frameCountRef.current = 0;
      lastVerifyFrameRef.current = -1;
      consecutiveNullDecodesRef.current = 0;
    }
  }, [videoId, initialNumericUserId]);

  useEffect(() => {
    if (!isPlaying) {
      frameCountRef.current = 0;
      lastVerifyFrameRef.current = -1;
      isVerifyingRef.current = false;
      consecutiveNullDecodesRef.current = 0;
    }
  }, [isPlaying]);

  return {verificationFailed};
}
