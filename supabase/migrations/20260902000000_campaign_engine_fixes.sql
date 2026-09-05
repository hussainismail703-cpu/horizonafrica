-- Campaign Engine Fixes & Scope Gap Closure
-- Adds: campaign_errors table (reproducibility), meta_error column (reproducibility),
--       nurture_flag on enrolments, lead profile extension columns, group_id on campaigns.
-- All statements are idempotent (IF NOT EXISTS) — safe to re-run.

-- ============================================================================
-- 1. campaign_errors table (issue 1 — already in DB, makes migration reproducible)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.campaign_errors (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   uuid REFERENCES public.campaigns(id) ON DELETE CASCADE,
  enrol_id      uuid REFERENCES public.campaign_enrolments(id) ON DELETE SET NULL,
  phone_number  text,
  error_type    text NOT NULL,
  error_message text,
  context       jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaign_errors_campaign
  ON public.campaign_errors (campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_errors_created_at
  ON public.campaign_errors (created_at);

ALTER TABLE public.campaign_errors ENABLE ROW LEVEL SECURITY;

-- RLS policies for campaign_errors (idempotent)
DO $$
BEGIN
  DROP POLICY IF EXISTS campaign_errors_select_auth ON public.campaign_errors;
  DROP POLICY IF EXISTS campaign_errors_insert_auth ON public.campaign_errors;
  DROP POLICY IF EXISTS campaign_errors_update_auth ON public.campaign_errors;
  DROP POLICY IF EXISTS campaign_errors_delete_auth ON public.campaign_errors;

  CREATE POLICY campaign_errors_select_auth ON public.campaign_errors
    FOR SELECT TO authenticated USING (true);
  CREATE POLICY campaign_errors_insert_auth ON public.campaign_errors
    FOR INSERT TO authenticated WITH CHECK (true);
  CREATE POLICY campaign_errors_update_auth ON public.campaign_errors
    FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  CREATE POLICY campaign_errors_delete_auth ON public.campaign_errors
    FOR DELETE TO authenticated USING (true);
END $$;

-- ============================================================================
-- 2. meta_error column on campaign_interactions (issue 2 — already in DB, idempotent)
-- ============================================================================
ALTER TABLE public.campaign_interactions ADD COLUMN IF NOT EXISTS meta_error text;

-- ============================================================================
-- 3. nurture_flag on campaign_enrolments (issue 5 — no-response flagging)
-- ============================================================================
ALTER TABLE public.campaign_enrolments
  ADD COLUMN IF NOT EXISTS nurture_flag boolean NOT NULL DEFAULT false;

-- ============================================================================
-- 4. Lead profile extension columns (issue 6 — Section 4.11)
-- ============================================================================
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS last_campaign_contact_date timestamptz,
  ADD COLUMN IF NOT EXISTS last_campaign_response text,
  ADD COLUMN IF NOT EXISTS rejection_reason text;

-- ============================================================================
-- 5. group_id on campaigns (issue 10 — store target group reference)
-- ============================================================================
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS group_id bigint REFERENCES public.broadcast_groups(id) ON DELETE SET NULL;
