"use client";

import {useEffect, useState} from "react";
import {
  DEFAULT_QR_OVERLAY_POSITION,
  isQrOverlayPosition,
  parseQrOverlayPosition,
  type QrOverlayPosition,
} from "@/lib/presentation-qr/position";

const CACHE_PREFIX = "saivd_qr_overlay_position:";

export type CreatorQrOverlay = {
  position: QrOverlayPosition;
  /** Resolved creator brand logo URL, if available */
  logoUrl: string | null;
};

/**
 * Loads a creator's QR overlay corner and brand logo via the viewer proxy (same-origin).
 * Position is cached in sessionStorage for the browser session (logo URLs are not —
 * they are often short-lived presigned links).
 */
export function useCreatorQrOverlayPosition(numericUserId: number | null): CreatorQrOverlay {
  const [overlay, setOverlay] = useState<CreatorQrOverlay>(() => {
    if (numericUserId === null) {
      return {position: DEFAULT_QR_OVERLAY_POSITION, logoUrl: null};
    }
    try {
      const cached = sessionStorage.getItem(`${CACHE_PREFIX}${numericUserId}`);
      if (cached && isQrOverlayPosition(cached)) {
        return {position: cached, logoUrl: null};
      }
    } catch {
      /* ignore storage errors */
    }
    return {position: DEFAULT_QR_OVERLAY_POSITION, logoUrl: null};
  });

  useEffect(() => {
    if (numericUserId === null) {
      setOverlay({position: DEFAULT_QR_OVERLAY_POSITION, logoUrl: null});
      return;
    }

    const cacheKey = `${CACHE_PREFIX}${numericUserId}`;
    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached && isQrOverlayPosition(cached)) {
        setOverlay((prev) => ({...prev, position: cached}));
      }
    } catch {
      /* ignore storage errors */
    }

    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch(`/api/creator/profile/${numericUserId}`, {
          credentials: "omit",
        });
        const body = await res.json().catch(() => null);
        if (cancelled || !res.ok || !body?.success) return;

        const next = parseQrOverlayPosition(body.data?.qr_overlay_position);
        const logo = typeof body.data?.logo === "string" ? body.data.logo.trim() : "";
        setOverlay({position: next, logoUrl: logo || null});
        try {
          sessionStorage.setItem(cacheKey, next);
        } catch {
          /* ignore storage errors */
        }
      } catch {
        /* keep cached/default position */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [numericUserId]);

  return overlay;
}
