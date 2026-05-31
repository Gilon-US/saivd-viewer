# Image verification rollout (single-pass)

Environment variables for `saivd-viewer`:

| Variable | Values | Default |
|----------|--------|---------|
| `NEXT_PUBLIC_VERIFY_MODE` | `blob`, `shadow`, `img` | `blob` |
| `NEXT_PUBLIC_VERIFY_TELEMETRY_SAMPLE` | `0.0`–`1.0` | `1.0` in dev |
| `VERIFY_TELEMETRY_SECRET` | optional server secret | unset |

## Rollout

1. **Deploy with `blob`** (default) — runner wired, behavior unchanged.
2. Collect baseline via `/api/internal/verify-telemetry` logs.
3. Add watermarked PNG fixtures under `src/lib/__tests__/fixtures/`; run `/test/verify-parity`.
4. **`shadow`** for 14 days — monitor `shadow_disagreement` beacons.
5. **`img`** when disagreement rate &lt; 1/100k.

Dev parity page: `/test/verify-parity` (404 in production).

## Image preload (cold first paint)

Public `/i/[id]` and `/embed/i/[id]` call `preload(viewUrl, { as: "image", crossOrigin: "anonymous" })` during SSR so the Wasabi PNG download starts before client hydration. The `<img>` uses matching `crossOrigin="anonymous"` and `fetchPriority="high"`.
