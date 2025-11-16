-- Migration: Remove Public Sharing and Profile Features
-- Date: 2025-01-13
-- Description: Removes public access tokens table and simplifies profiles table

-- Drop public access tokens table (if it exists)
DROP TABLE IF EXISTS public.public_access_tokens CASCADE;

-- Remove photo column from profiles
ALTER TABLE public.profiles 
DROP COLUMN IF EXISTS photo;

-- Remove avatar_url and bio columns (not needed for simple authentication)
ALTER TABLE public.profiles 
DROP COLUMN IF EXISTS avatar_url;

ALTER TABLE public.profiles 
DROP COLUMN IF EXISTS bio;

-- Drop existing public read policy for profiles
DROP POLICY IF EXISTS "Allow public read access to profiles" ON public.profiles;

-- Recreate policies to ensure only authenticated users can access their own profiles
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;

CREATE POLICY "Users can view their own profile"
  ON public.profiles
  FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
  ON public.profiles
  FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Users can insert their own profile"
  ON public.profiles
  FOR INSERT
  WITH CHECK (auth.uid() = id);

-- Update user_video_dashboard view to ensure it doesn't reference public access data
DROP VIEW IF EXISTS public.user_video_dashboard;

CREATE OR REPLACE VIEW public.user_video_dashboard AS
SELECT 
  v.id AS video_id,
  v.user_id,
  v.filename,
  v.filesize,
  v.content_type,
  v.original_url,
  v.original_thumbnail_url,
  v.upload_date,
  v.created_at,
  v.updated_at
FROM 
  public.videos v
ORDER BY 
  v.upload_date DESC;

-- Add comment
COMMENT ON TABLE public.profiles IS 'Simplified user profiles for authentication only';
COMMENT ON VIEW public.user_video_dashboard IS 'Dashboard view showing only authenticated user videos';
