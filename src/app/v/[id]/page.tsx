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
