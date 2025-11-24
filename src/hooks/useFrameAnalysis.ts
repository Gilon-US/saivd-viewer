"use client";

import {useEffect, useState, useRef, RefObject} from "react";

/**
 * Frame data passed to the analysis function
 */
export interface FrameData {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  imageData: ImageData;
  timestamp: number;
  videoTime: number;
}

/**
 * Frame analysis function type
 * Returns a string URL pointing to a QR code image to display as an overlay.
 * If the function returns null or an empty string, no overlay is shown.
 */
export type FrameAnalysisFunction = (frameData: FrameData) => string | null;

/**
 * Default placeholder frame analysis function
 * This will be replaced with actual analysis logic in the future.
 * It should eventually return a QR code image URL (string) when a QR should be shown
 * for the current frame, or null/empty string when no overlay should be displayed.
 */
const defaultAnalysisFunction: FrameAnalysisFunction = (_frameData: FrameData): string | null => {
  // Placeholder implementation
  // Future implementations could include:
  // - Face detection
  // - Object recognition
  // - Watermark verification
  // - Content moderation
  // - Quality analysis

  // TEMP: For testing purposes, always return a hardcoded QR code URL.
  // In production, this should decode the creator's numeric_user_id from the frame
  // and construct the appropriate QR code URL dynamically.
  return "https://saivd.netlify.app/profile/1/qr";
};

/**
 * Custom hook for analyzing video frames in real-time
 *
 * @param videoRef - Reference to the video element
 * @param isPlaying - Whether the video is currently playing
 * @param analysisFunction - Optional custom analysis function that returns a QR code URL
 * @returns Object containing qrCodeUrl state
 */
export function useFrameAnalysis(
  videoRef: RefObject<HTMLVideoElement | null>,
  isPlaying: boolean,
  analysisFunction: FrameAnalysisFunction = defaultAnalysisFunction
) {
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const contextRef = useRef<CanvasRenderingContext2D | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    // Initialize canvas for frame capture
    if (!canvasRef.current) {
      canvasRef.current = document.createElement("canvas");
      contextRef.current = canvasRef.current.getContext("2d", {
        willReadFrequently: true,
      });
    }

    const analyzeFrame = () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const context = contextRef.current;

      if (!video || !canvas || !context || video.paused || video.ended) {
        return;
      }

      // Set canvas size to match video
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }

      // Draw current video frame to canvas
      context.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Get image data
      let imageData: ImageData;
      try {
        imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      } catch (error) {
        // This can happen if the canvas is tainted by cross-origin video content.
        console.error("Error reading frame pixels (likely cross-origin video):", error);
        setQrCodeUrl(null);
        // Stop further analysis attempts for this playback to avoid spamming errors.
        if (animationFrameRef.current !== null) {
          cancelAnimationFrame(animationFrameRef.current);
          animationFrameRef.current = null;
        }
        return;
      }

      // Prepare frame data
      const frameData: FrameData = {
        canvas,
        context,
        imageData,
        timestamp: performance.now(),
        videoTime: video.currentTime,
      };

      // Call analysis function and update QR code URL state
      try {
        const url = analysisFunction(frameData);
        // Normalize empty/whitespace to null
        const normalizedUrl = typeof url === "string" && url.trim().length > 0 ? url.trim() : null;
        setQrCodeUrl(normalizedUrl);
      } catch (error) {
        console.error("Error in frame analysis:", error);
        setQrCodeUrl(null);
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
  }, [videoRef, isPlaying, analysisFunction]);

  // Reset overlay when video stops
  useEffect(() => {
    if (!isPlaying) {
      setQrCodeUrl(null);
    }
  }, [isPlaying]);

  return {qrCodeUrl};
}
