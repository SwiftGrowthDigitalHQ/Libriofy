CREATE INDEX IF NOT EXISTS idx_waiting_list_library_created_at
  ON public.waiting_list(library_id, created_at ASC);
