import {EmbedVideoView} from "./_view";
import {getPublicPlaybackData} from "@/lib/playback-url";

/** ISR: regenerate the rendered embed (and its prefetched presigned URL)
 *  every 60s. Well under the 1-hour Wasabi presign expiry. */
export const revalidate = 60;

type Params = {id: string};

/**
 * Server-component shell for /embed/[id]. Resolves the presigned playback URL
 * during render and passes it to the client view, eliminating the client-side
 * fetch round-trip for the common path. If the prefetch fails, pass null and
 * let the client view fall back to its own fetch.
 *
 * Cache-Control on this page is intentionally short (60s) because the rendered
 * HTML now contains a presigned URL that expires in 1 hour. Anything longer
 * risks serving stale URLs to embedders.
 */
export default async function EmbedVideoPage({params}: {params: Promise<Params>}) {
  const {id} = await params;
  const result = await getPublicPlaybackData(id, "watermarked");

  return (
    <EmbedVideoView
      videoId={id}
      initialPlaybackUrl={result.ok ? result.playbackUrl : null}
      initialError={
        result.ok ? null : {code: result.code, message: result.message, status: result.status}
      }
    />
  );
}
