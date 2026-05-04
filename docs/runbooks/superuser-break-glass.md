# Superuser break-glass (saivd-viewer)

Use only when the superuser cannot sign in or the role-change flow is unavailable.

1. Connect with the **Supabase service role** (or the SQL editor as a privileged role that bypasses RLS and the role-change trigger).
2. Confirm the auth user exists in `auth.users` and note `id`.
3. Update the existing profile row:

   ```sql
   UPDATE public.profiles
      SET role = 'superuser', updated_at = NOW()
    WHERE lower(trim(email)) = 'elon@saivd.io';
   ```

4. If no profile row exists, sign in once with that email so the auto-create trigger fires, then re-run step 3.
5. Verify `SELECT COUNT(*) FROM public.profiles WHERE role = 'superuser';` returns `1`.
6. Insert a manual row in `admin_audit_log` describing the incident and rotate credentials.
