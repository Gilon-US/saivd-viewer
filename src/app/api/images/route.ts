import {NextRequest, NextResponse} from "next/server";
import {createClient} from "@/utils/supabase/server";
import {generatePresignedVideoUrl} from "@/lib/wasabi-urls";

export async function GET(request: NextRequest) {
  try {
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

    const url = new URL(request.url);
    const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") ?? "20", 10)));
    const from = (page - 1) * limit;

    const {data: images, error, count} = await supabase
      .from("images")
      .select("*", {count: "exact"})
      .eq("user_id", user.id)
      .order("created_at", {ascending: false})
      .range(from, from + limit - 1);

    if (error) {
      console.error("[images] fetch failed:", error);
      return NextResponse.json(
        {success: false, error: {code: "database_error", message: "Failed to fetch images"}},
        {status: 500},
      );
    }

    const resolved = await Promise.all(
      (images ?? []).map(async (img) => {
        const key = img.original_url;
        let original_url = key;
        if (key && !key.startsWith("http")) {
          try {
            original_url = await generatePresignedVideoUrl(key);
          } catch {
            original_url = key;
          }
        }
        return {...img, original_url};
      }),
    );

    return NextResponse.json({
      success: true,
      data: {
        images: resolved,
        pagination: {
          page,
          limit,
          total: count ?? 0,
          totalPages: count ? Math.ceil(count / limit) : 0,
        },
      },
    });
  } catch (error) {
    console.error("[images] unhandled:", error);
    return NextResponse.json(
      {success: false, error: {code: "server_error", message: "Server error"}},
      {status: 500},
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
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

    const id = new URL(request.url).searchParams.get("id");
    if (!id) {
      return NextResponse.json(
        {success: false, error: {code: "validation_error", message: "Missing id parameter"}},
        {status: 400},
      );
    }

    const {error} = await supabase.from("images").delete().eq("id", id).eq("user_id", user.id);
    if (error) {
      return NextResponse.json(
        {success: false, error: {code: "database_error", message: "Failed to delete image"}},
        {status: 500},
      );
    }

    return NextResponse.json({success: true});
  } catch (error) {
    console.error("[images] delete failed:", error);
    return NextResponse.json(
      {success: false, error: {code: "server_error", message: "Server error"}},
      {status: 500},
    );
  }
}
