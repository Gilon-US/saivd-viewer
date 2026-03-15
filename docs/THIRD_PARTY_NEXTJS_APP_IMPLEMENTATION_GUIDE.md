# Third-Party Next.js App Implementation Guide: Watermarked Video Playback and Verification

This guide enables **third-party Next.js applications** to implement the same watermarked video playback and verification behavior as the SAIVD app. Your app can verify frame 0 (and optionally frames 10, 20, 30, …) using the same algorithm, and use SAIVD’s public API for the RSA public key and QR code image.

---

## 1. SAIVD as the Provider

**SAIVD** (the service at the base URL below) provides:

- **RSA public key API** – so third-party apps can verify that a watermarked video was signed by a known creator.
- **QR code image endpoint** – so third-party apps can display the creator’s profile QR during playback.

Your app does **not** need to host keys or generate QR codes; it only needs to call SAIVD’s endpoints with the **numeric user ID** decoded from the video’s watermark.

### 1.1 Base URL

All SAIVD endpoints used by third-party apps are under:

**Base URL:** `https://saivd.netlify.app`

Use this base URL when calling SAIVD from a third-party app (do not use relative paths).

---

## 2. SAIVD Endpoints for Third-Party Apps

### 2.1 Public RSA Key (required for verification)

- **Purpose:** Get the creator’s RSA public key (PEM) to verify the watermark signature for a given `numeric_user_id` decoded from the video.
- **URL:** `GET https://saivd.netlify.app/api/users/{numericUserId}/public-key`
- **Path parameter:** `numericUserId` – positive integer (e.g. `1`, `12345`). Decoded from frame 0 of the watermarked video (see §5).
- **Authentication:** None. This endpoint is public so third-party apps can verify watermarks.
- **CORS:** Response includes `Access-Control-Allow-Origin: *` for cross-origin requests.

**Success response (200):**

```json
{
  "success": true,
  "data": {
    "public_key_pem": "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkq...\n-----END PUBLIC KEY-----\n"
  }
}
```

**Error responses:** `400` (invalid ID), `404` (user not found or no public key), `500` (server error). Body shape: `{ "success": false, "error": { "code": "...", "message": "..." } }`.

**Example (third-party app):**

```ts
const SAVD_BASE_URL = "https://saivd.netlify.app";

async function fetchPublicKeyFromSavd(numericUserId: number): Promise<string> {
  const res = await fetch(
    `${SAVD_BASE_URL}/api/users/${numericUserId}/public-key`,
    { method: "GET", credentials: "omit" }
  );
  const data = await res.json();
  if (!res.ok || !data.success || !data.data?.public_key_pem) {
    throw new Error(data?.error?.message ?? `Failed to fetch public key: ${res.status}`);
  }
  return data.data.public_key_pem;
}
```

---

### 2.2 QR Code Image (optional, for overlay)

- **Purpose:** Get a PNG image of the QR code that links to the creator’s public profile. Use as the `src` of an `<img>` in your player overlay.
- **URL (page route):** `GET https://saivd.netlify.app/profile/{numericUserId}/qr`
- **URL (API route):** `GET https://saivd.netlify.app/api/users/{numericUserId}/qr`
- **Path parameter:** `numericUserId` – same integer decoded from frame 0.
- **Response:** PNG image (`Content-Type: image/png`). Use as image URL in your UI (e.g. `<img src={qrImageUrl} alt="Creator QR" />`).

**Example:**

```ts
function getSavdQrImageUrl(numericUserId: number): string {
  return `https://saivd.netlify.app/profile/${numericUserId}/qr`;
}
```

---

### 2.3 Creator Public Profile Page (optional)

- **Purpose:** Link users to the creator’s profile. The QR code from §2.2 encodes this URL.
- **URL:** `https://saivd.netlify.app/profile/{numericUserId}`

You can use this URL in your own UI (e.g. “View creator profile”) if you do not use the QR image.

---

## 3. High-Level Playback and Verification Flow

Use this flow in your application.

1. **Obtain a playback URL** for the watermarked video.  
   Use your own storage (e.g. your CDN or S3). The video file must be the same watermarked asset (same encoding, same frames 0, 10, 20, …).

2. **Before allowing playback:**  
   Run **frame 0 verification** (see §4). Do not set the `<video src>` (or do not allow play) until verification completes.

3. **Frame 0 verification steps:**  
   - Capture frame 0’s **luma (Y)** from the video (prefer WebCodecs; see §5.2).  
   - Decode **numeric_user_id** from the Y plane (no key; see §5.3–5.5).  
   - Fetch the RSA public key from SAIVD:  
     `GET https://saivd.netlify.app/api/users/{numericUserId}/public-key`  
   - Verify the watermark signature for frame 0 using that key (see §5.6–5.7).

4. **If verification succeeds:**  
   - Allow playback (set `video.src` and/or enable play button).  
   - Optionally show the QR overlay using  
     `https://saivd.netlify.app/profile/{numericUserId}/qr`  
     as the image URL.

