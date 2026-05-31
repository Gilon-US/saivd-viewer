/**
 * Comparative dashboard image load: redirect path vs previewUrl cache reuse.
 * Usage: set -a && . ./.env.local && . ./.env && set +a && npx tsx scripts/benchmark-dashboard-image-comparison.ts
 */
import {GetObjectCommand, S3Client} from "@aws-sdk/client-s3";
import {getSignedUrl} from "@aws-sdk/s3-request-presigner";
import {createClient} from "@supabase/supabase-js";

const IMAGE_IDS = [
  "58261ea3-8f7c-40e8-957d-f43775590eaa",
  "f684cef2-0bcd-402e-902f-e58b69dc37b1",
  "0da2f4a5-68da-4b37-a7ab-fa517c38b202",
];

const DEV_VIEW_REDIRECT_MS = 372;

function ms(a: number, b: number) {
  return Math.round(b - a);
}

function storageKey(image: {original_url: string | null; processed_url: string | null}) {
  const ref = image.processed_url || image.original_url;
  if (!ref) return null;
  if (ref.startsWith("http")) {
    try {
      return new URL(ref).pathname.replace(/^\//, "");
    } catch {
      return null;
    }
  }
  return ref;
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.WASABI_BUCKET_NAME;
  const region = process.env.WASABI_REGION ?? "us-east-1";
  const endpoint = process.env.WASABI_ENDPOINT;

  if (!supabaseUrl || !serviceKey || !bucket || !endpoint) {
    throw new Error("Missing env");
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const s3 = new S3Client({
    region,
    endpoint,
    credentials: {
      accessKeyId: process.env.WASABI_ACCESS_KEY_ID!,
      secretAccessKey: process.env.WASABI_SECRET_ACCESS_KEY!,
    },
  });

  async function presign(key: string) {
    return getSignedUrl(s3, new GetObjectCommand({Bucket: bucket, Key: key}), {expiresIn: 3600});
  }

  async function downloadMs(url: string, mode: RequestInit = {}) {
    const t0 = performance.now();
    const res = await fetch(url, {
      cache: "default",
      ...mode,
      headers: {
        "Cache-Control": "no-cache",
        ...(mode.headers ?? {}),
      },
    });
    const buf = Buffer.from(await res.arrayBuffer());
    return {ms: ms(t0, performance.now()), bytes: buf.length, ok: res.ok, status: res.status};
  }

  const comparisons: Record<string, unknown>[] = [];

  for (const id of IMAGE_IDS) {
    const {data: image} = await supabase
      .from("images")
      .select("id, filename, original_url, processed_url, file_size")
      .eq("id", id)
      .maybeSingle();

    if (!image) {
      comparisons.push({id, error: "not found"});
      continue;
    }

    const key = storageKey(image);
    if (!key) {
      comparisons.push({id, filename: image.filename, error: "no key"});
      continue;
    }

    const gridPresignMs = ms(0, 0);
    const t0 = performance.now();
    const gridUrl = await presign(key);
    const listPresignMs = ms(t0, performance.now());

    const tView = performance.now();
    const lightboxViaViewUrl = await presign(key);
    const viewPresignMs = ms(tView, performance.now());

    const thumbnailCold = await downloadMs(gridUrl, {mode: "cors", credentials: "omit"});

    const thumbnailWarmSameUrl = await downloadMs(gridUrl, {mode: "cors", credentials: "omit"});

    const lightboxNewPresignCold = await downloadMs(lightboxViaViewUrl, {
      mode: "cors",
      credentials: "omit",
    });

    const tBuf = performance.now();
    const obj = await s3.send(new GetObjectCommand({Bucket: bucket, Key: key}));
    await obj.Body!.transformToByteArray();
    const oldProxyBufferMs = ms(tBuf, performance.now());

    comparisons.push({
      id,
      filename: image.filename,
      fileSizeDb: image.file_size,
      bytes: thumbnailCold.bytes,
      presign: {listApiMs: listPresignMs, viewRouteMs: viewPresignMs, sameUrl: gridUrl === lightboxViaViewUrl},
      before: {
        label: "Old buffered /view proxy + Wasabi to client",
        estimatedMs: oldProxyBufferMs + thumbnailCold.ms,
        serverBufferMs: oldProxyBufferMs,
        wasabiToClientMs: thumbnailCold.ms,
      },
      middle: {
        label: "Redirect /view (~372ms dev) + new presign Wasabi (lightbox ignored previewUrl)",
        estimatedMs: DEV_VIEW_REDIRECT_MS + viewPresignMs + lightboxNewPresignCold.ms,
        viewRedirectMs: DEV_VIEW_REDIRECT_MS,
        wasabiMs: lightboxNewPresignCold.ms,
        note: "Different presigned URL than grid → cache miss",
      },
      after: {
        label: "previewUrl + crossOrigin grid (same URL, warm cache)",
        thumbnailColdMs: thumbnailCold.ms,
        lightboxWarmSameUrlMs: thumbnailWarmSameUrl.ms,
        estimatedLightboxOpenMs: thumbnailWarmSameUrl.ms,
        savingsVsMiddleMs:
          DEV_VIEW_REDIRECT_MS + viewPresignMs + lightboxNewPresignCold.ms - thumbnailWarmSameUrl.ms,
      },
    });
  }

  const valid = comparisons.filter((c) => c.after);
  const avg = (fn: (c: Record<string, unknown>) => number) =>
    Math.round(valid.reduce((s, c) => s + fn(c), 0) / valid.length);

  console.log(
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        devViewRedirectMsAssumption: DEV_VIEW_REDIRECT_MS,
        images: comparisons,
        summary: {
          avgBeforeMs: avg((c) => (c.before as {estimatedMs: number}).estimatedMs),
          avgMiddleMs: avg((c) => (c.middle as {estimatedMs: number}).estimatedMs),
          avgAfterWarmLightboxMs: avg((c) => (c.after as {estimatedLightboxOpenMs: number}).estimatedLightboxOpenMs),
          avgSavingsAfterVsMiddleMs: avg((c) => (c.after as {savingsVsMiddleMs: number}).savingsVsMiddleMs),
        },
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
