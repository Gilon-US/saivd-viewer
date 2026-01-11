"use client";

import {useEffect, useState, useRef, RefObject} from "react";

/**
 * Custom hook for analyzing video frames in real-time and extracting user ID from watermarked videos.
 * 
 * This hook:
 * - Counts frames during playback
 * - Extracts user ID every 20 frames via API call
 * - Manages QR code URL state based on extracted user ID
 * - Persists extracted user ID across pause/play/end cycles
 * - Restores QR URL immediately on replay without re-extraction
 *
 * @param videoRef - Reference to the video element
 * @param isPlaying - Whether the video is currently playing
 * @param videoId - Optional video ID for user ID extraction (only for watermarked videos)
 * @returns Object containing qrUrl and showOverlay state
 */
export function useFrameAnalysis(
  videoRef: RefObject<HTMLVideoElement | null>,
  isPlaying: boolean,
  videoId?: string
): {qrUrl: string | null; showOverlay: boolean} {
  // React State
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [extractedUserId, setExtractedUserId] = useState<string | null>(null);

  // React Refs (persist across renders, don't trigger re-renders)
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const contextRef = useRef<CanvasRenderingContext2D | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const skipPixelReadRef = useRef<boolean>(false);
  const frameCountRef = useRef<number>(0);
  const lastExtractionFrameRef = useRef<number>(-1);
  const isExtractingRef = useRef<boolean>(false);

  // Initialize canvas for frame capture
  useEffect(() => {
    if (!canvasRef.current) {
      canvasRef.current = document.createElement("canvas");
      contextRef.current = canvasRef.current.getContext("2d", {
        willReadFrequently: true,
      });
    }
  }, []);

  // Main frame analysis loop
  useEffect(() => {
    const analyzeFrame = () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const context = contextRef.current;

      // Early exit if video not ready
      if (!video || !canvas || !context || video.paused || video.ended) {
        return;
      }

      // Handle canvas resize
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }

      // Draw current frame to canvas
      context.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Handle tainted canvas (CORS issues)
      // Note: We don't actually use the imageData for extraction (external service handles that),
      // but we need to call getImageData to detect CORS errors
      if (!skipPixelReadRef.current) {
        try {
          context.getImageData(0, 0, canvas.width, canvas.height);
        } catch (error) {
          if (error instanceof DOMException && error.name === "SecurityError") {
            skipPixelReadRef.current = true; // Skip pixel reads on subsequent frames
          } else {
            throw error;
          }
        }
      }

      // User ID extraction logic (only if videoId provided)
      if (videoId && !isExtractingRef.current) {
        frameCountRef.current += 1;

        // Extract at frame 1 (first frame), then every 20 frames (21, 41, 61, ...)
        const isFirstExtraction = lastExtractionFrameRef.current === -1;
        const shouldExtract = isFirstExtraction || frameCountRef.current - lastExtractionFrameRef.current >= 20;

        if (shouldExtract) {
          const frameIndex = frameCountRef.current;
          isExtractingRef.current = true;
          lastExtractionFrameRef.current = frameCountRef.current;

          // Fire-and-forget API call (non-blocking)
          fetch(`/api/videos/${videoId}/extract-user-id?frame_index=${frameIndex}`)
            .then(async (response) => {
              if (!response.ok) {
                console.warn("[FrameAnalysis] Failed to extract user ID", response.status);
                return;
              }
              const data = await response.json();
              if (data.success && data.data?.user_id) {
                setExtractedUserId(data.data.user_id);
              }
            })
            .catch((error) => {
              console.error("[FrameAnalysis] Error extracting user ID:", error);
              // Silent failure, extraction will retry on next interval
            })
            .finally(() => {
              isExtractingRef.current = false;
            });
        }
      }

      // Schedule next frame analysis
      if (isPlaying) {
        animationFrameRef.current = requestAnimationFrame(analyzeFrame);
      }
    };

    // Start analysis loop when playing
    if (isPlaying) {
      animationFrameRef.current = requestAnimationFrame(analyzeFrame);
    }

    // Cleanup
    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [videoRef, isPlaying, videoId]);

  // Effect 1: Frame Counter Reset on Playback Stop
  useEffect(() => {
    if (!isPlaying) {
      // Reset frame counters, but preserve extractedUserId and qrUrl
      frameCountRef.current = 0;
      lastExtractionFrameRef.current = -1;
      isExtractingRef.current = false;
    } else {
      // When video starts playing, restore QR URL if we have extractedUserId
      if (videoId && extractedUserId && !qrUrl) {
        const qrUrlFromUserId = `https://saivd.netlify.app/profile/${extractedUserId}/qr`;
        setQrUrl((currentQrUrl) => {
          if (currentQrUrl !== qrUrlFromUserId) {
            return qrUrlFromUserId;
          }
          return currentQrUrl;
        });
      }
    }
  }, [isPlaying, videoId, extractedUserId, qrUrl]);

  // Effect 2: Reset on Video ID Change
  useEffect(() => {
    // When videoId changes, reset everything
    setExtractedUserId(null);
    setQrUrl(null);
    frameCountRef.current = 0;
    lastExtractionFrameRef.current = -1;
    isExtractingRef.current = false;
    skipPixelReadRef.current = false;
  }, [videoId]);

  // Effect 3: Update QR URL When User ID Extracted
  useEffect(() => {
    if (videoId && extractedUserId) {
      const qrUrlFromUserId = `https://saivd.netlify.app/profile/${extractedUserId}/qr`;
      setQrUrl(qrUrlFromUserId);
    } else if (!videoId) {
      setQrUrl(null);
    }
  }, [videoId, extractedUserId]);

  return {
    qrUrl,
    showOverlay: qrUrl !== null,
  };
}