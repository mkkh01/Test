-- Payment fallback: after two rejected customer submissions, allow evidence for human review.
-- Evidence is private and never exposed through customer endpoints.

alter table public.orders
  add column if not exists payment_failed_attempts integer not null default 0,
  add column if not exists payment_evidence_requested_at timestamptz;

alter table public.orders
  drop constraint if exists orders_payment_failed_attempts_check;

alter table public.orders
  add constraint orders_payment_failed_attempts_check check (payment_failed_attempts >= 0);

create table if not exists public.payment_evidence (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  txid text,
  transfer_text text,
  screenshot_data_url text,
  screenshot_mime_type text,
  status text not null default 'pending' check (status in ('pending', 'verified', 'rejected')),
  reviewed_at timestamptz,
  reviewer_id text,
  review_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (txid is not null or transfer_text is not null or screenshot_data_url is not null)
);

create index if not exists payment_evidence_order_idx
  on public.payment_evidence(order_id, created_at desc);

create index if not exists payment_evidence_status_idx
  on public.payment_evidence(status, created_at desc);

revoke all on table public.payment_evidence from anon, authenticated;
grant select, insert, update, delete on table public.payment_evidence to service_role;
alter table public.payment_evidence enable row level security;
