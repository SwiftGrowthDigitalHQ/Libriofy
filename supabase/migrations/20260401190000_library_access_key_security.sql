CREATE TABLE IF NOT EXISTS public.library_access_keys (
  library_id UUID PRIMARY KEY REFERENCES public.libraries(id) ON DELETE CASCADE,
  access_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  rotated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT library_access_keys_format_check CHECK (access_key ~ '^LIB-[A-Z0-9]{6}$')
);

ALTER TABLE public.library_access_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Library teams can view own library access keys" ON public.library_access_keys;
CREATE POLICY "Library teams can view own library access keys"
  ON public.library_access_keys
  FOR SELECT
  TO authenticated
  USING (
    public.can_access_library(auth.uid(), library_id)
    OR public.has_role(auth.uid(), 'super_admin')
  );

DROP TRIGGER IF EXISTS update_library_access_keys_updated_at ON public.library_access_keys;
CREATE TRIGGER update_library_access_keys_updated_at
  BEFORE UPDATE ON public.library_access_keys
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.device_setup_attempts (
  device_id TEXT PRIMARY KEY,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  first_failed_at TIMESTAMPTZ,
  last_failed_at TIMESTAMPTZ,
  locked_until TIMESTAMPTZ,
  last_access_key_suffix TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.device_setup_attempts ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS update_device_setup_attempts_updated_at ON public.device_setup_attempts;
CREATE TRIGGER update_device_setup_attempts_updated_at
  BEFORE UPDATE ON public.device_setup_attempts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.generate_library_access_key_value()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_alphabet CONSTANT TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_key TEXT := 'LIB-';
  v_bytes BYTEA := gen_random_bytes(6);
  v_index INTEGER;
BEGIN
  FOR v_index IN 0..5 LOOP
    v_key := v_key || substr(v_alphabet, (get_byte(v_bytes, v_index) % length(v_alphabet)) + 1, 1);
  END LOOP;

  RETURN v_key;
END;
$$;

CREATE OR REPLACE FUNCTION public.issue_library_access_key(p_library_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_access_key TEXT;
BEGIN
  IF p_library_id IS NULL THEN
    RAISE EXCEPTION 'library_id is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.libraries
    WHERE id = p_library_id
  ) THEN
    RAISE EXCEPTION 'Library not found';
  END IF;

  LOOP
    v_access_key := public.generate_library_access_key_value();
    EXIT WHEN NOT EXISTS (
      SELECT 1
      FROM public.library_access_keys
      WHERE access_key = v_access_key
        AND library_id <> p_library_id
    );
  END LOOP;

  INSERT INTO public.library_access_keys (
    library_id,
    access_key,
    rotated_at
  )
  VALUES (
    p_library_id,
    v_access_key,
    now()
  )
  ON CONFLICT (library_id) DO UPDATE
  SET access_key = EXCLUDED.access_key,
      rotated_at = now(),
      updated_at = now();

  RETURN v_access_key;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_library_access_key_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.issue_library_access_key(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ensure_library_access_key_on_insert ON public.libraries;
CREATE TRIGGER ensure_library_access_key_on_insert
  AFTER INSERT ON public.libraries
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_library_access_key_insert();

DO $$
DECLARE
  v_library RECORD;
BEGIN
  FOR v_library IN
    SELECT id
    FROM public.libraries
  LOOP
    PERFORM public.issue_library_access_key(v_library.id);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.regenerate_library_access_key(p_library_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_access_key TEXT;
BEGIN
  IF p_library_id IS NULL THEN
    RAISE EXCEPTION 'library_id is required';
  END IF;

  IF auth.uid() IS NOT NULL
    AND NOT public.can_access_library(auth.uid(), p_library_id)
    AND NOT public.has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'Not authorized to regenerate this Library Access Key';
  END IF;

  v_access_key := public.issue_library_access_key(p_library_id);

  RETURN jsonb_build_object(
    'library_id', p_library_id,
    'access_key', v_access_key,
    'rotated_at', now()
  );
END;
$$;

REVOKE ALL ON TABLE public.device_setup_attempts FROM PUBLIC;
REVOKE ALL ON TABLE public.library_access_keys FROM PUBLIC;
GRANT SELECT ON TABLE public.library_access_keys TO authenticated;
GRANT SELECT ON TABLE public.library_access_keys TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.device_setup_attempts TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.library_access_keys TO service_role;

REVOKE ALL ON FUNCTION public.generate_library_access_key_value() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.issue_library_access_key(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_library_access_key_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.regenerate_library_access_key(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.regenerate_library_access_key(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.regenerate_library_access_key(UUID) TO service_role;
