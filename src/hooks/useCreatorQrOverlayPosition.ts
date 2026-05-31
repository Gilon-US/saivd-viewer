"use client";

import {useEffect, useState} from "react";
import {
  DEFAULT_QR_OVERLAY_POSITION,
  isQrOverlayPosition,
  parseQrOverlayPosition,
  type QrOverlayPosition,
} from "@/lib/presentation-qr/position";

const CACHE_PREFIX = "saivd_qr_overlay_position:";

/**
 * Loads a creator's QR overlay corner via the viewer proxy (same-origin).
 * Cached in sessionStorage for the browser session.
 */
export function useCreatorQrOverlayPosition(numericUserId: number | null): QrOverlayPosition {
  const [position, setPosition] = useState<QrOverlayPosition>(DEFAULT_QR_OVERLAY_POSITION);

  useEffect(() => {
    if (numericUserId === null) {
      setPosition(DEFAULT_QR_OVERLAY_POSITION);
      return;
    }

    const cacheKey = `${CACHE_PREFIX}${numericUserId}`;
    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached && isQrOverlayPosition(cached)) {
        setPosition(cached);
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
        setPosition(next);
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

  return position;
}
