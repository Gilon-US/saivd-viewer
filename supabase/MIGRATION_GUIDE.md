# SAIVD Viewer - Database Migration Guide

## Overview
This guide will help you set up the Supabase database for SAIVD Viewer using your cloud account.

**Your Supabase Project**: `olynenlvldvpqshbckzj`  
**Dashboard URL**: https://supabase.com/dashboard/project/olynenlvldvpqshbckzj

## What This Migration Does

✅ Creates `videos` table for video metadata  
✅ Creates simplified `profiles` table (authentication only)  
✅ Sets up Row Level Security (RLS) policies  
✅ Removes watermarking infrastructure  
✅ Removes public sharing features  
✅ Creates necessary triggers and functions  

## Migration Steps

### Option A: Using Supabase Dashboard (Recommended)

1. **Open Supabase Dashboard**
   - Go to: https://supabase.com/dashboard/project/olynenlvldvpqshbckzj
   - Login with your credentials

2. **Navigate to SQL Editor**
   - Click "SQL Editor" in the left sidebar
   - Click "New Query"

3. **Run the Migration**
   - Open the file: `supabase/migrations/CONSOLIDATED_MIGRATION.sql`
   - Copy the entire contents
   - Paste into the SQL Editor
   - Click "Run" (or press Cmd/Ctrl + Enter)

4. **Verify Success**
   - You should see: "Migration completed successfully!" in the output
   - Check the "Table Editor" to verify `videos` and `profiles` tables exist

### Option B: Using Supabase CLI (Alternative)

If you have the Supabase CLI installed:

```bash
# Install CLI if needed
npm install -g supabase

# Login to Supabase
supabase login

# Link to your project
supabase link --project-ref olynenlvldvpqshbckzj

# Push the migration
supabase db push
```

## Verification Checklist

After running the migration, verify:

- [ ] `videos` table exists with correct columns
- [ ] `profiles` table exists (simplified, no photo/bio columns)
- [ ] RLS policies are enabled on both tables
- [ ] `user_video_dashboard` view exists
- [ ] No `watermarked_videos` or `watermarking_jobs` tables
- [ ] No `public_access_tokens` table

## Testing the Setup

1. **Test Authentication**
   - Register a new user in your app
   - Verify a profile is automatically created

2. **Test Video Upload**
   - Upload a video through your app
   - Verify it appears in the `videos` table
   - Verify you can only see your own videos

3. **Test RLS**
   - Create a second user
   - Verify users can't see each other's videos

## Troubleshooting

### Error: "relation already exists"
This is normal if tables already exist. The script is idempotent and will update existing tables.

### Error: "permission denied"
Make sure you're logged in with admin/owner access to the Supabase project.

### Error: "could not find table"
The tables will be created by this migration. Run the full script.

## Rollback (If Needed)

If you need to rollback:

1. Run `supabase/migrations/20250113_remove_watermarking_tables_rollback.sql`
2. Run `supabase/migrations/20250113_remove_public_sharing_profiles_rollback.sql`

## Next Steps

After successful migration:

1. ✅ Test user registration
2. ✅ Test video upload
3. ✅ Test video playback
4. ✅ Deploy frontend changes
5. ✅ Update documentation

## Support

If you encounter issues:
- Check Supabase logs in Dashboard > Logs
- Review RLS policies in Dashboard > Authentication > Policies
- Check table structure in Dashboard > Table Editor
