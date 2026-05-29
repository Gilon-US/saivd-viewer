import {NextRequest, NextResponse} from "next/server";

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://viewer.saivd.io";

type ParsedSaivdUrl = {kind: "video"; id: string} | {kind: "image"; id: string};

/**
 * oEmbed provider for SAIVD video and image URLs.
 * Spec: https://oembed.com/
 *
 * Accepts:
 *   GET /api/oembed?url=<https://viewer.saivd.io/v/{id}|/i/{id}|/embed/...>&format=json
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

  const parsed = parseSaivdUrl(url);
  if (!parsed) {
    return NextResponse.json({error: "Unsupported URL"}, {status: 404});
  }

  if (parsed.kind === "image") {
    const {width, height} = fitToBox(maxwidth, maxheight, 1);
    const embedUrl = `${APP_URL}/embed/i/${parsed.id}`;
    const html =
      `<div style="width:100%;max-width:100%;margin:0 auto;">` +
      `<iframe src="${embedUrl}" ` +
      `style="width:100%;aspect-ratio:1/1;border:0;display:block;" ` +
      `allow="fullscreen" allowfullscreen ` +
      `loading="lazy" referrerpolicy="strict-origin-when-cross-origin" ` +
      `title="SAIVD verified image"></iframe>` +
      `</div>`;

    return oembedJson({
      type: "rich",
      title: "Verified image — SAIVD",
      html,
      width,
      height,
    });
  }

  const {width, height} = fitToBox(maxwidth, maxheight, 16 / 9);
  const embedUrl = `${APP_URL}/embed/${parsed.id}`;
  const html =
    `<div style="width:100%;max-width:100%;margin:0 auto;">` +
    `<iframe src="${embedUrl}" ` +
    `style="width:100%;aspect-ratio:16/9;border:0;display:block;" ` +
    `allow="autoplay; fullscreen; picture-in-picture" allowfullscreen ` +
    `loading="lazy" referrerpolicy="strict-origin-when-cross-origin" ` +
    `title="SAIVD verified video"></iframe>` +
    `</div>`;

  return oembedJson({
    type: "video",
    title: "Verified video — SAIVD",
    html,
    width,
    height,
  });
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

function oembedJson(payload: {
  type: "video" | "rich";
  title: string;
  html: string;
  width: number;
  height: number;
}) {
  return NextResponse.json(
    {
      type: payload.type,
      version: "1.0",
      provider_name: "SAIVD",
      provider_url: APP_URL,
      title: payload.title,
      html: payload.html,
      width: payload.width,
      height: payload.height,
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
    },
  );
}

function parseSaivdUrl(input: string): ParsedSaivdUrl | null {
  try {
    const u = new URL(input);
    const expected = new URL(APP_URL).host;
    if (u.host !== expected) return null;

    const videoMatch = u.pathname.match(/^\/(?:v|embed)\/([a-zA-Z0-9-]+)\/?$/);
    if (videoMatch) return {kind: "video", id: videoMatch[1]};

    const imageMatch = u.pathname.match(/^\/(?:i|embed\/i)\/([a-zA-Z0-9-]+)\/?$/);
    if (imageMatch) return {kind: "image", id: imageMatch[1]};

    return null;
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
