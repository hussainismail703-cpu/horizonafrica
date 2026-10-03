-- Pre-Launch Audit Fixes
-- 1. conversation_threads gains message_count so the Conversations page can
--    render the thread list without loading every message row.
-- 2. A unique partial index on campaign_interactions(enrol_id, step_number)
--    for outbound rows makes the campaign send-claim atomic — concurrent
--    process invocations can no longer double-send the same step.
-- 3. broadcast_messages stores one row per outbound WhatsApp message so Meta
--    delivery-status callbacks can update per-message state and a trigger
--    keeps broadcast_history.total_delivered / total_read correct.
-- 4. broadcast_contacts gets a unique index on (group_id, phone_number) so
--    bulk imports cannot create duplicate recipients in a group.
-- All statements are idempotent (IF NOT EXISTS / OR REPLACE / DROP IF EXISTS).

-- 1. Conversation threads view with message count -------------------------
CREATE OR REPLACE VIEW public.conversation_threads AS
SELECT DISTINCT ON (c.phone_number)
  c.id,
  c.phone_number,
  c.contact_name,
  c.incoming_message,
  c.ai_response,
  c.lead_score,
  c.session_id,
  c.message_id,
  c."timestamp",
  c.created_at,
  c.objection_type,
  c.follow_up_requested,
  c.follow_up_date,
  c.needs_escalation,
  (SELECT count(*) FROM public.conversations x
    WHERE x.phone_number = c.phone_number) AS message_count
FROM public.conversations c
ORDER BY c.phone_number, c.created_at DESC;

-- 2. Atomic campaign send claim --------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_campaign_interactions_outbound_step
  ON public.campaign_interactions (enrol_id, step_number)
  WHERE message_type = 'outbound';

-- One interaction per Meta message id: Meta retries webhook deliveries, and
-- concurrent deliveries of the same wamid must not double-record the same
-- inbound message. Outbound wamids are unique per send, so this also guards
-- the claim path end-to-end.
CREATE UNIQUE INDEX IF NOT EXISTS uq_campaign_interactions_meta_message_id
  ON public.campaign_interactions (meta_message_id)
  WHERE meta_message_id IS NOT NULL;

-- 3. Per-message broadcast tracking ----------------------------------------
CREATE TABLE IF NOT EXISTS public.broadcast_messages (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  broadcast_id bigint NOT NULL REFERENCES public.broadcast_history(id) ON DELETE CASCADE,
  phone_number text NOT NULL,
  wamid        text,
  status       text NOT NULL DEFAULT 'sent',
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_broadcast_messages_wamid
  ON public.broadcast_messages (wamid)
  WHERE wamid IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_broadcast_messages_broadcast
  ON public.broadcast_messages (broadcast_id);

ALTER TABLE public.broadcast_messages ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  DROP POLICY IF EXISTS broadcast_messages_read ON public.broadcast_messages;
  CREATE POLICY broadcast_messages_read ON public.broadcast_messages
    FOR SELECT TO authenticated USING (true);

  -- The broadcast send route writes per-message rows through the
  -- cookie-authenticated client, so INSERT needs an authenticated policy.
  DROP POLICY IF EXISTS broadcast_messages_insert ON public.broadcast_messages;
  CREATE POLICY broadcast_messages_insert ON public.broadcast_messages
    FOR INSERT TO authenticated WITH CHECK (true);
END $$;

-- Keep broadcast_history delivered/read counters in sync with per-message
-- status callbacks. total_sent / total_failed are written by the sender.
CREATE OR REPLACE FUNCTION public.sync_broadcast_delivery_counts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  bid bigint := COALESCE(NEW.broadcast_id, OLD.broadcast_id);
BEGIN
  UPDATE public.broadcast_history h
  SET total_delivered = s.delivered_count,
      total_read      = s.read_count
  FROM (
    SELECT
      count(*) FILTER (WHERE status IN ('delivered', 'read')) AS delivered_count,
      count(*) FILTER (WHERE status = 'read') AS read_count
    FROM public.broadcast_messages
    WHERE broadcast_id = bid
  ) s
  WHERE h.id = bid;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_broadcast_messages_sync ON public.broadcast_messages;
CREATE TRIGGER trg_broadcast_messages_sync
  AFTER INSERT OR UPDATE OF status ON public.broadcast_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_broadcast_delivery_counts();

-- 4. Broadcast contact dedupe ------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_broadcast_contacts_group_phone
  ON public.broadcast_contacts (group_id, phone_number);
