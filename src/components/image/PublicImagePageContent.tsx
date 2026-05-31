import {preload} from "react-dom";
import {PublicImageShell} from "@/components/image/PublicImageShell";
import {PublicImageView} from "@/components/image/PublicImageView";
import type {ImageViewResult} from "@/lib/image-view-url";

type PublicImagePageContentProps = {
  imageId: string;
  result: ImageViewResult;
  embed?: boolean;
};

export function PublicImagePageContent({imageId, result, embed = false}: PublicImagePageContentProps) {
  if (!result.ok) {
    return (
      <PublicImageView
        imageId={imageId}
        embed={embed}
        initialViewUrl={null}
        initialError={{code: result.code, message: result.message, status: result.status}}
      />
    );
  }

  preload(result.viewUrl, {as: "image", crossOrigin: "anonymous"});

  return (
    <>
      <link rel="preload" as="image" href={result.viewUrl} crossOrigin="anonymous" />
      <PublicImageShell viewUrl={result.viewUrl} imageId={imageId} embed={embed}>
        <PublicImageView
          imageId={imageId}
          embed={embed}
          initialViewUrl={result.viewUrl}
          initialError={null}
          ssrImage
        />
      </PublicImageShell>
    </>
  );
}
