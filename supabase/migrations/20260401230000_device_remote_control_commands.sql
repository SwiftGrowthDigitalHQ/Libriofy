CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.device_commands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  library_id UUID NOT NULL REFERENCES public.libraries(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES public.entry_devices(device_id) ON DELETE CASCADE,
  command_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',
  requested_by UUID REFERENCES auth.users(id),
  requested_by_role TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT device_commands_type_check CHECK (
    command_type IN (
      'disable_device',
      'force_logout',
      'restart_scanner',
      'push_config_update'
    )
  ),
  CONSTRAINT device_commands_status_check CHECK (
    status IN (
      'pending',
      'acknowledged',
      'completed',
      'failed',
      'cancelled'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_device_commands_library_requested_at
  ON public.device_commands(library_id, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_device_commands_library_device_status
  ON public.device_commands(library_id, device_id, status, requested_at DESC);

ALTER TABLE public.device_commands ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Library teams can manage own device commands" ON public.device_commands;
CREATE POLICY "Library teams can manage own device commands"
  ON public.device_commands
  FOR ALL
  TO authenticated
  USING (public.can_access_library(auth.uid(), library_id))
  WITH CHECK (public.can_access_library(auth.uid(), library_id));

DROP POLICY IF EXISTS "Super admins can manage device commands" ON public.device_commands;
CREATE POLICY "Super admins can manage device commands"
  ON public.device_commands
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

DROP TRIGGER IF EXISTS update_device_commands_updated_at ON public.device_commands;
CREATE TRIGGER update_device_commands_updated_at
  BEFORE UPDATE ON public.device_commands
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.device_commands TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.device_commands TO service_role;

CREATE OR REPLACE FUNCTION public.issue_device_command(
  p_library_id UUID,
  p_device_id TEXT,
  p_command_type TEXT,
  p_payload JSONB DEFAULT '{}'::jsonb
)
RETURNS public.device_commands
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_device RECORD;
  v_requested_by_role TEXT;
  v_now TIMESTAMPTZ := now();
  v_status TEXT;
  v_command public.device_commands;
  v_command_payload JSONB := COALESCE(p_payload, '{}'::jsonb);
  v_device_control JSONB;
BEGIN
  IF p_library_id IS NULL OR btrim(COALESCE(p_device_id, '')) = '' OR btrim(COALESCE(p_command_type, '')) = '' THEN
    RAISE EXCEPTION 'library_id, device_id, and command_type are required';
  END IF;

  IF COALESCE(auth.role(), '') <> 'service_role' AND NOT public.can_access_library(auth.uid(), p_library_id) THEN
    RAISE EXCEPTION 'Not authorized to control this library';
  END IF;

  SELECT
    id,
    library_id,
    device_name,
    is_active,
    metadata
  INTO v_device
  FROM public.entry_devices
  WHERE library_id = p_library_id
    AND device_id = btrim(p_device_id)
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Device not found';
  END IF;

  CASE btrim(p_command_type)
    WHEN 'disable_device' THEN
      v_status := 'disabled';
    WHEN 'force_logout' THEN
      v_status := 'logout_required';
    WHEN 'restart_scanner' THEN
      v_status := 'restart_requested';
    WHEN 'push_config_update' THEN
      v_status := 'config_update_requested';
    ELSE
      RAISE EXCEPTION 'Unsupported device command type';
  END CASE;

  IF EXISTS (
    SELECT 1
    FROM public.libraries l
    WHERE l.id = p_library_id
      AND l.owner_id = auth.uid()
  ) THEN
    v_requested_by_role := 'library_owner';
  ELSIF EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.library_id = p_library_id
      AND ur.role = 'staff'
  ) THEN
    v_requested_by_role := 'staff';
  ELSIF public.has_role(auth.uid(), 'super_admin') THEN
    v_requested_by_role := 'super_admin';
  END IF;

  INSERT INTO public.device_commands (
    library_id,
    device_id,
    command_type,
    payload,
    status,
    requested_by,
    requested_by_role,
    requested_at,
    acknowledged_at,
    completed_at,
    failed_at,
    error_message,
    metadata
  )
  VALUES (
    p_library_id,
    btrim(p_device_id),
    btrim(p_command_type),
    v_command_payload,
    'pending',
    auth.uid(),
    v_requested_by_role,
    v_now,
    NULL,
    NULL,
    NULL,
    NULL,
    jsonb_build_object(
      'command_state',
      v_status
    )
  )
  RETURNING * INTO v_command;

  v_device_control := COALESCE(v_device.metadata->'device_control', '{}'::jsonb) || jsonb_build_object(
    'status', v_status,
    'current_command_id', v_command.id::text,
    'current_command_type', v_command.command_type,
    'current_command_status', 'pending',
    'current_command_requested_at', v_now,
    'current_command_error', NULL,
    'last_command_id', v_command.id::text,
    'last_command_type', v_command.command_type,
    'last_command_status', 'pending',
    'last_command_at', v_now
  );

  IF v_command.command_type = 'disable_device' THEN
    UPDATE public.entry_devices
    SET
      is_active = false,
      metadata = jsonb_set(
        COALESCE(metadata, '{}'::jsonb),
        '{device_control}',
        v_device_control,
        true
      )
    WHERE id = v_device.id;
  ELSE
    UPDATE public.entry_devices
    SET metadata = jsonb_set(
      COALESCE(metadata, '{}'::jsonb),
      '{device_control}',
      v_device_control,
      true
    )
    WHERE id = v_device.id;
  END IF;

  RETURN v_command;
END;
$$;

CREATE OR REPLACE FUNCTION public.pull_device_commands(
  p_library_id UUID,
  p_device_id TEXT,
  p_library_access_key TEXT,
  p_device_token TEXT,
  p_limit INTEGER DEFAULT 5
)
RETURNS SETOF public.device_commands
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_resolved_library_id UUID;
  v_device RECORD;
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 5), 1), 25);
  v_expected_hash TEXT;
