# Image Watermark Spec (v1)

This document is the **single source of truth** for the image watermark
format used by SAIVD. It is independent of, and intentionally different
from, the V2 video watermark format (see
[`V2_WATERMARK_STRATEGY.md`](./V2_WATERMARK_STRATEGY.md) for that).

Backend reference implementation: `saivd-backend/watermark_image/embed.py`.
Frontend implementation lives at `saivd-viewer/src/lib/image-watermark-verification.ts`
(Phase 3) and `saivd/src/lib/image-watermark-verification.ts` (Phase 2).

---

## 1. High-level summary

| What | Where in image | Key needed to read? | Frontend action |
|------|----------------|----------------------|-----------------|
| **Numeric user ID** (9 digits) | First 9 row-sum cells of the **top** region | No | Decode without any key |
| **Signed message** | First 100 row-sum cells of the **top** region | No to read | Build the same string as the encoder |
| **RSA signature** (256 bytes) | Row-sum cells of the **bottom 256 rows** | Yes (public key) — to verify | Extract bytes, `crypto.subtle.verify` against the message |

* **Nothing is encrypted.** The top-region cells are plain row-sum residues
  (sum of each row of the B channel modulo image width).
* **Channel.** The watermark lives in the **B channel only** (BGR index 0,
  which corresponds to RGBA index 2 on a browser canvas).
* **PNG only.** The watermarked output is always a lossless 3-channel
  8-bit RGB PNG. Any re-encode (JPEG, WebP, etc.) destroys the watermark.

---

## 2. Standardization (encoder-side, mandatory)

Before any embedding, the encoder runs an eight-step normalization that
produces a canonical `(H, W, 3)` uint8 BGR image. **Verification reads
the canonical output, not the original upload.** The standardization is
non-reversible and is part of the contract.

1. Decode any common format (PNG, JPEG, WebP, TIFF, BMP, GIF, paletted PNG,
   16-bit PNG, CMYK JPEG, …) via Pillow. HEIC is supported when
   `pillow-heif` is installed in the worker image.
2. Apply EXIF orientation; **strip** the EXIF orientation tag so the
   verifier sees the displayed orientation.
3. Force 8-bit depth. 16-bit / float inputs are scaled down.
4. Convert any mode (L, LA, P, RGBA, CMYK, YCbCr, …) to RGB. **Alpha is
   composited over opaque white `#FFFFFF`**, which is the documented
   contract (configurable per-request is deferred to Phase 4).
5. Discard the ICC profile.
6. Cap dimensions: if `max(H, W) > 8192`, downscale (Lanczos) preserving
   aspect ratio.
7. Reject input outside the supported range — minimum 16×16 after the
   cap; further the encoder requires `H ≥ RSA_len + USER_ID_DIGITS = 265`
   and `W ≥ RSA_len = 256` (so signature bytes uniquely fit in `mod W`
   row-sum residues).
8. RGB → BGR.

---

## 3. Region layout

Within the canonical 2-D B channel of shape `(H, W)`:

| Region | Rows | Carries | Length |
|---|---|---|---|
| **Right side** (top, payload) | `[0, H − 256)` | One value per row = `sum(row) % W` | `H − 256` cells |
| **Left side** (bottom, signature) | `[H − 256, H)` | One value per row = `sum(row) % W` | 256 cells |

The "right / left" naming is inherited from the video format where the
algorithm operates transposed; for images the split is top/bottom of the
B channel. Per-row sums are integers in `[0, W)`.

---

## 4. Right side — payload (no key needed to read)

* The first 9 cells of `right_side` are the 9 decimal digits of the
  numeric user ID, zero-padded. So a `user_id = 1` produces the prefix
  `[0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, …]`.
* The remaining `H − 256 − 9` cells are zeros (modulo `W` arithmetic; the
  encoder targets exactly 0).
* The **signed message** is the first 100 cells of `right_side`
  interpreted as a UTF-8 string of code points: `chr(c) for c in right_side[:100]`.
  This is the exact byte string the encoder signs.

**No `059059` calibration marker.** Unlike the V2 video format, the image
format has no calibration prefix; the decoder relies on byte-exact
row-sum recovery from the lossless PNG. This is acceptable because we do
not need to handle re-encode survival.

---

## 5. Left side — RSA signature (public key to verify)

* The encoder computes `signature = RSASSA-PKCS1-v1_5_SHA-256(message)`
  using the user's RSA-2048 **private** key (PKCS1v15 padding, SHA-256
  hash).
* The signature is exactly 256 bytes.
* The encoder embeds these 256 bytes into the bottom 256 rows of the B
  channel by nudging pixels (±1, never crossing 0 or 255) so that
  `(sum(row_i) % W) == signature[i - (H - 256)]` for `i in [H - 256, H)`.

Because `W ≥ 256` is enforced (§2 step 7), each value `0..255` lands in a
unique residue class modulo `W`, so the decoder reads `left_side[i]`
directly as a uint8 with no `% 256` coercion needed.

---

## 6. Decoder pseudocode

