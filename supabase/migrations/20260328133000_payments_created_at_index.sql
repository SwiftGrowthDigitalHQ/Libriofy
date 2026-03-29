CREATE INDEX IF NOT EXISTS idx_payments_library_created_at
  ON public.payments(library_id, created_at DESC);
