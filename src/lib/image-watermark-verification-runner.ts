import {
  decodeBitmapFromBlob,
  decodeBitmapFromImg,
  type BitmapDecodeVariant,
} from "@/lib/image-bitmap-decode";
import {getVerifyMode} from "@/lib/image-verify-mode";
import {flushBeacon, mark, type VerifyPathLabel} from "@/lib/perf/verify-marks";
import {
  verifyImageWatermark,
  type ImageVerificationResult,
} from "@/lib/image-watermark-verification";

export type ImageVerificationRunnerArgs = {
  imageId: string;
  img: HTMLImageElement | null;
  viewUrl: string;
  fetchCredentials: RequestCredentials;
  signal?: AbortSignal;
  /** Default strict avoids Safari/iOS color-management mutating B-channel bytes. */
  decodeVariant?: BitmapDecodeVariant;
};

export type ImageVerificationRunnerResult = ImageVerificationResult & {path: VerifyPathLabel};

async function runBlobPath(
  args: ImageVerificationRunnerArgs,
): Promise<ImageVerificationRunnerResult> {
  mark(args.imageId, "fetch_start");
  const res = await fetch(args.viewUrl, {
    credentials: args.fetchCredentials,
    signal: args.signal,
  });
  mark(args.imageId, "fetch_end");
  if (!res.ok) {
    return {
      ok: false,
      reason: "fetch_failed",
      detail: `image_fetch_failed: ${res.status}`,
      path: "blob",
    };
  }
  const blob = await res.blob();
  const variant = args.decodeVariant ?? "strict";
  const bmp = await decodeBitmapFromBlob(blob, variant);
  mark(args.imageId, "bitmap_ready");
  try {
    const result = await verifyImageWatermark(bmp);
    mark(args.imageId, "verify_end");
    flushBeacon(args.imageId, {path: "blob", outcome: result.ok ? "ok" : result.reason});
    return {...result, path: "blob"};
  } finally {
    bmp.close();
  }
}

async function runImgPath(
  args: ImageVerificationRunnerArgs,
): Promise<ImageVerificationRunnerResult | null> {
  if (!args.img) return null;
  mark(args.imageId, "img_visible");
  const variant = args.decodeVariant ?? "strict";
  const bmp = await decodeBitmapFromImg(args.img, variant);
  mark(args.imageId, "bitmap_ready");
  try {
    const result = await verifyImageWatermark(bmp);
    mark(args.imageId, "verify_end");
    return {...result, path: "img"};
  } finally {
    bmp.close();
  }
}

async function runImgWithFallback(
  args: ImageVerificationRunnerArgs,
): Promise<ImageVerificationRunnerResult> {
  let imgResult: ImageVerificationRunnerResult | null = null;
  try {
    imgResult = await runImgPath(args);
    if (imgResult?.ok) {
      flushBeacon(args.imageId, {path: "img", outcome: "ok"});
      return imgResult;
    }
  } catch (e) {
    flushBeacon(args.imageId, {path: "img", outcome: "threw", error: String(e)});
  }

  try {
    const blobResult = await runBlobPath(args);
    flushBeacon(args.imageId, {
      path: imgResult ? "img_then_blob" : "blob",
      outcome: blobResult.ok ? "ok" : blobResult.ok === false ? blobResult.reason : "fail",
      imgPathReason: imgResult && !imgResult.ok ? imgResult.reason : null,
    });
    return {...blobResult, path: imgResult ? "img_then_blob" : "blob"};
  } catch (e) {
    return {
      ok: false,
      reason: "malformed",
      detail: e instanceof Error ? e.message : String(e),
      path: "blob",
    };
  }
}

async function runShadowMode(
  args: ImageVerificationRunnerArgs,
): Promise<ImageVerificationRunnerResult> {
  const [imgSettled, blobSettled] = await Promise.allSettled([
    runImgPath(args),
    runBlobPath(args),
  ]);

  const imgResult = imgSettled.status === "fulfilled" ? imgSettled.value : null;
  const blobResult = blobSettled.status === "fulfilled" ? blobSettled.value : null;

  const imgOk = imgResult?.ok === true;
  const blobOk = blobResult?.ok === true;

  if (imgOk !== blobOk) {
    flushBeacon(args.imageId, {
      event: "shadow_disagreement",
      imgOutcome:
        imgResult ??
        (imgSettled.status === "rejected" ? `threw:${String(imgSettled.reason)}` : "null"),
      blobOutcome:
        blobResult ??
        (blobSettled.status === "rejected" ? `threw:${String(blobSettled.reason)}` : "null"),
      path: "shadow",
    });
  } else {
    flushBeacon(args.imageId, {path: "shadow", outcome: blobOk ? "ok" : "fail", agreed: true});
  }

  if (blobResult) return {...blobResult, path: "shadow"};
  if (imgSettled.status === "rejected") {
    throw imgSettled.reason;
  }
  return {
    ok: false,
    reason: "malformed",
    detail: "shadow_mode_blob_path_failed",
    path: "shadow",
  };
}

/** Single entry for image watermark verification with mode flag and img/blob fallback. */
export async function verifyImageWatermarkRunner(
  args: ImageVerificationRunnerArgs,
): Promise<ImageVerificationRunnerResult> {
  const mode = getVerifyMode();
  if (mode === "blob") {
    return runBlobPath(args);
  }
  if (mode === "shadow") {
    return runShadowMode(args);
  }
  return runImgWithFallback(args);
}