5. **If verification fails:**  
   - Block playback and show an error (e.g. “Video could not be verified” or “Viewing not allowed”).

6. **Optional – verify other watermarked frames:**  
   Frames **10, 20, 30, …** (every 10th frame) are also watermarked. You can verify them the same way as frame 0 **after** you have the public key: capture that frame’s Y, compute right_side and left_side, build message from first 100 right_side values, verify signature. The **numeric user ID is only decoded from frame 0**; for frames 10+ you only run signature verification with the key already fetched. The algorithm supports verifying additional frames the same way.

---

## 4. Blocking Playback Until Verification

- **Do not set `video.src`** (or use a placeholder) until frame 0 verification has succeeded. That way the full video is not loaded until the watermark has been checked.
- **Verification** can run as soon as you have the video URL: use **Range requests** to fetch the start of the file and decode frame 0 via WebCodecs (demux + decode), without loading the full file or using the `<video>` element for capture.
- **Play button / controls:** Only allow play when verification status is `"verified"`. If status is `"verifying"`, show a loading state; if `"failed"`, show an error and do not allow play.

---

## 5. Frame 0 Verification Algorithm

The following algorithm must match the watermark encoder used to produce the video. Use these exact constants and steps so verification works with SAIVD’s public key API.

### 5.1 Constants (must match the watermark encoder)

| Constant            | Value | Notes |
|---------------------|-------|--------|
| `PATCH_SIZE`        | 16    | Block size for patch matrix (width/height in pixels). |
| `FACTOR`            | 1     | Row sums use factor 1 (no division). |
| `MAX_MESSAGE_LENGTH`| 100   | First 100 right_side values form the signed message. |
| `SIGNATURE_LENGTH`  | 256   | Signature in bytes; left region has 256 slot sums. |
| `USER_ID_DIGITS`    | 9     | Numeric user ID is 9 decimal digits (zero-padded). |
| `REPS`              | 7     | `repsUsed = min(7, floor(rightSide.length / 9))`. |
| Watermarked frames  | 0, 10, 20, … | `frame_index % 10 === 0`. |
| RSA algorithm       | RSASSA-PKCS1-v1_5, SHA-256 | Web Crypto `verify`. |

---

### 5.2 Capture Frame 0 Luma (Y)

Use the **raw Y (luma) plane** from the video codec when possible. That best matches the encoder, which operates on codec Y. Canvas capture (draw video → `getImageData` → derive Y from RGB) can differ due to color space/gamma; prefer WebCodecs when available.

**Option A – WebCodecs (recommended):**

1. Fetch the start of the video with an HTTP Range request (e.g. first 8 MB; faststart MP4).
2. Demux the container (e.g. with a library such as **web-demuxer** or similar) to get a video chunk at time 0.
3. Decode that chunk with `VideoDecoder` to get a `VideoFrame`.
4. Read the **Y plane** from the frame (I420 or NV12: first plane is luma). Copy to a `Uint8Array` of size `width * height` (stride-aware if needed).
5. Crop to multiples of 16:  
   `cropW = width - (width % 16)`, `cropH = height - (height % 16)`; use the top-left `cropW × cropH` of the Y plane.

**Option B – Canvas fallback:**

If you cannot use WebCodecs:

1. Load the video in a `<video>` with `crossOrigin="anonymous"`.
2. Seek to time 0 and wait for `loadeddata` and `seeked`.
3. Draw the frame to a canvas (same size as `video.videoWidth` × `video.videoHeight`), then `getImageData`.
4. Convert RGBA to **limited-range BT.709 luma** (Y in 16–235):  
   `Y = 16 + (219/255) * (0.2126*R + 0.7152*G + 0.0722*B)`, then clamp to [0, 255].
5. Crop to multiples of 16 as above.

You then work with **cropped luma** `(luma, width, height)` where `width` and `height` are the cropped dimensions.

---

### 5.3 Patch Matrix

From cropped luma, build a **patch matrix** of 16×16 block means:

- `patchRows = floor(height / 16)`, `patchCols = floor(width / 16)`.
- For each block `(py, px)`, compute the mean of the 256 Y values in that block.
- Use integer rounding: **`(sum + 128) >> 8`** (equivalent to `Math.round(sum/256)`).

Result: 2D array `givenFrame[py][px]` of shape `(patchRows, patchCols)`.

---

### 5.4 Right-End Index and Right-Side Row Sums

- **Right-end index:**  
  `groupsPerColumn = floor(cropHeight / 5)`  
  `numLeftColumns = ceil(256 / groupsPerColumn)`  
  `rightEndIndex = patchCols - numLeftColumns`  
  (Clamp so `rightEndIndex >= 0`.)

- **Right-side row sums:**  
  For each patch row `r`:  
  `rawSum[r] = sum(givenFrame[r][c] for c in 0 .. rightEndIndex-1)`  
  `rightSide[r] = rawSum[r] % rightEndIndex`  
  So each value is in `[0, rightEndIndex - 1]`. Length of `rightSide` = number of patch rows.

