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

  // Wrapper div + responsive iframe. The wrapper is needed because some builder
  // products (Hostinger Website Builder mobile theme, certain Wix layouts, some
  // Squarespace blocks) interpret bare iframe width/height attributes as fixed
  // pixel hints on mobile, fighting the responsive CSS. The div forces those
  // builders to size by container width, and the iframe inside fills it via
  // aspect-ratio:16/9 (supported in all browsers since late 2021).
  const html =
    `<div style="width:100%;max-width:100%;margin:0 auto;">` +
    `<iframe src="${embedUrl}" ` +
    `style="width:100%;aspect-ratio:16/9;border:0;display:block;" ` +
    `allow="autoplay; fullscreen; picture-in-picture" allowfullscreen ` +
    `loading="lazy" referrerpolicy="strict-origin-when-cross-origin" ` +
    `title="SAIVD verified video"></iframe>` +
    `</div>`;

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
      headers: {
        "Cache-Control": "public, s-maxage=3600, max-age=3600",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
      },
    }
  );
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
    },
  });
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
