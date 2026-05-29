"use client";

const SAIVD_API_ORIGIN =
  process.env.NEXT_PUBLIC_SAIVD_API_URL?.replace(/\/+$/, "") ?? "https://saivd.netlify.app";

type QrLogoFlipButtonProps = {
  numericUserId: number;
  className?: string;
};

/** QR ↔ logo flip overlay — same pattern as VideoPlayer and creator ImageGrid lightbox. */
export function QrLogoFlipButton({numericUserId, className = ""}: QrLogoFlipButtonProps) {
  const qrUrl = `${SAIVD_API_ORIGIN}/profile/${numericUserId}/qr`;
  const profileUrl = `${SAIVD_API_ORIGIN}/profile/${numericUserId}`;

  return (
    <button
      type="button"
      onClick={() => window.open(profileUrl, "_blank", "noopener,noreferrer")}
      aria-label="View creator profile"
      className={`absolute top-2 right-2 sm:top-4 sm:right-4 z-20 qr-logo-flip-container cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 rounded-md ${className}`}>
      <div className="qr-logo-flip-card">
        <div className="qr-logo-flip-face qr-logo-flip-face-front">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qrUrl}
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
