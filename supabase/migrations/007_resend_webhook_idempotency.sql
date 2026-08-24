-- Resend delivers webhooks at least once; one Svix delivery must be processed once.
create unique index if not exists audit_logs_resend_webhook_id_idx
on public.audit_logs ((metadata->>'webhookId'))
where entity_type = 'email'
  and action like 'resend_%'
  and metadata ? 'webhookId';
