-- Phase 2: extend public.images with watermark output + processed dimensions.
-- Mirror of saivd/supabase/migrations/20260528120000_images_watermark_fields.sql
-- so the two Supabase projects stay in schema parity (plan §14.6 F1).

ALTER TABLE public.images
  ADD COLUMN IF NOT EXISTS processed_url TEXT,
  ADD COLUMN IF NOT EXISTS width INT,
  ADD COLUMN IF NOT EXISTS height INT,
  ADD COLUMN IF NOT EXISTS watermark_error TEXT,
  ADD COLUMN IF NOT EXISTS watermarked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS images_status_idx ON public.images (status);
