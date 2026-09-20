-- A1 authorization also depends on the absence of a matching membership.
-- A project row lock alone does not invalidate a SERIALIZABLE snapshot after
-- an earlier membership INSERT commits. Version its parent atomically so an
-- older approval transaction must restart and check the newly matching row.
-- No business value, permission, or approval is changed by this witness.
CREATE FUNCTION public.internal_approval_membership_parent_version_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
  affected integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.project_id IS NOT DISTINCT FROM OLD.project_id
       AND NEW.user_id IS NOT DISTINCT FROM OLD.user_id THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Preserve visible dates while creating the MVCC version observed by the
  -- approval's project lock. This write rolls back with the membership write.
  UPDATE public.projects AS parent
     SET updated_at = parent.updated_at
   WHERE parent.id = NEW.project_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN
    RAISE EXCEPTION 'A1_MEMBERSHIP_PROJECT_UNAVAILABLE' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER a1_membership_parent_version
BEFORE INSERT OR UPDATE ON public.project_members
FOR EACH ROW
EXECUTE FUNCTION public.internal_approval_membership_parent_version_v1();
