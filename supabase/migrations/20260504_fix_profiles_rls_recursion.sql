-- Fix infinite recursion in profiles RLS policies.
-- The SELECT/UPDATE policies referenced public.profiles inside their own USING clause,
-- which caused Postgres to recurse infinitely. The fix is a SECURITY DEFINER function
-- that reads the caller's role without triggering RLS.

CREATE OR REPLACE FUNCTION public.get_my_profile_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

-- Recreate SELECT policy using the helper instead of a self-referencing subquery
DROP POLICY IF EXISTS "Users can view profiles (self or staff)" ON public.profiles;
CREATE POLICY "Users can view profiles (self or staff)"
  ON public.profiles FOR SELECT
  USING (
    auth.uid() = id
    OR public.get_my_profile_role() IN ('admin', 'superuser')
  );

-- Recreate UPDATE policy the same way
DROP POLICY IF EXISTS "Users can update profiles (self or staff)" ON public.profiles;
CREATE POLICY "Users can update profiles (self or staff)"
  ON public.profiles FOR UPDATE
  USING (
    auth.uid() = id
    OR public.get_my_profile_role() IN ('admin', 'superuser')
  );
