-- Audit Log Cleanup Triggers
-- campaign_audit_log.entity_id is polymorphic, so a normal FK cannot cascade.
-- When an enrolment or classification row is deleted through any code path,
-- its audit rows would otherwise be orphaned forever. These triggers delete
-- the audit rows alongside the entity.

CREATE OR REPLACE FUNCTION public.delete_campaign_audit_rows()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  DELETE FROM public.campaign_audit_log WHERE entity_id = OLD.id;
  RETURN OLD;
END;
$function$;

DROP TRIGGER IF EXISTS trg_enrolments_audit_cleanup ON public.campaign_enrolments;
CREATE TRIGGER trg_enrolments_audit_cleanup
  AFTER DELETE ON public.campaign_enrolments
  FOR EACH ROW EXECUTE FUNCTION public.delete_campaign_audit_rows();

DROP TRIGGER IF EXISTS trg_classifications_audit_cleanup ON public.campaign_classifications;
CREATE TRIGGER trg_classifications_audit_cleanup
  AFTER DELETE ON public.campaign_classifications
  FOR EACH ROW EXECUTE FUNCTION public.delete_campaign_audit_rows();
