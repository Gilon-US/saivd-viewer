/**
 * Viewer-only helpers for the external watermark API.
 * This app does not create watermarked videos; it only calls the extract_user_id
 * endpoint to read the embedded user ID from already-watermarked videos (e.g. for QR/verification).
 * See docs/watermark-api-integration-guide.md for the external API contract.
 */

/** Normalize base URL: strip trailing slashes. */
export function getWatermarkBaseUrl(): string {
  const raw = process.env.WATERMARK_SERVICE_URL ?? "";
  return raw.replace(/\/+$/, "");
}

/** Standard error shape for API responses. */
export type WatermarkErrorPayload = {
  success: false;
  error: { code: string; message: string };
};

/** Error codes used by the extract-user-id route. */
export const WATERMARK_ERROR_CODES = {
  config_error: "config_error",
  unauthorized: "unauthorized",
  user_profile_error: "user_profile_error",
  extraction_failed: "extraction_failed",
  server_error: "server_error",
} as const;

/** Build JSON error response body. */
export function watermarkErrorBody(
  code: keyof typeof WATERMARK_ERROR_CODES | string,
  message: string
): WatermarkErrorPayload {
  return { success: false, error: { code, message } };
}
