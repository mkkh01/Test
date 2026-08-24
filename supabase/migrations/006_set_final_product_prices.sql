-- Canonical production prices for the three product tiers.
-- Apply after reviewing the target environment; this migration is intentionally not run by the agent.
update public.products
set price_usdt = case tier
  when 'Starter' then 5
  when 'Complete' then 7
  when 'Agency' then 10
end,
updated_at = now()
where tier in ('Starter', 'Complete', 'Agency');

-- Guard against a future seed/configuration drift.
do $$
begin
  alter table public.products add constraint products_canonical_price_check
    check ((tier = 'Starter' and price_usdt = 5)
      or (tier = 'Complete' and price_usdt = 7)
      or (tier = 'Agency' and price_usdt = 10));
exception when duplicate_object then null;
end $$;
