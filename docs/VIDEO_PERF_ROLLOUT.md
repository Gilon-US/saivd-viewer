# Video performance rollout (large files)

Rollback is **env-only** — no code revert required for emergency disable.

## Master switch

| Variable | Values | Default | Rollback |
|----------|--------|---------|----------|
| `NEXT_PUBLIC_VIDEO_PERF` | `legacy`, `optimized` | **`legacy`** | Set `legacy` and redeploy |

When `legacy`, all optimizations below are **off** regardless of sub-flags.

## Sub-flags (only when `optimized`)

| Variable | Values | Default | Effect |
|----------|--------|---------|--------|
| `NEXT_PUBLIC_VIDEO_VERIFY_FIRST` | `1`, `0` | off | Defer full `<video>` download until verified (large assets) |
| `NEXT_PUBLIC_VIDEO_MOOV_LADDER` | `faststart`, `legacy` | `legacy` | Smaller Range steps for moov parse |
| `NEXT_PUBLIC_VIDEO_DASHBOARD_PRELOAD` | `metadata`, `auto` | `auto` | Dashboard: no full download until Play |
| `NEXT_PUBLIC_VIDEO_PREWARM` | `1`, `0` | off | Prewarm WASM session on hover / public route |
| `NEXT_PUBLIC_VIDEO_PARALLEL_KEY` | `1`, `0` | off | Start public-key fetch after first frame candidate |
| `NEXT_PUBLIC_VIDEO_SSR_SHELL` | `1`, `0` | on (`0` disables SSR shell) | Server `<video>` + preload on `/v/*` |
| `NEXT_PUBLIC_VIDEO_TELEMETRY_SAMPLE` | `0.0`–`1.0` | `0` | Sampled video verify beacons |
| `NEXT_PUBLIC_VIDEO_LARGE_BYTES` | integer | `52428800` (50 MB) | Threshold for large-file behaviors |
| `NEXT_PUBLIC_VIDEO_UNKNOWN_AS_LARGE` | `1`, `0` | `1` | Apply large-file path when size unknown |

## Staged production enablement

1. **Deploy code** with `NEXT_PUBLIC_VIDEO_PERF=legacy` (safe baseline).
2. **Stage 1:** `optimized` + `MOOV_LADDER=faststart` + keep `SSR_SHELL=1`.
3. **Stage 2:** + `PREWARM=1` + `PARALLEL_KEY=1`.
4. **Stage 3:** + `VERIFY_FIRST=1` + `DASHBOARD_PRELOAD=metadata` (large threshold applies).
5. Monitor `/api/internal/verify-telemetry` logs (`kind: video`) and verify failure rate.

## Emergency rollback

```bash
NEXT_PUBLIC_VIDEO_PERF=legacy
```

Redeploy. Optional git tag before enable: `video-perf-pre-rollout`.

## Local full-plan test

```bash
NEXT_PUBLIC_VIDEO_PERF=optimized \
NEXT_PUBLIC_VIDEO_VERIFY_FIRST=1 \
NEXT_PUBLIC_VIDEO_MOOV_LADDER=faststart \
NEXT_PUBLIC_VIDEO_DASHBOARD_PRELOAD=metadata \
NEXT_PUBLIC_VIDEO_PREWARM=1 \
NEXT_PUBLIC_VIDEO_PARALLEL_KEY=1 \
NEXT_PUBLIC_VIDEO_TELEMETRY_SAMPLE=1 \
PORT=3001 npm run dev
```

Benchmark: `npx tsx scripts/benchmark-dashboard-video-load.ts`
