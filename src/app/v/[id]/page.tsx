import type {Metadata} from "next";
import {PublicVideoView} from "./_view";
import {getPublicPlaybackData} from "@/lib/playback-url";

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://viewer.saivd.io";

/** ISR: regenerate the rendered page (and its prefetched presigned URL) every
 *  60s. Well under the 1-hour Wasabi presign expiry, so cached pages always
 *  have a valid URL. Saves Supabase + Wasabi calls on repeat traffic. */
export const revalidate = 60;

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

/**
 * Server-component shell. Resolves the presigned playback URL during render
 * and passes it to the client view as `initialPlaybackUrl`, eliminating the
 * client-side fetch round-trip for the common path. If the prefetch fails,
 * pass null and let the client view fall back to its own fetch — the existing
 * /api/public/videos/[id]/play endpoint handles all the same error cases.
 *
 * Cache-Control on this page is intentionally short (60s) because the rendered
 * HTML now contains a presigned URL that expires in 1 hour.
 */
export default async function PublicVideoPage({params}: {params: Promise<Params>}) {
  const {id} = await params;
  const result = await getPublicPlaybackData(id, "watermarked");

  return (
    <PublicVideoView
      videoId={id}
      initialPlaybackUrl={result.ok ? result.playbackUrl : null}
      initialError={result.ok ? null : {code: result.code, message: result.message, status: result.status}}
    />
  );
}
