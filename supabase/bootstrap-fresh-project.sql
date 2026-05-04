-- ============================================================
-- SAIVD-VIEWER Full Bootstrap — run once in Supabase SQL Editor
-- for a fresh project that has never had the profiles table.
-- ============================================================

-- ── 0. Prerequisites ─────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── 1. Create profiles table ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profiles (
  id           UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  display_name TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ── 2. Auto-create profile on new user signup ─────────────────
DROP TRIGGER IF EXISTS handle_new_user_trigger ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (NEW.id, NEW.email, split_part(NEW.email, '@', 1))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER handle_new_user_trigger
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Auto-update updated_at
DROP TRIGGER IF EXISTS update_profiles_updated_at ON public.profiles;

CREATE OR REPLACE FUNCTION public.update_profiles_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_profiles_updated_at_column();

-- ── 3. Backfill profiles for existing auth.users ─────────────
-- Inserts a profile row for any user that signed up before this table existed.
INSERT INTO public.profiles (id, email, display_name)
SELECT id, email, split_part(email, '@', 1)
FROM auth.users
ON CONFLICT (id) DO NOTHING;

-- ── 4. Add role column ────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('user', 'admin', 'superuser'));

COMMENT ON COLUMN public.profiles.role IS 'Application-level role: user, admin, or superuser';

UPDATE public.profiles SET role = 'user' WHERE role IS NULL;

-- ── 5. RLS policies (self-or-staff) ──────────────────────────
DROP POLICY IF EXISTS "Users can view their own profile"           ON public.profiles;
DROP POLICY IF EXISTS "Users can update their own profile"         ON public.profiles;
DROP POLICY IF EXISTS "Users can insert their own profile"         ON public.profiles;
DROP POLICY IF EXISTS "Users can view profiles (self or admin)"    ON public.profiles;
DROP POLICY IF EXISTS "Users can view profiles (self or staff)"    ON public.profiles;
DROP POLICY IF EXISTS "Users can update profiles (self or admin)"  ON public.profiles;
DROP POLICY IF EXISTS "Users can update profiles (self or staff)"  ON public.profiles;

CREATE POLICY "Users can view profiles (self or staff)"
  ON public.profiles FOR SELECT
  USING (
    auth.uid() = id
    OR EXISTS (
      SELECT 1 FROM public.profiles p_staff
      WHERE p_staff.id = auth.uid()
        AND p_staff.role IN ('admin', 'superuser')
    )
  );

CREATE POLICY "Users can update profiles (self or staff)"
  ON public.profiles FOR UPDATE
  USING (
    auth.uid() = id
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'superuser')
    )
  );

CREATE POLICY "Users can insert their own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

GRANT SELECT, UPDATE, INSERT ON public.profiles TO authenticated;

-- ── 6. Block direct role mutations from auth client ───────────
REVOKE UPDATE (role) ON public.profiles FROM authenticated, anon;

-- ── 7. Guard trigger: only service_role may change role ───────
CREATE OR REPLACE FUNCTION public.guard_profile_role_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
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

-- ── 8. admin_audit_log ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id          BIGSERIAL PRIMARY KEY,
  actor_id    UUID        NOT NULL REFERENCES auth.users(id),
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

DROP POLICY IF EXISTS "Staff can read audit log"        ON public.admin_audit_log;
DROP POLICY IF EXISTS "Service role inserts audit log"  ON public.admin_audit_log;

CREATE POLICY "Staff can read audit log"
  ON public.admin_audit_log FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role IN ('admin', 'superuser')
    )
    OR (SELECT lower(trim(email)) FROM public.profiles WHERE id = auth.uid())
       = lower(trim('elon@saivd.io'))
  );

CREATE POLICY "Service role inserts audit log"
  ON public.admin_audit_log FOR INSERT
  TO service_role WITH CHECK (true);

GRANT SELECT ON public.admin_audit_log TO authenticated;
GRANT INSERT ON public.admin_audit_log TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.admin_audit_log_id_seq TO service_role;

COMMENT ON TABLE public.admin_audit_log IS 'Staff actions: role changes, profile edits, etc.';

-- ── 9. Promote bootstrap superuser ────────────────────────────
UPDATE public.profiles
   SET role = 'superuser', updated_at = NOW()
 WHERE lower(trim(email)) = 'elon@saivd.io';
