"use client";

import {LoadingSpinner} from "@/components/ui/loading-spinner";
import {useImageWatermarkVerification} from "@/hooks/useImageWatermarkVerification";
import {imageViewProxyUrl} from "@/lib/image-verification-url";
import {QrLogoFlipButton} from "./QrLogoFlipButton";

type ImageLightboxProps = {
  isOpen: boolean;
  imageId: string;
  filename: string;
  previewUrl: string | null;
  onClose: () => void;
};

function verificationFailMessage(
  verification: ReturnType<typeof useImageWatermarkVerification>,
): string {
  const {failReason, result} = verification;
  if (failReason === "invalid_signature") return "Signature does not match the public key.";
  if (failReason === "fetch_failed") {
    if (result && !result.ok && result.detail?.startsWith("image_fetch_failed")) {
      return "Could not load the image for verification.";
    }
    return "Could not fetch the public key.";
  }
  if (failReason === "no_watermark") return "No watermark detected.";
  if (result && !result.ok) return result.detail ?? "Image could not be decoded.";
  return "Image could not be decoded.";
}

export function ImageLightbox({isOpen, imageId, filename, onClose}: ImageLightboxProps) {
  const verification = useImageWatermarkVerification(imageId, {enabled: isOpen});
  const displayUrl = imageViewProxyUrl(imageId);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}>
      <div className="relative inline-block max-w-full max-h-full" onClick={(e) => e.stopPropagation()}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={displayUrl}
          alt={filename}
          className="block max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl"
        />

        {verification.verifiedUserId !== null && !verification.isVerificationFailed && (
          <QrLogoFlipButton numericUserId={verification.verifiedUserId} />
        )}

        {verification.verificationStatus === "verifying" && (
          <div className="absolute top-2 left-2 sm:top-4 sm:left-4 z-20 flex items-center gap-2 rounded-md bg-black/60 px-2 py-1 text-xs text-white">
            <LoadingSpinner size="sm" /> Verifying…
          </div>
        )}

        {verification.isVerificationFailed && (
          <div className="absolute bottom-2 left-2 right-2 sm:bottom-4 sm:left-4 sm:right-4 z-20 rounded-md bg-amber-600/90 px-3 py-2 text-xs text-white">
            <div className="font-medium">Watermark verification failed</div>
            <div className="opacity-90">{verificationFailMessage(verification)}</div>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 text-white text-2xl font-bold bg-black/40 rounded-full w-10 h-10 flex items-center justify-center hover:bg-black/60"
        aria-label="Close">
        ×
      </button>
    </div>
  );
}
