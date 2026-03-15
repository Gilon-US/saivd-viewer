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
   - Capture frame 0’s **luma (Y)** from the video using **WebCodecs** (required; see §5.2).  
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
- **Verification** can run as soon as you have the video URL: use **Range requests** to fetch the start of the file and decode frame 0 via **WebCodecs** (WASM demuxer + `VideoDecoder`), without loading the full file or using the `<video>` element for capture. WebCodecs is required so the Y plane matches the encoder (see §5.2).
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

### 5.2 Capture Frame 0 Luma (Y) — WebCodecs required

Frame 0 capture **must** use **WebCodecs** so the luma (Y) data matches the encoder. The encoder operates on the **raw Y plane** from the video codec. The only way to get that same Y plane in the browser is to decode the video with the **WebCodecs API** (`VideoDecoder` + `VideoFrame`) and read the Y plane from the decoded frame. Canvas-based capture (draw video to canvas → `getImageData` → derive Y from RGB) produces Y-from-RGB, which can differ from codec Y due to color space and gamma; verification may then fail or be unreliable. Therefore **WebCodecs is the required implementation** for frame 0 capture. The canvas path in §5.2.2 is only for environments where WebCodecs is unavailable; in that case verification may not succeed.

**What is WebCodecs?**

WebCodecs is a browser API that gives direct access to video encoding and decoding. For this guide you use:

- **`VideoDecoder`** – decodes compressed video chunks into **`VideoFrame`** objects. The decoded frame can be in a YUV format (e.g. I420, NV12) where the **Y (luma) plane** is the first plane and matches what the watermark encoder uses.
- **`EncodedVideoChunk`** – a single compressed frame (e.g. one frame of H.264/AVC). The demuxer produces these from the MP4 container.
- **`VideoFrame`** – the decoded frame. You read the Y plane via `frame.copyTo(buffer)` and the returned layout (plane 0 = Y, with `offset` and `stride`).

**Flow in this implementation:** Fetch the start of the video (Range request) → demux the container with WASM to get an `EncodedVideoChunk` at time 0 → get a `VideoDecoderConfig` from the demuxer → create a `VideoDecoder`, configure it, decode the chunk → receive one `VideoFrame` → copy out the Y plane using the frame’s layout → crop to multiple of 16. That Y plane is then fed into the rest of the verification pipeline (§5.3–5.7).

---

#### 5.2.1 WebCodecs + WASM demuxer (required implementation)

You **must** implement frame 0 capture using a **WASM-based demuxer** plus the WebCodecs **`VideoDecoder`** and **`VideoFrame`**. The demuxer parses the MP4 container and produces an `EncodedVideoChunk` for frame 0; `VideoDecoder` decodes it to a `VideoFrame`; you then read the **Y plane** directly from that frame. This does not require a `<video>` element and uses **Range requests** so only the start of the file is downloaded.

**Dependency and WASM file**

- Use the **web-demuxer** npm package (e.g. `web-demuxer` ^4.0.0 or compatible).
- The package ships a **WebAssembly (WASM)** file used at runtime to demux MP4. You must **serve this WASM file** from your app so the browser can load it.
- Copy the WASM file from the package into your app’s static assets (e.g. a `public/wasm/` or `static/wasm/` folder). Use the **full** WASM build supplied by the package (often under a path like `dist/wasm-files/web-demuxer.wasm` or similar in the package). Do **not** use a “mini” or stripped build; the full build is required for demuxing and seeking to time 0.
- The demuxer must load the WASM via a **URL**. Pass an **absolute URL** (e.g. `window.location.origin + "/wasm/web-demuxer.wasm"`). If the library loads the WASM inside a Web Worker, relative paths can fail because the worker has no document base URL.
- Ensure the WASM file is served with `Content-Type: application/wasm` (or `application/octet-stream`). You can sanity-check by fetching the URL with `HEAD` and verifying the response is successful and the content type is acceptable.

**Range fetch**

- Watermarked videos are typically **faststart** MP4 (metadata at the start). Fetch only the beginning of the file with HTTP Range requests to avoid downloading the full video.
- Use a **stepped range** in case the first chunk is too small for the demuxer to parse (e.g. large `moov`/`stco`):
  - First try: `Range: bytes=0-{8*1024*1024 - 1}` (first 8 MB).
  - If demuxing fails (e.g. “corrupted STCO” or “reached eof”), try a larger range: e.g. first 16 MB.
- Request with `fetch(videoUrl, { mode: "cors", headers: { Range: "bytes=0-" + (byteCount - 1) } })`. Accept both `206 Partial Content` and `200 OK`; if you get `200`, the server may have ignored Range and returned the full file.
- Build an `ArrayBuffer` from the response body, then wrap in a `File` (e.g. `new File([buffer], "video.mp4", { type: "video/mp4" })`) for the demuxer.

**Demux and get frame 0**

1. Instantiate the demuxer with the **absolute WASM URL**: e.g. `new WebDemuxer({ wasmFilePath: wasmAbsoluteUrl })`.
2. Call `await demuxer.load(file)` with the `File` from the Range fetch.
3. Get the video decoder config: `await demuxer.getDecoderConfig("video")`. If missing, demux failed or the track is not video.
4. Seek to time 0: `await demuxer.seek("video", 0)`. This returns an `EncodedVideoChunk` (or equivalent) for the first frame. If this returns null, the range may be too small (try a larger Range).
5. Decode that single chunk with the browser’s **WebCodecs `VideoDecoder`**:
   - Create a `VideoDecoder` with an `output` callback that receives a `VideoFrame` and an `error` callback.
   - Call `decoder.configure(config)` with the config from step 3 (the config describes the codec so the decoder can decode the chunk).
   - Call `decoder.decode(chunk)` to decode the `EncodedVideoChunk`. The decoder will eventually call your `output` callback with one `VideoFrame`.
   - Call `decoder.flush()` and wait for it to resolve. Your `output` callback will be invoked with exactly one `VideoFrame` (frame 0). Wrap this in a Promise: resolve with that frame when `output` is called, or resolve with null if `flush()` completes without any output.
   - If the environment does not support `VideoDecoder`, `EncodedVideoChunk`, or `VideoFrame`, treat verification as unsupported (or fall back to canvas with a warning that it may fail).
