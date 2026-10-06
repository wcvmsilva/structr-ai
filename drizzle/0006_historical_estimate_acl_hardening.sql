-- H1 evidence is immutable under row DML and whole-table operations. Apply this
-- migration transactionally after 0005 and before exposing historical capture.
-- This does not protect against an owner/admin that can change or disable DDL.
CREATE OR REPLACE FUNCTION public.historical_estimate_reject_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '23514',
    CONSTRAINT = 'historical_estimate_immutable',
    MESSAGE = 'Historical estimate evidence cannot be changed or truncated';
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE TRIGGER hes_no_truncate BEFORE TRUNCATE ON public.historical_estimate_sources
FOR EACH STATEMENT EXECUTE FUNCTION public.historical_estimate_reject_mutation();
--> statement-breakpoint
CREATE OR REPLACE TRIGGER hesl_no_truncate BEFORE TRUNCATE ON public.historical_estimate_source_lines
FOR EACH STATEMENT EXECUTE FUNCTION public.historical_estimate_reject_mutation();
--> statement-breakpoint
CREATE OR REPLACE TRIGGER hei_no_truncate BEFORE TRUNCATE ON public.historical_estimate_imports
FOR EACH STATEMENT EXECUTE FUNCTION public.historical_estimate_reject_mutation();
--> statement-breakpoint
CREATE OR REPLACE TRIGGER heil_no_truncate BEFORE TRUNCATE ON public.historical_estimate_import_lines
FOR EACH STATEMENT EXECUTE FUNCTION public.historical_estimate_reject_mutation();
--> statement-breakpoint
-- CREATE TABLE may inherit provider grants even though 0005 contains no GRANT.
-- Normalize these four objects only; never change creator defaults, membership,
-- unrelated tables, or the as-yet-unverified application principal's grants.
DO $h1_acl$
DECLARE
  evidence_table text;
  api_role text;
  api_oid oid;
  reachable_role record;
BEGIN
  FOREACH evidence_table IN ARRAY ARRAY[
    'historical_estimate_sources', 'historical_estimate_source_lines',
    'historical_estimate_imports', 'historical_estimate_import_lines'
  ] LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC', evidence_table);
    FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = api_role) THEN
        EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM %I', evidence_table, api_role);
      END IF;
    END LOOP;
  END LOOP;

  -- These REVOKEs do not clear privileges held by other roles, including grants
  -- on individual columns, that an API role inherits or reaches via SET ROLE.
  -- Refuse this deployment instead of rewriting its role graph or silently
  -- declaring it safe. Unknown runtime roles remain a
  -- separate, mandatory release preflight; no positive access is granted here.
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    SELECT oid INTO api_oid FROM pg_catalog.pg_roles WHERE rolname = api_role;
    IF api_oid IS NULL THEN CONTINUE; END IF;
    FOR reachable_role IN
      SELECT oid FROM pg_catalog.pg_roles
      WHERE oid = api_oid OR pg_catalog.pg_has_role(api_oid, oid, 'SET')
    LOOP
      FOREACH evidence_table IN ARRAY ARRAY[
        'historical_estimate_sources', 'historical_estimate_source_lines',
        'historical_estimate_imports', 'historical_estimate_import_lines'
      ] LOOP
        IF pg_catalog.has_table_privilege(
          reachable_role.oid, format('public.%I', evidence_table),
          'INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
        ) OR pg_catalog.has_any_column_privilege(
          reachable_role.oid, format('public.%I', evidence_table),
          'SELECT,INSERT,UPDATE,REFERENCES'
        ) THEN
          RAISE EXCEPTION USING ERRCODE = '23514',
            CONSTRAINT = 'historical_estimate_api_acl',
            MESSAGE = 'Historical estimate API access remains through effective role privileges';
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
END;
$h1_acl$;
--> statement-breakpoint
