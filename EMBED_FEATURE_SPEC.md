# SAIVD Embed Feature — Cursor Build Spec

Build the ability for SAIVD viewers to embed a verified video inline on a third-party site via iframe, in addition to the existing fullscreen `/v/[id]` view. The share UI must let the user choose between copying the fullscreen link and copying the iframe embed snippet.

## Goals

1. New iframe-friendly route at `/embed/[id]` that reuses the existing playback + watermark verification pipeline.
2. `VideoPlayer` gains an `embedded` mode that drops its modal chrome (no fullscreen overlay, no X close button) and fills its parent.
3. Share UI in the dashboard exposes two clearly-labeled copy actions: "Copy share link" and "Copy embed code".
4. Netlify headers explicitly allow framing of `/embed/*` and explicitly forbid framing of `/v/*`.
5. Fix an existing bug where the QR overlay click hijacks the current tab/iframe.

Do not change the watermark verification logic, the public playback API, or the dashboard's video upload/list flow. Reuse `VideoPlayer` — do not fork a new player component.

---

## File-by-file changes

### 1. `src/components/video/VideoPlayer.tsx` (modify)

**Add an `embedded` prop and adjust layout.**

Update the props interface (around line 12):

```ts
interface VideoPlayerProps {
  videoUrl: string;
  videoId?: string | null;
  onClose: () => void;
  isOpen: boolean;
  enableFrameAnalysis: boolean;
  verificationStatus?: "verifying" | "verified" | "failed" | null;
  verifiedUserId?: string | null;
  onVerificationComplete?: (status: "verified" | "failed", userId: string | null) => void;
  /** When true, render inline (fills parent) and hide the modal close button. Used by /embed/[id]. */
  embedded?: boolean;
}
```

Destructure `embedded = false` in the function signature (around line 23).

Replace the outer wrapper at line 176. Currently:

```tsx
<div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-2 sm:p-4">
  <div className="relative w-full max-w-5xl">
```

Becomes:

```tsx
<div
  className={
    embedded
      ? "relative w-full h-full bg-black"
      : "fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-2 sm:p-4"
  }
>
  <div className={embedded ? "relative w-full h-full" : "relative w-full max-w-5xl"}>
```

Wrap the close button block (lines 178–184) so it only renders when `!embedded`:

```tsx
{!embedded && (
  <button onClick={onClose} ... >
    <X className="w-6 h-6 sm:w-8 sm:h-8" />
  </button>
)}
```

**Fix the QR overlay click handler** (lines 231–235). Currently it calls `window.location.assign(creatorProfileUrl)`, which hijacks the embedder's tab. Replace with:

```tsx
onClick={() => {
  if (creatorProfileUrl) {
    window.open(creatorProfileUrl, "_blank", "noopener,noreferrer");
  }
}}
```

Do not change anything else in this file. Verification flow, controls, QR flip, and verification-failed UX stay identical.

### 2. `src/app/embed/[id]/page.tsx` (create)

New route. Reuses the same fetch logic as `src/app/v/[id]/page.tsx`. Differences from `/v/[id]`:
- No "you've finished watching" replay card. When the video ends, leave the player on its end frame; the user re-plays by clicking the play button in `VideoPlayer`'s controls.
- No "not found" / "fetch error" cards with chrome — render minimal centered text only, since the iframe is small.
- No `min-h-screen` — use `h-screen w-screen` so it fills exactly the iframe.
- `VideoPlayer` is rendered with `embedded` and a no-op `onClose`.
- Verification-failed state still renders explicit messaging — that's load-bearing for trust.

