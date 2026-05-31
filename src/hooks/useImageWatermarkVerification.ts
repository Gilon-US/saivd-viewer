"use client";

import {useEffect, useRef, useState, type RefObject} from "react";
import {imageViewProxyUrl} from "@/lib/image-verification-url";
import {getVerifyMode} from "@/lib/image-verify-mode";
import {
  verifyImageWatermarkRunner,
} from "@/lib/image-watermark-verification-runner";
import {
  type ImageVerificationFailReason,
  type ImageVerificationResult,
} from "@/lib/image-watermark-verification";

export type ImageVerificationStatus = "idle" | "verifying" | "verified" | "failed";

type UseImageWatermarkVerificationOptions = {
  enabled?: boolean;
  imgRef?: RefObject<HTMLImageElement | null>;
  /** Set true from the <img> onLoad handler before verification can use the img path. */
  imgReady?: boolean;
  fetchCredentials?: RequestCredentials;
  /** When set (e.g. presigned URL from grid), used instead of /api/images/{id}/view. */
  viewUrl?: string | null;
};

export function useImageWatermarkVerification(
  imageId: string | null | undefined,
  options?: UseImageWatermarkVerificationOptions,
) {
  const enabled = options?.enabled ?? true;
  const imgRef = options?.imgRef;
  const imgReady = options?.imgReady ?? false;
  const verifyUrl =
    options?.viewUrl?.trim() ??
    (imageId?.trim() ? imageViewProxyUrl(imageId.trim()) : null);
  const fetchCredentials =
    options?.fetchCredentials ??
    (verifyUrl?.startsWith("http") ? "omit" : "include");

  const [state, setState] = useState<ImageVerificationStatus>("idle");
  const [result, setResult] = useState<ImageVerificationResult | null>(null);
  const cancelRef = useRef<{cancelled: boolean}>({cancelled: false});

  useEffect(() => {
    cancelRef.current.cancelled = true;
    cancelRef.current = {cancelled: false};
    const tag = cancelRef.current;

    if (!enabled || !verifyUrl || !imageId?.trim()) {
      setState("idle");
      setResult(null);
      return;
    }

    const needsImg = getVerifyMode() !== "blob";
    if (needsImg && !imgReady) {
      setState("verifying");
      setResult(null);
      return;
    }

    const controller = new AbortController();
    setState("verifying");
    setResult(null);

    (async () => {
      try {
        const verification = await verifyImageWatermarkRunner({
          imageId: imageId.trim(),
          img: imgRef?.current ?? null,
          viewUrl: verifyUrl,
          fetchCredentials,
          signal: controller.signal,
        });
        if (tag.cancelled) return;
        setResult(verification);
        setState(verification.ok ? "verified" : "failed");
      } catch (e) {
        if (tag.cancelled) return;
        setResult({
          ok: false,
          reason: "malformed",
          detail: e instanceof Error ? e.message : String(e),
        });
        setState("failed");
      }
    })();

    return () => {
      tag.cancelled = true;
      controller.abort();
    };
  }, [verifyUrl, enabled, imageId, imgReady, imgRef, fetchCredentials]);

  const verifiedUserId = result?.ok ? result.numericUserId : null;
  const failReason: ImageVerificationFailReason | null =
    result && !result.ok ? result.reason : null;

  return {
    verifiedUserId,
    isVerificationFailed: state === "failed",
    verificationStatus: state,
    failReason,
    result,
  };
}
