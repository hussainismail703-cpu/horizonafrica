-- Fix upsert_lead_from_conversation() to respect score_locked.
-- The trigger predates the manual-lock columns: every conversation INSERT with
-- a higher lead_score snapshot upgraded the lead even when a user had locked
-- the score in the dashboard. Also allows an existing NULL score to be set.

CREATE OR REPLACE FUNCTION public.upsert_lead_from_conversation()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  score_order text[];
BEGIN
  score_order := ARRAY['COLD', 'WARM', 'HOT'];

  INSERT INTO leads (phone_number, full_name, lead_score, status, created_at, updated_at)
  VALUES (NEW.phone_number, NEW.contact_name, NEW.lead_score, 'new', NEW.created_at, NOW())
  ON CONFLICT (phone_number) DO UPDATE SET
    full_name = COALESCE(EXCLUDED.full_name, leads.full_name),
    lead_score = CASE
      WHEN leads.score_locked THEN leads.lead_score
      WHEN EXCLUDED.lead_score IS NOT NULL
        AND (leads.lead_score IS NULL
          OR array_position(score_order, EXCLUDED.lead_score) > array_position(score_order, leads.lead_score))
      THEN EXCLUDED.lead_score
      ELSE leads.lead_score
    END,
    updated_at = NOW();

  RETURN NEW;
END;
$function$;
