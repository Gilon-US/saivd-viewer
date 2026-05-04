-- ============================================================
-- SAIVD-VIEWER Settings / Admin migrations — ROLLBACK
-- Date: 2026-05-04
-- ============================================================

DROP POLICY IF EXISTS "Service role inserts audit log" ON public.admin_audit_log;
DROP POLICY IF EXISTS "Staff can read audit log" ON public.admin_audit_log;
DROP TABLE IF EXISTS public.admin_audit_log CASCADE;

DROP TRIGGER IF EXISTS profiles_guard_role_change ON public.profiles;
DROP FUNCTION IF EXISTS public.guard_profile_role_change();

GRANT UPDATE (role) ON public.profiles TO authenticated;

DROP POLICY IF EXISTS "Users can update profiles (self or staff)" ON public.profiles;
DROP POLICY IF EXISTS "Users can view profiles (self or staff)" ON public.profiles;
CREATE POLICY "Users can view their own profile"
  ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE USING (auth.uid() = id);

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS role;
