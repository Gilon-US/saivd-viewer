"use client";

import {useEffect, useRef, useState} from "react";
import {X, Play, Pause, Volume2, VolumeX, Maximize, AlertCircle} from "lucide-react";
import {useFrameAnalysis} from "@/hooks/useFrameAnalysis";
import {LoadingSpinner} from "@/components/ui/loading-spinner";

type VerificationStatus = "idle" | "verifying" | "verified" | "failed";

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
  const [verifiedUserId, setVerifiedUserId] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Frame analysis hook - returns a QR code URL when user ID is extracted
  // This continues to run during playback (every 20 frames) as before
  const {qrUrl: frameAnalysisQrUrl} = useFrameAnalysis(
    videoRef,
    isPlaying,
    enableFrameAnalysis && videoId ? videoId : undefined
  );

  // Determine QR URL: use verified user ID if available, otherwise use frame analysis result
  // The verified user ID takes precedence, but frame analysis can still update it if needed
  const qrUrl = verifiedUserId
    ? `https://saivd.netlify.app/profile/${verifiedUserId}/qr`
    : frameAnalysisQrUrl;

  // Video verification effect - verifies video authenticity before allowing playback
  useEffect(() => {
    // Only verify if video is open, frame analysis is enabled, and we have a videoId
    if (!isOpen || !enableFrameAnalysis || !videoId) {
      // Reset verification state when conditions aren't met
      if (!isOpen) {
        setVerificationStatus("idle");
        setVerifiedUserId(null);
      }
      return;
    }

    // Abort any existing verification request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Create new abort controller for this verification
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    // Start verification
    setVerificationStatus("verifying");
    setVerifiedUserId(null);

    const verifyVideo = async () => {
      try {
        const response = await fetch(`/api/videos/${videoId}/extract-user-id?frame_index=1`, {
          signal: abortController.signal,
        });

        if (abortController.signal.aborted) {
          return; // Request was cancelled
        }

        if (!response.ok) {
          const data = await response.json();
          setVerificationStatus("failed");
          return;
        }

        const data = await response.json();
        if (data.success && data.data?.user_id) {
          setVerifiedUserId(data.data.user_id);
          setVerificationStatus("verified");
        } else {
          setVerificationStatus("failed");
        }
      } catch (error: unknown) {
        if (abortController.signal.aborted) {
          // Request was cancelled, don't update state
          return;
        }
        console.error("Error verifying video:", error);
        setVerificationStatus("failed");
      }
    };

    verifyVideo();

    // Cleanup: abort request if component unmounts or dependencies change
    return () => {
      abortController.abort();
      abortControllerRef.current = null;
    };
  }, [isOpen, enableFrameAnalysis, videoId]);

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
                This video is not authentic, viewing not allowed
              </p>
            </div>
          )}

          {/* QR code overlay - positioned at top-left corner, only show if verified */}
          {verificationStatus === "verified" && qrUrl && (
            <div className="absolute top-2 left-2 pointer-events-none z-20">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrUrl}
                alt="Creator QR code"
                className="w-16 h-16 object-contain rounded-md shadow-md"
              />
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
