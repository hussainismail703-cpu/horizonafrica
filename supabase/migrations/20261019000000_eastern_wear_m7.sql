-- Eastern Wear Phase 1 · M7: Dashboard Rebrand + Reporting
-- Scope freeze refs: §8 (metric definitions)
--
-- handover_events records every human-takeover / release action so the
-- §8 "Handover" metric can count takeovers over a date range. The
-- leads.human_takeover_at timestamp alone cannot do this — it is cleared
-- when the conversation is released back to Layla.

CREATE TABLE IF NOT EXISTS public.handover_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number text NOT NULL,
  lead_id      bigint REFERENCES public.leads(id) ON DELETE SET NULL,
  action       text NOT NULL CHECK (action IN ('takeover', 'release')),
  actor        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_handover_events_created_at
  ON public.handover_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_handover_events_phone
  ON public.handover_events (phone_number, created_at DESC);

ALTER TABLE public.handover_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'handover_events'
      AND policyname = 'handover_events_select_authenticated'
  ) THEN
    CREATE POLICY handover_events_select_authenticated
      ON public.handover_events FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

COMMENT ON TABLE public.handover_events IS
  'Audit trail of human-takeover actions for the scope-freeze §8 Handover metric.';
