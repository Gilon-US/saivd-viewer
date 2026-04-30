import {createClient} from "@supabase/supabase-js";

/**
 * Service-role Supabase client for trusted, server-side reads/writes that need to
 * bypass row-level security. NEVER import this from a Client Component or expose the
 * resulting client to the browser.
 *
 * Used by /api/public/videos/[id]/play to look up a video by id without an
 * authenticated user session. The `videos` table has RLS scoped to
 * `auth.uid() = user_id`, so an anonymous client cannot read rows even by id; this
 * helper allows the controlled public-play endpoint to do that lookup while keeping
 * the table locked down to direct anon-key access.
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY in the server environment. Throws if missing so
 * misconfiguration fails fast rather than silently returning empty rows.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is not configured");
  }
  if (!serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not configured. " +
        "Required for server-side RLS bypass on /api/public/* routes."
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
