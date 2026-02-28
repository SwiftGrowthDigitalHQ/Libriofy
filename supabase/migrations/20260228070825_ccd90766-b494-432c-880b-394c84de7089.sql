
-- Add branding and custom domain columns to libraries
ALTER TABLE public.libraries
  ADD COLUMN IF NOT EXISTS custom_domain text,
  ADD COLUMN IF NOT EXISTS logo_url text,
  ADD COLUMN IF NOT EXISTS primary_color text DEFAULT '#14b8a6',
  ADD COLUMN IF NOT EXISTS opening_hours text;

-- Add unique constraint on custom_domain (only non-null values)
CREATE UNIQUE INDEX IF NOT EXISTS libraries_custom_domain_unique ON public.libraries (custom_domain) WHERE custom_domain IS NOT NULL;

-- Update get_library_public to also match by custom_domain
CREATE OR REPLACE FUNCTION public.get_library_public(p_identifier text)
 RETURNS SETOF libraries
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT * FROM public.libraries
  WHERE id::text = p_identifier OR slug = p_identifier OR custom_domain = p_identifier
  LIMIT 1;
$function$;
