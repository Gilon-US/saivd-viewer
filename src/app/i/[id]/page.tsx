import type {Metadata} from "next";
import {PublicImageView} from "@/components/image/PublicImageView";
import {getPublicImageViewData} from "@/lib/image-view-url";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://viewer.saivd.io";

export const revalidate = 60;

type Params = {id: string};

export async function generateMetadata({params}: {params: Promise<Params>}): Promise<Metadata> {
  const {id} = await params;
  const watchUrl = `${APP_URL}/i/${id}`;
  const embedUrl = `${APP_URL}/embed/i/${id}`;
  const fallbackImage = `${APP_URL}/images/saivd-logo.png`;

  return {
    title: "Verified image — SAIVD",
    description: "Cryptographically verified image, watermarked at the source.",
    openGraph: {
      type: "website",
      url: watchUrl,
      title: "Verified image — SAIVD",
      images: [{url: fallbackImage, width: 1200, height: 630}],
    },
    alternates: {
      types: {
        "application/json+oembed": `${APP_URL}/api/oembed?url=${encodeURIComponent(watchUrl)}&format=json`,
      },
    },
    other: {
      "twitter:card": "summary_large_image",
      "og:video": embedUrl,
    },
  };
}

export default async function PublicImagePage({params}: {params: Promise<Params>}) {
  const {id} = await params;
  const result = await getPublicImageViewData(id);

  return (
    <PublicImageView
      imageId={id}
      initialViewUrl={result.ok ? result.viewUrl : null}
      initialError={result.ok ? null : {code: result.code, message: result.message, status: result.status}}
    />
  );
}
