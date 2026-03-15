/**
 * Client-side watermark decode and RSA verification.
 * Matches docs/THIRD_PARTY_NEXTJS_APP_IMPLEMENTATION_GUIDE.md (§5) and
 * docs/FRONTEND_WATERMARK_VERIFICATION_IMPLEMENTATION_GUIDE.md.
 */

export const PATCH_SIZE = 16;
export const SIGNATURE_LENGTH = 256;
export const USER_ID_DIGITS = 9;
export const REPS = 7;
export const MAX_MESSAGE_LENGTH = 100;

export function captureFrameToImageData(video: HTMLVideoElement): ImageData | null {
  if (video.videoWidth === 0 || video.videoHeight === 0) return null;

  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

export function imageDataToLumaLimitedBt709(data: ImageData): Uint8Array {
  const {width, height, data: rgba} = data;
  const luma = new Uint8Array(width * height);
  const scale = 219 / 255;

  for (let i = 0; i < width * height; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];

    const yFull = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const yLimited = 16 + scale * yFull;
    luma[i] = Math.max(0, Math.min(255, Math.round(yLimited)));
  }

  return luma;
}

export function cropToMultipleOf16(
  imageData: ImageData
): {luma: Uint8Array; width: number; height: number} {
  const croppedWidth = imageData.width - (imageData.width % PATCH_SIZE);
  const croppedHeight = imageData.height - (imageData.height % PATCH_SIZE);

  const fullLuma = imageDataToLumaLimitedBt709(imageData);
  const croppedLuma = new Uint8Array(croppedWidth * croppedHeight);

  for (let y = 0; y < croppedHeight; y++) {
    for (let x = 0; x < croppedWidth; x++) {
      croppedLuma[y * croppedWidth + x] = fullLuma[y * imageData.width + x];
    }
  }

  return {luma: croppedLuma, width: croppedWidth, height: croppedHeight};
}

export function buildPatchMatrix(
  luma: Uint8Array,
  width: number,
  height: number
): number[][] {
  const rows = Math.floor(height / PATCH_SIZE);
  const cols = Math.floor(width / PATCH_SIZE);
  const matrix: number[][] = [];

  for (let py = 0; py < rows; py++) {
    const row: number[] = [];
    for (let px = 0; px < cols; px++) {
      let sum = 0;
      for (let dy = 0; dy < PATCH_SIZE; dy++) {
        for (let dx = 0; dx < PATCH_SIZE; dx++) {
          sum += luma[(py * PATCH_SIZE + dy) * width + (px * PATCH_SIZE + dx)];
        }
      }
      row.push((sum + 128) >> 8);
    }
    matrix.push(row);
  }

  return matrix;
}

export function getRightEndIndex(pixelHeight: number, patchCols: number): number {
  const groupsPerColumn = Math.floor(pixelHeight / 5);
  if (groupsPerColumn <= 0) return 0;
  const numLeftColumns = Math.ceil(SIGNATURE_LENGTH / groupsPerColumn);
  return Math.max(0, patchCols - numLeftColumns);
}

export function getRightSideRowSums(
  givenFrame: number[][],
  rightEndIndex: number
): number[] {
  const patchRows = givenFrame.length;
  const rightSide: number[] = [];

  for (let row = 0; row < patchRows; row++) {
    let sum = 0;
    for (let col = 0; col < rightEndIndex && col < givenFrame[row].length; col++) {
      sum += givenFrame[row][col];
    }
    const value = sum % rightEndIndex;
    rightSide.push(value);
  }

  return rightSide;
}

export function mode(arr: number[]): number | null {
  if (arr.length === 0) return null;
  const counts = new Map<number, number>();
  for (const v of arr) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: number | null = null;
  let maxCount = 0;
  for (const [v, c] of counts) {
    if (c > maxCount) {
      maxCount = c;
      best = v;
    }
  }
  return best;
}

/**
 * Decode numeric user ID from right-side row sums (frame 0 or any frame).
 * Backend encodes a fixed 9-digit decimal string, left-padded with zeros.
 * Uses dynamic repsUsed = min(7, floor(rightSide.length / 9)); 9 groups of repsUsed; digit = mode per group.
 * Does not strip trailing zeros.
 */
export function decodeNumericUserIdFromRightSide(rightSide: number[]): number | null {
  const repsUsed = Math.min(7, Math.floor(rightSide.length / 9));
  if (repsUsed === 0) {
    console.warn("[watermark-decode] decodeNumericUserIdFromRightSide: not enough data", {
      rightSideLength: rightSide.length,
      repsUsed: 0,
      needAtLeast: 9,
    });
    return null;
  }

  const values = rightSide.slice(0, 9 * repsUsed);
  const digits: number[] = [];

  for (let d = 0; d < USER_ID_DIGITS; d++) {
    const group = values.slice(d * repsUsed, (d + 1) * repsUsed);
    const m = mode(group);
    if (m === null || m < 0 || m > 9) {
      console.warn("[watermark-decode] decodeNumericUserIdFromRightSide: invalid digit", {
        digitIndex: d,
        modeValue: m,
        groupLength: group.length,
        rightSideLength: rightSide.length,
        repsUsed,
      });
      return null;
    }
    digits.push(m);
  }

  const digitStr = digits.join("");
  const numericUserId = parseInt(digitStr, 10);
  const result = Number.isNaN(numericUserId) ? null : numericUserId;
  console.log("[watermark-diagnostic] decodeNumericUserIdFromRightSide", {
    repsUsed,
    digitStr,
    numericUserId: result,
    digits,
  });
  return result;
}

