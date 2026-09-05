-- M1: Campaign Engine Schema
-- Creates: campaigns, campaign_steps, campaign_enrolments, campaign_interactions,
--          campaign_classifications, campaign_audit_log
-- Adds: trigger_set_updated_at(), log_campaign_audit()
-- Enables RLS on all campaign tables with authenticated policies.

-- ============================================================================
-- 1. Helper functions
-- ============================================================================

-- Generic updated_at setter (idempotent — safe if it already exists)
CREATE OR REPLACE FUNCTION public.trigger_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Audit logger for campaign_enrolments + campaign_classifications
CREATE OR REPLACE FUNCTION public.log_campaign_audit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_entity_type text;
  v_entity_id uuid;
  v_field text;
  v_old text;
  v_new text;
  v_changed_by text;
BEGIN
  v_changed_by := COALESCE(
    current_setting('app.current_user', true),
    'system'
  );

  IF TG_TABLE_NAME = 'campaign_enrolments' THEN
    v_entity_type := 'campaign_enrolment';
    v_entity_id   := NEW.id;

    IF (TG_OP = 'UPDATE') THEN
      IF OLD.status IS DISTINCT FROM NEW.status THEN
        INSERT INTO public.campaign_audit_log (entity_type, entity_id, field_changed, old_value, new_value, changed_by)
        VALUES (v_entity_type, v_entity_id, 'status',
                COALESCE(OLD.status::text, ''), COALESCE(NEW.status::text, ''),
                v_changed_by);
      END IF;
      IF OLD.current_step IS DISTINCT FROM NEW.current_step THEN
        INSERT INTO public.campaign_audit_log (entity_type, entity_id, field_changed, old_value, new_value, changed_by)
        VALUES (v_entity_type, v_entity_id, 'current_step',
                COALESCE(OLD.current_step::text, ''), COALESCE(NEW.current_step::text, ''),
                v_changed_by);
      END IF;
      RETURN NEW;
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'campaign_classifications' THEN
    v_entity_type := 'classification';
    v_entity_id   := NEW.id;

    IF (TG_OP = 'UPDATE') THEN
      IF OLD.classification IS DISTINCT FROM NEW.classification THEN
        INSERT INTO public.campaign_audit_log (entity_type, entity_id, field_changed, old_value, new_value, changed_by)
        VALUES (v_entity_type, v_entity_id, 'classification',
                COALESCE(OLD.classification, ''), COALESCE(NEW.classification, ''),
                v_changed_by);
      END IF;
      IF OLD.rejection_reason IS DISTINCT FROM NEW.rejection_reason THEN
        INSERT INTO public.campaign_audit_log (entity_type, entity_id, field_changed, old_value, new_value, changed_by)
        VALUES (v_entity_type, v_entity_id, 'rejection_reason',
                COALESCE(OLD.rejection_reason, ''), COALESCE(NEW.rejection_reason, ''),
                v_changed_by);
      END IF;
      IF OLD.corrected_by IS DISTINCT FROM NEW.corrected_by THEN
        INSERT INTO public.campaign_audit_log (entity_type, entity_id, field_changed, old_value, new_value, changed_by)
        VALUES (v_entity_type, v_entity_id, 'corrected_by',
                COALESCE(OLD.corrected_by, ''), COALESCE(NEW.corrected_by, ''),
                v_changed_by);
      END IF;
      RETURN NEW;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================================================
-- 2. campaigns
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.campaigns (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  objective   text,
  status      text NOT NULL DEFAULT 'draft'
              CHECK (status IN ('draft','active','paused','completed','stopped')),
  start_date  timestamptz,
  end_date    timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_campaigns_set_updated_at ON public.campaigns;
CREATE TRIGGER trg_campaigns_set_updated_at
  BEFORE UPDATE ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

-- ============================================================================
-- 3. campaign_steps
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.campaign_steps (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  step_number   integer NOT NULL,
  delay_days    integer NOT NULL,
  template_name text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, step_number)
);

-- ============================================================================
-- 4. campaign_enrolments
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.campaign_enrolments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id  uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  phone_number text NOT NULL,
  lead_id      bigint REFERENCES public.leads(id) ON DELETE SET NULL,
  current_step integer NOT NULL DEFAULT 0,
  status       text NOT NULL DEFAULT 'active'
               CHECK (status IN ('active','responded','completed','removed')),
  enrolled_at  timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Unique active enrolment per phone per campaign (only one non-removed row)
