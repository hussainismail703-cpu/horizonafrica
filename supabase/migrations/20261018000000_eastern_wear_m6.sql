-- Eastern Wear Phase 1 · M6: Unpaid-Order Follow-Ups + Broadcast Readiness
-- Scope freeze refs: §4.5, §4.7
--
-- 1. follow_ups tracks the ordered nudge sequence for orders stuck in
--    pending_payment. One row per nudge; the cron sender marks it sent and
--    inserts the next step, and cancels pending rows when the order resolves
--    (paid/cancelled/expired) or the customer opts out / declines.
-- 2. broadcast_contacts.source distinguishes Shopify-synced contacts from
--    manual/CSV-imported ones.
-- 3. shopify_customers.accepts_marketing captures Shopify marketing consent
--    so broadcast sync can respect it.

-- 1. follow_ups ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.follow_ups (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id       uuid REFERENCES public.orders(id) ON DELETE CASCADE,
  lead_id        bigint REFERENCES public.leads(id) ON DELETE SET NULL,
  phone_number   text NOT NULL,
  sequence_step  integer NOT NULL DEFAULT 1,
  template_name  text NOT NULL,
  scheduled_for  timestamptz NOT NULL,
  status         text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','sending','sent','failed','cancelled')),
  meta_message_id text,
  error          text,
  sent_at        timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- One row per nudge step per order — prevents duplicate scheduling.
-- Full (non-partial) unique index so PostgREST upsert can use it as an
-- ON CONFLICT arbiter; NULL order_ids never conflict in Postgres anyway.
CREATE UNIQUE INDEX IF NOT EXISTS uq_follow_ups_order_step
  ON public.follow_ups (order_id, sequence_step);
CREATE INDEX IF NOT EXISTS idx_follow_ups_due
  ON public.follow_ups (scheduled_for) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_follow_ups_order
  ON public.follow_ups (order_id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_follow_ups_phone
  ON public.follow_ups (phone_number, created_at DESC);

DROP TRIGGER IF EXISTS trg_follow_ups_set_updated_at ON public.follow_ups;
CREATE TRIGGER trg_follow_ups_set_updated_at
  BEFORE UPDATE ON public.follow_ups
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

-- 2. broadcast_contacts.source ------------------------------------------------
ALTER TABLE public.broadcast_contacts
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';

-- 3. shopify_customers.accepts_marketing --------------------------------------
-- NULL = consent state unknown (older syncs / no phone); true/false = explicit.
ALTER TABLE public.shopify_customers
  ADD COLUMN IF NOT EXISTS accepts_marketing boolean;

-- 4. RLS ----------------------------------------------------------------------
ALTER TABLE public.follow_ups ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  EXECUTE 'DROP POLICY IF EXISTS follow_ups_select_auth ON public.follow_ups;';
  EXECUTE 'DROP POLICY IF EXISTS follow_ups_insert_auth ON public.follow_ups;';
  EXECUTE 'DROP POLICY IF EXISTS follow_ups_update_auth ON public.follow_ups;';
  EXECUTE 'DROP POLICY IF EXISTS follow_ups_delete_auth ON public.follow_ups;';

  EXECUTE 'CREATE POLICY follow_ups_select_auth ON public.follow_ups FOR SELECT TO authenticated USING (true);';
  EXECUTE 'CREATE POLICY follow_ups_insert_auth ON public.follow_ups FOR INSERT TO authenticated WITH CHECK (true);';
  EXECUTE 'CREATE POLICY follow_ups_update_auth ON public.follow_ups FOR UPDATE TO authenticated USING (true) WITH CHECK (true);';
  EXECUTE 'CREATE POLICY follow_ups_delete_auth ON public.follow_ups FOR DELETE TO authenticated USING (true);';
END $$;