---

### 5.5 Decode Numeric User ID from Right Side (frame 0 only)

- `repsUsed = min(7, floor(rightSide.length / 9))`.  
  If `repsUsed < 1`, decoding fails.
- Take the first `9 * repsUsed` values of `rightSide`. Split into 9 groups of `repsUsed` values.
- For each group, compute the **mode** (most frequent value); on tie, use the smallest value. Each mode must be in 0–9; otherwise decoding fails.
- Concatenate the 9 digits to form a string (e.g. `"000000001"`).  
  `numeric_user_id = parseInt(digitStr, 10)`.

This gives the integer you use for the SAIVD public-key and QR endpoints.

---

### 5.6 Left Side (Signature) and Message

- **Left region:** Pixel columns from `rightEndIndex * 16` to the end of the cropped frame.
- **Signature bytes (256):** In column-major order, form 256 “slots.” Each slot is the **sum of 5 consecutive pixels** in one column (no division). Fill a 256-byte array in that order; if the frame is small, pad or truncate to 256.
- **Message:** First 100 values of `rightSide`.  
  `messageString = rightSide.slice(0, 100).map(v => String.fromCharCode(v)).join('')`  
  Encode to bytes with UTF-8 for the verify call.

---

### 5.7 RSA Verification

1. **Fetch public key from SAIVD:**  
   `GET https://saivd.netlify.app/api/users/{numericUserId}/public-key`  
   Parse `data.public_key_pem`.

2. **Import key (Web Crypto):**  
   Strip PEM headers and whitespace, base64-decode, then:  
   `crypto.subtle.importKey("spki", buffer, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"])`.

3. **Verify:**  
   `crypto.subtle.verify(  
     { name: "RSASSA-PKCS1-v1_5" },  
     publicKey,  
     signatureBytes,   // 256-byte Uint8Array from left region  
     messageBytes     // UTF-8-encoded message string  
   )`  
   If this returns `true`, frame 0’s watermark is valid for that `numeric_user_id`.

---

## 6. Verifying Other Frames (10, 20, 30, …)

Watermarked frames are **0, 10, 20, 30, …** (every 10th frame). The **numeric user ID is only decoded from frame 0**. For frames 10, 20, … you reuse the same public key and the same algorithm:

1. Capture that frame’s Y (e.g. seek to the right time and capture via WebCodecs or canvas, then crop to multiple of 16).
2. Build patch matrix, `rightEndIndex`, and `rightSide` as in §5.3–5.4.
3. Build **message** from first 100 values of `rightSide` (same as §5.6).
4. Extract **signature** from the left region (same as §5.6).
5. Call `crypto.subtle.verify` with the **same** public key and these message/signature bytes.

The same technique applies to other watermarked frames if you want stronger assurance (e.g. verify frame 0 and a few later frames). If the encoder uses different encoding for non–frame-0 watermarked frames, verification of those frames would need to follow that encoding; the data layout and verification steps above match the design used by SAIVD’s encoder.

---

## 7. End-to-End Checklist for Your App

- [ ] Use your own watermarked video URL (your storage); do not call SAIVD’s `/api/videos/.../play` for playback.
- [ ] Before playback: capture frame 0 Y (WebCodecs preferred), decode `numeric_user_id`, fetch `https://saivd.netlify.app/api/users/{numericUserId}/public-key`, verify frame 0 signature.
- [ ] Block playback until frame 0 verification succeeds; show loading while verifying and an error if it fails.
- [ ] Optionally show QR overlay: `<img src={"https://saivd.netlify.app/profile/" + numericUserId + "/qr"} alt="Creator QR" />`.
- [ ] Optional: verify frames 10, 20, … with the same key and same right_side/left_side/verify steps.
- [ ] Use the constants and formulas in §5 so your decode/verify pipeline matches the watermark encoder and works with SAIVD’s public key API.

---

## 8. Summary of SAIVD URLs (Third-Party Use)

| What | URL |
|------|-----|
| Base | `https://saivd.netlify.app` |
| Public key | `GET https://saivd.netlify.app/api/users/{numericUserId}/public-key` |
| QR image (page) | `https://saivd.netlify.app/profile/{numericUserId}/qr` |
| QR image (API) | `https://saivd.netlify.app/api/users/{numericUserId}/qr` |
| Creator profile | `https://saivd.netlify.app/profile/{numericUserId}` |

Replace `{numericUserId}` with the 9-digit integer decoded from frame 0 (e.g. `1`, `123456789`).

---

## 9. Self-Contained Use

This guide is intended for use in **any repository**. It does not reference other documents or code paths. Implement the algorithm in §5 exactly (constants, patch matrix, right/left regions, user ID decode, RSA verify) so that verification succeeds when using SAIVD’s public key endpoint. The only external dependency is the SAIVD API at `https://saivd.netlify.app`.
