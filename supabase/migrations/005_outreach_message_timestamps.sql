alter table public.outreach_messages
  add column if not exists updated_at timestamptz not null default now();

create index if not exists outreach_messages_updated_idx on public.outreach_messages(updated_at desc);
