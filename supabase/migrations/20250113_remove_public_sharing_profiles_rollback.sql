-- Rollback: Restore Public Sharing and Profile Features
-- Date: 2025-01-13
-- Description: Rollback script to restore public sharing and profile features if needed

-- Recreate public_access_tokens table
CREATE TABLE IF NOT EXISTS public.public_access_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  video_id UUID REFERENCES public.videos(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add indexes
CREATE INDEX IF NOT EXISTS public_access_tokens_video_id_idx ON public.public_access_tokens (video_id);
CREATE INDEX IF NOT EXISTS public_access_tokens_token_idx ON public.public_access_tokens (token);
CREATE INDEX IF NOT EXISTS public_access_tokens_user_id_idx ON public.public_access_tokens (user_id);

-- Enable RLS
ALTER TABLE public.public_access_tokens ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Users can view their own tokens"
  ON public.public_access_tokens
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own tokens"
  ON public.public_access_tokens
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own tokens"
  ON public.public_access_tokens
  FOR DELETE
  USING (auth.uid() = user_id);

-- Grant permissions
GRANT SELECT, INSERT, DELETE ON public.public_access_tokens TO authenticated;

-- Add trigger for updated_at
CREATE TRIGGER update_public_access_tokens_updated_at
  BEFORE UPDATE ON public.public_access_tokens
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Add photo, avatar_url, and bio columns back to profiles
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS photo TEXT;

ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS avatar_url TEXT;

ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS bio TEXT;

-- Recreate public read policy
CREATE POLICY "Allow public read access to profiles"
  ON public.profiles
  FOR SELECT
  TO public
  USING (true);

-- Add comments
COMMENT ON TABLE public.public_access_tokens IS 'Tokens for public video access';
COMMENT ON TABLE public.profiles IS 'User profiles with public information';
