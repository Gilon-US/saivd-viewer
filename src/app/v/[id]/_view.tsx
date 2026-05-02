"use client";

import {use, useCallback, useEffect, useRef, useState} from "react";
import Link from "next/link";
import {VideoPlayer} from "@/components/video/VideoPlayer";
import {LoadingSpinner} from "@/components/ui/loading-spinner";
import {Button} from "@/components/ui/button";
import {AlertTriangleIcon, PlayIcon, RefreshCwIcon} from "lucide-react";

type FetchStatus = "loading" | "ready" | "not_found" | "fetch_error";
type VerificationStatus = "verifying" | "verified" | "failed" | null;

const SAIVD_API_ORIGIN =
  process.env.NEXT_PUBLIC_SAIVD_API_URL ?? "https://saivd.netlify.app";

/**
 * Public, unauthenticated video viewer at /v/[id].
 *
 * Flow:
 *  1. Fetch a presigned playback URL from /api/public/videos/[id]/play.
 *  2. Open the same VideoPlayer used in the dashboard, with frame analysis on.
 *  3. The player runs the standard frame-0 + every-10th-frame watermark verification
 *     and renders the QR overlay (linking to ${SAIVD_API_ORIGIN}/profile/{id}) once
 *     verification succeeds.
 *  4. On close, keep the user on the page and show a "finished watching" card with a
 *     Replay button. Verification failure is messaged explicitly on the page.
 *
 * Important: this page does NOT modify VideoPlayer. It uses the component exactly as
 * the dashboard does, passing the same props. All page-specific UX (replay card,
 * not-found card, "Powered by SAIVD") lives in this file only.
 */
export function PublicVideoView({params}: {params: Promise<{id: string}>}) {
  const {id: videoId} = use(params);

  const [fetchStatus, setFetchStatus] = useState<FetchStatus>("loading");
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [playerOpen, setPlayerOpen] = useState(false);
  const [verificationStatus, setVerificationStatus] = useState<VerificationStatus>(null);
  const [verifiedUserId, setVerifiedUserId] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const fetchInflightRef = useRef(false);

  // Fetch a presigned playback URL on mount or retry. Guarded with a ref so dev-mode
  // double-effects (or React 19 re-runs) don't generate two presigned URLs.
  useEffect(() => {
    let cancelled = false;
    if (fetchInflightRef.current) return;
    fetchInflightRef.current = true;

    setFetchStatus("loading");
    setFetchError(null);

    const load = async () => {
      try {
        const res = await fetch(`/api/public/videos/${videoId}/play?variant=watermarked`);
        const body = await res.json().catch(() => null);

        if (cancelled) return;

        if (res.status === 404) {
          setFetchStatus("not_found");
          return;
        }

        if (!res.ok || !body?.success || !body?.data?.playbackUrl) {
          setFetchError(body?.error?.message ?? `Failed to load video (status ${res.status})`);
          setFetchStatus("fetch_error");
          return;
        }

        setPlaybackUrl(body.data.playbackUrl);
        setVerificationStatus("verifying");
        setVerifiedUserId(null);
        setPlayerOpen(true);
        setFetchStatus("ready");
      } catch (err) {
        if (cancelled) return;
        setFetchError(err instanceof Error ? err.message : "Failed to load video");
        setFetchStatus("fetch_error");
      } finally {
        fetchInflightRef.current = false;
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [videoId, retryCount]);

  const handleVerificationComplete = useCallback(
    (status: "verified" | "failed", userId: string | null) => {
      setVerificationStatus(status);
      setVerifiedUserId(userId);
    },
    []
  );

  const handleClosePlayer = useCallback(() => {
    setPlayerOpen(false);
  }, []);

  const handleReplay = useCallback(() => {
    if (!playbackUrl) return;
    setVerificationStatus("verifying");
    setVerifiedUserId(null);
    setPlayerOpen(true);
  }, [playbackUrl]);

  const handleRetry = useCallback(() => {
    // Bump retryCount to re-run the fetch effect with a fresh presigned URL.
    setPlaybackUrl(null);
    setVerificationStatus(null);
    setVerifiedUserId(null);
    setRetryCount((n) => n + 1);
  }, []);

  // ---- Render ----------------------------------------------------------------

  if (fetchStatus === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="flex flex-col items-center gap-4 text-center">
          <LoadingSpinner size="lg" />
          <p className="text-sm text-white/70">Loading video…</p>
        </div>
      </main>
    );
  }

  if (fetchStatus === "not_found") {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="max-w-md rounded-lg border border-white/10 bg-white/5 p-6 text-center">
          <AlertTriangleIcon className="mx-auto mb-4 h-10 w-10 text-yellow-400" />
          <h1 className="text-2xl font-semibold">Video not found</h1>
          <p className="mt-2 text-sm text-white/70">
            This video doesn&apos;t exist or has been removed by its owner.
          </p>
          <PoweredBySaivdLink className="mt-6" />
        </div>
      </main>
    );
  }

  if (fetchStatus === "fetch_error") {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="max-w-md rounded-lg border border-white/10 bg-white/5 p-6 text-center">
          <AlertTriangleIcon className="mx-auto mb-4 h-10 w-10 text-red-400" />
          <h1 className="text-2xl font-semibold">Couldn&apos;t load this video</h1>
          <p className="mt-2 text-sm text-white/70">
            {fetchError ?? "Please try again later."}
          </p>
          <Button onClick={handleRetry} className="mt-4" variant="outline">
            <RefreshCwIcon className="mr-2 h-4 w-4" />
            Try again
          </Button>
          <PoweredBySaivdLink className="mt-6" />
        </div>
      </main>
    );
  }

  // fetchStatus === "ready"
  return (
    <main className="relative min-h-screen">
      {playbackUrl && (
        <VideoPlayer
          videoUrl={playbackUrl}
          videoId={videoId}
          isOpen={playerOpen}
          onClose={handleClosePlayer}
          enableFrameAnalysis
          verificationStatus={verificationStatus}
          verifiedUserId={verifiedUserId}
          onVerificationComplete={handleVerificationComplete}
        />
      )}

      {!playerOpen && (
        <div className="flex min-h-screen items-center justify-center px-4">
          {verificationStatus === "failed" ? (
            <div className="max-w-md rounded-lg border border-red-500/40 bg-red-500/10 p-6 text-center">
              <AlertTriangleIcon className="mx-auto mb-4 h-10 w-10 text-red-400" />
              <h1 className="text-2xl font-semibold">This video could not be verified as authentic</h1>
              <p className="mt-2 text-sm text-white/70">
                The watermark on this video did not match a registered SAIVD creator key.
                Playback was blocked for your safety.
              </p>
              <PoweredBySaivdLink className="mt-6" />
            </div>
          ) : (
            <div className="max-w-md rounded-lg border border-white/10 bg-white/5 p-6 text-center">
              <h1 className="text-2xl font-semibold">You&apos;ve finished watching</h1>
              <p className="mt-2 text-sm text-white/70">
                Want to watch it again?
              </p>
              <Button onClick={handleReplay} className="mt-6">
                <PlayIcon className="mr-2 h-4 w-4" />
                Replay
              </Button>
              <PoweredBySaivdLink className="mt-6" />
            </div>
          )}
        </div>
      )}
    </main>
  );
}

function PoweredBySaivdLink({className = ""}: {className?: string}) {
  return (
    <div className={`text-xs text-white/50 ${className}`}>
      Powered by{" "}
      <Link
        href={SAIVD_API_ORIGIN}
        target="_blank"
        rel="noopener noreferrer"
        className="underline hover:text-white"
      >
        SAIVD
      </Link>
    </div>
  );
}
