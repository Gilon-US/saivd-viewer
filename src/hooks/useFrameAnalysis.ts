"use client";

import {useEffect, useState, useRef, RefObject} from "react";
import {
  captureFrameToImageData,
  importPublicKeyFromPem,
  decodeAndVerifyFrame,
} from "@/lib/watermark-decode";

const VERIFY_INTERVAL = 10; // Every 10th frame (0, 10, 20, 30, …)

/**
 * Custom hook for ongoing watermark verification during playback.
 *
 * Per Third-Party Guide §6: for frames 10, 20, 30, … only run signature
 * verification with the already-fetched key (no user ID decode). If
 * RSA verify returns false, sets verificationFailed.
 *
 * @param videoRef - Reference to the video element
 * @param isPlaying - Whether the video is currently playing
 * @param videoId - Optional; when set with publicKeyPem, enables ongoing verification
 * @param initialNumericUserId - Unused; kept for API compatibility
 * @param publicKeyPem - PEM for RSA verification of each 10th frame (required for verification)
 * @returns Object containing verificationFailed (true if any 10th-frame signature verify failed)
 */
export function useFrameAnalysis(
  videoRef: RefObject<HTMLVideoElement | null>,
  isPlaying: boolean,
  videoId?: string,
  _initialNumericUserId?: number | null,
  publicKeyPem?: string | null
): {verificationFailed: boolean} {
  const [verificationFailed, setVerificationFailed] = useState(false);
  const publicKeyRef = useRef<CryptoKey | null>(null);

  const animationFrameRef = useRef<number | null>(null);
  const frameCountRef = useRef(0);
  const lastVerifyFrameRef = useRef(-1);
  const isVerifyingRef = useRef(false);

  useEffect(() => {
    if (!publicKeyPem) {
      publicKeyRef.current = null;
      return;
    }
    let cancelled = false;
    importPublicKeyFromPem(publicKeyPem).then((key) => {
      if (!cancelled) publicKeyRef.current = key;
    });
    return () => {
      cancelled = true;
      publicKeyRef.current = null;
    };
  }, [publicKeyPem]);

  useEffect(() => {
    const analyzeFrame = () => {
      const video = videoRef.current;
      if (!video || !videoId || !publicKeyPem) {
        return;
      }
      if (video.paused || video.ended || !isPlaying) {
        return;
      }

      const currentFrame = frameCountRef.current;

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
        console.warn("[verify-diagnostic] Ongoing verify: frame capture failed", {
          frame: currentFrame,
          videoWidth: video.videoWidth,
          videoHeight: video.videoHeight,
        });
        setVerificationFailed(true);
        isVerifyingRef.current = false;
        frameCountRef.current = currentFrame + 1;
        if (isPlaying) {
          animationFrameRef.current = requestAnimationFrame(analyzeFrame);
        }
        return;
      }

      const key = publicKeyRef.current;
      if (!key) {
        importPublicKeyFromPem(publicKeyPem)
          .then((k) => {
            publicKeyRef.current = k;
            return decodeAndVerifyFrame(k, imageData);
          })
          .then(({verified}) => {
            if (!verified) {
              console.warn("[verify-diagnostic] Ongoing verify: signature failed (frame " + currentFrame + ")", {
                frame: currentFrame,
                hint: "Check [watermark-diagnostic] verifyFrame for this frame's rightSide/signature.",
              });
              setVerificationFailed(true);
            }
          })
          .catch((err) => {
            console.warn("[verify-diagnostic] Ongoing verify error", { frame: currentFrame, err });
            setVerificationFailed(true);
          })
          .finally(() => {
            isVerifyingRef.current = false;
            frameCountRef.current = currentFrame + 1;
            if (isPlaying) {
              animationFrameRef.current = requestAnimationFrame(analyzeFrame);
            }
          });
        return;
      }

      decodeAndVerifyFrame(key, imageData)
        .then(({verified}) => {
          if (!verified) {
            console.warn("[verify-diagnostic] Ongoing verify: signature failed (frame " + currentFrame + ")", {
              frame: currentFrame,
              hint: "Check [watermark-diagnostic] verifyFrame for this frame's rightSide/signature.",
            });
            setVerificationFailed(true);
          }
        })
        .catch((err) => {
          console.warn("[verify-diagnostic] Ongoing verify error", { frame: currentFrame, err });
          setVerificationFailed(true);
        })
        .finally(() => {
          isVerifyingRef.current = false;
          frameCountRef.current = currentFrame + 1;
          if (isPlaying) {
            animationFrameRef.current = requestAnimationFrame(analyzeFrame);
          }
        });
    };

    if (isPlaying && videoId && publicKeyPem) {
      frameCountRef.current = 0;
      animationFrameRef.current = requestAnimationFrame(analyzeFrame);
    }

    return () => {
      if (animationFrameRef.current != null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [videoRef, isPlaying, videoId, publicKeyPem]);

  useEffect(() => {
    if (!videoId || !publicKeyPem) {
      setVerificationFailed(false);
      frameCountRef.current = 0;
      lastVerifyFrameRef.current = -1;
    }
  }, [videoId, publicKeyPem]);

  useEffect(() => {
    if (!isPlaying) {
      frameCountRef.current = 0;
      lastVerifyFrameRef.current = -1;
      isVerifyingRef.current = false;
    }
  }, [isPlaying]);

  return {verificationFailed};
}
