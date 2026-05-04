import {NextRequest, NextResponse} from "next/server";
import {requireAdminUser} from "@/utils/admin";
import {requireRole} from "@/utils/auth-roles";
import {createServiceRoleClient} from "@/utils/supabase/admin";
import {isBootstrapSuperuserEmail} from "@/lib/bootstrap-superuser";
import {writeAudit} from "@/utils/audit";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isValidUUID = (id: string) => UUID_RE.test(id);
const COLUMNS = "id, email, display_name, role";

export async function GET(_req: NextRequest, ctx: {params: Promise<{id: string}>}) {
  const {id} = await ctx.params;
  if (!isValidUUID(id))
    return NextResponse.json({success: false, error: "Invalid user ID"}, {status: 400});

  const {supabase, error} = await requireAdminUser();
  if (error) return NextResponse.json({success: false, error: error.message}, {status: error.status});

  const {data, error: fetchErr} = await supabase
    .from("profiles")
    .select(COLUMNS)
    .eq("id", id)
    .single();
  if (fetchErr || !data)
    return NextResponse.json({success: false, error: "User not found"}, {status: 404});

  return NextResponse.json({success: true, data});
}

export async function PUT(request: NextRequest, ctx: {params: Promise<{id: string}>}) {
  const {id} = await ctx.params;
  if (!isValidUUID(id))
    return NextResponse.json({success: false, error: "Invalid user ID"}, {status: 400});

  const body = (await request.json()) as {display_name?: string | null};
  if (
    body.display_name !== undefined &&
    body.display_name !== null &&
    (typeof body.display_name !== "string" ||
      body.display_name.length < 2 ||
      body.display_name.length > 50)
  ) {
    return NextResponse.json(
      {success: false, error: "Display name must be 2–50 chars"},
      {status: 400}
    );
  }

  const {supabase, error: gateErr} = await requireAdminUser();
  if (gateErr)
    return NextResponse.json({success: false, error: gateErr.message}, {status: gateErr.status});

  const {
    data: {user},
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({success: false, error: "Auth required"}, {status: 401});

  const {data: before, error: beforeErr} = await supabase
    .from("profiles")
    .select(COLUMNS)
    .eq("id", id)
    .single();
  if (beforeErr || !before)
    return NextResponse.json({success: false, error: "User not found"}, {status: 404});

  const svc = createServiceRoleClient();
  const updates: Record<string, unknown> = {updated_at: new Date().toISOString()};
  if (body.display_name !== undefined) updates.display_name = body.display_name;

  const {data: after, error: updErr} = await svc
    .from("profiles")
    .update(updates)
    .eq("id", id)
    .select(`${COLUMNS}, updated_at`)
    .single();
  if (updErr || !after)
    return NextResponse.json({success: false, error: "Failed to update"}, {status: 500});

  try {
    await writeAudit({
      actorId: user.id,
      action: "edit_user_profile",
      targetId: id,
      before: {display_name: before.display_name},
      after: {display_name: after.display_name},
      request,
    });
  } catch (e) {
    console.error("audit failed (profile saved):", e);
  }

  return NextResponse.json({success: true, data: after});
}

export async function DELETE(request: NextRequest, ctx: {params: Promise<{id: string}>}) {
  const {id} = await ctx.params;
  if (!isValidUUID(id))
    return NextResponse.json({success: false, error: "Invalid user ID"}, {status: 400});

  const {user, error} = await requireRole(["superuser"]);
  if (error) return NextResponse.json({success: false, error: error.message}, {status: error.status});
  if (id === user.id)
    return NextResponse.json({success: false, error: "Cannot delete yourself"}, {status: 400});

  const svc = createServiceRoleClient();
  const {data: target} = await svc
    .from("profiles")
    .select("id, email, display_name, role")
    .eq("id", id)
    .single();
  if (!target) return NextResponse.json({success: false, error: "User not found"}, {status: 404});
  if (isBootstrapSuperuserEmail(target.email)) {
    return NextResponse.json(
      {success: false, error: "Cannot delete the platform superuser"},
      {status: 403}
    );
  }

  const {error: delErr} = await svc.auth.admin.deleteUser(id);
  if (delErr)
    return NextResponse.json({success: false, error: "Failed to delete user"}, {status: 500});

  try {
    await writeAudit({
      actorId: user.id,
      action: "delete_user",
      targetId: id,
      before: {email: target.email, display_name: target.display_name, role: target.role},
      after: null,
      request,
    });
  } catch (e) {
    console.error("audit failed (user deleted):", e);
  }

  return NextResponse.json({success: true});
}
