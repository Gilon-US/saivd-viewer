"use client";

import {useEffect, useRef, useState, useCallback} from "react";
import {X, Play, Pause, Volume2, VolumeX, Maximize, AlertCircle} from "lucide-react";
import {useFrameAnalysis} from "@/hooks/useFrameAnalysis";
import {LoadingSpinner} from "@/components/ui/loading-spinner";
import {
  captureFrameToImageData,
  decodeNumericUserIdFromFrame0,
  importPublicKeyFromPem,
  decodeAndVerifyFrame,
} from "@/lib/watermark-decode";

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
  const abortControllerRef = useRef<AbortController | null>(null);
  const initialVerifyDoneRef = useRef(false);
  /** Guard: set as soon as we start verification so we don't run again on every seeked event. */
  const verificationStartedRef = useRef(false);

  // Ongoing verification every 10th frame during playback
  const {verificationFailed} = useFrameAnalysis(
    videoRef,
    isPlaying,
    enableFrameAnalysis && verificationStatus === "verified" ? videoId ?? undefined : undefined,
    initialNumericUserId,
    publicKeyPem
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

  const runInitialVerification = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !enableFrameAnalysis || !videoId) return;
    if (verificationStartedRef.current) return;
    verificationStartedRef.current = true;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setVerificationStatus("verifying");
    setInitialNumericUserId(null);
    setPublicKeyPem(null);
    initialVerifyDoneRef.current = false;

    console.log("[VideoPlayer] Initial verification started", { videoId, enableFrameAnalysis });

    try {
      console.log("[verify-diagnostic] Frame 0 capture", {
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        readyState: video.readyState,
        currentTime: video.currentTime,
      });
      const imageData = captureFrameToImageData(video);
      if (abortController.signal.aborted || !imageData) {
        console.warn("[VideoPlayer] Initial verification failed: frame capture failed or aborted", {
          hasImageData: !!imageData,
          aborted: abortController.signal.aborted,
        });
        setVerificationStatus("failed");
        return;
      }
      console.log("[verify-diagnostic] Frame 0 imageData", {
        width: imageData.width,
        height: imageData.height,
        dataLength: imageData.data.length,
      });

      const numericUserId = decodeNumericUserIdFromFrame0(imageData);
      if (abortController.signal.aborted || numericUserId == null || numericUserId <= 0) {
        console.warn("[verify-diagnostic] Frame 0 decode failed", {
          numericUserId: numericUserId ?? "null",
          aborted: abortController.signal.aborted,
          hint: "Check [watermark-diagnostic] logs for rightSide/rightEndIndex; encoder may use different crop or patch formula.",
        });
        setVerificationStatus("failed");
        return;
      }
      console.log("[verify-diagnostic] Frame 0 decoded numeric_user_id", { numericUserId });

      const publicKeyUrl = `${SAIVD_API_ORIGIN}/api/users/${numericUserId}/public-key`;
      console.log("[VideoPlayer] Fetching public key", { url: publicKeyUrl });
      const res = await fetch(publicKeyUrl, {
        signal: abortController.signal,
        credentials: "omit",
      });
      if (abortController.signal.aborted) return;

      if (!res.ok) {
        console.warn("[verify-diagnostic] Public key fetch failed", {
          numericUserId,
          status: res.status,
          statusText: res.statusText,
          hint: "404 = user/key not found for this ID; check decoded numeric_user_id matches encoder.",
        });
        setVerificationStatus("failed");
        return;
      }

      const body = await res.json().catch(() => ({}));
      if (!body.success || !body.data?.public_key_pem) {
        console.warn("[verify-diagnostic] Invalid public key response", {
          numericUserId,
          success: body.success,
          hasPem: !!(body.data?.public_key_pem),
          bodyKeys: body?.data ? Object.keys(body.data) : [],
        });
        setVerificationStatus("failed");
        return;
      }

      const publicKeyPemValue = body.data.public_key_pem as string;
      console.log("[VideoPlayer] Public key received", {
        pemLength: publicKeyPemValue?.length ?? 0,
      });

      setInitialNumericUserId(numericUserId);
      setPublicKeyPem(publicKeyPemValue);

      // Required RSA verify for frame 0 (per Third-Party Guide)
      let verified = false;
      try {
        const publicKey = await importPublicKeyFromPem(publicKeyPemValue);
        const result = await decodeAndVerifyFrame(publicKey, imageData);
        verified = result.verified;
        console.log("[verify-diagnostic] Frame 0 RSA result", {
          verified: result.verified,
          numericUserIdFromVerify: result.numericUserId,
          hint: !result.verified && "Check [watermark-diagnostic] verifyFrame for rightSide/signature vs encoder.",
        });
      } catch (rsaErr) {
        console.warn("[verify-diagnostic] Frame 0 RSA verify error", rsaErr);
      }

      if (abortController.signal.aborted) return;

      if (!verified) {
        console.warn("[verify-diagnostic] Verification failed: frame 0 RSA verify returned false", {
          decodedNumericUserId: numericUserId,
          hint: "Valid videos showing invalid: compare [watermark-diagnostic] rightSideFirst63 and verifyFrame rightSideFirst20 with encoder output; check patch rounding (sum+128)>>8 and BT.709 luma.",
        });
        setVerificationStatus("failed");
        return;
      }

      console.log("[VideoPlayer] Frame 0 RSA verify passed");
      setVerificationStatus("verified");
      initialVerifyDoneRef.current = true;
      console.log("[VideoPlayer] Initial verification complete", { numericUserId });
    } catch (err) {
      if (abortController.signal.aborted) return;
      console.error("[VideoPlayer] Initial verification error:", err);
      setVerificationStatus("failed");
    } finally {
      abortControllerRef.current = null;
      verificationStartedRef.current = false;
    }
  }, [enableFrameAnalysis, videoId]);

  // Reset when modal closes or video id changes
  useEffect(() => {
    if (!isOpen) {
      setVerificationStatus("idle");
      setInitialNumericUserId(null);
      setPublicKeyPem(null);
      initialVerifyDoneRef.current = false;
      verificationStartedRef.current = false;
    }
  }, [isOpen, videoId]);

  // Start verification when player opens with frame analysis enabled
  useEffect(() => {
    if (!isOpen || !enableFrameAnalysis || !videoId) return;
    setVerificationStatus("verifying");
  }, [isOpen, enableFrameAnalysis, videoId]);

  // Run initial verification when video has loaded and seeked to 0
  const handleCanPlay = useCallback(() => {
    if (!initialVerifyDoneRef.current && verificationStatus === "verifying" && videoRef.current) {
      const video = videoRef.current;
      if (video.readyState >= 2) {
        video.currentTime = 0;
      }
    }
  }, [verificationStatus]);

  const handleSeeked = useCallback(() => {
    if (
      verificationStartedRef.current ||
      initialVerifyDoneRef.current ||
      verificationStatus !== "verifying" ||
      !videoRef.current ||
      videoRef.current.currentTime !== 0
    ) {
      return;
    }
    runInitialVerification();
  }, [verificationStatus, runInitialVerification]);

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
            src={videoUrl}
            crossOrigin="anonymous"
            className="w-full aspect-video"
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleLoadedMetadata}
            onCanPlay={handleCanPlay}
            onSeeked={handleSeeked}
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
                This video is not authentic, viewing not allowed
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
