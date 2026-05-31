import {NextRequest, NextResponse} from "next/server";
import {createClient} from "@/utils/supabase/server";
import {extractKeyFromUrl, generatePresignedVideoUrl} from "@/lib/wasabi-urls";

/** Authenticated view URL for dashboard lightbox + verification (redirects to Wasabi). */
export async function GET(_request: NextRequest, context: {params: Promise<{id: string}>}) {
  try {
    const {id: imageId} = await context.params;
    const supabase = await createClient();
    const {
      data: {user},
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        {success: false, error: {code: "unauthorized", message: "Authentication required"}},
        {status: 401},
      );
    }

    const {data: image, error} = await supabase
      .from("images")
      .select("id, user_id, original_url, processed_url")
      .eq("id", imageId)
      .eq("user_id", user.id)
      .single();

    if (error || !image) {
      return NextResponse.json(
        {success: false, error: {code: "not_found", message: "Image not found"}},
        {status: 404},
      );
    }

    const storageRef = image.processed_url || image.original_url;
    if (!storageRef) {
      return NextResponse.json(
        {success: false, error: {code: "not_found", message: "Image file not available"}},
        {status: 404},
      );
    }

    let key = storageRef;
    if (key.startsWith("http")) {
      const extracted = extractKeyFromUrl(key);
      if (!extracted) {
        return NextResponse.json(
          {success: false, error: {code: "invalid_data", message: "Invalid storage key"}},
          {status: 500},
        );
      }
      key = extracted;
    }

    const viewUrl = await generatePresignedVideoUrl(key);

    return NextResponse.redirect(viewUrl, 307);
  } catch (error) {
    console.error("[images/view] error:", error);
    return NextResponse.json(
      {success: false, error: {code: "server_error", message: "Failed to load image"}},
      {status: 500},
    );
  }
}
