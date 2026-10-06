-- A1 locks the tenant even when no tenant_settings row exists. Version that
-- parent on newly matching settings so an older snapshot cannot omit policy.
CREATE FUNCTION public.internal_approval_policy_parent_version_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
  affected integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.tenant_id IS NOT DISTINCT FROM OLD.tenant_id THEN
      RETURN NEW;
    END IF;
  END IF;

  UPDATE public.tenants AS parent
     SET updated_at = parent.updated_at
   WHERE parent.id = NEW.tenant_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN
    RAISE EXCEPTION 'A1_POLICY_TENANT_UNAVAILABLE' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER a1_policy_parent_version
BEFORE INSERT OR UPDATE ON public.tenant_settings
FOR EACH ROW
EXECUTE FUNCTION public.internal_approval_policy_parent_version_v1();
