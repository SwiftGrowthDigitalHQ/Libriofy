-- Ensure the libraries table has the geo + labeling fields needed for Growth Intelligence.
ALTER TABLE public.libraries
  ADD COLUMN IF NOT EXISTS district TEXT,
  ADD COLUMN IF NOT EXISTS state TEXT,
  ADD COLUMN IF NOT EXISTS country TEXT NOT NULL DEFAULT 'India',
  ADD COLUMN IF NOT EXISTS owner_name TEXT;

-- library_name is an alias for the existing `name` column used across the app.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'libraries'
      AND column_name = 'library_name'
  ) THEN
    ALTER TABLE public.libraries
      ADD COLUMN library_name TEXT GENERATED ALWAYS AS (name) STORED;
  END IF;
END
$$;

UPDATE public.libraries
SET country = COALESCE(NULLIF(country, ''), 'India')
WHERE country IS NULL OR country = '';

-- Backfill owner_name from profiles when possible
UPDATE public.libraries l
SET owner_name = p.full_name
FROM public.profiles p
WHERE p.user_id = l.owner_id
  AND (l.owner_name IS NULL OR l.owner_name = '');

CREATE INDEX IF NOT EXISTS libraries_country_idx ON public.libraries (country);
CREATE INDEX IF NOT EXISTS libraries_state_idx ON public.libraries (state);
CREATE INDEX IF NOT EXISTS libraries_district_idx ON public.libraries (district);
CREATE INDEX IF NOT EXISTS libraries_city_idx ON public.libraries (city);

-- Keep owner_name in sync with owner_id
CREATE OR REPLACE FUNCTION public.sync_library_owner_name()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.owner_id IS NOT NULL THEN
    SELECT full_name
    INTO NEW.owner_name
    FROM public.profiles
    WHERE user_id = NEW.owner_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS libraries_owner_name_sync ON public.libraries;
CREATE TRIGGER libraries_owner_name_sync
BEFORE INSERT OR UPDATE OF owner_id ON public.libraries
FOR EACH ROW
EXECUTE FUNCTION public.sync_library_owner_name();

-- Geographic analytics views exposed via PostgREST (used by Super Admin Growth Intelligence Dashboard).
-- NOTE: These views may already exist with additional columns from prior migrations.
-- Postgres does not allow `CREATE OR REPLACE VIEW` to *remove* columns, so we drop and recreate to ensure
-- the canonical shape used by the Growth Intelligence dashboard.
DROP VIEW IF EXISTS public.admin_state_analytics;
DROP VIEW IF EXISTS public.admin_district_analytics;
DROP VIEW IF EXISTS public.admin_city_analytics;

CREATE VIEW public.admin_state_analytics AS
SELECT
  COALESCE(NULLIF(trim(state), ''), 'Unknown') AS state,
  COUNT(*)::int AS libraries
FROM public.libraries
WHERE lower(COALESCE(NULLIF(trim(country), ''), 'india')) = 'india'
GROUP BY 1
ORDER BY libraries DESC;

CREATE VIEW public.admin_district_analytics AS
SELECT
  COALESCE(NULLIF(trim(state), ''), 'Unknown') AS state,
  COALESCE(NULLIF(trim(district), ''), 'Unknown') AS district,
  COUNT(*)::int AS libraries
FROM public.libraries
WHERE lower(COALESCE(NULLIF(trim(country), ''), 'india')) = 'india'
GROUP BY 1, 2
ORDER BY libraries DESC;

CREATE VIEW public.admin_city_analytics AS
SELECT
  COALESCE(NULLIF(trim(state), ''), 'Unknown') AS state,
  COALESCE(NULLIF(trim(city), ''), 'Unknown') AS city,
  COUNT(*)::int AS libraries
FROM public.libraries
WHERE lower(COALESCE(NULLIF(trim(country), ''), 'india')) = 'india'
GROUP BY 1, 2
ORDER BY libraries DESC;

CREATE OR REPLACE VIEW public.admin_platform_coverage AS
SELECT
  COUNT(*)::int AS total_libraries,
  COUNT(DISTINCT NULLIF(trim(city), ''))::int AS active_cities,
  COUNT(DISTINCT NULLIF(trim(district), ''))::int AS active_districts,
  COUNT(DISTINCT NULLIF(trim(state), ''))::int AS states_covered,
  ROUND(
    (
      COUNT(DISTINCT NULLIF(trim(state), ''))::numeric
      / 28::numeric
    ) * 100::numeric,
    2
  )::numeric(5, 2) AS india_market_penetration_percent
FROM public.libraries
WHERE lower(COALESCE(NULLIF(trim(country), ''), 'india')) = 'india';

-- Required for PostgREST to expose these views to the frontend (authenticated role).
GRANT SELECT ON public.admin_state_analytics TO authenticated;
GRANT SELECT ON public.admin_district_analytics TO authenticated;
GRANT SELECT ON public.admin_city_analytics TO authenticated;
GRANT SELECT ON public.admin_platform_coverage TO authenticated;
