-- Campaign audit actor fallback
-- API routes attempted to set app.current_user with a separate set_config RPC,
-- but that setting does not persist into the later UPDATE request. Use the
-- authenticated Supabase JWT email as the portable fallback so manual changes
-- record the actual dashboard actor while service/system writes still record
-- "system".

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
    NULLIF(current_setting('app.current_user', true), ''),
    NULLIF(auth.email(), ''),
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
