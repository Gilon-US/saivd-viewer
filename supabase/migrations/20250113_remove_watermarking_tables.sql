-- Migration: Remove Watermarking Tables
-- Date: 2025-01-13
-- Description: Removes all watermarking-related database infrastructure

-- Drop dependent views first
DROP VIEW IF EXISTS public.recent_watermarking_jobs;

-- Update user_video_dashboard view to remove watermarking columns (if it exists)
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

-- Drop watermarking tables (cascade will handle foreign keys)
DROP TABLE IF EXISTS public.watermarking_jobs CASCADE;
DROP TABLE IF EXISTS public.watermarked_videos CASCADE;

-- Remove watermarking-related triggers if any
DROP TRIGGER IF EXISTS on_watermarked_video_created ON public.watermarked_videos;
DROP FUNCTION IF EXISTS public.handle_watermarked_video_creation();

-- Add comment
COMMENT ON VIEW public.user_video_dashboard IS 'Simplified dashboard view showing only uploaded videos';
