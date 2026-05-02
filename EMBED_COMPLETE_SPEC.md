# SAIVD Embed Feature — Complete Build Spec

This spec consolidates everything required to make SAIVD videos embeddable across the web. It supersedes `EMBED_FEATURE_SPEC.md` and `EMBED_PHASE2_SPEC.md` — implement this single document.

## Overview

Today, SAIVD videos can only be opened in a separate tab at `/v/[id]`. After this work ships, creators will have two complementary embed options exposed via the dashboard share menu:

1. **Copy share link** — copies `https://viewer.saivd.io/v/{id}`. Pasting this URL into WordPress, Notion, Substack, Slack, Discord, Twitter/X, LinkedIn, iMessage, etc. auto-embeds the verified video via oEmbed and Open Graph metadata.
2. **Copy embed code** — copies an iframe HTML snippet pointing at `https://viewer.saivd.io/embed/{id}`. Pasting this into Hostinger Website Builder's Embed Code element, Wix's HTML widget, Squarespace, Webflow, or any Custom HTML block renders the video inline.

Both options use the same watermark verification, QR overlay, and "Powered by SAIVD" attribution as the existing `/v/[id]` page. No verification logic changes.

## Architecture summary

- New iframe-friendly route at `/embed/[id]` reuses `VideoPlayer` in a new `embedded` mode that drops modal chrome.
- `/v/[id]` is split into a server-component shell that exports `generateMetadata` (Open Graph, Twitter Card, oEmbed discovery link) and a client view (existing logic, unchanged).
- New `/api/oembed` JSON endpoint returns iframe HTML for SAIVD video URLs.
- Netlify headers explicitly allow `/embed/*` to be framed and explicitly forbid `/v/*` from being framed.
- Dashboard share button becomes a dropdown menu with two copy actions.
- One existing bug fix: QR overlay click currently calls `window.location.assign`, which hijacks the host tab/iframe; replace with `window.open(_, '_blank')`.

Implement files in the order listed below — `/embed/[id]` must exist before the oEmbed endpoint references it, and the `embedded` prop on `VideoPlayer` must exist before `/embed/[id]` uses it.

## Pre-flight checklist

Before starting:

