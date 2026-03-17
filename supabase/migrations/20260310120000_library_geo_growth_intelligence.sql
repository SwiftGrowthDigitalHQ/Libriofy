-- Add geographic fields needed for Growth Intelligence dashboards
ALTER TABLE public.libraries
  ADD COLUMN IF NOT EXISTS district TEXT,
  ADD COLUMN IF NOT EXISTS state TEXT,
  ADD COLUMN IF NOT EXISTS country TEXT NOT NULL DEFAULT 'India';

UPDATE public.libraries
SET country = COALESCE(NULLIF(country, ''), 'India')
WHERE country IS NULL OR country = '';

CREATE INDEX IF NOT EXISTS libraries_country_idx ON public.libraries (country);
CREATE INDEX IF NOT EXISTS libraries_state_idx ON public.libraries (state);
CREATE INDEX IF NOT EXISTS libraries_district_idx ON public.libraries (district);
CREATE INDEX IF NOT EXISTS libraries_city_idx ON public.libraries (city);

-- Optimized aggregated analytics used by the Super Admin Growth Intelligence dashboard
CREATE OR REPLACE VIEW public.admin_state_analytics AS
SELECT
  COALESCE(NULLIF(trim(state), ''), 'Unknown') AS state,
  COUNT(*)::int AS libraries,
  SUM(active_students)::int AS students,
  SUM(monthly_revenue)::numeric(12, 2) AS revenue
FROM public.libraries
WHERE enabled = true
  AND lower(COALESCE(NULLIF(trim(country), ''), 'india')) = 'india'
  AND public.has_role(auth.uid(), 'super_admin')
GROUP BY 1;

CREATE OR REPLACE VIEW public.admin_district_analytics AS
SELECT
  COALESCE(NULLIF(trim(district), ''), 'Unknown') AS district,
  COALESCE(NULLIF(trim(state), ''), 'Unknown') AS state,
  COUNT(*)::int AS libraries,
  SUM(active_students)::int AS students,
  SUM(monthly_revenue)::numeric(12, 2) AS revenue
FROM public.libraries
WHERE enabled = true
  AND lower(COALESCE(NULLIF(trim(country), ''), 'india')) = 'india'
  AND public.has_role(auth.uid(), 'super_admin')
GROUP BY 1, 2;

CREATE OR REPLACE VIEW public.admin_city_analytics AS
SELECT
  COALESCE(NULLIF(trim(city), ''), 'Unknown') AS city,
  COALESCE(NULLIF(trim(district), ''), 'Unknown') AS district,
  COALESCE(NULLIF(trim(state), ''), 'Unknown') AS state,
  COUNT(*)::int AS libraries,
  SUM(active_students)::int AS students,
  SUM(monthly_revenue)::numeric(12, 2) AS revenue
FROM public.libraries
WHERE enabled = true
  AND lower(COALESCE(NULLIF(trim(country), ''), 'india')) = 'india'
  AND public.has_role(auth.uid(), 'super_admin')
GROUP BY 1, 2, 3;

GRANT SELECT ON public.admin_state_analytics TO authenticated;
GRANT SELECT ON public.admin_district_analytics TO authenticated;
GRANT SELECT ON public.admin_city_analytics TO authenticated;