```typescript
// 1. Render the image at intrinsic resolution into a canvas.
const canvas = new OffscreenCanvas(imageBitmap.width, imageBitmap.height);
const ctx = canvas.getContext('2d')!;
ctx.drawImage(imageBitmap, 0, 0);
const { data, width: W, height: H } = ctx.getImageData(0, 0, canvas.width, canvas.height);

// 2. Extract per-row sums of the B channel (RGBA index 2) mod W.
const RSA_LEN = 256;
const USER_ID_DIGITS = 9;
const rowSums = new Int32Array(H);
for (let y = 0; y < H; y++) {
  let s = 0;
  const base = y * W * 4;
  for (let x = 0; x < W; x++) s += data[base + x * 4 + 2];  // +2 = B
  rowSums[y] = s % W;
}
const rightSide = rowSums.subarray(0, H - RSA_LEN);
const leftSide  = rowSums.subarray(H - RSA_LEN);

// 3. Decode numeric_user_id from the first 9 cells (no key needed).
const digits = Array.from(rightSide.subarray(0, USER_ID_DIGITS));
if (digits.some(d => d < 0 || d > 9)) return { ok: false, reason: 'no_watermark' };
const numericUserId = parseInt(digits.join(''), 10);

// 4. Fetch the user's RSA public key (cached).
const publicKey = await fetchPublicKey(numericUserId);

// 5. Build the message and signature buffers.
const messageStr = Array.from(rightSide.subarray(0, 100))
  .map(v => String.fromCharCode(v)).join('');
const messageBuf = new TextEncoder().encode(messageStr);
const signatureBuf = new Uint8Array(leftSide.subarray(0, RSA_LEN));

// 6. RSA verify.
const ok = await crypto.subtle.verify(
  { name: 'RSASSA-PKCS1-v1_5' }, publicKey, signatureBuf, messageBuf,
);
return ok ? { ok: true, numericUserId } : { ok: false, reason: 'invalid_signature' };
```

---

## 7. Frontend integration notes

* **Render at intrinsic resolution.** The verifier MUST run on the
  full-resolution `ImageBitmap`, not on a styled DOM element. Use an
  `OffscreenCanvas` (or hidden `<canvas>`) sized to `imageBitmap.width`
  and `imageBitmap.height`, and `drawImage(img, 0, 0)` with no scaling.
  Any browser downscale will break the row sums.
* **Channel index.** On a browser `<canvas>` `getImageData` returns RGBA
  (`R=0, G=1, B=2, A=3`), so the B channel the encoder watermarked
  (cv2 BGR index 0) is at RGBA index `+2`.
* **QR overlay.** The QR badge is identical to the video player. See
  the reference component pattern in
  `saivd-viewer/src/components/video/VideoPlayer.tsx:236-268` and reuse
  the `qr-logo-flip-*` CSS classes from `globals.css`.

---

## 8. Constants (must match encoder)

| Constant | Value | Source |
|---|---|---|
| `RSA_LEN` | 256 | `watermark_video.encryption_utils.RSA_len` |
| `USER_ID_DIGITS` | 9 | `watermark_image.embed.USER_ID_DIGITS` |
| `SIGNED_MESSAGE_LENGTH` | 100 | `watermark_image.embed.SIGNED_MESSAGE_LENGTH` |
| `RSA padding` | PKCS1v15 | both ends |
| `Hash` | SHA-256 | both ends |
| `Channel` | B (cv2 BGR index 0 = canvas RGBA index 2) | both ends |
| `Row-sum modulus` | image width `W` | both ends |
| `Alpha-flatten background` | `#FFFFFF` opaque white | encoder standardization |
| `Max input dimension` | 8192 | `watermark_image.utils.MAX_DIM_DEFAULT` |
| `Min H` | 265 | encoder enforces |
| `Min W` | 256 | encoder enforces |
| `Max input bytes` | 100 MB (worker), 50 MB (saivd/ upload) | env-configurable |

---

## 9. Relation to V2 video format

The image format is **not interchangeable** with the V2 video format.
Key differences:

| Aspect | V2 video | Image (this spec) |
|---|---|---|
| Channel | Y (luma of YUV420) | B (BGR / RGBA index 2) |
| Patching | 16×16 patch matrix, patch-row sums | whole-pixel-row sums |
| Region split | right *patch columns* / left *pixel columns* | top rows / bottom 256 rows |
| Calibration marker | `059059` (6 digits) before user_id | none |
| User-id repetition | `repsUsed = min(7, ⌊rightSide.len / 9⌋)` with mode recovery | none |
| Signature embed | 5-pixel column-major slot sums | per-row sums of bottom 256 rows |
| Survives | libx264 CRF 4-20 + faststart | PNG (lossless) only |

A future migration to align the image format to V2 (Phase 4) is
discussed in
`saivd-backend/docs/IMAGE_WATERMARK_INTEGRATION_PLAN.md` §3 Option B.
Phase 1 deliberately adopts the simpler Temp-Ido-derived format.

---

## 10. Versioning

Phase 1 ships without an in-band version byte. If a future change
introduces a second image format, the frontend will dispatch by the
`format_version` column of the `images` Supabase row (added in the
migration that introduces the new format) or, as a fallback, by trying
each known decoder and accepting the first that produces a valid
signature.
