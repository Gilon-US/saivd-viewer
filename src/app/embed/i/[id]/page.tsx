import {PublicImagePageContent} from "@/components/image/PublicImagePageContent";
import {getPublicImageViewData} from "@/lib/image-view-url";

export const revalidate = 60;

type Params = {id: string};

export default async function EmbedImagePage({params}: {params: Promise<Params>}) {
  const {id} = await params;
  const result = await getPublicImageViewData(id);

  return <PublicImagePageContent imageId={id} result={result} embed />;
}