CREATE UNIQUE INDEX IF NOT EXISTS uq_campaign_enrolments_active_phone
  ON public.campaign_enrolments (campaign_id, phone_number)
  WHERE status <> 'removed';

DROP TRIGGER IF EXISTS trg_enrolments_set_updated_at ON public.campaign_enrolments;
CREATE TRIGGER trg_enrolments_set_updated_at
  BEFORE UPDATE ON public.campaign_enrolments
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

DROP TRIGGER IF EXISTS trg_enrolments_audit ON public.campaign_enrolments;
CREATE TRIGGER trg_enrolments_audit
  AFTER UPDATE ON public.campaign_enrolments
  FOR EACH ROW EXECUTE FUNCTION public.log_campaign_audit();

-- ============================================================================
-- 5. campaign_interactions
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.campaign_interactions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  enrol_id        uuid REFERENCES public.campaign_enrolments(id) ON DELETE SET NULL,
  phone_number    text NOT NULL,
  step_number     integer,
  message_type    text NOT NULL CHECK (message_type IN ('outbound','inbound')),
  template_name   text,
  message_body    text,
  delivery_status text NOT NULL DEFAULT 'pending'
                  CHECK (delivery_status IN ('pending','sent','delivered','read','failed')),
  meta_message_id text,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaign_interactions_campaign
  ON public.campaign_interactions (campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_interactions_enrol
  ON public.campaign_interactions (enrol_id);
CREATE INDEX IF NOT EXISTS idx_campaign_interactions_phone_step
  ON public.campaign_interactions (phone_number, step_number, message_type);

-- ============================================================================
-- 6. campaign_classifications
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.campaign_classifications (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  interaction_id           uuid NOT NULL REFERENCES public.campaign_interactions(id) ON DELETE CASCADE,
  phone_number             text NOT NULL,
  classification           text NOT NULL
                           CHECK (classification IN ('interested','not_interested','already_has_service','needs_information','no_response','other','uncertain')),
  rejection_reason         text
                           CHECK (rejection_reason IS NULL OR rejection_reason IN ('price','already_has_service','not_needed','not_now','needs_more_info','competitor','not_eligible','other')),
  confidence               real CHECK (confidence IS NULL OR (confidence >= 0.0 AND confidence <= 1.0)),
  classified_by            text NOT NULL DEFAULT 'ai' CHECK (classified_by IN ('ai','manual')),
  original_ai_classification text,
  corrected_by             text,
  corrected_at             timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaign_classifications_phone
  ON public.campaign_classifications (phone_number);

DROP TRIGGER IF EXISTS trg_classifications_audit ON public.campaign_classifications;
CREATE TRIGGER trg_classifications_audit
  AFTER UPDATE ON public.campaign_classifications
  FOR EACH ROW EXECUTE FUNCTION public.log_campaign_audit();

-- ============================================================================
-- 7. campaign_audit_log
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.campaign_audit_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type  text NOT NULL,
  entity_id    uuid NOT NULL,
  field_changed text NOT NULL,
  old_value    text,
  new_value    text,
  changed_by   text NOT NULL,
  changed_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaign_audit_log_entity
  ON public.campaign_audit_log (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_campaign_audit_log_changed_at
  ON public.campaign_audit_log (changed_at);

-- ============================================================================
-- 8. Row Level Security
-- ============================================================================
ALTER TABLE public.campaigns                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_steps           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_enrolments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_interactions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_classifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_audit_log       ENABLE ROW LEVEL SECURITY;

-- Reusable policy template: authenticated users full access
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT unnest(ARRAY['campaigns','campaign_steps','campaign_enrolments','campaign_interactions','campaign_classifications','campaign_audit_log'])
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', t || '_select_auth', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', t || '_insert_auth', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', t || '_update_auth', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', t || '_delete_auth', t);

    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true);', t || '_select_auth', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (true);', t || '_insert_auth', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (true) WITH CHECK (true);', t || '_update_auth', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (true);', t || '_delete_auth', t);
  END LOOP;
END $$;

-- Service role bypasses RLS by default (supabase service key).
