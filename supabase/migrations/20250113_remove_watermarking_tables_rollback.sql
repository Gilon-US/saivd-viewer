-- Rollback: Restore Watermarking Tables
-- Date: 2025-01-13
-- Description: Rollback script to restore watermarking infrastructure if needed

-- Recreate watermarked_videos table
CREATE TABLE IF NOT EXISTS public.watermarked_videos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  video_id UUID REFERENCES public.videos(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  watermarked_url TEXT,
  watermarked_thumbnail_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  error_message TEXT,
  watermark_date TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add indexes
CREATE INDEX IF NOT EXISTS watermarked_videos_video_id_idx ON public.watermarked_videos (video_id);
CREATE INDEX IF NOT EXISTS watermarked_videos_user_id_idx ON public.watermarked_videos (user_id);
CREATE INDEX IF NOT EXISTS watermarked_videos_status_idx ON public.watermarked_videos (status);

-- Enable RLS
ALTER TABLE public.watermarked_videos ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Users can view their own watermarked videos"
  ON public.watermarked_videos
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own watermarked videos"
  ON public.watermarked_videos
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own watermarked videos"
  ON public.watermarked_videos
  FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own watermarked videos"
  ON public.watermarked_videos
  FOR DELETE
  USING (auth.uid() = user_id);

-- Recreate watermarking_jobs table
CREATE TABLE IF NOT EXISTS public.watermarking_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  video_id UUID REFERENCES public.videos(id) ON DELETE CASCADE NOT NULL,
  watermarked_video_id UUID REFERENCES public.watermarked_videos(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  external_job_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  error_message TEXT,
  request_payload JSONB,
  response_payload JSONB,
  callback_received BOOLEAN DEFAULT FALSE,
  callback_token TEXT UNIQUE,
  callback_timestamp TIMESTAMP WITH TIME ZONE,
  retry_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add indexes
CREATE INDEX IF NOT EXISTS watermarking_jobs_video_id_idx ON public.watermarking_jobs (video_id);
CREATE INDEX IF NOT EXISTS watermarking_jobs_user_id_idx ON public.watermarking_jobs (user_id);
CREATE INDEX IF NOT EXISTS watermarking_jobs_status_idx ON public.watermarking_jobs (status);
CREATE INDEX IF NOT EXISTS watermarking_jobs_external_job_id_idx ON public.watermarking_jobs (external_job_id);
CREATE INDEX IF NOT EXISTS watermarking_jobs_callback_token_idx ON public.watermarking_jobs (callback_token);

-- Enable RLS
ALTER TABLE public.watermarking_jobs ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Users can view their own watermarking jobs"
  ON public.watermarking_jobs
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own watermarking jobs"
  ON public.watermarking_jobs
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own watermarking jobs"
  ON public.watermarking_jobs
  FOR UPDATE
  USING (auth.uid() = user_id);

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON public.watermarked_videos TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.watermarking_jobs TO authenticated;

-- Add triggers for updated_at
CREATE TRIGGER update_watermarked_videos_updated_at
  BEFORE UPDATE ON public.watermarked_videos
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_watermarking_jobs_updated_at
  BEFORE UPDATE ON public.watermarking_jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Recreate views
CREATE OR REPLACE VIEW public.recent_watermarking_jobs AS
SELECT 
  wj.id,
  wj.video_id,
  wj.user_id,
  wj.status,
  wj.created_at,
  v.filename
FROM 
  public.watermarking_jobs wj
  JOIN public.videos v ON wj.video_id = v.id
ORDER BY 
  wj.created_at DESC
LIMIT 100;

-- Add comments
COMMENT ON TABLE public.watermarked_videos IS 'Stores watermarked video metadata';
COMMENT ON TABLE public.watermarking_jobs IS 'Tracks watermarking job status and callbacks';
