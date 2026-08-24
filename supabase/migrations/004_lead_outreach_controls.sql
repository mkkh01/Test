-- Lead contact controls and outreach delivery state.
-- All first-contact messages remain human-approved; this migration stores the audit state.

alter table public.leads
  add column if not exists contact_email text,
  add column if not exists contact_email_source text,
  add column if not exists contact_permission text not null default 'unknown',
  add column if not exists sales_status text not null default 'not_contacted',
  add column if not exists next_contact_at timestamptz,
  add column if not exists opted_out_at timestamptz,
  add column if not exists blocked_at timestamptz,
  add column if not exists notes text;

alter table public.outreach_messages
  add column if not exists recipient_email text,
  add column if not exists subject text,
  add column if not exists approved_by text,
  add column if not exists approval_note text,
  add column if not exists scheduled_at timestamptz,
  add column if not exists last_attempt_at timestamptz,
  add column if not exists attempt_count integer not null default 0,
  add column if not exists provider text,
  add column if not exists idempotency_key text,
  add column if not exists opt_out_url text;

update public.leads
set sales_status = case
  when status = 'converted' then 'converted'
  when status = 'replied' then 'replied'
  when status = 'contacted' then 'contacted'
  when status = 'blocked' then 'blocked'
  when status = 'ignored' then 'not_interested'
  else 'not_contacted'
end
where sales_status = 'not_contacted';

create index if not exists leads_sales_status_idx on public.leads(sales_status, updated_at desc);
create index if not exists leads_contact_permission_idx on public.leads(contact_permission, opted_out_at);
create index if not exists outreach_messages_status_idx on public.outreach_messages(status, scheduled_at, created_at);
create unique index if not exists outreach_messages_idempotency_idx on public.outreach_messages(idempotency_key) where idempotency_key is not null;

-- Keep the allowed states explicit without changing existing application tables.
do $$
begin
  alter table public.leads add constraint leads_contact_permission_check
    check (contact_permission in ('unknown', 'opted_in', 'public_contact', 'opted_out', 'blocked'));
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.leads add constraint leads_sales_status_check
    check (sales_status in ('not_contacted', 'contacted', 'replied', 'qualified', 'converted', 'not_interested', 'lost', 'blocked'));
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.outreach_messages add constraint outreach_attempt_count_check
    check (attempt_count >= 0);
exception when duplicate_object then null;
end $$;
