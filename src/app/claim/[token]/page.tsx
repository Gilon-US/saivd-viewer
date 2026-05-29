"use client";

import {use, useCallback, useEffect, useRef, useState} from "react";
import {useRouter} from "next/navigation";
import Link from "next/link";
import {AlertTriangleIcon, CheckCircle2Icon, DownloadIcon, RefreshCwIcon} from "lucide-react";
import {LoadingSpinner} from "@/components/ui/loading-spinner";
import {Button} from "@/components/ui/button";
import {useAuth} from "@/contexts/AuthContext";
import {useVideoUpload} from "@/hooks/useVideoUpload";
import {useImageUpload} from "@/hooks/useImageUpload";
import {isImageTransfer, isVideoTransfer} from "@/lib/transfer-media";

/**
 * Claim page for the cross-app transfer feature.
 *
 * Workflow:
 *   1. User opens https://viewer.saivd.io/claim/<token> (link they got from a creator).
 *   2. We require viewer auth (redirect to /login if not signed in, with a redirect-back).
 *   3. Fetch transfer metadata via same-origin proxy: GET /api/claim/transfers/<token>
 *      (server forwards to the creator app's public transfers API — avoids CORS).
 *   4. Show file info + a "Claim" button.
 *   5. On Claim:
 *        a. fetch(download_url) → Blob → File. (CORS-protected GET to creator's bucket.)
 *        b. Push that File through useVideoUpload — exactly the same pipeline that
 *           backs the dashboard's drag-and-drop upload. The viewer's bucket gets a
 *           fresh object key, the videos table gets a fresh UUID, the watermark
 *           verification path is identical.
 *        c. After useVideoUpload reports success, POST /api/claim/transfers/<token>/mark-claimed
 *           (proxy) to invalidate the token on the creator app.
 *        d. Redirect to /dashboard/videos or /dashboard/images.
 *
 * The token never touches the viewer's database. The viewer never holds creator
 * DB credentials. All cross-app communication is HTTPS to creator's public,
 * token-protected endpoints.
 */

type TransferMetadata = {
  filename: string;
  size: number;
  content_type: string;
  download_url: string;
};

type FetchStatus = "loading" | "ready" | "not_found" | "fetch_error";
type ClaimStatus = "idle" | "downloading" | "uploading" | "finalizing" | "claimed" | "failed";

type ClaimMediaKind = "video" | "image" | "unknown";

function resolveMediaKind(metadata: TransferMetadata): ClaimMediaKind {
  if (isImageTransfer(metadata.content_type, metadata.filename)) return "image";
  if (isVideoTransfer(metadata.content_type, metadata.filename)) return "video";
  return "unknown";
}

