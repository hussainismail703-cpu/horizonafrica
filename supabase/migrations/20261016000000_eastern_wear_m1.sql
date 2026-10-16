-- ============================================================================
-- Eastern Wear Phase 1 — M1: Persona, Classification, Knowledge Base
-- Scope freeze refs: §4.2 (inbound categories), §4.3/§4.4 (two order tracks),
-- campaign-response classification retuned with clothing rejection reasons.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. conversations.message_category — inbound routing categories (§4.2)
-- ----------------------------------------------------------------------------
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS message_category text
    CHECK (message_category IS NULL OR message_category IN (
      'sales','orders','payments','delivery','general','complaints','uncertain'
    ));

-- ----------------------------------------------------------------------------
-- 2. order_track — two sales tracks on conversations + leads (§4.3/§4.4)
-- ----------------------------------------------------------------------------
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS order_track text
    CHECK (order_track IS NULL OR order_track IN ('stock_on_hand','imported'));

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS order_track text
    CHECK (order_track IS NULL OR order_track IN ('stock_on_hand','imported'));

-- ----------------------------------------------------------------------------
-- 3. campaign_classifications.rejection_reason — widen CHECK with clothing
--    reasons while keeping every existing value valid.
-- ----------------------------------------------------------------------------
ALTER TABLE public.campaign_classifications
  DROP CONSTRAINT IF EXISTS campaign_classifications_rejection_reason_check;
ALTER TABLE public.campaign_classifications
  ADD CONSTRAINT campaign_classifications_rejection_reason_check
    CHECK (rejection_reason IS NULL OR rejection_reason IN (
      -- existing telecoms reasons (kept valid for historical rows)
      'price','already_has_service','not_needed','not_now','needs_more_info',
      'competitor','not_eligible','other',
      -- clothing reasons
      'sizing_fit','delivery_time','style_design'
    ));

-- ----------------------------------------------------------------------------
-- 4. Index for per-phone conversation lookups (newest first)
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_conversations_phone_created
  ON public.conversations (phone_number, created_at DESC);
