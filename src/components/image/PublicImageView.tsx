"use client";

import {useEffect, useLayoutEffect, useRef, useState} from "react";
import {LoadingSpinner} from "@/components/ui/loading-spinner";
import {AlertTriangleIcon} from "lucide-react";
import {getVerifyMode} from "@/lib/image-verify-mode";
import {verifyImageWatermarkRunner} from "@/lib/image-watermark-verification-runner";
import {PresentationQrFlipButton} from "@/components/presentation/PresentationQrFlipButton";
import {useCreatorQrOverlayPosition} from "@/hooks/useCreatorQrOverlayPosition";

type FetchStatus = "loading" | "ready" | "not_found" | "fetch_error";
type VerificationStatus = "idle" | "verifying" | "verified" | "failed";

type InitialError = {code: string; message: string; status: number};

type PublicImageViewProps = {
  imageId: string;
  initialViewUrl: string | null;
  initialError: InitialError | null;
  /** Minimal chrome for iframe embeds */
  embed?: boolean;
  /** Image is server-rendered in PublicImageShell; this component only adds verify UI. */
  ssrImage?: boolean;
};

function ssrImageSelector(imageId: string): string {
  return `img[data-saivd-public-image="${CSS.escape(imageId)}"]`;
}

export function PublicImageView({
  imageId,
  initialViewUrl,
  initialError,
  embed = false,
  ssrImage = false,
}: PublicImageViewProps) {
  const initialStatus: FetchStatus = initialViewUrl
    ? "ready"
    : initialError?.status === 404
      ? "not_found"
      : "loading";

  const [fetchStatus, setFetchStatus] = useState<FetchStatus>(initialStatus);
  const [viewUrl, setViewUrl] = useState<string | null>(initialViewUrl);
  const [verificationStatus, setVerificationStatus] = useState<VerificationStatus>(
    initialViewUrl ? "verifying" : "idle",
  );
  const [verifiedUserId, setVerifiedUserId] = useState<number | null>(null);
  const [imgReady, setImgReady] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const qrOverlayPosition = useCreatorQrOverlayPosition(verifiedUserId);
  const fetchInflightRef = useRef(false);
  const skipNextFetchRef = useRef(Boolean(initialViewUrl) || initialError?.status === 404);

  useLayoutEffect(() => {
    if (!ssrImage || !viewUrl) return;

    const el = document.querySelector(ssrImageSelector(imageId));
    if (!(el instanceof HTMLImageElement)) return;

    imgRef.current = el;
    const onLoad = () => setImgReady(true);
    if (el.complete && el.naturalWidth > 0) {
      setImgReady(true);
    } else {
      setImgReady(false);
      el.addEventListener("load", onLoad);
      return () => el.removeEventListener("load", onLoad);
    }
  }, [ssrImage, imageId, viewUrl]);

  useEffect(() => {
    if (ssrImage) return;
    setImgReady(false);
  }, [viewUrl, ssrImage]);

  useEffect(() => {
    let cancelled = false;
    if (skipNextFetchRef.current) {
      skipNextFetchRef.current = false;
      return;
    }
    if (fetchInflightRef.current) return;
    fetchInflightRef.current = true;

    const load = async () => {
      try {
        const origin =
          typeof window !== "undefined" && window.location?.origin ? window.location.origin : "";
        const res = await fetch(`${origin}/api/public/images/${imageId}/view`);
        const body = await res.json().catch(() => null);
        if (cancelled) return;
        if (res.status === 404) {
          setFetchStatus("not_found");
          return;
        }
        if (!res.ok || !body?.success || !body?.data?.viewUrl) {
          setFetchStatus("fetch_error");
          return;
        }
        setViewUrl(body.data.viewUrl);
        setFetchStatus("ready");
        setVerificationStatus("verifying");
      } finally {
        fetchInflightRef.current = false;
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [imageId]);

  useEffect(() => {
    if (!viewUrl || verificationStatus !== "verifying") return;
    const needsImg = getVerifyMode() !== "blob";
    if (needsImg && (!imgReady || !imgRef.current)) return;

    const controller = new AbortController();
    let cancelled = false;

    (async () => {
      try {
        const result = await verifyImageWatermarkRunner({
          imageId,
          img: imgRef.current,
          viewUrl,
          fetchCredentials: "omit",
          signal: controller.signal,
        });
        if (cancelled) return;
        if (result.ok) {
          setVerifiedUserId(result.numericUserId);
          setVerificationStatus("verified");
        } else {
          setVerificationStatus("failed");
        }
      } catch {
        if (!cancelled) setVerificationStatus("failed");
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [viewUrl, verificationStatus, imgReady, imageId]);

  const overlay = (
    <>
      {verificationStatus === "verifying" && (
        <div className="absolute top-2 left-2 sm:top-4 sm:left-4 z-20 flex items-center gap-2 rounded-md bg-black/60 px-2 py-1 text-xs text-white">
          <LoadingSpinner size="sm" /> Verifying…
        </div>
      )}

      {verificationStatus === "verified" && verifiedUserId !== null && (
        <PresentationQrFlipButton
          numericUserId={verifiedUserId}
          mediaKind="image"
          mediaId={imageId}
          enabled={fetchStatus === "ready"}
          position={qrOverlayPosition}
        />
      )}

      {verificationStatus === "failed" && !embed && (
        <div className="absolute bottom-2 left-2 right-2 sm:bottom-4 sm:left-4 sm:right-4 z-20 rounded-md bg-amber-600/90 px-3 py-2 text-xs text-white">
          <div className="font-medium">Watermark verification failed</div>
        </div>
      )}
    </>
  );

  if (ssrImage && fetchStatus === "ready" && viewUrl) {
    return overlay;
  }

  if (fetchStatus === "loading") {
    return (
      <div className={`flex items-center justify-center ${embed ? "h-full w-full" : "min-h-screen"}`}>
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (fetchStatus === "not_found") {
    return (
      <div className={`flex items-center justify-center p-6 ${embed ? "h-full" : "min-h-screen"}`}>
        <p className="text-sm text-gray-600">Image not found</p>
      </div>
    );
  }

  if (fetchStatus === "fetch_error" || !viewUrl) {
    return (
      <div className={`flex items-center justify-center p-6 ${embed ? "h-full" : "min-h-screen"}`}>
        <AlertTriangleIcon className="h-8 w-8 text-red-500" />
      </div>
    );
  }

  return (
    <div
      className={`relative flex items-center justify-center bg-gray-100 dark:bg-gray-900 ${embed ? "h-full w-full" : "min-h-screen p-4"}`}>
      <div className="relative inline-block max-w-full max-h-full">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          src={viewUrl}
          alt="Verified image"
          crossOrigin="anonymous"
          fetchPriority="high"
          onLoad={() => setImgReady(true)}
          className="block max-w-full max-h-full object-contain rounded-lg shadow-2xl"
        />
        {overlay}
      </div>
    </div>
  );
}