6. When done, destroy the demuxer (e.g. `demuxer.destroy()`) and release the decoder.

**Extract Y plane from the VideoFrame (WebCodecs)**

- The `VideoFrame` from the decoder is typically in **I420** or **NV12** format. Both have a separate Y (luma) plane. Only handle these formats; if `frame.format` is something else, treat as failure or unsupported.
- Read dimensions: `width = frame.codedWidth`, `height = frame.codedHeight`.
- Allocate a buffer large enough for all planes: `const buffer = new Uint8Array(frame.allocationSize())`.
- Call `await frame.copyTo(buffer)`. This copies the frame’s pixel data into `buffer`. The return value is a **layout** object describing where each plane (Y, U, V) lives in `buffer`.
- The layout is either an array of plane descriptors or an object with a `layout` array. Each descriptor has `offset` (byte offset into `buffer`) and `stride` (bytes per row; may be ≥ width due to alignment). **Plane 0 is always the Y (luma) plane** in I420/NV12.
- Let `yOffset = layout[0].offset` (or `layout.layout[0].offset` depending on the API shape) and `yStride = layout[0].stride ?? width`.
- Copy the Y plane into a contiguous `Uint8Array` of length `width * height` (this is what the rest of the pipeline expects):
  - If `yStride === width`, one copy: `yPlane.set(buffer.subarray(yOffset, yOffset + width * height))`.
  - Otherwise, copy row by row: for each row `r` in `0 .. height-1`, copy `buffer[yOffset + r * yStride .. yOffset + r * yStride + width]` into `yPlane[r * width .. (r+1) * width]`.
- Call `frame.close()` to release the frame.
- **Crop to multiples of 16:**  
  `cropW = width - (width % 16)`, `cropH = height - (height % 16)`. Extract the top-left `cropW × cropH` region from `yPlane` into a new `Uint8Array` and use `(croppedLuma, cropW, cropH)` for the rest of the verification pipeline (§5.3 onward).

**End-to-end WebCodecs flow**

- **Feature check:** Ensure `typeof VideoDecoder !== "undefined"`, `typeof EncodedVideoChunk !== "undefined"`, and `typeof VideoFrame !== "undefined"`. If any are missing, WebCodecs is not available; treat frame 0 capture as unsupported (or use the canvas fallback with a warning).
- Optional: `HEAD` the WASM URL to confirm it is served with a valid content type.
- **Loop** over range sizes (e.g. [8 MB, 16 MB]):
  - Fetch range → build `File` → create demuxer with absolute WASM URL → `load(file)` → `getDecoderConfig("video")` → `seek("video", 0)` to get one `EncodedVideoChunk` → create `VideoDecoder`, configure, `decode(chunk)`, `flush()` → receive one `VideoFrame` in `output` → extract Y plane from the frame via `copyTo` and layout → crop to multiple of 16.
  - If any step returns null or throws, try the next range size.
  - On full success, return `{ yPlane, width, height }` in cropped dimensions for use in §5.3–5.7.
- This WebCodecs-based path is the **required** implementation; it produces the same Y-plane input as the encoder and is the only reliable way to pass verification.

---

#### 5.2.2 Canvas fallback (not recommended; use only if WebCodecs is unavailable)

If the browser does not support WebCodecs (`VideoDecoder` / `EncodedVideoChunk` / `VideoFrame`), you can attempt frame 0 capture via canvas. **This is not the required implementation.** The encoder uses codec Y; canvas gives you Y derived from RGB after the browser’s decode-and-render pipeline, which can differ (color space, gamma). Verification may fail or be unreliable. Use this only when WebCodecs is unavailable and treat verification failures as expected.

1. Load the video in a `<video>` with `crossOrigin="anonymous"`.
2. Seek to time 0 and wait for `loadeddata` and `seeked`.
3. Draw the frame to a canvas (same size as `video.videoWidth` × `video.videoHeight`), then `getImageData`.
4. Convert RGBA to **limited-range BT.709 luma** (Y in 16–235):  
   `Y = 16 + (219/255) * (0.2126*R + 0.7152*G + 0.0722*B)`, then clamp to [0, 255].
5. Crop to multiples of 16 as above.

You then work with **cropped luma** `(luma, width, height)` where `width` and `height` are the cropped dimensions. Prefer implementing and requiring WebCodecs so verification matches the encoder.

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
- [ ] Before playback: capture frame 0 Y using **WebCodecs** (WASM demuxer + `VideoDecoder` + `VideoFrame`; required—see §5.2.1), decode `numeric_user_id`, fetch `https://saivd.netlify.app/api/users/{numericUserId}/public-key`, verify frame 0 signature.
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

This guide is intended for use in **any repository**. It does not reference other documents or code paths. Implement the algorithm in §5 exactly: **frame 0 capture must use WebCodecs** (WASM demuxer + `VideoDecoder` + `VideoFrame`; see §5.2.1), then the same constants, patch matrix, right/left regions, user ID decode, and RSA verify so that verification succeeds when using SAIVD’s public key endpoint. The only external dependency is the SAIVD API at `https://saivd.netlify.app`.
