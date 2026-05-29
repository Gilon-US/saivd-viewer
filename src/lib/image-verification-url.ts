/** Same-origin proxy for dashboard lightbox + verification (avoids Wasabi CORS). */
export function imageViewProxyUrl(imageId: string): string {
  return `/api/images/${encodeURIComponent(imageId)}/view`;
}
