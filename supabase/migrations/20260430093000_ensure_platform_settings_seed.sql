CREATE TABLE IF NOT EXISTS public.platform_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT 'false'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read maintenance mode" ON public.platform_settings;
CREATE POLICY "Anyone can read maintenance mode"
  ON public.platform_settings
  FOR SELECT
  USING (
    key = 'maintenance_mode'
    OR public.has_role(auth.uid(), 'super_admin')
  );

DROP POLICY IF EXISTS "Super admins can manage platform settings" ON public.platform_settings;
CREATE POLICY "Super admins can manage platform settings"
  ON public.platform_settings
  FOR ALL
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

INSERT INTO public.platform_settings (key, value)
VALUES ('maintenance_mode', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.set_platform_settings_metadata()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  previous_updated_by UUID;
BEGIN
  previous_updated_by := CASE WHEN TG_OP = 'UPDATE' THEN OLD.updated_by ELSE NULL END;
  NEW.updated_at := now();
  NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by, previous_updated_by);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS platform_settings_metadata ON public.platform_settings;
CREATE TRIGGER platform_settings_metadata
  BEFORE INSERT OR UPDATE ON public.platform_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.set_platform_settings_metadata();