```tsx
"use client";

import {use, useCallback, useEffect, useRef, useState} from "react";
import {VideoPlayer} from "@/components/video/VideoPlayer";
import {LoadingSpinner} from "@/components/ui/loading-spinner";
import {AlertTriangleIcon} from "lucide-react";

type FetchStatus = "loading" | "ready" | "not_found" | "fetch_error";
type VerificationStatus = "verifying" | "verified" | "failed" | null;

/**
 * Embeddable video viewer at /embed/[id]. Designed to be loaded inside an iframe
 * on third-party sites. Reuses the same VideoPlayer + verification pipeline as
 * /v/[id], but with no modal chrome, no replay card, and no fullscreen overlay.
 *
 * Sizing: fills its parent (the iframe). Embedders are expected to size the
 * iframe responsively (16:9 by default). See VideoGrid share UI for the snippet.
 */
export default function EmbedVideoPage({params}: {params: Promise<{id: string}>}) {
  const {id: videoId} = use(params);

  const [fetchStatus, setFetchStatus] = useState<FetchStatus>("loading");
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [verificationStatus, setVerificationStatus] = useState<VerificationStatus>(null);
  const [verifiedUserId, setVerifiedUserId] = useState<string | null>(null);

  const fetchInflightRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    if (fetchInflightRef.current) return;
    fetchInflightRef.current = true;

    const load = async () => {
      try {
        const res = await fetch(`/api/public/videos/${videoId}/play?variant=watermarked`);
        const body = await res.json().catch(() => null);

        if (cancelled) return;

        if (res.status === 404) {
          setFetchStatus("not_found");
          return;
        }

        if (!res.ok || !body?.success || !body?.data?.playbackUrl) {
          setFetchError(body?.error?.message ?? `Failed to load video (status ${res.status})`);
          setFetchStatus("fetch_error");
          return;
        }

        setPlaybackUrl(body.data.playbackUrl);
        setVerificationStatus("verifying");
        setVerifiedUserId(null);
        setFetchStatus("ready");
      } catch (err) {
        if (cancelled) return;
        setFetchError(err instanceof Error ? err.message : "Failed to load video");
        setFetchStatus("fetch_error");
      } finally {
        fetchInflightRef.current = false;
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [videoId]);

  const handleVerificationComplete = useCallback(
    (status: "verified" | "failed", userId: string | null) => {
      setVerificationStatus(status);
      setVerifiedUserId(userId);
    },
    []
  );

  const noop = useCallback(() => {}, []);

  if (fetchStatus === "loading") {
    return (
      <main className="flex h-screen w-screen items-center justify-center bg-black">
        <LoadingSpinner size="lg" />
      </main>
    );
  }

  if (fetchStatus === "not_found") {
    return (
      <main className="flex h-screen w-screen items-center justify-center bg-black px-4">
        <div className="text-center">
          <AlertTriangleIcon className="mx-auto mb-3 h-8 w-8 text-yellow-400" />
          <p className="text-sm text-white/80">Video not found.</p>
        </div>
      </main>
    );
  }

  if (fetchStatus === "fetch_error") {
    return (
      <main className="flex h-screen w-screen items-center justify-center bg-black px-4">
        <div className="text-center">
          <AlertTriangleIcon className="mx-auto mb-3 h-8 w-8 text-red-400" />
          <p className="text-sm text-white/80">{fetchError ?? "Couldn't load this video."}</p>
        </div>
      </main>
    );
  }

  // ready
  return (
    <main className="h-screen w-screen bg-black">
      {playbackUrl && (
        <VideoPlayer
          embedded
          videoUrl={playbackUrl}
          videoId={videoId}
          isOpen
          onClose={noop}
          enableFrameAnalysis
          verificationStatus={verificationStatus}
          verifiedUserId={verifiedUserId}
          onVerificationComplete={handleVerificationComplete}
        />
      )}
    </main>
  );
}
```

### 3. `src/components/video/VideoGrid.tsx` (modify)

**Replace the single share button with a dropdown menu offering two copy options.**

The current implementation around lines 116–156 has a single `LinkIcon` button that calls `handleCopyLink`. Replace with a shadcn `DropdownMenu` containing two items: "Copy share link" and "Copy embed code".

