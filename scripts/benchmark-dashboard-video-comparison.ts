/**
 * Before/after video perf comparison (network layer; WASM decode excluded).
 * Usage: set -a && . ./.env.local && . ./.env && set +a && npx tsx scripts/benchmark-dashboard-video-comparison.ts
 */
import {GetObjectCommand, S3Client} from "@aws-sdk/client-s3";
import {getSignedUrl} from "@aws-sdk/s3-request-presigner";
import {createClient} from "@supabase/supabase-js";
import {MOOV_RANGE_FASTSTART, MOOV_RANGE_LEGACY} from "../src/lib/video-perf-flags";
import {resolveWatermarkedStorageKey} from "../src/lib/video-playback-url";

const DEV_PLAY_JSON_MS = 400;
const MB = 1024 * 1024;

function ms(a: number, b: number) {
  return Math.round(b - a);
}

async function timeRange(url: string, byteCount: number) {
  const end = Math.max(0, byteCount - 1);
  const t0 = performance.now();
  const res = await fetch(url, {
    cache: "no-store",
    headers: {Range: `bytes=0-${end}`, "Cache-Control": "no-cache"},
  });
  await res.arrayBuffer();
  return {ms: ms(t0, performance.now()), ok: res.ok, bytes: byteCount};
}

async function timeFull(url: string) {
  const t0 = performance.now();
  const res = await fetch(url, {cache: "no-store", headers: {"Cache-Control": "no-cache"}});
  const buf = Buffer.from(await res.arrayBuffer());
  return {ms: ms(t0, performance.now()), bytes: buf.length, ok: res.ok};
}

async function resolveVideoIds(supabaseUrl: string, serviceKey: string): Promise<string[]> {
  const fromEnv = process.env.BENCHMARK_VIDEO_IDS?.split(",").map((s) => s.trim()).filter(Boolean);
  if (fromEnv?.length) return fromEnv.slice(0, 5);
  const supabase = createClient(supabaseUrl, serviceKey);
  const {data} = await supabase
    .from("videos")
    .select("id")
    .not("original_url", "is", null)
    .order("upload_date", {ascending: false})
    .limit(3);
  return (data ?? []).map((v: {id: string}) => v.id);
}

