CREATE TABLE IF NOT EXISTS public.platform_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT 'false'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

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
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := auth.uid();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS platform_settings_metadata ON public.platform_settings;
CREATE TRIGGER platform_settings_metadata
  BEFORE INSERT OR UPDATE ON public.platform_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.set_platform_settings_metadata();

CREATE OR REPLACE FUNCTION public.is_maintenance_mode_enabled()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT CASE
        WHEN jsonb_typeof(value) = 'boolean' THEN (value #>> '{}')::boolean
        WHEN jsonb_typeof(value) = 'string' THEN LOWER(value #>> '{}') IN ('true', '1', 'yes', 'on')
        WHEN jsonb_typeof(value) = 'number' THEN (value #>> '{}')::numeric <> 0
        ELSE FALSE
      END
      FROM public.platform_settings
      WHERE key = 'maintenance_mode'
      LIMIT 1
    ),
    FALSE
  );
$$;

CREATE OR REPLACE FUNCTION public.prevent_writes_during_maintenance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_maintenance_mode_enabled() THEN
    RAISE EXCEPTION 'Maintenance mode is active. Data changes are temporarily disabled.'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

DO $$
DECLARE
  table_record RECORD;
  trigger_name TEXT;
BEGIN
  FOR table_record IN
    SELECT schemaname, tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename <> 'platform_settings'
  LOOP
    trigger_name := 'maintenance_block_' || table_record.tablename;

    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I.%I', trigger_name, table_record.schemaname, table_record.tablename);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON %I.%I FOR EACH ROW EXECUTE FUNCTION public.prevent_writes_during_maintenance()',
      trigger_name,
      table_record.schemaname,
      table_record.tablename
    );
  END LOOP;
END;
$$;

