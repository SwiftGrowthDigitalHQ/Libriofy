-- Add slug column for human-readable public URLs
ALTER TABLE public.libraries ADD COLUMN slug text UNIQUE;

-- Create index for fast slug lookups
CREATE INDEX idx_libraries_slug ON public.libraries (slug);

-- Function to look up library by slug or UUID
CREATE OR REPLACE FUNCTION public.get_library_public(p_identifier text)
RETURNS SETOF public.libraries
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT * FROM public.libraries
  WHERE id::text = p_identifier OR slug = p_identifier
  LIMIT 1;
$$;
