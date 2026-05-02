# SAIVD Embed Phase 2 — URL-only Embedding (oEmbed + Open Graph)

Phase 1 (`EMBED_FEATURE_SPEC.md`) shipped iframe-based embedding. Phase 2 makes the bare `https://viewer.saivd.io/v/{id}` URL auto-embed across platforms that follow web standards — no snippet copying, no third-party site changes. Pasting the URL into WordPress, Notion, Slack, Discord, Substack, Twitter/X, LinkedIn, iMessage, etc. will produce a verified-video card that plays inline.

This does **not** unlock URL-only embedding in closed builder products (Hostinger Website Builder, Wix, Squarespace drag-and-drop, Webflow's Video element). Those use hardcoded provider allowlists and require a business integration with each platform — out of scope.

## Goals

1. Implement oEmbed provider at `/api/oembed` returning the iframe HTML for a SAIVD video URL.
2. Add oEmbed discovery `<link>` tag to `/v/[id]` so platforms can find the endpoint.
3. Add Open Graph + Twitter Card `<meta>` tags to `/v/[id]` so link unfurling shows a video card.
4. Refactor `/v/[id]/page.tsx` to a server component shell + client view, since the current `"use client"` page can't export `generateMetadata`.

Do not change the iframe embed contract from Phase 1. The oEmbed response just returns the same iframe snippet that's already in the Phase 1 share UI.

---

## File-by-file changes

### 1. `src/app/v/[id]/page.tsx` (refactor: server component → client view)

Currently `"use client"` at the top, which blocks `generateMetadata`. Split:

- Keep `src/app/v/[id]/page.tsx` as a **server component** that fetches video metadata, exports `generateMetadata`, and renders the existing client logic from a child component.
- Move the existing `"use client"` page body into `src/app/v/[id]/_view.tsx` (underscore prefix, not a route).

#### `src/app/v/[id]/page.tsx` (new server-component shell)

```tsx
import type {Metadata} from "next";
import {PublicVideoView} from "./_view";

const SAIVD_API_ORIGIN =
  process.env.NEXT_PUBLIC_SAIVD_API_URL ?? "https://saivd.netlify.app";

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://viewer.saivd.io";

type Params = {id: string};

/**
 * Generate Open Graph + Twitter Card meta tags so pasting a /v/[id] URL into
 * Slack, Discord, iMessage, Twitter/X, LinkedIn, Facebook, etc. unfurls into a
 * playable video card. We keep the meta tags minimal and not video-specific
 * for now (no per-video title/thumbnail), since we don't yet expose a
 * thumbnail or title API on the public side. Upgrade later when those exist.
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
      // oEmbed discovery — platforms that support oEmbed will look for this
      // link, fetch the JSON, and render the returned iframe HTML inline.
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

#### `src/app/v/[id]/_view.tsx` (move existing client logic here, unchanged behavior)

Take the entire current body of `src/app/v/[id]/page.tsx` (everything from `"use client";` through the closing brace of the `PoweredBySaivdLink` helper) and put it in this new file. Rename the default-exported component from `PublicVideoPage` to `PublicVideoView` and change it from `default export` to a named export:

```tsx
"use client";

// ...all the existing imports, types, helpers...

export function PublicVideoView({params}: {params: Promise<{id: string}>}) {
  // ...exact existing implementation, untouched...
}

// PoweredBySaivdLink and any other helpers stay here as they were.
```

This is a pure code-move refactor. No behavior changes. The existing fetch flow, verification state machine, replay card, and verification-failed UX are identical to today.

### 2. `src/app/api/oembed/route.ts` (create)

oEmbed JSON provider. Receives a `url` query parameter pointing at a `/v/[id]` URL on the same origin, validates it, and returns the standard oEmbed response with HTML for the iframe.

```ts
import {NextRequest, NextResponse} from "next/server";

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://viewer.saivd.io";

/**
 * oEmbed provider for SAIVD video URLs.
 *
 * Spec: https://oembed.com/
 *
 * Accepts:
 *   GET /api/oembed?url=<https://viewer.saivd.io/v/{id}>&format=json[&maxwidth=NNN&maxheight=NNN]
 *
 * Returns oEmbed JSON of type "video" with HTML containing the iframe pointing
 * at /embed/[id]. This is what platforms like WordPress, Notion, Slack,
 * Discord, Substack, Discourse, etc. consume when a user pastes a SAIVD link.
 *
 * Does NOT verify that the video exists in the database — that check happens
 * when the embed iframe loads /api/public/videos/[id]/play. We just validate
 * URL shape here so we can respond fast and not consume DB resources for every
 * crawler/bot oEmbed lookup.
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  const format = req.nextUrl.searchParams.get("format") ?? "json";
  const maxwidth = clampInt(req.nextUrl.searchParams.get("maxwidth"), 1280, 320, 1920);
  const maxheight = clampInt(req.nextUrl.searchParams.get("maxheight"), 720, 180, 1080);

  if (format !== "json") {
    // We only support JSON. XML format is rarely used; return 501 per spec.
    return new NextResponse("Only json format is supported", {status: 501});
  }

  if (!url) {
    return NextResponse.json({error: "Missing url parameter"}, {status: 400});
  }

  const videoId = parseSaivdVideoUrl(url);
  if (!videoId) {
    return NextResponse.json({error: "Unsupported URL"}, {status: 404});
  }

  // Maintain the requested max dimensions while preserving 16:9.
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
      // Optional thumbnail — using brand logo as fallback. Replace with
      // per-video thumbnail when that pipeline exists.
      thumbnail_url: `${APP_URL}/images/saivd-logo.png`,
      thumbnail_width: 1200,
      thumbnail_height: 630,
    },
    {
      // Cache for 1 hour at the edge — oEmbed responses are stable and crawler
      // traffic can be heavy.
      headers: {"Cache-Control": "public, s-maxage=3600, max-age=3600"},
    }
  );
}

function parseSaivdVideoUrl(input: string): string | null {
  try {
    const u = new URL(input);
    const expected = new URL(APP_URL).host;
    if (u.host !== expected) return null;
    // Accept both /v/{id} (canonical share URL) and /embed/{id} (in case a
    // platform passes that to oEmbed too).
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
  // Fit a `ratio` rectangle inside maxW x maxH.
  const widthIfHeightCapped = Math.round(maxH * ratio);
  if (widthIfHeightCapped <= maxW) {
    return {width: widthIfHeightCapped, height: maxH};
  }
  const heightIfWidthCapped = Math.round(maxW / ratio);
  return {width: maxW, height: heightIfWidthCapped};
}
```

### 3. `netlify.toml` (modify — extend Phase 1 headers)

Add cache headers and CORS for the oEmbed endpoint. oEmbed needs to be cross-origin readable since platforms fetch it from their own backends.

Add this block (keep the Phase 1 headers for `/embed/*` and `/v/*`):

```toml
# oEmbed endpoint must be cross-origin readable (consumed by WordPress, Notion,
# Slack, Discord etc. from their own infrastructure).
[[headers]]
  for = "/api/oembed"
  [headers.values]
    Access-Control-Allow-Origin = "*"
    Access-Control-Allow-Methods = "GET, OPTIONS"
    Cache-Control = "public, s-maxage=3600, max-age=3600"
```

### 4. Brand image for OG (verify exists)

The metadata code references `/images/saivd-logo.png` at 1200×630 (Open Graph standard). The `VideoPlayer` already references `/images/saivd-logo.png`, so the image exists, but it may not be at OG dimensions. Verify `public/images/saivd-logo.png` exists and is at least 1200×630. If it's smaller (e.g., a square logo), create `public/images/og-card.png` at exactly 1200×630 with the SAIVD logo on a branded background, and reference that image instead of `saivd-logo.png` in `generateMetadata`.

---

## Acceptance criteria

After deploy to production:

1. **oEmbed endpoint returns valid JSON.** Run:
   ```
   curl 'https://viewer.saivd.io/api/oembed?url=https%3A%2F%2Fviewer.saivd.io%2Fv%2F{REAL_VIDEO_ID}&format=json'
   ```
   Should return JSON with `type: "video"`, `html: "<iframe ...>"`, `width`, `height`. The iframe `src` should be `https://viewer.saivd.io/embed/{REAL_VIDEO_ID}`.

2. **Discovery link is in the HTML head.** View source of `https://viewer.saivd.io/v/{id}` in a browser and grep for `application/json+oembed`. There should be a `<link rel="alternate" type="application/json+oembed" href="...">` tag.

3. **Open Graph tags render in the head.** Same view source, grep for `og:video`. Should see `og:type=video.other`, `og:video` pointing at the embed URL, `og:image`, `og:title`, `og:description`.

4. **Twitter Card tags render.** Grep for `twitter:card`. Should be `player` with `twitter:player` pointing at the embed URL.

5. **WordPress auto-embed works.** On any WordPress site (4.0+), paste `https://viewer.saivd.io/v/{id}` on its own line in the Gutenberg editor. After a brief moment, the URL should expand into an embedded SAIVD video that plays in place. (Self-hosted WP with default settings is enough — no plugin needed.)

6. **Slack link unfurl.** Paste `https://viewer.saivd.io/v/{id}` into a Slack DM to yourself. Slack should show a card with title, description, image, and (depending on workspace settings) a play button that opens the embed inline.

7. **Discord link unfurl.** Same as Slack — paste in a channel, expect a video preview card.

8. **iMessage / WhatsApp link preview.** Paste in a chat, expect a tap-to-play preview using the OG image and title.

9. **Twitter/X player card.** Paste `https://viewer.saivd.io/v/{id}` into a tweet draft and check the preview. (Note: Twitter occasionally requires domain validation via the legacy Card Validator. If the player card doesn't show, fall back gracefully — the page-level OG tags will still produce a static preview card.)

10. **Phase 1 still works.** All existing acceptance criteria from `EMBED_FEATURE_SPEC.md` continue to pass — verify the share dropdown still copies the iframe snippet, `/embed/[id]` is still framable, etc.

## Out of scope (do not build now)

- Per-video thumbnails (requires server-side video poster generation; needs a separate pipeline).
- Per-video title and description (would need to expose creator-provided metadata via the public API).
- oEmbed XML format (`format=xml`) — every modern consumer uses JSON.
- Domain whitelist on the oEmbed endpoint — currently any URL matching the pattern is accepted; that's correct because the endpoint only exposes information that's already public.
- Twitter Card domain validation submission — do separately once you decide whether you want player cards on Twitter specifically.

## Suggested commit structure

Two commits, each independently reviewable:

1. `refactor(v/[id]): split into server-component shell + client view` — the page split, no behavior change.
2. `feat(embed): add oEmbed provider and Open Graph metadata for /v/[id]` — `generateMetadata`, `/api/oembed`, `netlify.toml` headers, OG image verification.
