-- Webhook Hardening
-- Part of the webhook hardening work:
--   1. inbound_webhook_messages deduplicates inbound Meta webhooks by wamid so
--      retried/delivered-twice payloads are not processed twice.
--   2. system_heartbeats records scheduler liveness (e.g. the campaign process
--      cron) so the health monitor can detect missed runs.
--   3. campaign_interactions.content_type records the Meta message type
--      (text, button, interactive, image, location, ...) on inbound
--      interactions.
-- All statements are idempotent (IF NOT EXISTS / DROP POLICY IF EXISTS).

CREATE TABLE IF NOT EXISTS public.inbound_webhook_messages (
  wamid        text PRIMARY KEY,
  phone_number text,
  received_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.system_heartbeats (
  name        text PRIMARY KEY,
  last_run_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.campaign_interactions
  ADD COLUMN IF NOT EXISTS content_type text;

ALTER TABLE public.inbound_webhook_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_heartbeats ENABLE ROW LEVEL SECURITY;

-- inbound_webhook_messages is written/read only by the service-role webhook
-- handler; no client policies are required (RLS denies all direct access).

DO $$
BEGIN
  DROP POLICY IF EXISTS system_heartbeats_read ON public.system_heartbeats;

  CREATE POLICY system_heartbeats_read ON public.system_heartbeats
    FOR SELECT TO public USING (true);
END $$;

INSERT INTO public.system_heartbeats (name)
VALUES ('campaign_process')
ON CONFLICT (name) DO NOTHING;
