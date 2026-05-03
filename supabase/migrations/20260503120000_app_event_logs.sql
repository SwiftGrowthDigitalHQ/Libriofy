create table if not exists public.app_event_logs (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  status text not null check (status in ('START', 'SUCCESS', 'FAILED')),
  user_identifier text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  message text,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists app_event_logs_created_at_idx
  on public.app_event_logs (created_at desc);

create index if not exists app_event_logs_event_type_created_at_idx
  on public.app_event_logs (event_type, created_at desc);

create index if not exists app_event_logs_status_created_at_idx
  on public.app_event_logs (status, created_at desc);

alter table public.app_event_logs enable row level security;