BEGIN
  IF p_library_id IS NULL OR btrim(COALESCE(p_device_id, '')) = '' OR btrim(COALESCE(p_library_access_key, '')) = '' THEN
    RAISE EXCEPTION 'library_id, device_id, and library_access_key are required';
  END IF;

  SELECT library_id
  INTO v_resolved_library_id
  FROM public.library_access_keys
  WHERE access_key = btrim(p_library_access_key)
  LIMIT 1;

  IF NOT FOUND OR v_resolved_library_id IS NULL THEN
    RAISE EXCEPTION 'Invalid library access key';
  END IF;

  IF v_resolved_library_id <> p_library_id THEN
    RAISE EXCEPTION 'Library access key does not match this library';
  END IF;

  SELECT
    id,
    library_id,
    secret_token_hash
  INTO v_device
  FROM public.entry_devices
  WHERE device_id = btrim(p_device_id)
    AND library_id = p_library_id
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Device not found';
  END IF;

  IF v_device.secret_token_hash IS NOT NULL THEN
    IF btrim(COALESCE(p_device_token, '')) = '' THEN
      RAISE EXCEPTION 'Device token missing';
    END IF;

    SELECT encode(digest(btrim(p_device_token), 'sha256'), 'hex')
    INTO v_expected_hash;

    IF v_expected_hash IS NULL OR v_expected_hash <> v_device.secret_token_hash THEN
      RAISE EXCEPTION 'Device token invalid';
    END IF;
  END IF;

  RETURN QUERY
  SELECT *
  FROM public.device_commands
  WHERE library_id = p_library_id
    AND device_id = btrim(p_device_id)
    AND status = 'pending'
  ORDER BY requested_at ASC
  LIMIT v_limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_device_command_status(
  p_library_id UUID,
  p_device_id TEXT,
  p_library_access_key TEXT,
  p_device_token TEXT,
  p_command_id UUID,
  p_status TEXT,
  p_error_message TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS public.device_commands
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_resolved_library_id UUID;
  v_device RECORD;
  v_command public.device_commands;
  v_now TIMESTAMPTZ := now();
  v_expected_hash TEXT;
  v_next_status TEXT;
  v_next_control JSONB;
  v_is_terminal BOOLEAN;
BEGIN
  IF p_library_id IS NULL OR btrim(COALESCE(p_device_id, '')) = '' OR btrim(COALESCE(p_library_access_key, '')) = '' OR p_command_id IS NULL THEN
    RAISE EXCEPTION 'library_id, device_id, library_access_key, and command_id are required';
  END IF;

  IF btrim(COALESCE(p_status, '')) = '' THEN
    RAISE EXCEPTION 'status is required';
  END IF;

  IF p_status NOT IN ('acknowledged', 'completed', 'failed') THEN
    RAISE EXCEPTION 'Unsupported command status';
  END IF;

  SELECT library_id
  INTO v_resolved_library_id
  FROM public.library_access_keys
  WHERE access_key = btrim(p_library_access_key)
  LIMIT 1;

  IF NOT FOUND OR v_resolved_library_id IS NULL THEN
    RAISE EXCEPTION 'Invalid library access key';
  END IF;

  IF v_resolved_library_id <> p_library_id THEN
    RAISE EXCEPTION 'Library access key does not match this library';
  END IF;

  SELECT
    id,
    library_id,
    secret_token_hash,
    metadata
  INTO v_device
  FROM public.entry_devices
  WHERE device_id = btrim(p_device_id)
    AND library_id = p_library_id
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Device not found';
  END IF;

  IF v_device.secret_token_hash IS NOT NULL THEN
    IF btrim(COALESCE(p_device_token, '')) = '' THEN
      RAISE EXCEPTION 'Device token missing';
    END IF;

    SELECT encode(digest(btrim(p_device_token), 'sha256'), 'hex')
    INTO v_expected_hash;

    IF v_expected_hash IS NULL OR v_expected_hash <> v_device.secret_token_hash THEN
      RAISE EXCEPTION 'Device token invalid';
    END IF;
  END IF;

  SELECT *
  INTO v_command
  FROM public.device_commands
  WHERE id = p_command_id
    AND library_id = p_library_id
    AND device_id = btrim(p_device_id)
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Command not found';
  END IF;

  v_is_terminal := p_status IN ('completed', 'failed');
  v_next_status := CASE
    WHEN v_command.command_type = 'disable_device' THEN 'disabled'
    WHEN v_is_terminal THEN 'active'
    ELSE COALESCE((v_device.metadata->'device_control'->>'status'), 'active')
  END;

  UPDATE public.device_commands
  SET
    status = p_status,
    acknowledged_at = CASE
      WHEN p_status = 'acknowledged' THEN COALESCE(acknowledged_at, v_now)
      WHEN p_status = 'completed' THEN COALESCE(acknowledged_at, v_now)
      ELSE acknowledged_at
    END,
    completed_at = CASE
      WHEN p_status = 'completed' THEN COALESCE(completed_at, v_now)
      ELSE completed_at
    END,
    failed_at = CASE
      WHEN p_status = 'failed' THEN COALESCE(failed_at, v_now)
      ELSE failed_at
    END,
    error_message = CASE
      WHEN p_status = 'failed' THEN COALESCE(NULLIF(btrim(p_error_message), ''), error_message)
      ELSE error_message
    END,
    metadata = COALESCE(metadata, '{}'::jsonb) || COALESCE(p_metadata, '{}'::jsonb),
    updated_at = v_now
  WHERE id = v_command.id
  RETURNING * INTO v_command;

  v_next_control := COALESCE(v_device.metadata->'device_control', '{}'::jsonb) || jsonb_build_object(
    'status', v_next_status,
    'current_command_id', CASE WHEN v_is_terminal THEN NULL ELSE v_command.id::text END,
    'current_command_type', CASE WHEN v_is_terminal THEN NULL ELSE v_command.command_type END,
    'current_command_status', CASE WHEN v_is_terminal THEN NULL ELSE p_status END,
    'current_command_requested_at', CASE WHEN v_is_terminal THEN NULL ELSE v_command.requested_at END,
    'current_command_error', CASE WHEN p_status = 'failed' THEN COALESCE(NULLIF(btrim(p_error_message), ''), v_command.error_message) ELSE NULL END,
    'last_command_id', v_command.id::text,
    'last_command_type', v_command.command_type,
    'last_command_status', p_status,
    'last_command_at', v_now,
    'last_command_error', CASE WHEN p_status = 'failed' THEN COALESCE(NULLIF(btrim(p_error_message), ''), v_command.error_message) ELSE NULL END
  );

  UPDATE public.entry_devices
  SET metadata = jsonb_set(
    COALESCE(metadata, '{}'::jsonb),
    '{device_control}',
    v_next_control,
    true
  )
  WHERE id = v_device.id;

  RETURN v_command;
END;
$$;

REVOKE ALL ON FUNCTION public.issue_device_command(UUID, TEXT, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pull_device_commands(UUID, TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_device_command_status(UUID, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, JSONB) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.issue_device_command(UUID, TEXT, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.issue_device_command(UUID, TEXT, TEXT, JSONB) TO service_role;

GRANT EXECUTE ON FUNCTION public.pull_device_commands(UUID, TEXT, TEXT, TEXT, INTEGER) TO anon;
GRANT EXECUTE ON FUNCTION public.pull_device_commands(UUID, TEXT, TEXT, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pull_device_commands(UUID, TEXT, TEXT, TEXT, INTEGER) TO service_role;

GRANT EXECUTE ON FUNCTION public.record_device_command_status(UUID, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, JSONB) TO anon;
GRANT EXECUTE ON FUNCTION public.record_device_command_status(UUID, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_device_command_status(UUID, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, JSONB) TO service_role;
