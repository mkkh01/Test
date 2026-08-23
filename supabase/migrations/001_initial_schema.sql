-- Client Payment & Scope Protection Platform
-- Initial schema: private-by-default application data.

create extension if not exists pgcrypto;

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  tier text not null check (tier in ('Starter', 'Complete', 'Agency')),
  tagline text not null,
  price_usdt numeric(18, 6) not null check (price_usdt > 0),
  currency text not null default 'USDT',
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.intake_submissions (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text not null,
  company text not null,
  business_type text not null,
  current_situation text not null,
  desired_outcome text not null,
  budget text not null,
  contact_method text not null,
  source text not null default 'website',
  status text not null default 'new' check (status in ('new', 'reviewing', 'qualified', 'not_fit', 'contacted', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  product_id uuid not null references public.products(id),
  customer_email text not null,
  customer_name text,
  amount_usdt numeric(18, 6) not null check (amount_usdt > 0),
  network text not null,
  receiving_address text not null,
  status text not null default 'awaiting_payment' check (status in ('awaiting_payment', 'payment_detected', 'confirming', 'paid', 'expired', 'manual_review', 'cancelled')),
  download_token_hash text,
  download_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  invoice_number text not null unique,
  amount_usdt numeric(18, 6) not null check (amount_usdt > 0),
  network text not null,
  receiving_address text not null,
  status text not null default 'open' check (status in ('open', 'paid', 'underpaid', 'wrong_network', 'expired', 'manual_review', 'cancelled')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  txid text not null unique,
  network text not null,
  token_contract text not null,
  from_address text,
  to_address text not null,
  amount_usdt numeric(18, 6) not null check (amount_usdt >= 0),
  confirmations integer not null default 0 check (confirmations >= 0),
  status text not null default 'detected' check (status in ('detected', 'confirming', 'confirmed', 'rejected', 'manual_review')),
  provider text not null,
  raw_reference jsonb,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  source_item_id text,
  source_url text not null,
  display_name text,
  public_handle text,
  public_contact text,
  buyer_type text,
  problem_type text,
  fit_score integer check (fit_score between 0 and 100),
  status text not null default 'discovered' check (status in ('discovered', 'analyzed', 'drafted', 'approved', 'contacted', 'replied', 'converted', 'ignored', 'blocked')),
  evidence_excerpt text,
  discovered_at timestamptz not null default now(),
  last_contacted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, source_url)
);

create table if not exists public.source_items (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  external_id text,
  source_url text not null,
  title text,
  body text,
  author_handle text,
  published_at timestamptz,
  fetched_at timestamptz not null default now(),
  content_hash text not null,
  processed boolean not null default false,
  unique (source, content_hash),
  unique (source, source_url)
);

create table if not exists public.lead_analyses (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  model text not null,
  prompt_version text not null,
  problem_type text,
  buyer_type text,
  fit_score integer check (fit_score between 0 and 100),
  evidence text,
  recommended_product text,
  message_draft text,
  needs_human_review boolean not null default true,
  validation_status text not null default 'pending' check (validation_status in ('pending', 'passed', 'blocked', 'manual_review')),
  raw_response jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.outreach_messages (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  channel text not null,
  direction text not null check (direction in ('outbound', 'inbound')),
  body text not null,
  status text not null default 'draft' check (status in ('draft', 'approved', 'queued', 'sent', 'failed', 'rejected', 'replied')),
  approval_required boolean not null default true,
  approved_at timestamptz,
  sent_at timestamptz,
  external_message_id text,
  error_message text,
  created_at timestamptz not null default now()
);

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null check (job_type in ('source_fetch', 'lead_analyze', 'message_draft', 'payment_check', 'delivery', 'cleanup')),
  dedupe_key text not null unique,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'dead_letter')),
  attempts integer not null default 0 check (attempts >= 0),
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  completed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_type text not null check (actor_type in ('system', 'admin', 'customer', 'integration')),
  actor_id text,
  action text not null,
  entity_type text not null,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists intake_submissions_status_idx on public.intake_submissions(status, created_at desc);
create index if not exists orders_status_idx on public.orders(status, created_at desc);
create index if not exists invoices_status_idx on public.invoices(status, expires_at);
create index if not exists payments_invoice_idx on public.payments(invoice_id, created_at desc);
create index if not exists leads_status_score_idx on public.leads(status, fit_score desc nulls last, discovered_at desc);
create index if not exists source_items_processed_idx on public.source_items(processed, published_at desc nulls last);
create index if not exists jobs_queue_idx on public.jobs(status, run_after);
create index if not exists audit_logs_entity_idx on public.audit_logs(entity_type, entity_id, created_at desc);

-- The browser must not access private business data directly.
revoke all on table public.intake_submissions, public.orders, public.invoices, public.payments,
  public.leads, public.source_items, public.lead_analyses, public.outreach_messages,
  public.jobs, public.audit_logs from anon, authenticated;

grant select on table public.products to anon, authenticated;
grant select, insert, update, delete on table public.products to service_role;
grant select, insert, update, delete on table public.intake_submissions, public.orders, public.invoices,
  public.payments, public.leads, public.source_items, public.lead_analyses, public.outreach_messages,
  public.jobs, public.audit_logs to service_role;

alter table public.products enable row level security;
alter table public.intake_submissions enable row level security;
alter table public.orders enable row level security;
alter table public.invoices enable row level security;
alter table public.payments enable row level security;
alter table public.leads enable row level security;
alter table public.source_items enable row level security;
alter table public.lead_analyses enable row level security;
alter table public.outreach_messages enable row level security;
alter table public.jobs enable row level security;
alter table public.audit_logs enable row level security;

create policy "Public can view active products"
on public.products for select
to anon, authenticated
using (active = true);

insert into public.products (slug, name, tier, tagline, price_usdt, sort_order)
values
  ('client-payment-scope-protection-starter', 'Client Payment & Scope Protection Kit — Starter', 'Starter', 'Start with the essentials for your next client project.', 3, 1),
  ('client-payment-scope-protection-complete', 'Client Payment & Scope Protection Kit', 'Complete', 'Protect your scope, control revisions, and get paid professionally.', 7, 2),
  ('client-payment-scope-protection-agency', 'Client Payment & Scope Protection Kit — Agency', 'Agency', 'A structured client workflow for small agencies and teams.', 12, 3)
on conflict (slug) do update set name = excluded.name, tagline = excluded.tagline, price_usdt = excluded.price_usdt, active = true, updated_at = now();
