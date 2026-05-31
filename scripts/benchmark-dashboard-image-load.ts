/**
 * Baseline dashboard image load timings (current setup).
 * Usage: npx tsx scripts/benchmark-dashboard-image-load.ts
 */
import {GetObjectCommand, S3Client} from "@aws-sdk/client-s3";
import {getSignedUrl} from "@aws-sdk/s3-request-presigner";
import {createClient} from "@supabase/supabase-js";

const IMAGE_IDS = [
  "58261ea3-8f7c-40e8-957d-f43775590eaa",
  "f684cef2-0bcd-402e-902f-e58b69dc37b1",
  "0da2f4a5-68da-4b37-a7ab-fa517c38b202",
];

function ms(start: number, end: number) {
  return Math.round(end - start);
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
    throw new Error("Missing env: SUPABASE, WASABI_BUCKET_NAME, WASABI_ENDPOINT");
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
    const command = new GetObjectCommand({Bucket: bucket, Key: key});
    return getSignedUrl(s3, command, {expiresIn: 3600});
  }

  async function timeDownload(url: string) {
    const t0 = performance.now();
    const res = await fetch(url, {cache: "no-store", headers: {"Cache-Control": "no-cache"}});
    const buf = Buffer.from(await res.arrayBuffer());
    return {ok: res.ok, status: res.status, bytes: buf.length, ms: ms(t0, performance.now())};
  }

  const rows: Record<string, unknown>[] = [];

  for (const id of IMAGE_IDS) {
    const tDb0 = performance.now();
    const {data: image, error} = await supabase
      .from("images")
      .select("id, filename, original_url, processed_url, file_size")
      .eq("id", id)
      .maybeSingle();
    const dbLookupMs = ms(tDb0, performance.now());

    if (error || !image) {
      rows.push({id, error: error?.message ?? "not found", dbLookupMs});
      continue;
    }

    const key = storageKey(image);
    if (!key) {
      rows.push({id, filename: image.filename, error: "no storage key", dbLookupMs});
      continue;
    }

    const tPresign0 = performance.now();
    const presignedA = await presign(key);
    const listPresignMs = ms(tPresign0, performance.now());

    const tView0 = performance.now();
    const presignedB = await presign(key);
    const viewRedirectMs = ms(tView0, performance.now());

    const tBuf0 = performance.now();
    const obj = await s3.send(new GetObjectCommand({Bucket: bucket, Key: key}));
    const bytes = Buffer.from(await (obj.Body as {transformToByteArray(): Promise<Uint8Array>}).transformToByteArray());
    const oldProxyBufferMs = ms(tBuf0, performance.now());

    const wasabiDirect = await timeDownload(presignedA);
    const wasabiDirectRepeat = await timeDownload(presignedB);

    rows.push({
      id,
      filename: image.filename,
      fileSizeDb: image.file_size,
      bytesOnDisk: bytes.length,
      dbLookupMs,
      listPresignMs,
      viewRedirectMs,
      oldProxyBufferMs,
      wasabiDirectMs: wasabiDirect.ms,
      wasabiDirectRepeatMs: wasabiDirectRepeat.ms,
      thumbnailVsLightboxSamePresignUrl: presignedA === presignedB,
      estimatedCurrentLightboxMs: viewRedirectMs + wasabiDirect.ms,
      estimatedOldBufferedProxyMs: oldProxyBufferMs + wasabiDirect.ms,
      devServerLogs307Ms: "see terminal (~370-1080ms incl auth+compile)",
    });
  }

  const nums = rows.filter((r) => r.estimatedCurrentLightboxMs);
  const num = (r: Record<string, unknown>, key: string) => r[key] as number;
  const summary = {
    imageCount: nums.length,
    avgViewRedirectMs: Math.round(nums.reduce((s, r) => s + num(r, "viewRedirectMs"), 0) / nums.length),
    avgOldProxyBufferMs: Math.round(nums.reduce((s, r) => s + num(r, "oldProxyBufferMs"), 0) / nums.length),
    avgWasabiDownloadMs: Math.round(nums.reduce((s, r) => s + num(r, "wasabiDirectMs"), 0) / nums.length),
    avgEstimatedCurrentLightboxMs: Math.round(
      nums.reduce((s, r) => s + num(r, "estimatedCurrentLightboxMs"), 0) / nums.length,
    ),
    avgEstimatedOldBufferedProxyMs: Math.round(
      nums.reduce((s, r) => s + num(r, "estimatedOldBufferedProxyMs"), 0) / nums.length,
    ),
  };

  console.log(
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        setup:
          "Dashboard lightbox: img src=/api/images/{id}/view (307 redirect); previewUrl from grid NOT used; thumbnail without crossOrigin",
        afterChangeNote:
          "Post-fix: lightbox uses previewUrl + crossOrigin grid; warm open ~verify-only if same URL cached",
        note: "estimatedCurrentLightboxMs = viewRedirectMs + wasabiDirectMs (sequential, cold cache)",
        rows,
        summary,
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
