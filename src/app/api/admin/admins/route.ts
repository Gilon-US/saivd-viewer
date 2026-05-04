import {NextResponse} from "next/server";
import {BOOTSTRAP_SUPERUSER_EMAIL} from "@/lib/bootstrap-superuser";
import {requireStaff} from "@/utils/auth-roles";

const SUMMARY = "id, display_name, email, role";

export async function GET() {
  const {supabase, error} = await requireStaff();
  if (error) return NextResponse.json({success: false, error: error.message}, {status: error.status});

  const {data: bootstrapRows} = await supabase
    .from("profiles")
    .select(SUMMARY)
    .ilike("email", BOOTSTRAP_SUPERUSER_EMAIL)
    .limit(1);
  const {data: superuserRow} = await supabase
    .from("profiles")
    .select(SUMMARY)
    .eq("role", "superuser")
    .limit(2);
  const {data: admins} = await supabase
    .from("profiles")
    .select(SUMMARY)
    .eq("role", "admin")
    .order("email", {ascending: true});

  const bootstrap = bootstrapRows?.[0] ?? null;
  const fromDbRole = superuserRow?.[0] ?? null;
  const superuser = bootstrap ? {...bootstrap, role: "superuser"} : fromDbRole;

  return NextResponse.json({
    success: true,
    data: {
      superuser,
      admins: admins ?? [],
      adminCount: admins?.length ?? 0,
      adminCap: 3,
    },
  });
}
