import {NextRequest, NextResponse} from "next/server";
import {createClient} from "@supabase/supabase-js";

/**
 * GET /api/users/[numericUserId]/public-key
 *
 * Public, unauthenticated endpoint. Returns the RSA public key (PEM) for the
 * creator identified by numeric_user_id (decoded from the watermark).
 * Used by this app and third-party apps for watermark verification.
 */
export async function GET(
  _request: NextRequest,
  context: {params: Promise<{numericUserId: string}>}
) {
  const numericUserIdParam = (await context.params).numericUserId;

  const numericUserId = parseInt(numericUserIdParam, 10);
  if (
    Number.isNaN(numericUserId) ||
    numericUserId < 1 ||
    !Number.isSafeInteger(numericUserId)
  ) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "validation_error",
          message: "numericUserId must be a positive integer",
        },
      },
      {status: 400, headers: corsHeaders()}
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("[PublicKey] Missing Supabase config");
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "server_error",
          message: "Server configuration error",
        },
      },
      {status: 500, headers: corsHeaders()}
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const {data: profile, error} = await supabase
    .from("profiles")
    .select("id, public_key_pem")
    .eq("numeric_user_id", numericUserId)
    .single();

  if (error || !profile) {
    if (error?.code === "PGRST116") {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "not_found",
            message: "No profile found for this numeric user ID",
          },
        },
        {status: 404, headers: corsHeaders()}
      );
    }
    console.error("[PublicKey] Profile lookup error:", error?.message);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "server_error",
          message: "Failed to fetch public key",
        },
      },
      {status: 500, headers: corsHeaders()}
    );
  }

  if (!profile.public_key_pem) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "not_found",
          message: "Public key not available for this creator",
        },
      },
      {status: 404, headers: corsHeaders()}
    );
  }

  return NextResponse.json(
    {
      success: true,
      data: {
        public_key_pem: profile.public_key_pem,
        creator_user_id: profile.id ?? undefined,
      },
    },
    {headers: corsHeaders()}
  );
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export async function OPTIONS() {
  return new NextResponse(null, {status: 204, headers: corsHeaders()});
}
