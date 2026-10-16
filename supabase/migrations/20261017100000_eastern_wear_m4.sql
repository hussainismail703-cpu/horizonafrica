-- Eastern Wear Phase 1 · M4: Imported Orders Track + Human-Handover Pause
-- Scope freeze refs: §4.4, §4.6
--
-- Two independent features:
--   1. Imported/online orders run a different lifecycle from stock-on-hand:
--      Layla explains the 6-week lead time + 50% deposit terms, then hands the
--      enquiry to Orders@easternwearbykersh.co.za. There is no payment link —
--      add a terminal 'handed_to_orders' status for the imported track.
--   2. Human handover pause: once a team member takes over a conversation in
--      Chatwoot (or via the dashboard), Layla pauses automated replies until
--      the conversation is released.

-- 1. orders.status — add 'handed_to_orders' -------------------------------
-- The constraint was created as an inline column CHECK, so its name may vary;
-- find and drop whatever CHECK constrains the status column, then recreate it.
DO $$
DECLARE
  cname text;
BEGIN
  SELECT con.conname INTO cname
  FROM pg_constraint con
  WHERE con.conrelid = 'public.orders'::regclass
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%status%IN%'
  LIMIT 1;
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.orders DROP CONSTRAINT %I', cname);
  END IF;
END $$;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_status_check
  CHECK (status IN (
    'pending_payment',
    'paid',
    'payment_failed',
    'cancelled',
    'expired',
    'handed_to_orders'
  ));

-- 2. leads — human takeover flag -----------------------------------------
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS human_takeover    boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS human_takeover_at timestamptz,
  ADD COLUMN IF NOT EXISTS human_takeover_by text;

-- Fast lookup of flagged leads by phone on the inbound webhook path.
CREATE INDEX IF NOT EXISTS idx_leads_human_takeover
  ON public.leads (phone_number)
  WHERE human_takeover = true;
