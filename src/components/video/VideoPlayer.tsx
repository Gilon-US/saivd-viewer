"use client";

import {useEffect, useRef, useState, useCallback} from "react";
import {X, Play, Pause, Volume2, VolumeX, Maximize, AlertCircle} from "lucide-react";
import {useFrameAnalysis} from "@/hooks/useFrameAnalysis";
import {LoadingSpinner} from "@/components/ui/loading-spinner";
import {
  decodeNumericUserIdFromLuma,
  importPublicKeyFromPem,
  decodeAndVerifyFrameFromLuma,
} from "@/lib/watermark-decode";
import { getFrame0LumaFromUrl, isWebCodecsSupported } from "@/lib/watermark-webcodecs";

type VerificationStatus = "idle" | "verifying" | "verified" | "failed";

/** External SAIVD API origin for public key and profile/QR. Override via NEXT_PUBLIC_SAIVD_API_URL. */
const SAIVD_API_ORIGIN =
  process.env.NEXT_PUBLIC_SAIVD_API_URL ?? "https://saivd.netlify.app";

interface VideoPlayerProps {
  videoUrl: string;
  videoId?: string | null;
  onClose: () => void;
  isOpen: boolean;
  enableFrameAnalysis: boolean;
}

export function VideoPlayer({videoUrl, videoId, onClose, isOpen, enableFrameAnalysis}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [verificationStatus, setVerificationStatus] = useState<VerificationStatus>("idle");
  const [initialNumericUserId, setInitialNumericUserId] = useState<number | null>(null);
  const [publicKeyPem, setPublicKeyPem] = useState<string | null>(null);
  /** When enableFrameAnalysis: "" until WebCodecs verification succeeds; then videoUrl. When !enableFrameAnalysis: videoUrl. */
  const [videoSrc, setVideoSrc] = useState("");
  const abortControllerRef = useRef<AbortController | null>(null);
  const initialVerifyDoneRef = useRef(false);

  // Ongoing verification every 10th frame is disabled: we use WebCodecs-only (no canvas) and
  // do not have WebCodecs-based capture for arbitrary playback frames; only frame 0 is verified.
  const {verificationFailed} = useFrameAnalysis(
    videoRef,
    isPlaying,
    undefined,
    initialNumericUserId,
    null
  );

  const qrUrl =
    initialNumericUserId != null
      ? `${SAIVD_API_ORIGIN}/profile/${initialNumericUserId}/qr`
      : null;

  // When ongoing verification fails, mark as failed and pause
  useEffect(() => {
    if (verificationFailed && verificationStatus === "verified") {
      console.warn("[VideoPlayer] Ongoing verification failed — pausing and showing not authentic");
      setVerificationStatus("failed");
      if (videoRef.current) {
        videoRef.current.pause();
        setIsPlaying(false);
      }
    }
  }, [verificationFailed, verificationStatus]);

  // Reset when modal closes or video id changes
  useEffect(() => {
    if (!isOpen) {
      setVerificationStatus("idle");
      setInitialNumericUserId(null);
      setPublicKeyPem(null);
      setVideoSrc("");
      initialVerifyDoneRef.current = false;
    }
  }, [isOpen, videoId]);

  // When opening with frame analysis disabled: set src and allow playback
  useEffect(() => {
    if (!isOpen || enableFrameAnalysis) return;
    setVideoSrc(videoUrl);
    setVerificationStatus("verified");
  }, [isOpen, enableFrameAnalysis, videoUrl]);

  // WebCodecs-only verification (per docs: Y channel must come from codec, not canvas)
  const WEBCODECS_TIMEOUT_MS = 20000;

  useEffect(() => {
    if (!isOpen || !enableFrameAnalysis || !videoId || !videoUrl) return;

    if (!isWebCodecsSupported()) {
      console.warn("[verify-diagnostic] WebCodecs not supported in this browser; verification required");
      setVerificationStatus("failed");
      setVideoSrc("");
      return;
    }

    setVerificationStatus("verifying");
    setVideoSrc("");

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const timeoutId = setTimeout(() => {
      if (abortController.signal.aborted) return;
      console.warn("[verify-diagnostic] WebCodecs attempt timed out", { timeoutMs: WEBCODECS_TIMEOUT_MS });
      abortController.abort();
    }, WEBCODECS_TIMEOUT_MS);

    (async () => {
      try {
        const lumaResult = await getFrame0LumaFromUrl(videoUrl, abortController.signal);
        clearTimeout(timeoutId);
        if (abortController.signal.aborted) return;

        if (!lumaResult) {
          console.warn("[verify-diagnostic] WebCodecs returned null (demux/decode failed); verification requires WebCodecs Y channel");
          setVerificationStatus("failed");
          return;
        }

        console.log("[verify-diagnostic] WebCodecs frame 0 luma received", {
          width: lumaResult.width,
          height: lumaResult.height,
        });
        const numericUserId = decodeNumericUserIdFromLuma(
          lumaResult.luma,
          lumaResult.width,
          lumaResult.height
        );
        if (abortController.signal.aborted) return;
        if (numericUserId == null || numericUserId <= 0) {
          setVerificationStatus("failed");
          return;
        }

        const publicKeyUrl = `${SAIVD_API_ORIGIN}/api/users/${numericUserId}/public-key`;
        const res = await fetch(publicKeyUrl, {
          signal: abortController.signal,
          credentials: "omit",
        });
        if (abortController.signal.aborted) return;
        if (!res.ok) {
          setVerificationStatus("failed");
          return;
        }

        const body = await res.json().catch(() => ({}));
        const publicKeyPemValue = body.data?.public_key_pem as string | undefined;
        if (!body.success || !publicKeyPemValue) {
          setVerificationStatus("failed");
          return;
        }

        const publicKey = await importPublicKeyFromPem(publicKeyPemValue);
        const result = await decodeAndVerifyFrameFromLuma(
          publicKey,
          lumaResult.luma,
          lumaResult.width,
          lumaResult.height
        );
        if (abortController.signal.aborted) return;

        if (result.verified) {
          setInitialNumericUserId(numericUserId);
          setPublicKeyPem(publicKeyPemValue);
          initialVerifyDoneRef.current = true;
          setVerificationStatus("verified");
          setVideoSrc(videoUrl);
        } else {
          setVerificationStatus("failed");
        }
      } catch (err) {
        clearTimeout(timeoutId);
        if (abortController.signal.aborted) {
          console.warn("[verify-diagnostic] WebCodecs aborted (e.g. timeout)");
        } else {
          console.warn("[verify-diagnostic] WebCodecs error", err);
        }
        setVerificationStatus("failed");
      } finally {
        clearTimeout(timeoutId);
        abortControllerRef.current = null;
      }
    })();

    return () => {
      clearTimeout(timeoutId);
      abortController.abort();
    };
  }, [isOpen, enableFrameAnalysis, videoId, videoUrl]);

  // Reset video state when player closes
  useEffect(() => {
    if (!isOpen) {
      setIsPlaying(false);
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.currentTime = 0;
      }
    }
  }, [isOpen]);

  const togglePlay = () => {
    // Only allow playback if video is verified
    if (verificationStatus !== "verified") {
      return;
    }

    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        // If video has ended, seek to start before playing
        if (videoRef.current.currentTime >= videoRef.current.duration) {
          videoRef.current.currentTime = 0;
        }
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const toggleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
    }
  };

  const toggleFullscreen = () => {
    if (videoRef.current) {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        videoRef.current.requestFullscreen();
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4">
      <div className="relative w-full max-w-5xl">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute -top-12 right-0 text-white hover:text-gray-300 transition-colors"
          aria-label="Close video player">
          <X className="w-8 h-8" />
        </button>

        {/* Video container */}
        <div className="relative bg-black rounded-lg overflow-hidden">
          <video
            ref={videoRef}
            src={videoSrc || undefined}
            crossOrigin="anonymous"
            className="w-full aspect-video"
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleLoadedMetadata}
            onEnded={() => setIsPlaying(false)}
            controls={false}
          />

          {/* Verification overlay - shows while verifying or if verification failed */}
          {verificationStatus === "verifying" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm z-30">
              <LoadingSpinner size="lg" className="mb-4" />
              <p className="text-white text-lg font-medium text-center px-4">
                We are verifying the video&apos;s authenticity. Your video will play shortly, please wait.
              </p>
            </div>
          )}

          {verificationStatus === "failed" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm z-30">
              <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
              <p className="text-white text-lg font-medium text-center px-4">
                Verification failed. Authenticity must be verified using WebCodecs (Y channel); this browser or video may not support it.
              </p>
            </div>
          )}

          {/* QR code/Logo overlay - positioned at top-left corner, only show if verified */}
          {verificationStatus === "verified" && qrUrl && (
            <div className="absolute top-2 left-2 pointer-events-none z-20 qr-logo-flip-container">
              <div className="qr-logo-flip-card">
                {/* QR Code - Front face */}
                <div className="qr-logo-flip-face qr-logo-flip-face-front">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={qrUrl}
                    alt="Creator QR code"
                    className="w-16 h-16 object-contain rounded-md shadow-md"
                  />
                </div>
                {/* Logo - Back face */}
                <div className="qr-logo-flip-face qr-logo-flip-face-back">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/images/saivd-logo.png"
                    alt="SAIVD Logo"
                    className="w-16 h-16 object-contain rounded-md shadow-md"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Custom controls - only show if verified */}
          {verificationStatus === "verified" && (
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4 z-20">
              {/* Seek bar */}
              <input
                type="range"
                min="0"
                max={duration || 0}
                value={currentTime}
                onChange={handleSeek}
                className="w-full mb-4 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"
              />

              {/* Control buttons */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <button
                    onClick={togglePlay}
                    className="text-white hover:text-gray-300 transition-colors"
                    aria-label={isPlaying ? "Pause" : "Play"}>
                    {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6" />}
                  </button>

                  <button
                    onClick={toggleMute}
                    className="text-white hover:text-gray-300 transition-colors"
                    aria-label={isMuted ? "Unmute" : "Mute"}>
                    {isMuted ? <VolumeX className="w-6 h-6" /> : <Volume2 className="w-6 h-6" />}
                  </button>

                  <span className="text-white text-sm">
                    {formatTime(currentTime)} / {formatTime(duration)}
                  </span>
                </div>

                <button
                  onClick={toggleFullscreen}
                  className="text-white hover:text-gray-300 transition-colors"
                  aria-label="Fullscreen">
                  <Maximize className="w-6 h-6" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}
