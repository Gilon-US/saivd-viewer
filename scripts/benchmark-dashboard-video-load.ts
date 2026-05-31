/**
 * Dashboard + public video load timings (network/API layer; excludes WASM decode).
 * Usage:
 *   set -a && . ./.env.local && . ./.env && set +a && npx tsx scripts/benchmark-dashboard-video-load.ts
 *
 * Optional: BENCHMARK_VIDEO_IDS=id1,id2,id3  APP_URL=http://localhost:3001
 */
import {GetObjectCommand, S3Client} from "@aws-sdk/client-s3";
import {getSignedUrl} from "@aws-sdk/s3-request-presigner";
import {createClient} from "@supabase/supabase-js";
import {resolveWatermarkedStorageKey} from "../src/lib/video-playback-url";

function ms(start: number, end: number) {
  return Math.round(end - start);
}

async function timeFetch(
  url: string,
  init: RequestInit & {label?: string} = {},
): Promise<{ms: number; status: number; bytes: number; ok: boolean; redirectUrl?: string}> {
  const t0 = performance.now();
  const res = await fetch(url, {
    cache: "no-store",
    redirect: init.redirect ?? "follow",
    ...init,
    headers: {
      "Cache-Control": "no-cache",
      ...(init.headers ?? {}),
    },
  });
  const buf = Buffer.from(await res.arrayBuffer());
  return {
    ms: ms(t0, performance.now()),
    status: res.status,
    bytes: buf.length,
    ok: res.ok,
    redirectUrl: res.url !== url ? res.url : undefined,
  };
}

async function timeRangeFetch(url: string, byteCount: number) {
  const end = Math.max(0, byteCount - 1);
  const t0 = performance.now();
  const res = await fetch(url, {
    cache: "no-store",
    headers: {Range: `bytes=0-${end}`, "Cache-Control": "no-cache"},
  });
  const buf = Buffer.from(await res.arrayBuffer());
  return {ms: ms(t0, performance.now()), status: res.status, bytes: buf.length, ok: res.ok};
}

