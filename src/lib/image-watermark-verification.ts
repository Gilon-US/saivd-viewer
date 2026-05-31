/**
 * In-browser verifier for the SAIVD image watermark format (v1).
 * See docs/IMAGE_WATERMARK_SPEC.md
 */

const RSA_LEN = 256;
const USER_ID_DIGITS = 9;
const SIGNED_MESSAGE_LENGTH = 100;

const SAIVD_API_ORIGIN =
  process.env.NEXT_PUBLIC_SAIVD_API_URL ?? "https://saivd.netlify.app";

export type ImageVerificationFailReason =
  | "no_watermark"
  | "invalid_signature"
  | "malformed"
  | "fetch_failed";

export type ImageVerificationOk = {ok: true; numericUserId: number};
export type ImageVerificationFail = {ok: false; reason: ImageVerificationFailReason; detail?: string};
export type ImageVerificationResult = ImageVerificationOk | ImageVerificationFail;

type DecodedRegions = {
  width: number;
  height: number;
  rightSide: Int32Array;
  leftSide: Int32Array;
};

function imageBitmapToBlueRowSums(bmp: ImageBitmap): DecodedRegions | {error: string} {
  const W = bmp.width;
  const H = bmp.height;
  if (W < RSA_LEN || H < RSA_LEN + USER_ID_DIGITS) {
    return {error: `image too small (${W}x${H})`};
  }
  let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  if (typeof OffscreenCanvas !== "undefined") {
    const oc = new OffscreenCanvas(W, H);
    ctx = oc.getContext("2d") as OffscreenCanvasRenderingContext2D;
  } else {
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    ctx = c.getContext("2d") as CanvasRenderingContext2D;
  }
  if (!ctx) return {error: "could not get 2d context"};
  ctx.drawImage(bmp, 0, 0);
  const {data} = ctx.getImageData(0, 0, W, H);
  const rowSums = new Int32Array(H);
  for (let y = 0; y < H; y++) {
    let s = 0;
    const base = y * W * 4;
    for (let x = 0; x < W; x++) s += data[base + x * 4 + 2];
    rowSums[y] = s % W;
  }
  return {
    width: W,
    height: H,
    rightSide: rowSums.slice(0, H - RSA_LEN),
    leftSide: rowSums.slice(H - RSA_LEN),
  };
}

/** Parity harness — concatenated row-sum residues (one per row). Algorithm unchanged. */
export function fingerprintBlueRowSums(bmp: ImageBitmap): Int32Array | {error: string} {
  const decoded = imageBitmapToBlueRowSums(bmp);
  if ("error" in decoded) return decoded;
  const {height, rightSide, leftSide} = decoded;
  const full = new Int32Array(height);
  full.set(rightSide, 0);
  full.set(leftSide, rightSide.length);
  return full;
}

const PUBLIC_KEY_CACHE: Map<number, Promise<CryptoKey>> = new Map();

export async function fetchImagePublicKey(numericUserId: number): Promise<CryptoKey> {
  const cached = PUBLIC_KEY_CACHE.get(numericUserId);
  if (cached) return cached;

  const promise = (async () => {
    const res = await fetch(`${SAIVD_API_ORIGIN}/api/users/${numericUserId}/public-key`, {
      credentials: "omit",
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error?.message ?? `public_key_fetch_failed: ${res.status}`);
    }
    const data = await res.json();
    const pem: string | undefined = data?.data?.public_key_pem;
    if (!pem) throw new Error("public_key_fetch_failed: missing public_key_pem");
    return importRsaPublicKeyForVerify(pem);
  })();

  PUBLIC_KEY_CACHE.set(numericUserId, promise);
  promise.catch(() => PUBLIC_KEY_CACHE.delete(numericUserId));
  return promise;
}

export async function importRsaPublicKeyForVerify(pem: string): Promise<CryptoKey> {
  const trimmed = pem
    .replace(/-----BEGIN PUBLIC KEY-----/g, "")
    .replace(/-----END PUBLIC KEY-----/g, "")
    .replace(/\s/g, "");
  const binary = atob(trimmed);
  const buffer = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) buffer[i] = binary.charCodeAt(i);
  return crypto.subtle.importKey(
    "spki",
    buffer,
    {name: "RSASSA-PKCS1-v1_5", hash: "SHA-256"},
    false,
    ["verify"],
  );
}

export async function verifyImageWatermark(
  bmp: ImageBitmap,
  options?: {publicKey?: CryptoKey},
): Promise<ImageVerificationResult> {
  const decoded = imageBitmapToBlueRowSums(bmp);
  if ("error" in decoded) return {ok: false, reason: "malformed", detail: decoded.error};
  const {rightSide, leftSide} = decoded;

  const digits = Array.from(rightSide.subarray(0, USER_ID_DIGITS));
  if (digits.some((d) => d < 0 || d > 9)) {
    return {ok: false, reason: "no_watermark", detail: `digits out of range: ${digits.join(",")}`};
  }
  const numericUserId = parseInt(digits.join(""), 10);
  if (!Number.isFinite(numericUserId)) {
    return {ok: false, reason: "no_watermark", detail: "could not parse user_id"};
  }

  let publicKey: CryptoKey;
  try {
    publicKey = options?.publicKey ?? (await fetchImagePublicKey(numericUserId));
  } catch (e) {
    return {ok: false, reason: "fetch_failed", detail: e instanceof Error ? e.message : String(e)};
  }

  const messageChars: number[] = [];
  for (let i = 0; i < SIGNED_MESSAGE_LENGTH; i++) messageChars.push(rightSide[i]);
  const messageBuf = new TextEncoder().encode(String.fromCharCode(...messageChars));
  const signatureBuf = new Uint8Array(RSA_LEN);
  for (let i = 0; i < RSA_LEN; i++) signatureBuf[i] = leftSide[i] & 0xff;

  try {
    const ok = await crypto.subtle.verify(
      {name: "RSASSA-PKCS1-v1_5"},
      publicKey,
      signatureBuf,
      messageBuf,
    );
    if (!ok) return {ok: false, reason: "invalid_signature"};
    return {ok: true, numericUserId};
  } catch (e) {
    return {ok: false, reason: "malformed", detail: e instanceof Error ? e.message : String(e)};
  }
}
