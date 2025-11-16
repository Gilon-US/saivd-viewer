# Backend Simplification Migration Guide

**Date**: 2025-01-13  
**Stories**: SAIVD-002-S1, SAIVD-002-S2  
**Impact**: Backend infrastructure removal

## Overview

This migration guide covers the removal of watermarking and public sharing/profile features from the SAIVD-Viewer application backend. These features are no longer needed as the application focuses on authenticated user video management only.

### Story 3.1: Watermarking Infrastructure Removal

This migration removes all watermarking-related backend infrastructure. The watermarking functionality is no longer needed as users will upload pre-watermarked videos.

## Breaking Changes

### Database Changes

**Tables Removed:**
- `watermarked_videos` - Stored watermarked video metadata
- `watermarking_jobs` - Tracked watermarking job status

**Views Removed:**
- `recent_watermarking_jobs` - Dashboard view for recent jobs

**Views Updated:**
- `user_video_dashboard` - Simplified to exclude watermarking columns

### API Endpoints Removed

The following API endpoints have been removed and will return 404:

- `POST /api/videos/[id]/watermark` - Request watermarking
- `GET /api/videos/[id]/watermark/status` - Check watermarking status
- `DELETE /api/videos/[id]/watermark` - Cancel watermarking
- `POST /api/callbacks/watermark` - Watermarking completion callback

### Code Removed

**Files Deleted:**
- `src/lib/watermark.ts` - Watermarking service client
- `src/lib/__tests__/watermark.test.ts` - Watermarking client tests
- `src/app/api/callbacks/watermark/route.ts` - Callback endpoint

**Environment Variables Removed:**
- `WATERMARK_SERVICE_URL` - Watermarking service API URL
- `WATERMARK_SERVICE_API_KEY` - Watermarking service API key

## Migration Steps

### 1. Database Migration

Run the migration script in your Supabase SQL editor:

```bash
# Apply migration
psql -f supabase/migrations/20250113_remove_watermarking_tables.sql
```

**Rollback (if needed):**
```bash
# Rollback migration
psql -f supabase/migrations/20250113_remove_watermarking_tables_rollback.sql
```

### 2. Environment Variables

Remove the following from your `.env` files:
- `.env.local`
- `.env.docker`
- `.env.docker.prod`

```bash
# Remove these lines:
WATERMARK_SERVICE_URL=...
WATERMARK_SERVICE_API_KEY=...
```

### 3. Code Deployment

Deploy the updated codebase:

```bash
# Build and deploy
npm run build
# Deploy to your hosting platform
```

### 4. Verification

After deployment, verify:

1. **Database**: Confirm tables are removed
   ```sql
   SELECT table_name FROM information_schema.tables 
   WHERE table_schema = 'public' 
   AND table_name LIKE '%watermark%';
   -- Should return 0 rows
   ```

2. **API Endpoints**: Confirm endpoints return 404
   ```bash
   curl -X POST https://your-domain.com/api/videos/test-id/watermark
   # Should return 404
   ```

3. **Video Management**: Test core functionality
   - Upload a video
   - List videos
   - Delete a video
   - All should work correctly

## Impact Assessment

### What Still Works ✅

- Video upload functionality
- Video storage (Wasabi)
- Video listing and management
- Video playback
- User authentication
- User isolation (RLS policies)

### What No Longer Works ❌

- Watermarking API integration
- Watermarking job tracking
- Watermarking callbacks
- Watermarked video storage

## Rollback Procedure

If issues arise, rollback using these steps:

1. **Restore Database Tables**
   ```bash
   psql -f supabase/migrations/20250113_remove_watermarking_tables_rollback.sql
   ```

2. **Restore Code**
   ```bash
   git revert <commit-hash>
   npm run build
   # Redeploy
   ```

3. **Restore Environment Variables**
   Add back the watermarking service configuration to your `.env` files

## Support

If you encounter issues during migration:

1. Check the debug log: `.ai/debug-log.md`
2. Review database migration logs
3. Verify all environment variables are correctly set
4. Test in staging environment first

---

### Story 3.2: Profile and Public Sharing Removal

This migration removes public profile pages and video sharing functionality.

#### Breaking Changes

**Database Changes:**
- `public_access_tokens` table removed
- `profiles` table simplified (removed `photo`, `avatar_url`, `bio` columns)
- Public read access policy removed from profiles

**API Endpoints Removed:**
- `GET /api/profile/[userId]` - Public profile viewing
- `PUT /api/profile/[userId]` - Profile updates
- All public URL generation endpoints

**Routes Removed:**
- `/profile/[userId]` - Public profile pages
- `/dashboard/profile` - User profile management page

#### Migration Steps

1. **Run Database Migration**
   ```bash
   psql -f supabase/migrations/20250113_remove_public_sharing_profiles.sql
   ```

2. **Verify Changes**
   ```sql
   -- Verify public_access_tokens table is removed
   SELECT table_name FROM information_schema.tables 
   WHERE table_schema = 'public' AND table_name = 'public_access_tokens';
   -- Should return 0 rows
   
   -- Verify profiles table simplified
   SELECT column_name FROM information_schema.columns 
   WHERE table_name = 'profiles' AND column_name IN ('photo', 'avatar_url', 'bio');
   -- Should return 0 rows
   ```

3. **Test Authentication**
   - Login still works
   - Logout still works
   - Session management functional
   - User isolation enforced

#### Rollback (if needed)
```bash
psql -f supabase/migrations/20250113_remove_public_sharing_profiles_rollback.sql
```

---

## Related Documentation

- Epic: `/docs/epics/simplify-saivd-viewer-epic.md`
- Story 3.1: `/docs/stories/3.1.remove-watermarking-backend-infrastructure.md`
- Story 3.2: `/docs/stories/3.2.remove-profile-and-public-sharing-features.md`
- Database Design: `/docs/architecture/03-database-design.md`
- API Architecture: `/docs/architecture/02-backend-api-architecture.md`

## Notes

- Frontend UI changes will be removed in Story 3.3
- These migrations only affect backend infrastructure
- User authentication remains fully functional
- Essential profile data (id, email, display_name) preserved for authentication
- No user data (uploaded videos) is affected
- Performance should improve due to reduced complexity
