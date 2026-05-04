-- ============================================================
-- SAIVD-VIEWER Settings / Admin migrations — apply once in SQL Editor
-- Date: 2026-05-04
-- Notes:
--   * profiles in saivd-viewer is the slim schema: id, email, display_name,
--     created_at, updated_at (see 20250113_remove_public_sharing_profiles.sql).
--   * This adds a `role` column (none currently exists), staff RLS, role-change
--     guard trigger, and the admin_audit_log table.
-- ============================================================

-- ── 1. profiles: add role column with the canonical 3-value check ─────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('user', 'admin', 'superuser'));

COMMENT ON COLUMN public.profiles.role IS 'Application-level role: user, admin, or superuser';

-- Backfill for existing rows is a no-op because of the DEFAULT, but make it explicit:
UPDATE public.profiles SET role = 'user' WHERE role IS NULL;

-- ── 2. profiles: replace self-only RLS with self-or-staff RLS ─────────
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can view profiles (self or admin)" ON public.profiles;
DROP POLICY IF EXISTS "Users can view profiles (self or staff)" ON public.profiles;
DROP POLICY IF EXISTS "Users can update profiles (self or admin)" ON public.profiles;
DROP POLICY IF EXISTS "Users can update profiles (self or staff)" ON public.profiles;

CREATE POLICY "Users can view profiles (self or staff)"
  ON public.profiles
  FOR SELECT
  USING (
    auth.uid() = id
    OR EXISTS (
      SELECT 1 FROM public.profiles p_staff
      WHERE p_staff.id = auth.uid()
        AND p_staff.role IN ('admin', 'superuser')
    )
  );

CREATE POLICY "Users can update profiles (self or staff)"
  ON public.profiles
  FOR UPDATE
  USING (
    auth.uid() = id
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'superuser')
    )
  );

-- INSERT policy is unchanged (matches viewer's existing fix_profiles_permissions.sql):
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
CREATE POLICY "Users can insert their own profile"
  ON public.profiles
  FOR INSERT
  WITH CHECK (auth.uid() = id);

-- ── 3. Block direct role column updates from the auth client ──────────
REVOKE UPDATE (role) ON public.profiles FROM authenticated, anon;

-- ── 4. Guard trigger: only service_role can mutate role ───────────────
CREATE OR REPLACE FUNCTION public.guard_profile_role_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  jwt_role text;
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    jwt_role := coalesce(nullif(trim(current_setting('request.jwt.claim.role', true)), ''), '');
    IF current_user IN ('postgres', 'supabase_admin', 'service_role')
       OR jwt_role = 'service_role' THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'role changes must go through the admin API';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_guard_role_change ON public.profiles;
CREATE TRIGGER profiles_guard_role_change
  BEFORE UPDATE OF role ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_profile_role_change();

-- ── 5. admin_audit_log table ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id          BIGSERIAL PRIMARY KEY,
  actor_id    UUID        NOT NULL REFERENCES auth.users (id),
  action      TEXT        NOT NULL,
  target_id   UUID,
  "before"    JSONB,
  "after"     JSONB,
  ip          TEXT,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS admin_audit_log_actor_idx  ON public.admin_audit_log (actor_id,  created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_log_target_idx ON public.admin_audit_log (target_id, created_at DESC);

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can read audit log" ON public.admin_audit_log;
CREATE POLICY "Staff can read audit log"
  ON public.admin_audit_log
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'superuser')
    )
    OR (SELECT lower(trim(email)) FROM public.profiles WHERE id = auth.uid())
       = lower(trim('elon@saivd.io'))
  );

DROP POLICY IF EXISTS "Service role inserts audit log" ON public.admin_audit_log;
CREATE POLICY "Service role inserts audit log"
  ON public.admin_audit_log
  FOR INSERT
  TO service_role
  WITH CHECK (true);

GRANT SELECT ON public.admin_audit_log TO authenticated;
GRANT INSERT ON public.admin_audit_log TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.admin_audit_log_id_seq TO service_role;

COMMENT ON TABLE public.admin_audit_log IS 'Staff actions: role changes, profile edits, etc.';
