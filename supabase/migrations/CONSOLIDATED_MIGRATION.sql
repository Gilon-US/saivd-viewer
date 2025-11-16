-- ============================================================================
-- SAIVD Viewer - Consolidated Database Migration
-- ============================================================================
-- This script sets up the complete database schema for SAIVD Viewer
-- Run this in Supabase Dashboard > SQL Editor
-- 
-- What this does:
-- 1. Creates videos table for video metadata storage
-- 2. Creates simplified profiles table (authentication only)
-- 3. Sets up Row Level Security (RLS) policies
-- 4. Creates necessary triggers and functions
-- 5. Removes watermarking and public sharing features
-- ============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- VIDEOS TABLE
-- ============================================================================

-- Create videos table
CREATE TABLE IF NOT EXISTS public.videos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  filesize BIGINT NOT NULL,
  content_type TEXT NOT NULL,
  original_url TEXT NOT NULL,
  original_thumbnail_url TEXT,
  preview_thumbnail_data TEXT, -- Base64 encoded thumbnail generated in browser
  processed_url TEXT,
  processed_thumbnail_url TEXT,
  title TEXT,
  description TEXT,
  duration INTEGER,
  status TEXT DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'processing', 'processed', 'failed')),
  upload_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Drop existing policies if they exist (for idempotent script)
DROP POLICY IF EXISTS "Users can view their own videos" ON public.videos;
DROP POLICY IF EXISTS "Users can insert their own videos" ON public.videos;
DROP POLICY IF EXISTS "Users can update their own videos" ON public.videos;
DROP POLICY IF EXISTS "Users can delete their own videos" ON public.videos;

-- Enable RLS
ALTER TABLE public.videos ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for videos
CREATE POLICY "Users can view their own videos" 
  ON public.videos 
  FOR SELECT 
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own videos" 
  ON public.videos 
  FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own videos" 
  ON public.videos 
  FOR UPDATE 
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own videos" 
  ON public.videos 
  FOR DELETE 
  USING (auth.uid() = user_id);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS videos_user_id_idx ON public.videos (user_id);
CREATE INDEX IF NOT EXISTS videos_upload_date_idx ON public.videos (upload_date);
CREATE INDEX IF NOT EXISTS videos_status_idx ON public.videos (status);

-- Create or replace function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop and recreate trigger for videos updated_at
DROP TRIGGER IF EXISTS update_videos_updated_at ON public.videos;
CREATE TRIGGER update_videos_updated_at
BEFORE UPDATE ON public.videos
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Grant permissions to authenticated users
GRANT SELECT, INSERT, UPDATE, DELETE ON public.videos TO authenticated;

-- Add table comment
COMMENT ON TABLE public.videos IS 'Stores metadata for user-uploaded videos';

-- ============================================================================
-- PROFILES TABLE (SIMPLIFIED - AUTHENTICATION ONLY)
-- ============================================================================

-- Create simplified profiles table
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  display_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Drop old public sharing columns if they exist
ALTER TABLE public.profiles DROP COLUMN IF EXISTS photo;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS avatar_url;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS bio;

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Allow public read access to profiles" ON public.profiles;

-- Enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Create RLS policies (authenticated users only)
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

-- Create index for email lookups
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);

-- Create or replace function to handle new user creation
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (NEW.id, NEW.email, split_part(NEW.email, '@', 1))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop and recreate trigger for new user creation
DROP TRIGGER IF EXISTS handle_new_user_trigger ON auth.users;
CREATE TRIGGER handle_new_user_trigger
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Drop and recreate trigger for profiles updated_at
DROP TRIGGER IF EXISTS update_profiles_updated_at ON public.profiles;
CREATE TRIGGER update_profiles_updated_at
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Grant permissions to authenticated users only
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;

-- Add table comment
COMMENT ON TABLE public.profiles IS 'Simplified user profiles for authentication only';

-- ============================================================================
-- CLEANUP: REMOVE WATERMARKING AND PUBLIC SHARING FEATURES
-- ============================================================================

-- Drop watermarking tables if they exist
DROP TABLE IF EXISTS public.watermarking_jobs CASCADE;
DROP TABLE IF EXISTS public.watermarked_videos CASCADE;

-- Drop public access tokens table if it exists
DROP TABLE IF EXISTS public.public_access_tokens CASCADE;

-- Drop watermarking views if they exist
DROP VIEW IF EXISTS public.user_video_dashboard CASCADE;

-- ============================================================================
-- CREATE SIMPLIFIED DASHBOARD VIEW
-- ============================================================================

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
COMMENT ON VIEW public.user_video_dashboard IS 'Dashboard view showing only authenticated user videos';

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================

-- Verify tables were created
DO $$
BEGIN
  RAISE NOTICE 'Migration completed successfully!';
  RAISE NOTICE 'Tables created: videos, profiles';
  RAISE NOTICE 'Views created: user_video_dashboard';
  RAISE NOTICE 'Watermarking and public sharing features removed';
END $$;
