"use client";

import {usePresentationQr, type PresentationMediaKind} from "@/hooks/usePresentationQr";
import {
  DEFAULT_QR_OVERLAY_POSITION,
  getQrOverlayPositionClasses,
  type QrOverlayPosition,
} from "@/lib/presentation-qr/position";
import {cn} from "@/lib/utils";

const SAIVD_API_ORIGIN =
  process.env.NEXT_PUBLIC_SAIVD_API_URL?.replace(/\/+$/, "") ?? "https://saivd.netlify.app";

type PresentationQrFlipButtonProps = {
  numericUserId: number;
  mediaKind: PresentationMediaKind;
  mediaId: string;
  enabled: boolean;
  position?: QrOverlayPosition;
  elevateAboveBottomControls?: boolean;
  className?: string;
  mintEndpoint?: string;
};

export function PresentationQrFlipButton({
  numericUserId,
  mediaKind,
  mediaId,
  enabled,
  position = DEFAULT_QR_OVERLAY_POSITION,
  elevateAboveBottomControls = false,
  className = "",
  mintEndpoint = "/api/presentation/mint",
}: PresentationQrFlipButtonProps) {
  const {qrDataUrl, isDynamic, staticQrUrl} = usePresentationQr({
    enabled,
    numericUserId,
    mediaKind,
    mediaId,
    mintEndpoint,
  });

  const profileUrl = `${SAIVD_API_ORIGIN}/profile/${numericUserId}`;
  const qrImageSrc = isDynamic && qrDataUrl ? qrDataUrl : staticQrUrl;

  if (!qrImageSrc) return null;

  return (
    <button
      type="button"
      onClick={() => {
        // In-app click: always profile. QR image still encodes /p/… for camera scans.
        window.open(profileUrl, "_blank", "noopener,noreferrer");
      }}
      aria-label="View creator profile"
      className={cn(
        "absolute z-20 qr-logo-flip-container cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 rounded-md",
        getQrOverlayPositionClasses(position, {elevateAboveBottomControls}),
        className,
      )}>
      <div className="qr-logo-flip-card">
        <div className="qr-logo-flip-face qr-logo-flip-face-front">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qrImageSrc}
            alt="Creator QR code"
            className="w-16 h-16 object-contain rounded-md shadow-md"
          />
        </div>
        <div className="qr-logo-flip-face qr-logo-flip-face-back">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/saivd-logo.png"
            alt="Brand logo"
            className="w-16 h-16 object-contain rounded-md shadow-md"
          />
        </div>
      </div>
    </button>
  );
}