async function resolveVideoIds(
  videoIdsFromEnv: string[] | undefined,
  supabaseUrl: string,
  serviceKey: string,
): Promise<string[]> {
  if (videoIdsFromEnv?.length) return videoIdsFromEnv.slice(0, 5);

  const supabase = createClient(supabaseUrl, serviceKey);
  const {data} = await supabase
    .from("videos")
    .select("id")
    .not("original_url", "is", null)
    .order("upload_date", {ascending: false})
    .limit(3);

  return (data ?? []).map((v: {id: string}) => v.id);
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.WASABI_BUCKET_NAME;
  const region = process.env.WASABI_REGION ?? "us-east-1";
  const endpoint = process.env.WASABI_ENDPOINT;
  const appUrl = (process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001").replace(
    /\/$/,
    "",
  );

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
    const t0 = performance.now();
    const url = await getSignedUrl(s3, new GetObjectCommand({Bucket: bucket, Key: key}), {expiresIn: 3600});
    return {url, ms: ms(t0, performance.now())};
  }

  const videoIdsFromEnv = process.env.BENCHMARK_VIDEO_IDS?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const videoIds = await resolveVideoIds(videoIdsFromEnv, supabaseUrl, serviceKey);
  if (!videoIds.length) {
    throw new Error("No video IDs found. Set BENCHMARK_VIDEO_IDS or seed videos in Supabase.");
  }

  const rows: Record<string, unknown>[] = [];

  for (const id of videoIds) {
    const tDb0 = performance.now();
    const {data: video, error} = await supabase
      .from("videos")
      .select("id, filename, original_url, processed_url")
      .eq("id", id)
      .maybeSingle();
    const dbLookupMs = ms(tDb0, performance.now());

    if (error || !video) {
      rows.push({id, error: error?.message ?? "not found", dbLookupMs});
      continue;
    }

    const key = resolveWatermarkedStorageKey(video);
    if (!key) {
      rows.push({id, filename: video.filename, error: "no storage key", dbLookupMs});
      continue;
    }

    const listPresign = await presign(key);
    const playJsonPresign = await presign(key);

    const wasabiFullCold = await timeFetch(listPresign.url);
    const wasabiFullWarmSameUrl = await timeFetch(listPresign.url);

    const moovRange8Mb = await timeRangeFetch(listPresign.url, 8 * 1024 * 1024);
    const moovRange8MbRepeat = await timeRangeFetch(listPresign.url, 8 * 1024 * 1024);

    let publicPlayJsonMs: number | null = null;
    let publicPlayJsonNote: string | null = null;
    try {
      const tPlay0 = performance.now();
      const playRes = await fetch(`${appUrl}/api/public/videos/${id}/play?variant=watermarked`, {
        cache: "no-store",
      });
      await playRes.json();
      publicPlayJsonMs = ms(tPlay0, performance.now());
      publicPlayJsonNote = `status ${playRes.status}`;
    } catch (e) {
      publicPlayJsonNote = e instanceof Error ? e.message : "fetch failed";
    }

    let publicPagePrefetchMs: number | null = null;
    try {
      const tPage0 = performance.now();
      const pageRes = await fetch(`${appUrl}/v/${id}`, {cache: "no-store", headers: {Accept: "text/html"}});
      await pageRes.text();
      publicPagePrefetchMs = ms(tPage0, performance.now());
    } catch (e) {
      publicPagePrefetchMs = null;
    }

    const estimatedOldDashboardOpenMs = playJsonPresign.ms + wasabiFullCold.ms + 400;
    const estimatedNewDashboardOpenMs = listPresign.ms + wasabiFullCold.ms;
    const estimatedNewDashboardWarmMs = wasabiFullWarmSameUrl.ms;
    const estimatedPublicMoovPhaseMs = moovRange8Mb.ms;

    rows.push({
      id,
      filename: video.filename,
      bytesDownloadedFull: wasabiFullCold.bytes,
      dbLookupMs,
      listPresignMs: listPresign.ms,
      playJsonPresignMs: playJsonPresign.ms,
      samePresignUrl: listPresign.url === playJsonPresign.url,
      wasabiFullDownloadColdMs: wasabiFullCold.ms,
      wasabiFullDownloadWarmSameUrlMs: wasabiFullWarmSameUrl.ms,
      moovRange8MbColdMs: moovRange8Mb.ms,
      moovRange8MbRepeatMs: moovRange8MbRepeat.ms,
      publicPlayJsonMs,
      publicPlayJsonNote,
      publicPageHtmlMs: publicPagePrefetchMs,
      scenarios: {
        oldDashboard: {
          label: "JSON /play presign + full Wasabi download (+ ~400ms dev API)",
          estimatedMs: estimatedOldDashboardOpenMs,
        },
        newDashboard: {
          label: "List presign + full Wasabi (first open)",
          estimatedMs: estimatedNewDashboardOpenMs,
        },
        newDashboardWarm: {
          label: "playback_url cache hit (same presigned URL, repeat fetch)",
          estimatedMs: estimatedNewDashboardWarmMs,
        },
        publicMoovPhase: {
          label: "Range 0–8MB (verification container phase, not WASM)",
          estimatedMs: estimatedPublicMoovPhaseMs,
        },
        publicPage: {
          label: "GET /v/[id] HTML (SSR presign + shell in response)",
          estimatedMs: publicPagePrefetchMs,
        },
      },
    });
  }

  const valid = rows.filter((r) => r.scenarios);
  const avg = (path: string) =>
    valid.length
      ? Math.round(
          valid.reduce((s, r) => s + ((r.scenarios as Record<string, {estimatedMs: number}>)[path]?.estimatedMs ?? 0), 0) /
            valid.length,
        )
      : null;

  console.log(
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        appUrl,
        videoIds,
        note: "Wasm/ffmpeg frame-0 decode not measured here. moovRange8Mb approximates container read before decode.",
        rows,
        summary: {
          videoCount: valid.length,
          avgListPresignMs: valid.length
            ? Math.round(valid.reduce((s, r) => s + (r.listPresignMs as number), 0) / valid.length)
            : null,
          avgWasabiFullColdMs: valid.length
            ? Math.round(valid.reduce((s, r) => s + (r.wasabiFullDownloadColdMs as number), 0) / valid.length)
            : null,
          avgOldDashboardEstimatedMs: avg("oldDashboard"),
          avgNewDashboardEstimatedMs: avg("newDashboard"),
          avgNewDashboardWarmMs: avg("newDashboardWarm"),
          avgMoovRange8MbMs: avg("publicMoovPhase"),
          avgPublicPageHtmlMs: avg("publicPage"),
          avgPublicPlayJsonMs: valid.length
            ? Math.round(
                valid.reduce((s, r) => s + ((r.publicPlayJsonMs as number | null) ?? 0), 0) / valid.length,
              )
            : null,
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