If `@/components/ui/dropdown-menu` does not yet exist in the project, add it first by running `npx shadcn@latest add dropdown-menu` from the repo root. (This must be run manually outside Cursor's tool calls; do not skip it.)

Add a second handler alongside `handleCopyLink`:

```ts
const handleCopyEmbed = async (videoId: string) => {
  const embedUrl = `${window.location.origin}/embed/${videoId}`;
  // Universal embed snippet — works in Hostinger, Wix, WordPress, Squarespace,
  // Webflow, Ghost, Substack, raw HTML. No wrapper div (avoids fights with
  // builders that wrap embedded HTML in their own fixed-size container).
  // aspect-ratio is the modern responsive sizing primitive (all browsers since
  // late 2021); width/height attributes are the fallback so the iframe never
  // collapses to zero in older or quirky environments.
  const snippet =
    `<iframe src="${embedUrl}"\n` +
    `        width="100%" height="400"\n` +
    `        style="width:100%;aspect-ratio:16/9;border:0;display:block;"\n` +
    `        allow="autoplay; fullscreen; picture-in-picture"\n` +
    `        allowfullscreen loading="lazy"\n` +
    `        referrerpolicy="strict-origin-when-cross-origin"\n` +
    `        title="SAIVD verified video"></iframe>`;

  try {
    await navigator.clipboard.writeText(snippet);
  } catch {
    // Fallback for older browsers / non-secure contexts
    const ta = document.createElement("textarea");
    ta.value = snippet;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }
  toast({title: "Embed code copied", description: "Paste it into your site's HTML."});
};
```

Replace the `LinkIcon` button JSX with:

```tsx
<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Button variant="ghost" size="icon" aria-label="Share video">
      <LinkIcon className="h-4 w-4" />
    </Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent align="end">
    <DropdownMenuItem onClick={() => handleCopyLink(video.id)}>
      Copy share link
    </DropdownMenuItem>
    <DropdownMenuItem onClick={() => handleCopyEmbed(video.id)}>
      Copy embed code
    </DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```

Update `handleCopyLink`'s toast message to `"Link copied"` so it's distinguishable from the embed toast.

### 4. `netlify.toml` (modify)

Replace the entire file with:

```toml
[build]
  command = "npm run build"
  publish = ".next"

[build.environment]
  NODE_VERSION = "20"
  AWS_LAMBDA_JS_RUNTIME = "nodejs20.x"
  SECRETS_SCAN_OMIT_KEYS = "NEXT_PUBLIC_SUPABASE_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY,NEXT_PUBLIC_APP_URL,WASABI_REGION,WASABI_BUCKET_NAME"
  SECRETS_SCAN_OMIT_PATHS = ".next/**,.netlify/**,node_modules/**,docs/**,*.md"

# Allow /embed/* to be framed by any site (these URLs exist for that purpose).
[[headers]]
  for = "/embed/*"
  [headers.values]
    Content-Security-Policy = "frame-ancestors *"

# Forbid /v/* from being framed — force embedders to use /embed/* instead.
# This is a control point for future analytics, rate-limiting, and per-customer
# allowlisting without breaking embedded use cases.
[[headers]]
  for = "/v/*"
  [headers.values]
    X-Frame-Options = "DENY"
    Content-Security-Policy = "frame-ancestors 'none'"
```

The previous `/* → /index.html` redirect was a SPA fallback that does not apply to a Next.js App Router app and is being removed deliberately. Next.js routing on Netlify is handled by Netlify's built-in Next runtime; do not re-add the rewrite. If routing breaks in production after this change, the fix is to add `@netlify/plugin-nextjs` to `package.json` and `[[plugins]]` block in `netlify.toml`, not to bring back the SPA redirect.

---

## Acceptance criteria

Manual test checklist after the changes:

1. **Fullscreen view still works.** `https://viewer.saivd.io/v/{id}` loads, plays, runs verification, shows QR overlay, shows "Powered by SAIVD" footer, and the X close button closes back to the replay card. No regressions.
2. **Embed route loads inside an iframe.** Create a throwaway HTML file with the iframe snippet from `handleCopyEmbed` and open it in a browser pointing at a known good video id. Video loads, verification runs, verified QR appears, controls work, no X button is visible, no replay card appears.
3. **Embed route loads when opened directly.** `https://viewer.saivd.io/embed/{id}` in a normal tab fills the viewport and plays. (Direct loads of the embed URL should work — they just won't be the primary entry point.)
4. **QR click in embed opens parent tab, not iframe.** Click the QR overlay in an embedded video; the creator profile opens in a new tab via `window.open`. The iframe itself is unchanged.
5. **`/v/{id}` cannot be framed.** Drop the same iframe snippet but pointing at `/v/{id}` instead of `/embed/{id}`. The browser refuses to render it (check DevTools console for the `frame-ancestors` violation).
6. **Share dropdown.** In the dashboard, the share button opens a menu with "Copy share link" and "Copy embed code". Clicking the first puts `${origin}/v/{id}` on the clipboard; clicking the second puts the full iframe HTML snippet on the clipboard. Toast messages are distinguishable.
7. **Verification failure still blocks playback in embed.** Manually flip a video's verification to fail (or use a known-bad fixture); the embed shows the "This video is not authentic" overlay and controls are hidden, same as in `/v/{id}`.

## Out of scope for this PR

These come later if there's demand — do not build them now:

- postMessage protocol (`saivd:verified`, `saivd:ended`, etc.) for embedders to react to player state.
- Embed query params (`autoplay`, `muted`, `loop`, `theme`).
- oEmbed provider endpoint.
- Open Graph / Twitter Card meta tags on `/v/[id]`.
- Per-domain `frame-ancestors` allowlist for paid customers.
- Rate limiting on `/api/public/videos/[id]/play`.
- JS SDK / `<script>` embed loader.

## Notes on the existing code

- `VideoPlayer` already runs verification client-side via `useWatermarkVerification`. This is expensive (WebCodecs + WASM frame decode + RSA verify). It will run for every embed page load. That's acceptable for v1; if it becomes a problem, add a click-to-load poster gate inside the embed page, but do not change the verification path itself.
- The public playback API at `src/app/api/public/videos/[id]/play/route.ts` is unauthenticated and returns a 1-hour presigned Wasabi URL. That URL is already hotlinkable today, so opening up iframe embedding does not change the abuse surface materially. Adding rate limits is a separate hardening task.
- The `embedded` prop is intentionally a small boolean flag rather than a refactor of `VideoPlayer` into "modal wrapper + inline content" components. The refactor is cleaner long-term but out of scope here.

## Suggested commit structure

Three commits, in this order, so each is independently reviewable:

1. `fix(VideoPlayer): open creator profile in new tab from QR overlay` — the `window.open` fix only.
2. `feat(embed): add /embed/[id] route and embedded mode on VideoPlayer` — new route + `embedded` prop + `netlify.toml` headers.
3. `feat(share): expose embed code copy alongside share link` — `VideoGrid` dropdown + `handleCopyEmbed`.
