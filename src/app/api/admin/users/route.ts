import {NextResponse} from "next/server";
import {requireAdminUser} from "@/utils/admin";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const page = Math.max(parseInt(url.searchParams.get("page") || "1", 10) || 1, 1);
    const limit = Math.min(
      Math.max(parseInt(url.searchParams.get("limit") || "20", 10) || 20, 1),
      100
    );

    const {supabase, error: gateErr} = await requireAdminUser();
    if (gateErr)
      return NextResponse.json({success: false, error: gateErr.message}, {status: gateErr.status});

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const {data, error, count} = await supabase
      .from("profiles")
      .select("id, display_name, email, role", {count: "exact"})
      .range(from, to)
      .order("email", {ascending: true});

    if (error) {
      console.error("GET /api/admin/users:", error);
      return NextResponse.json({success: false, error: "Failed to fetch users"}, {status: 500});
    }

    return NextResponse.json({
      success: true,
      data: data || [],
      pagination: {
        page,
        limit,
        total: count ?? 0,
        totalPages: count ? Math.ceil(count / limit) : 0,
      },
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({success: false, error: "Server error"}, {status: 500});
  }
}
