-- H1 and A1 must both version the same project: an older SERIALIZABLE
-- transaction may be waiting on either side. Preserve all visible values.
CREATE FUNCTION public.internal_approval_historical_project_witness_v1()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
  affected integer;
BEGIN
  UPDATE public.projects AS parent
     SET updated_at = parent.updated_at
   WHERE parent.id = NEW.project_id
     AND parent.tenant_id = NEW.tenant_id
     AND parent.client_id = NEW.client_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN
    RAISE EXCEPTION 'A1_HISTORICAL_PROJECT_UNAVAILABLE' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER a1_historical_import_project_witness
BEFORE INSERT ON public.historical_estimate_imports
FOR EACH ROW
EXECUTE FUNCTION public.internal_approval_historical_project_witness_v1();
--> statement-breakpoint
CREATE TRIGGER a1_snapshot_project_witness
BEFORE INSERT ON public.estimate_internal_approval_snapshots
FOR EACH ROW
EXECUTE FUNCTION public.internal_approval_historical_project_witness_v1();
--> statement-breakpoint
-- A snapshot survives revocation; do not filter by the draft's current status.
-- Reuse the frozen validator's contextual, two-edge, bounded traversal.
CREATE FUNCTION public.internal_approval_historical_recorded_lineage_v1()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog
SET row_security = off
AS $$
DECLARE
  recorded_draft uuid;
BEGIN
  FOR recorded_draft IN
    SELECT snapshot.estimate_draft_id
      FROM public.estimate_internal_approval_snapshots AS snapshot
     WHERE snapshot.tenant_id = NEW.tenant_id
       AND snapshot.project_id = NEW.project_id
     ORDER BY snapshot.estimate_draft_id
  LOOP
    PERFORM public.internal_approval_check_lineage_v1(recorded_draft);
  END LOOP;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER a1_historical_recorded_lineage_final
AFTER INSERT ON public.historical_estimate_imports
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.internal_approval_historical_recorded_lineage_v1();