export function decodeNumericUserIdFromFrame0(imageData: ImageData): number | null {
  const {luma, width, height} = cropToMultipleOf16(imageData);
  if (width === 0 || height === 0) {
    console.warn("[watermark-diagnostic] decodeNumericUserIdFromFrame0: zero crop", {
      originalWidth: imageData.width,
      originalHeight: imageData.height,
    });
    return null;
  }

  const givenFrame = buildPatchMatrix(luma, width, height);
  const patchRows = givenFrame.length;
  const patchCols = givenFrame[0]?.length ?? 0;
  const rightEndIndex = getRightEndIndex(height, patchCols);
  if (rightEndIndex <= 0) {
    console.warn("[watermark-diagnostic] decodeNumericUserIdFromFrame0: rightEndIndex <= 0", {
      height,
      patchCols,
      groupsPerColumn: Math.floor(height / 5),
    });
    return null;
  }

  const rightSide = getRightSideRowSums(givenFrame, rightEndIndex);
  const numericUserId = decodeNumericUserIdFromRightSide(rightSide);

  console.log("[watermark-diagnostic] decodeNumericUserIdFromFrame0", {
    cropWidth: width,
    cropHeight: height,
    patchRows,
    patchCols,
    rightEndIndex,
    rightSideLength: rightSide.length,
    rightSideFirst63: rightSide.slice(0, 63),
    numericUserId: numericUserId ?? null,
  });

  return numericUserId;
}

export function getLeftSideSignature(
  luma: Uint8Array,
  width: number,
  height: number,
  rightEndIndex: number
): Uint8Array {
  const leftStartCol = rightEndIndex * PATCH_SIZE;
  if (leftStartCol >= width) return new Uint8Array(256);

  const leftWidth = width - leftStartCol;
  const out: number[] = [];

  for (let col = 0; col < leftWidth && out.length < 256; col++) {
    const pixelCol = leftStartCol + col;
    for (
      let groupStart = 0;
      groupStart + 5 <= height && out.length < 256;
      groupStart += 5
    ) {
      let sum = 0;
      for (let r = 0; r < 5; r++) {
        sum += luma[(groupStart + r) * width + pixelCol];
      }
      out.push(Math.max(0, Math.min(255, sum)));
    }
  }

  const sig = new Uint8Array(256);
  for (let i = 0; i < 256 && i < out.length; i++) {
    sig[i] = out[i];
  }
  return sig;
}

export async function importPublicKeyFromPem(pem: string): Promise<CryptoKey> {
  const trimmed = pem
    .replace(/-----BEGIN PUBLIC KEY-----/g, "")
    .replace(/-----END PUBLIC KEY-----/g, "")
    .replace(/\s/g, "");

  const binary = atob(trimmed);
  const buffer = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    buffer[i] = binary.charCodeAt(i);
  }

  return crypto.subtle.importKey(
    "spki",
    buffer,
    {name: "RSASSA-PKCS1-v1_5", hash: "SHA-256"},
    false,
    ["verify"]
  );
}

export function buildMessageBytes(rightSide: number[]): Uint8Array {
  const len = Math.min(MAX_MESSAGE_LENGTH, rightSide.length);
  const chars: string[] = [];
  for (let i = 0; i < len; i++) {
    chars.push(String.fromCharCode(rightSide[i]));
  }
  const str = chars.join("");
  return new TextEncoder().encode(str);
}

export async function verifyFrame(
  publicKey: CryptoKey,
  rightSide: number[],
  signatureBytes: Uint8Array
): Promise<boolean> {
  const messageBytes = buildMessageBytes(rightSide);
  if (messageBytes.length === 0) {
    console.warn("[watermark-diagnostic] verifyFrame: empty message (rightSide too short)");
    return false;
  }

  const verified = await crypto.subtle.verify(
    {name: "RSASSA-PKCS1-v1_5"},
    publicKey,
    signatureBytes as BufferSource,
    messageBytes as BufferSource
  );

  console.log("[watermark-diagnostic] verifyFrame", {
    rightSideLength: rightSide.length,
    messageByteLength: messageBytes.length,
    rightSideFirst20: rightSide.slice(0, 20),
    signatureFirst8: Array.from(signatureBytes.slice(0, 8)),
    signatureLast4: Array.from(signatureBytes.slice(252, 256)),
    verified,
  });

  return verified;
}

export async function decodeAndVerifyFrame(
  publicKey: CryptoKey,
  imageData: ImageData
): Promise<{verified: boolean; numericUserId: number | null}> {
  const {luma, width, height} = cropToMultipleOf16(imageData);
  if (width === 0 || height === 0) {
    console.warn("[watermark-diagnostic] decodeAndVerifyFrame: zero crop");
    return {verified: false, numericUserId: null};
  }

  const givenFrame = buildPatchMatrix(luma, width, height);
  const patchCols = givenFrame[0]?.length ?? 0;
  const rightEndIndex = getRightEndIndex(height, patchCols);
  if (rightEndIndex <= 0) {
    console.warn("[watermark-diagnostic] decodeAndVerifyFrame: rightEndIndex <= 0");
    return {verified: false, numericUserId: null};
  }

  const rightSide = getRightSideRowSums(givenFrame, rightEndIndex);
  const numericUserId = decodeNumericUserIdFromRightSide(rightSide);
  const signatureBytes = getLeftSideSignature(luma, width, height, rightEndIndex);

  console.log("[watermark-diagnostic] decodeAndVerifyFrame input", {
    cropWidth: width,
    cropHeight: height,
    rightEndIndex,
    rightSideLength: rightSide.length,
    numericUserId: numericUserId ?? null,
  });

  const verified = await verifyFrame(publicKey, rightSide, signatureBytes);
  return {verified, numericUserId};
}
