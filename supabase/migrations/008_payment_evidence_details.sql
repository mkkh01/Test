-- Payment evidence details: customer-provided context is stored for review;
-- blockchain-derived values remain authoritative for automatic verification.

alter table public.payment_evidence
  add column if not exists sender_address text,
  add column if not exists recipient_address text,
  add column if not exists amount_usdt numeric(18, 6),
  add column if not exists transfer_time timestamptz,
  add column if not exists verification_status text not null default 'pending',
  add column if not exists verification_reason text;

alter table public.payment_evidence
  drop constraint if exists payment_evidence_amount_check;

alter table public.payment_evidence
  add constraint payment_evidence_amount_check
  check (amount_usdt is null or amount_usdt >= 0);

alter table public.payment_evidence
  drop constraint if exists payment_evidence_verification_status_check;

alter table public.payment_evidence
  add constraint payment_evidence_verification_status_check
  check (verification_status in ('pending', 'matched', 'outside_time_window', 'mismatch', 'manual_review'));

create index if not exists payment_evidence_transfer_time_idx
  on public.payment_evidence(transfer_time desc);

revoke all on table public.payment_evidence from anon, authenticated;
grant select, insert, update, delete on table public.payment_evidence to service_role;
