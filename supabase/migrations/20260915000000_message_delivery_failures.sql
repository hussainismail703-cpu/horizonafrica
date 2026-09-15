-- Message Delivery Failures
-- Meta reports delivery failures asynchronously via status callbacks on the
-- WhatsApp webhook (sent/delivered/read/failed). Without this table, sends
-- that Meta accepted but could not deliver (e.g. 24h window closed, marketing
-- frequency cap, invalid recipient) are invisible — the sender is still
-- marked as successful. All statements are idempotent (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS public.message_delivery_failures (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id      text,
  recipient_phone text,
  error_code      integer,
  error_title     text,
  error_message   text,
  raw_status      jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mdf_recipient_phone
  ON public.message_delivery_failures (recipient_phone);
CREATE INDEX IF NOT EXISTS idx_mdf_created_at
  ON public.message_delivery_failures (created_at);

ALTER TABLE public.message_delivery_failures ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  DROP POLICY IF EXISTS mdf_select_auth ON public.message_delivery_failures;
  DROP POLICY IF EXISTS mdf_insert_service_role ON public.message_delivery_failures;

  CREATE POLICY mdf_select_auth ON public.message_delivery_failures
    FOR SELECT TO authenticated USING (true);
  CREATE POLICY mdf_insert_service_role ON public.message_delivery_failures
    FOR INSERT TO service_role WITH CHECK (true);
END $$;