export default function ClaimPage({params}: {params: Promise<{token: string}>}) {
  const {token} = use(params);
  const router = useRouter();
  const {user, loading: authLoading} = useAuth();
  const {uploadVideo} = useVideoUpload();
  const {uploadImage} = useImageUpload();

  const [fetchStatus, setFetchStatus] = useState<FetchStatus>("loading");
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<TransferMetadata | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);

  const [claimStatus, setClaimStatus] = useState<ClaimStatus>("idle");
  const [claimError, setClaimError] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number>(0);

  const fetchInflightRef = useRef(false);

  // If not authenticated, send to login with a redirect-back param so we land
  // back here after sign-in.
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      const back = `/claim/${token}`;
      router.replace(`/login?redirectTo=${encodeURIComponent(back)}`);
    }
  }, [user, authLoading, token, router]);

  // Fetch metadata from the creator's public API. Single-fire guarded ref
  // prevents duplicate calls under React 19 / Strict Mode dev double-effect.
  useEffect(() => {
    if (!user) return;
    if (fetchInflightRef.current) return;
    fetchInflightRef.current = true;

    let cancelled = false;
    setFetchStatus("loading");
    setFetchError(null);

    const load = async () => {
      try {
        const res = await fetch(`/api/claim/transfers/${encodeURIComponent(token)}`, {
          credentials: "same-origin",
        });
        const body = await res.json().catch(() => null);
        if (cancelled) return;

        if (res.status === 404) {
          setFetchStatus("not_found");
          return;
        }

        if (!res.ok || !body?.success || !body?.data?.file?.download_url) {
          setFetchError(body?.error?.message ?? `Failed to load transfer (status ${res.status})`);
          setFetchStatus("fetch_error");
          return;
        }

        setMetadata(body.data.file as TransferMetadata);
        setExpiresAt(body.data.expires_at ?? null);
        setFetchStatus("ready");
      } catch (err) {
        if (cancelled) return;
        setFetchError(err instanceof Error ? err.message : "Failed to load transfer");
        setFetchStatus("fetch_error");
      } finally {
        fetchInflightRef.current = false;
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [token, user]);

  /**
   * Stream the creator's presigned download into a File, then push it through
   * the existing upload pipeline. We intentionally don't use multipart upload
   * here — same shape as a desktop drag-and-drop, so verification, thumbnail
   * generation, and the videos row insert all behave identically.
   */
  const handleClaim = useCallback(async () => {
    if (!metadata) return;

    setClaimStatus("downloading");
    setClaimError(null);
    setDownloadProgress(0);

    try {
      // 1. Download the file. Use streaming with content-length so we can show
      //    progress; if the response lacks content-length (some Wasabi edges)
      //    we just blob() it directly.
      const downloadRes = await fetch(metadata.download_url, {credentials: "omit"});
      if (!downloadRes.ok) {
        throw new Error(`Download failed (status ${downloadRes.status})`);
      }

      const expectedLength = Number(downloadRes.headers.get("content-length") ?? metadata.size ?? 0);
      let blob: Blob;

      if (expectedLength > 0 && downloadRes.body) {
        const reader = downloadRes.body.getReader();
        const chunks: Uint8Array[] = [];
        let received = 0;
        while (true) {
          const {done, value} = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(value);
            received += value.byteLength;
            setDownloadProgress(Math.min(99, Math.round((received / expectedLength) * 100)));
          }
        }
        blob = new Blob(chunks as BlobPart[], {type: metadata.content_type});
      } else {
        blob = await downloadRes.blob();
      }

      setDownloadProgress(100);

      // 2. Wrap the blob as a File. useVideoUpload reads .name, .size, .type,
      //    .lastModified — supplying them keeps the rest of the pipeline
      //    indistinguishable from a real drag-and-drop.
      const file = new File([blob], metadata.filename, {
        type: metadata.content_type,
        lastModified: Date.now(),
      });

      const mediaKind = resolveMediaKind(metadata);
      if (mediaKind === "unknown") {
        throw new Error("This transfer is not a supported video or image type.");
      }

      setClaimStatus("uploading");
      if (mediaKind === "image") {
        await uploadImage(file);
      } else {
        await uploadVideo(file);
      }

      // 4. Tell the creator the token is spent. Best-effort — if this fails
      //    we still consider the claim successful from the viewer's POV; the
      //    creator's row will still expire on TTL.
      setClaimStatus("finalizing");
      try {
        await fetch(`/api/claim/transfers/${encodeURIComponent(token)}/mark-claimed`, {
          method: "POST",
          credentials: "same-origin",
        });
      } catch {
        /* non-fatal */
      }

      setClaimStatus("claimed");

      const dashboardPath = mediaKind === "image" ? "/dashboard/images" : "/dashboard/videos";
      window.setTimeout(() => router.push(dashboardPath), 1500);
    } catch (err) {
      setClaimError(err instanceof Error ? err.message : "Claim failed");
      setClaimStatus("failed");
    }
  }, [metadata, token, uploadVideo, uploadImage, router]);

  // ---- Render ----------------------------------------------------------------

  if (authLoading || (!user && fetchStatus === "loading")) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <LoadingSpinner size="lg" />
      </main>
    );
  }

  if (fetchStatus === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="flex flex-col items-center gap-4 text-center">
          <LoadingSpinner size="lg" />
          <p className="text-sm text-gray-600 dark:text-gray-400">Loading transfer…</p>
        </div>
      </main>
    );
  }

  if (fetchStatus === "not_found") {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="max-w-md w-full rounded-lg border bg-white dark:bg-gray-800 p-6 text-center shadow">
          <AlertTriangleIcon className="mx-auto mb-4 h-10 w-10 text-yellow-500" />
          <h1 className="text-2xl font-semibold">Link not available</h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            This share link has expired, has already been claimed, or doesn&apos;t exist. Ask the creator for a fresh link.
          </p>
          <Link
            href="/dashboard/videos"
            className="mt-6 inline-block text-sm text-blue-600 hover:underline">
            Back to your videos
          </Link>
        </div>
      </main>
    );
  }

  if (fetchStatus === "fetch_error") {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="max-w-md w-full rounded-lg border bg-white dark:bg-gray-800 p-6 text-center shadow">
          <AlertTriangleIcon className="mx-auto mb-4 h-10 w-10 text-red-500" />
          <h1 className="text-2xl font-semibold">Couldn&apos;t load transfer</h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">{fetchError ?? "Try again later."}</p>
        </div>
      </main>
    );
  }

  // fetchStatus === "ready"
  const sizeMb = metadata ? (metadata.size / (1024 * 1024)).toFixed(1) : "";
  const expiryLabel = expiresAt ? new Date(expiresAt).toLocaleString() : "";
  const isWorking = claimStatus === "downloading" || claimStatus === "uploading" || claimStatus === "finalizing";
  const mediaKind = metadata ? resolveMediaKind(metadata) : "video";
  const isImage = mediaKind === "image";
  const mediaLabel = isImage ? "Image" : "Video";
  const mediaLabelLower = mediaLabel.toLowerCase();
  const libraryLabel = isImage ? "images" : "videos";

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="max-w-md w-full rounded-lg border bg-white dark:bg-gray-800 p-6 shadow">
        <h1 className="text-2xl font-semibold mb-2">{mediaLabel} shared with you</h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
          A SAIVD creator has shared a {mediaLabelLower} with you. Claim it to add a copy to your own SAIVD Viewer library.
        </p>

        {metadata && (
          <div className="rounded-md border border-gray-200 dark:border-gray-700 p-4 mb-6">
            <p className="font-medium truncate" title={metadata.filename}>
              {metadata.filename}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {sizeMb} MB · {metadata.content_type}
            </p>
            {expiryLabel && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">Link expires {expiryLabel}</p>
            )}
          </div>
        )}

        {claimStatus === "claimed" ? (
          <div className="rounded-md border border-green-300 bg-green-50 dark:bg-green-900/20 dark:border-green-800 p-4 flex items-start gap-2">
            <CheckCircle2Icon className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-green-700 dark:text-green-300">
              Claimed! Redirecting to your {libraryLabel}…
            </div>
          </div>
        ) : claimStatus === "failed" ? (
          <>
            <div className="rounded-md border border-red-300 bg-red-50 dark:bg-red-900/20 dark:border-red-800 p-4 flex items-start gap-2 mb-4">
              <AlertTriangleIcon className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-red-700 dark:text-red-300">{claimError ?? "Claim failed"}</div>
            </div>
            <Button onClick={handleClaim} className="w-full">
              <RefreshCwIcon className="mr-2 h-4 w-4" />
              Try again
            </Button>
          </>
        ) : (
          <>
            <Button onClick={handleClaim} disabled={isWorking || !metadata} className="w-full">
              {isWorking ? (
                <>
                  <LoadingSpinner size="sm" className="mr-2" />
                  {claimStatus === "downloading" && `Downloading… ${downloadProgress}%`}
                  {claimStatus === "uploading" && "Uploading to your library…"}
                  {claimStatus === "finalizing" && "Finalizing…"}
                </>
              ) : (
                <>
                  <DownloadIcon className="mr-2 h-4 w-4" />
                  Claim {mediaLabelLower}
                </>
              )}
            </Button>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-3 text-center">
              The {mediaLabelLower} will be copied to your account. The original stays with the creator.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
