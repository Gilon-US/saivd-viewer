import {PublicImageView} from "@/components/image/PublicImageView";
import {getPublicImageViewData} from "@/lib/image-view-url";

export const revalidate = 60;

type Params = {id: string};

export default async function EmbedImagePage({params}: {params: Promise<Params>}) {
  const {id} = await params;
  const result = await getPublicImageViewData(id);

  return (
    <PublicImageView
      imageId={id}
      embed
      initialViewUrl={result.ok ? result.viewUrl : null}
      initialError={result.ok ? null : {code: result.code, message: result.message, status: result.status}}
    />
  );
}