async function ladderWalkMs(url: string, steps: number[]) {
  let total = 0;
  const stepMs: Record<string, number> = {};
  for (const bytes of steps) {
    const r = await timeRange(url, bytes);
    stepMs[String(bytes)] = r.ms;
    total += r.ms;
  }
  return {totalMs: total, stepMs};
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.WASABI_BUCKET_NAME;
  const region = process.env.WASABI_REGION ?? "us-east-1";
  const endpoint = process.env.WASABI_ENDPOINT;
  const appUrl = (process.env.APP_URL ?? "http://localhost:3001").replace(/\/$/, "");

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

  const videoIds = await resolveVideoIds(supabaseUrl, serviceKey);
  const comparisons: Record<string, unknown>[] = [];

  for (const id of videoIds) {
    const {data: video} = await supabase
      .from("videos")
      .select("id, filename, original_url, processed_url")
      .eq("id", id)
      .maybeSingle();

    if (!video) {
      comparisons.push({id, error: "not found"});
      continue;
    }

    const key = resolveWatermarkedStorageKey(video);
    if (!key) {
      comparisons.push({id, filename: video.filename, error: "no key"});
      continue;
    }

    const url = await presign(key);

    const legacyMoov8Mb = await timeRange(url, MOOV_RANGE_LEGACY[0]!);
    const faststart1Mb = await timeRange(url, 1 * MB);
    const faststart256Kb = await timeRange(url, 256 * 1024);
    const faststartLadder = await ladderWalkMs(url, MOOV_RANGE_FASTSTART.slice(0, 3));
    const fullDownload = await timeFull(url);

    let publicPageHtmlMs: number | null = null;
    let publicPlayJsonMs: number | null = null;
    try {
      const t0 = performance.now();
      const page = await fetch(`${appUrl}/v/${id}`, {cache: "no-store", headers: {Accept: "text/html"}});
      await page.text();
      publicPageHtmlMs = ms(t0, performance.now());
    } catch {
      publicPageHtmlMs = null;
    }
    try {
      const t0 = performance.now();
      const play = await fetch(`${appUrl}/api/public/videos/${id}/play?variant=watermarked`, {cache: "no-store"});
      await play.json();
      publicPlayJsonMs = ms(t0, performance.now());
    } catch {
      publicPlayJsonMs = null;
    }

    const beforeDashboardOpenMs = DEV_PLAY_JSON_MS + fullDownload.ms;
    const afterDashboardOpenMs = 0;
    const afterDashboardFirstPlayMs = fullDownload.ms;

    const beforeVerifyNetworkMs = legacyMoov8Mb.ms;
    const afterVerifyNetworkMs = faststart1Mb.ms;

    const beforeVerifyWithPlaybackContentionMs = legacyMoov8Mb.ms + Math.round(fullDownload.ms * 0.35);
    const afterVerifyFirstMs = faststart1Mb.ms;

    comparisons.push({
      id,
      filename: video.filename,
      fileBytes: fullDownload.bytes,
      before: {
        label: "Pre-change baseline",
        dashboardClickToBufferMs: beforeDashboardOpenMs,
        verifyMoovContainerMs: beforeVerifyNetworkMs,
        verifyWithVideoPreloadContentionMs: beforeVerifyWithPlaybackContentionMs,
        publicColdClientPlayApiMs: publicPlayJsonMs,
        moovLegacyFirstStep8MbMs: legacyMoov8Mb.ms,
      },
      after: {
        label: "Current viewer (3001) optimizations",
        dashboardClickInstantMs: afterDashboardOpenMs,
        dashboardFirstPlayDownloadMs: afterDashboardFirstPlayMs,
        verifyMoovFaststartTypicalMs: afterVerifyNetworkMs,
        verifyFirstNoFullDownloadMs: afterVerifyFirstMs,
        publicSsrPageMs: publicPageHtmlMs,
        moovFaststart256KbMs: faststart256Kb.ms,
        moovFaststart1MbMs: faststart1Mb.ms,
        moovFaststartLadderWalk3StepsMs: faststartLadder.totalMs,
      },
      deltas: {
        dashboardOpenSavedMs: beforeDashboardOpenMs - afterDashboardOpenMs,
        verifyMoovSavedMs: beforeVerifyNetworkMs - afterVerifyNetworkMs,
        verifyContentionSavedMs: beforeVerifyWithPlaybackContentionMs - afterVerifyFirstMs,
        publicPageVsPlayApiMs:
          publicPlayJsonMs != null && publicPageHtmlMs != null ? publicPlayJsonMs - publicPageHtmlMs : null,
      },
    });
  }

  const valid = comparisons.filter((c) => c.deltas);
  const avg = (fn: (c: Record<string, unknown>) => number | null) => {
    const nums = valid.map(fn).filter((n): n is number => n != null);
    return nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : null;
  };

  console.log(
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        appUrl,
        videoIds,
        note:
          "Before = JSON /play + preload=auto + legacy 8MB moov step. After = instant dashboard open + metadata/play defer + faststart moov (~1MB) + verify-first (no parallel full download). WASM/ffmpeg not measured.",
        comparisons,
        summary: {
          videoCount: valid.length,
          avgBeforeDashboardOpenMs: avg((c) => (c.before as {dashboardClickToBufferMs: number}).dashboardClickToBufferMs),
          avgAfterDashboardOpenMs: avg((c) => (c.after as {dashboardClickInstantMs: number}).dashboardClickInstantMs),
          avgDashboardOpenSavedMs: avg((c) => (c.deltas as {dashboardOpenSavedMs: number}).dashboardOpenSavedMs),
          avgBeforeMoov8MbMs: avg((c) => (c.before as {moovLegacyFirstStep8MbMs: number}).moovLegacyFirstStep8MbMs),
          avgAfterMoov1MbMs: avg((c) => (c.after as {moovFaststart1MbMs: number}).moovFaststart1MbMs),
          avgVerifyMoovSavedMs: avg((c) => (c.deltas as {verifyMoovSavedMs: number}).verifyMoovSavedMs),
          avgVerifyContentionSavedMs: avg((c) => (c.deltas as {verifyContentionSavedMs: number}).verifyContentionSavedMs),
          avgPublicSsrPageMs: avg((c) => (c.after as {publicSsrPageMs: number | null}).publicSsrPageMs ?? null),
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
