import {NextResponse} from "next/server";
import {createClient} from "@/utils/supabase/server";

const PROFILE_COLUMNS = "id, email, display_name, role, created_at, updated_at";

export async function GET() {
  const supabase = await createClient();
  const {
    data: {user},
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({success: false, error: "Auth required"}, {status: 401});

  const {data, error} = await supabase
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("id", user.id)
    .single();

  if (error || !data) {
    return NextResponse.json({success: false, error: "Profile not found"}, {status: 404});
  }
  return NextResponse.json({success: true, data});
}

export async function PUT(request: Request) {
  const supabase = await createClient();
  const {
    data: {user},
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({success: false, error: "Auth required"}, {status: 401});

  const body = (await request.json()) as {display_name?: string | null};
  const updates: Record<string, unknown> = {};
  if (typeof body.display_name === "string") {
    if (body.display_name.length < 2 || body.display_name.length > 50) {
      return NextResponse.json(
        {success: false, error: "Display name must be 2–50 chars"},
        {status: 400}
      );
    }
    updates.display_name = body.display_name;
  }
  updates.updated_at = new Date().toISOString();

  const {data, error} = await supabase
    .from("profiles")
    .update(updates)
    .eq("id", user.id)
    .select(PROFILE_COLUMNS)
    .single();
  if (error || !data) {
    return NextResponse.json({success: false, error: "Update failed"}, {status: 500});
  }
  return NextResponse.json({success: true, data});
}
