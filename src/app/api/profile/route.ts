import {NextResponse} from "next/server";
import {profileWithBootstrapSuperuserRole} from "@/lib/bootstrap-superuser";
import {fetchProfileForUser, updateProfileForUser} from "@/lib/profile-db";
import {createClient} from "@/utils/supabase/server";
import {isQrOverlayPosition} from "@/lib/presentation-qr/position";

function displayNameFromUser(user: {email?: string | null; user_metadata?: Record<string, unknown>}) {
  const fromMeta = user.user_metadata?.display_name;
  if (typeof fromMeta === "string" && fromMeta.trim()) return fromMeta.trim();
  const email = user.email ?? "";
  const local = email.split("@")[0];
  return local || null;
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: {user},
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({success: false, error: "Auth required"}, {status: 401});

  const {data, error} = await fetchProfileForUser(supabase, user.id);

  if (error) {
    if (error.code === "PGRST116") {
      const now = new Date().toISOString();
      const insertPayload = {
        id: user.id,
        email: user.email || "",
        display_name: displayNameFromUser(user),
        created_at: now,
        updated_at: now,
      };

      const {error: createError} = await supabase.from("profiles").insert(insertPayload);
      if (createError && createError.code !== "23505") {
        console.error("Error creating profile:", createError);
        return NextResponse.json({success: false, error: "Failed to create profile"}, {status: 500});
      }

      const {data: created, error: fetchCreatedError} = await fetchProfileForUser(supabase, user.id);
      if (fetchCreatedError || !created) {
        console.error("Error fetching profile after create:", fetchCreatedError);
        return NextResponse.json({success: false, error: "Failed to create profile"}, {status: 500});
      }

      return NextResponse.json({success: true, data: profileWithBootstrapSuperuserRole(created)});
    }

    console.error("Error fetching profile:", error);
    return NextResponse.json({success: false, error: "Failed to fetch profile"}, {status: 500});
  }

  if (!data) {
    return NextResponse.json({success: false, error: "Profile not found"}, {status: 404});
  }

  return NextResponse.json({success: true, data: profileWithBootstrapSuperuserRole(data)});
}

export async function PUT(request: Request) {
  const supabase = await createClient();
  const {
    data: {user},
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({success: false, error: "Auth required"}, {status: 401});

  const body = (await request.json()) as {
    display_name?: string | null;
    qr_overlay_position?: string;
  };
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
  if (body.qr_overlay_position !== undefined) {
    if (!isQrOverlayPosition(body.qr_overlay_position)) {
      return NextResponse.json({success: false, error: "Invalid QR overlay position"}, {status: 400});
    }
    updates.qr_overlay_position = body.qr_overlay_position;
  }
  updates.updated_at = new Date().toISOString();

  const {data, error, qrColumnMissing} = await updateProfileForUser(supabase, user.id, updates);
  if (error) {
    if (qrColumnMissing) {
      return NextResponse.json(
        {success: false, error: error.message ?? "QR overlay preference unavailable"},
        {status: 503}
      );
    }
    return NextResponse.json({success: false, error: "Update failed"}, {status: 500});
  }
  if (!data) {
    return NextResponse.json({success: false, error: "Update failed"}, {status: 500});
  }
  return NextResponse.json({success: true, data: profileWithBootstrapSuperuserRole(data)});
}