- [x] `npx shadcn@latest add dropdown-menu` was already run; `src/components/ui/dropdown-menu.tsx` exists and `@radix-ui/react-dropdown-menu` is installed transitively via `radix-ui@1.4.3`. Do not run shadcn again.
- [ ] Verify the existing toast hook is `@/hooks/use-toast` (it's used in `VideoGrid.tsx` already). Match its existing call signature.
- [ ] Verify `public/images/saivd-logo.png` exists. If it's smaller than 1200×630 (standard Open Graph card size), the metadata will still work but link previews on Twitter/Facebook won't be optimal — note this for follow-up but don't block on it.

---

## File-by-file changes

### 1. `src/components/video/VideoPlayer.tsx` (modify)

Two changes: add an `embedded` prop, and fix the QR click handler.

**1a. Props interface — add `embedded`:**

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

Destructure `embedded = false` in the function signature.

**1b. Outer wrapper conditional layout** — replace the wrapper that begins around line 176:

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

**1c. Hide close button when embedded** — wrap the close button block (the `<button>` at lines 178–184):

```tsx
{!embedded && (
  <button
    onClick={onClose}
    className="absolute -top-10 sm:-top-12 right-0 sm:right-2 text-white hover:text-gray-300 transition-colors touch-manipulation z-30"
    aria-label="Close video player">
    <X className="w-6 h-6 sm:w-8 sm:h-8" />
  </button>
)}
```

**1d. Fix the QR click handler** at lines 231–235. Currently calls `window.location.assign(creatorProfileUrl)`. Replace the onClick with:

```tsx
onClick={() => {
  if (creatorProfileUrl) {
    window.open(creatorProfileUrl, "_blank", "noopener,noreferrer");
  }
}}
```

Do not change anything else in this file — verification flow, controls, QR flip animation, verification-failed UX are untouched.

### 2. `src/app/embed/[id]/page.tsx` (create)

New iframe-friendly route. Reuses the same fetch flow as `/v/[id]` but with no modal chrome, no replay card, and minimal error UX (since the iframe is small).

```tsx
"use client";

import {use, useCallback, useEffect, useRef, useState} from "react";
import {VideoPlayer} from "@/components/video/VideoPlayer";
import {LoadingSpinner} from "@/components/ui/loading-spinner";
import {AlertTriangleIcon} from "lucide-react";

type FetchStatus = "loading" | "ready" | "not_found" | "fetch_error";
type VerificationStatus = "verifying" | "verified" | "failed" | null;

/**
 * Embeddable video viewer at /embed/[id]. Designed for iframe use on third-party
 * sites. Reuses the same VideoPlayer + verification pipeline as /v/[id], but
 * with no modal chrome, no replay card, and no fullscreen overlay.
 *
 * Sizing: fills its parent (the iframe). Embedders are responsible for sizing
 * the iframe itself (the share-UI snippet defaults to a responsive 16:9 box).
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

### 3. `src/app/v/[id]/_view.tsx` (create — move existing client logic here)

Take the entire current body of `src/app/v/[id]/page.tsx` (everything from `"use client";` through the end of the `PoweredBySaivdLink` helper) and move it to this new file. Two small renames:

- Rename the default-exported component from `PublicVideoPage` to `PublicVideoView`.
- Change `export default function PublicVideoPage(...)` to `export function PublicVideoView(...)` (named export, not default).

Everything else — imports, types, helpers, JSX, behavior — is unchanged. This is a pure code move, no behavior change.

### 4. `src/app/v/[id]/page.tsx` (replace — server-component shell)

Replace the file's contents entirely with this server-component shell that exports `generateMetadata`:

```tsx
import type {Metadata} from "next";
import {PublicVideoView} from "./_view";

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://viewer.saivd.io";

type Params = {id: string};

/**
 * Open Graph + Twitter Card meta tags so pasting a /v/[id] URL into Slack,
 * Discord, iMessage, Twitter/X, LinkedIn, Facebook etc. unfurls into a
 * playable video card. Also includes the oEmbed discovery link so platforms
 * like WordPress, Notion, Substack, Discourse can auto-embed by URL alone.
 */
export async function generateMetadata({params}: {params: Promise<Params>}): Promise<Metadata> {
  const {id} = await params;
  const watchUrl = `${APP_URL}/v/${id}`;
  const embedUrl = `${APP_URL}/embed/${id}`;
  const fallbackImage = `${APP_URL}/images/saivd-logo.png`;

  return {
    title: "Verified video — SAIVD",
    description: "Cryptographically verified video, watermarked at the source.",
    openGraph: {
      type: "video.other",
      url: watchUrl,
      title: "Verified video — SAIVD",
      description: "Cryptographically verified video, watermarked at the source.",
      siteName: "SAIVD",
      images: [{url: fallbackImage, width: 1200, height: 630}],
      videos: [
        {
          url: embedUrl,
          secureUrl: embedUrl,
          type: "text/html",
          width: 1280,
          height: 720,
        },
      ],
    },
    twitter: {
      card: "player",
      title: "Verified video — SAIVD",
      description: "Cryptographically verified video, watermarked at the source.",
      images: [fallbackImage],
      players: [
        {
          playerUrl: embedUrl,
          streamUrl: embedUrl,
          width: 1280,
          height: 720,
        },
      ],
    },
    alternates: {
      types: {
        "application/json+oembed": `${APP_URL}/api/oembed?url=${encodeURIComponent(watchUrl)}&format=json`,
      },
    },
  };
}

export default function PublicVideoPage({params}: {params: Promise<Params>}) {
  return <PublicVideoView params={params} />;
}
```

### 5. `src/app/api/oembed/route.ts` (create)

oEmbed JSON provider per [oembed.com](https://oembed.com/). Receives a `url` query parameter pointing at a SAIVD video URL on the same origin and returns a standard `type: "video"` oEmbed response with the iframe HTML.

```ts
import {NextRequest, NextResponse} from "next/server";

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://viewer.saivd.io";

/**
 * oEmbed provider for SAIVD video URLs.
 * Spec: https://oembed.com/
 *
 * Accepts:  GET /api/oembed?url=<https://viewer.saivd.io/v/{id}>&format=json[&maxwidth=NNN&maxheight=NNN]
 * Returns:  oEmbed JSON of type "video" with HTML containing the iframe to /embed/[id].
 *
 * Does NOT verify that the video exists in the database — the verification
 * happens when the embed iframe loads /api/public/videos/[id]/play. We just
 * validate URL shape so we can respond fast and not consume DB resources for
 * crawler/bot oEmbed lookups.
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  const format = req.nextUrl.searchParams.get("format") ?? "json";
  const maxwidth = clampInt(req.nextUrl.searchParams.get("maxwidth"), 1280, 320, 1920);
  const maxheight = clampInt(req.nextUrl.searchParams.get("maxheight"), 720, 180, 1080);

  if (format !== "json") {
    return new NextResponse("Only json format is supported", {status: 501});
  }

  if (!url) {
    return NextResponse.json({error: "Missing url parameter"}, {status: 400});
  }

  const videoId = parseSaivdVideoUrl(url);
  if (!videoId) {
    return NextResponse.json({error: "Unsupported URL"}, {status: 404});
  }

  const {width, height} = fitToBox(maxwidth, maxheight, 16 / 9);
  const embedUrl = `${APP_URL}/embed/${videoId}`;

  const html =
    `<iframe src="${embedUrl}" ` +
    `width="${width}" height="${height}" ` +
    `style="width:100%;aspect-ratio:16/9;border:0;display:block;" ` +
    `allow="autoplay; fullscreen; picture-in-picture" allowfullscreen ` +
    `loading="lazy" referrerpolicy="strict-origin-when-cross-origin" ` +
    `title="SAIVD verified video"></iframe>`;

  return NextResponse.json(
    {
      type: "video",
      version: "1.0",
      provider_name: "SAIVD",
      provider_url: APP_URL,
      title: "Verified video — SAIVD",
      html,
      width,
      height,
      thumbnail_url: `${APP_URL}/images/saivd-logo.png`,
      thumbnail_width: 1200,
      thumbnail_height: 630,
    },
    {
      headers: {"Cache-Control": "public, s-maxage=3600, max-age=3600"},
    }
  );
}

function parseSaivdVideoUrl(input: string): string | null {
  try {
    const u = new URL(input);
    const expected = new URL(APP_URL).host;
    if (u.host !== expected) return null;
    const m = u.pathname.match(/^\/(?:v|embed)\/([a-zA-Z0-9-]+)\/?$/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function clampInt(v: string | null, fallback: number, min: number, max: number): number {
  const n = v ? parseInt(v, 10) : fallback;
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function fitToBox(maxW: number, maxH: number, ratio: number): {width: number; height: number} {
  const widthIfHeightCapped = Math.round(maxH * ratio);
  if (widthIfHeightCapped <= maxW) {
    return {width: widthIfHeightCapped, height: maxH};
  }
  const heightIfWidthCapped = Math.round(maxW / ratio);
  return {width: maxW, height: heightIfWidthCapped};
}
```

### 6. `src/components/video/VideoGrid.tsx` (modify)

Replace the single `LinkIcon` button (around `VideoGrid.tsx:282`) with a `DropdownMenu` exposing two copy actions. Add a second handler alongside `handleCopyLink`.

**6a. Add imports** at the top of the file (next to existing imports):

```ts
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
```

**6b. Add the embed-copy handler** alongside `handleCopyLink`:

```ts
const handleCopyEmbed = async (videoId: string) => {
  const embedUrl = `${window.location.origin}/embed/${videoId}`;
  // Universal embed snippet — works in Hostinger, Wix, WordPress (Custom HTML),
  // Squarespace, Webflow, Ghost, raw HTML. No wrapper div (avoids fights with
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

**6c. Update the existing `handleCopyLink` toast** to say `"Link copied"` (so it's distinguishable from the embed toast):

```ts
toast({title: "Link copied", description: copyUrl});
```

**6d. Replace the share button JSX** (the `LinkIcon` button) with the dropdown:

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

### 7. `netlify.toml` (replace)

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

# oEmbed endpoint must be cross-origin readable (consumed by WordPress, Notion,
# Slack, Discord etc. from their own infrastructure).
[[headers]]
  for = "/api/oembed"
  [headers.values]
    Access-Control-Allow-Origin = "*"
    Access-Control-Allow-Methods = "GET, OPTIONS"
    Cache-Control = "public, s-maxage=3600, max-age=3600"

# Public video API must be cross-origin readable. Builder products (Hostinger
# Website Builder, Wix, Squarespace) wrap user-embedded iframes with a sandbox
# that strips `allow-same-origin`, making the iframe's origin opaque (null).
# Without these CORS headers, the embed page's fetch to /api/public/videos/[id]/play
# fails with "Failed to fetch" because it's treated as a cross-origin request
# from a null origin. The endpoint is already public (no auth) so this doesn't
# change the security posture.
[[headers]]
  for = "/api/public/*"
  [headers.values]
    Access-Control-Allow-Origin = "*"
    Access-Control-Allow-Methods = "GET, OPTIONS"
```

The previous `/* → /index.html` SPA rewrite is removed deliberately. Next.js routing on Netlify is handled by Netlify's built-in Next runtime, not SPA fallback. Do not re-add that redirect. If routing breaks in production after this change, the correct fix is to add `@netlify/plugin-nextjs` and a `[[plugins]]` block — not to bring back the SPA redirect.

### 8. Brand image verification (manual)

Verify `public/images/saivd-logo.png` exists. If it's smaller than 1200×630 (Open Graph standard), the metadata still works but link previews will be lower quality. Acceptable for v1 — flag for follow-up to create a dedicated `public/images/og-card.png` at exactly 1200×630.

---

## Acceptance criteria

After all files are in place and the app is running locally, walk this checklist:

### iframe embedding (Phase 1)

1. **Fullscreen view still works.** `http://localhost:3000/v/{id}` loads, plays, runs verification, shows QR overlay, the X close button works, the replay card appears on close. No regressions vs. before.
2. **Embed route loads inside an iframe.** Create a throwaway HTML file with the snippet from `handleCopyEmbed` and open it in a browser. Video loads, verification runs, verified QR appears, controls work, no X button, no replay card.
3. **Embed route loads when opened directly.** `http://localhost:3000/embed/{id}` in a normal tab fills the viewport and plays.
4. **QR click in embed opens parent tab, not iframe.** Click the QR overlay in an embedded video; the creator profile opens in a new tab via `window.open`.
5. **`/v/{id}` cannot be framed.** Drop the same iframe snippet but with `/v/{id}` instead of `/embed/{id}`. Browser refuses to render it; DevTools console shows a `frame-ancestors` violation.
6. **Share dropdown.** In the dashboard, the share button opens a menu with "Copy share link" and "Copy embed code". Each copies the right thing. Toast messages are distinguishable.
7. **Verification failure still blocks playback in embed.** With a known-bad fixture, the embed shows the "This video is not authentic" overlay and controls are hidden.

### URL-only embedding (Phase 2)

8. **oEmbed endpoint returns valid JSON.**
   ```
   curl 'http://localhost:3000/api/oembed?url=http%3A%2F%2Flocalhost%3A3000%2Fv%2F{REAL_VIDEO_ID}&format=json'
   ```
   Returns JSON with `type: "video"`, `html: "<iframe ...>"`, `width`, `height`. The iframe `src` points at `/embed/{REAL_VIDEO_ID}`.

9. **Discovery link is in `/v/[id]` HTML head.** View source of `/v/{id}`, grep for `application/json+oembed`. Should see a `<link rel="alternate" type="application/json+oembed" href="...">` tag.

10. **Open Graph tags render.** Same view source, grep for `og:video`. Should see `og:type=video.other`, `og:video` pointing at the embed URL, `og:image`, `og:title`, `og:description`.

11. **Twitter Card tags render.** Grep for `twitter:card`. Should be `player` with `twitter:player` pointing at the embed URL.

12. **WordPress auto-embed (after deploy to production).** Paste `https://viewer.saivd.io/v/{id}` on its own line in a Gutenberg editor. The URL expands into an embedded SAIVD video that plays in place. (Self-hosted WP, default settings, no plugin required.)

13. **Slack/Discord link unfurl (after deploy to production).** Paste the URL into a Slack DM or Discord channel. Card appears with title, description, image; depending on workspace settings, plays inline.

14. **iMessage / WhatsApp link preview (after deploy to production).** Tap-to-play preview appears with OG image and title.

---

## Out of scope (do not build now)

These belong to follow-up work. Do not gold-plate v1.

- postMessage protocol for embedders to react to player state (`saivd:verified`, `saivd:ended`, etc.).
- Embed query params (`autoplay`, `muted`, `loop`, `theme`).
- JS SDK / `<script>` embed loader.
- Per-customer `frame-ancestors` allowlist.
- Rate limiting on `/api/public/videos/[id]/play`.
- Per-video thumbnails (requires a server-side poster pipeline).
- Per-video title/description in metadata (requires exposing creator-provided meta via the public API).
- oEmbed XML format.
- Twitter Card domain validation submission.

---

## Suggested commit structure

Five commits, each independently reviewable, in this order:

1. `fix(VideoPlayer): open creator profile in new tab from QR overlay` — the `window.open` fix only.
2. `feat(VideoPlayer): add embedded mode that hides modal chrome` — the `embedded` prop and the conditional layout/close-button logic.
3. `feat(embed): add /embed/[id] route` — new file plus `netlify.toml` headers for `/embed/*` and `/v/*` (the SPA rewrite removal can ride along here since it's part of the same Netlify config edit).
4. `refactor(v/[id]): split into server-component shell + client view` — the `_view.tsx` move and server-component shell. No metadata yet — keep this commit purely a refactor.
5. `feat(embed): add oEmbed provider and Open Graph metadata for /v/[id]` — `generateMetadata`, `/api/oembed`, oEmbed CORS headers in `netlify.toml`.
6. `feat(share): expose embed code copy alongside share link` — `VideoGrid` dropdown and `handleCopyEmbed`.

Six commits, but commit 3 and commit 5 each touch `netlify.toml`. Either combine them into a single Netlify config commit or accept the small overlap; both are fine.
