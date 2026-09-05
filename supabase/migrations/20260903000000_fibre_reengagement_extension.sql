-- Fibre Lead Re-Engagement Campaign Extension
-- Adds: final-outcome enrolment statuses, calling_queue table, opt_out_list table,
--       callback_requested classification, lead info-capture columns, final_outcome column.
-- All statements are idempotent (IF NOT EXISTS / DROP IF EXISTS) — safe to re-run.

-- ============================================================================
-- 1. Extend campaign_enrolments.status CHECK constraint
--    Add: interested, callback_requested, not_interested, opted_out,
--         no_response_final, other_invalid
-- ============================================================================
ALTER TABLE public.campaign_enrolments DROP CONSTRAINT IF EXISTS campaign_enrolments_status_check;
ALTER TABLE public.campaign_enrolments ADD CONSTRAINT campaign_enrolments_status_check
  CHECK (status IN (
    'active','responded','completed','removed',
    'interested','callback_requested','not_interested','opted_out',
    'no_response_final','other_invalid'
  ));

-- ============================================================================
-- 2. final_outcome column on campaign_enrolments (human-readable label per spec §8)
-- ============================================================================
ALTER TABLE public.campaign_enrolments
  ADD COLUMN IF NOT EXISTS final_outcome text;

-- ============================================================================
-- 3. Extend campaign_classifications.classification CHECK constraint
--    Add: callback_requested
-- ============================================================================
ALTER TABLE public.campaign_classifications DROP CONSTRAINT IF EXISTS campaign_classifications_classification_check;
ALTER TABLE public.campaign_classifications ADD CONSTRAINT campaign_classifications_classification_check
  CHECK (classification IN (
    'interested','not_interested','already_has_service','needs_information',
    'no_response','other','uncertain','callback_requested'
  ));

-- ============================================================================
-- 4. calling_queue table — sales-qualified leads ready for human follow-up
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.calling_queue (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id             uuid REFERENCES public.campaigns(id) ON DELETE CASCADE,
  enrolment_id            uuid REFERENCES public.campaign_enrolments(id) ON DELETE SET NULL,
  phone_number            text NOT NULL,
  lead_id                 bigint REFERENCES public.leads(id) ON DELETE SET NULL,
  full_name               text,
  email                   text,
  preferred_package       text,
  customer_request        text,
  preferred_callback_time text,
  campaign_source         text,
  campaign_stage          text,
  final_outcome           text,
  queue_status            text NOT NULL DEFAULT 'pending'
                          CHECK (queue_status IN ('pending','called','converted','lost','callback_scheduled')),
  called_at               timestamptz,
  called_by               text,
  call_notes              text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_calling_queue_campaign
  ON public.calling_queue (campaign_id);
CREATE INDEX IF NOT EXISTS idx_calling_queue_status
  ON public.calling_queue (queue_status);
CREATE INDEX IF NOT EXISTS idx_calling_queue_phone
  ON public.calling_queue (phone_number);

DROP TRIGGER IF EXISTS trg_calling_queue_set_updated_at ON public.calling_queue;
CREATE TRIGGER trg_calling_queue_set_updated_at
  BEFORE UPDATE ON public.calling_queue
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

ALTER TABLE public.calling_queue ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  DROP POLICY IF EXISTS calling_queue_select_auth ON public.calling_queue;
  DROP POLICY IF EXISTS calling_queue_insert_auth ON public.calling_queue;
  DROP POLICY IF EXISTS calling_queue_update_auth ON public.calling_queue;
  DROP POLICY IF EXISTS calling_queue_delete_auth ON public.calling_queue;

  CREATE POLICY calling_queue_select_auth ON public.calling_queue
    FOR SELECT TO authenticated USING (true);
  CREATE POLICY calling_queue_insert_auth ON public.calling_queue
    FOR INSERT TO authenticated WITH CHECK (true);
  CREATE POLICY calling_queue_update_auth ON public.calling_queue
    FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  CREATE POLICY calling_queue_delete_auth ON public.calling_queue
    FOR DELETE TO authenticated USING (true);
END $$;

-- ============================================================================
-- 5. opt_out_list table — global cross-campaign opt-out
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.opt_out_list (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number        text NOT NULL UNIQUE,
  reason              text,
  source_campaign_id  uuid REFERENCES public.campaigns(id) ON DELETE SET NULL,
  opted_out_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_opt_out_list_phone
  ON public.opt_out_list (phone_number);

ALTER TABLE public.opt_out_list ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  DROP POLICY IF EXISTS opt_out_list_select_auth ON public.opt_out_list;
  DROP POLICY IF EXISTS opt_out_list_insert_auth ON public.opt_out_list;
  DROP POLICY IF EXISTS opt_out_list_update_auth ON public.opt_out_list;
  DROP POLICY IF EXISTS opt_out_list_delete_auth ON public.opt_out_list;

  CREATE POLICY opt_out_list_select_auth ON public.opt_out_list
    FOR SELECT TO authenticated USING (true);
  CREATE POLICY opt_out_list_insert_auth ON public.opt_out_list
    FOR INSERT TO authenticated WITH CHECK (true);
  CREATE POLICY opt_out_list_update_auth ON public.opt_out_list
    FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  CREATE POLICY opt_out_list_delete_auth ON public.opt_out_list
    FOR DELETE TO authenticated USING (true);
END $$;

-- ============================================================================
-- 6. Lead info-capture columns (spec §7)
-- ============================================================================
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS preferred_package text,
  ADD COLUMN IF NOT EXISTS preferred_callback_time text;
