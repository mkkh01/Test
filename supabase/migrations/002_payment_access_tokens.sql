-- Payment workflow hardening: customer-scoped order access token.
-- Store only a hash; the raw token is returned once to the customer.

alter table public.orders
  add column if not exists access_token_hash text;

create unique index if not exists orders_access_token_hash_uidx
  on public.orders(access_token_hash)
  where access_token_hash is not null;

create index if not exists orders_access_token_status_idx
  on public.orders(access_token_hash, status)
  where access_token_hash is not null;
