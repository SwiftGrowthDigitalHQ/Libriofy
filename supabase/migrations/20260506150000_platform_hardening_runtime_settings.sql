INSERT INTO public.platform_settings (key, value)
VALUES
  ('ops_queue_processing_enabled', 'true'::jsonb),
  ('ops_billing_mutations_enabled', 'true'::jsonb)
ON CONFLICT (key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
