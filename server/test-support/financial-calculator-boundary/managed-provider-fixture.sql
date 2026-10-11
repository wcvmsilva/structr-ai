-- Owned disposable laboratory only; never a hosted containment script.
-- Reproduce actual non-superuser installation, inaccessible PUBLIC routines/views,
-- and unrelated managed-owner defaults without changing their ACLs to get GREEN.
ALTER ROLE postgres LOGIN CREATEROLE BYPASSRLS;
-- Existing provider authority observed in the read-only role graph; local grantor differs.
GRANT pg_signal_backend,pg_monitor TO postgres WITH ADMIN TRUE,INHERIT TRUE,SET TRUE; ALTER DATABASE postgres OWNER TO postgres; ALTER SCHEMA structr_private OWNER TO postgres;
   DO $fixture$ DECLARE obj record; BEGIN
    FOR obj IN SELECT c.oid::regclass AS name,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','structr_private') AND c.relowner='app_principal_runner'::regrole AND c.relkind IN ('r','p','v','m','S') LOOP
     EXECUTE format('ALTER %s %s OWNER TO postgres',CASE WHEN obj.relkind='S' THEN 'SEQUENCE' WHEN obj.relkind='v' THEN 'VIEW' WHEN obj.relkind='m' THEN 'MATERIALIZED VIEW' ELSE 'TABLE' END,obj.name);
    END LOOP;
    FOR obj IN SELECT p.oid::regprocedure AS name FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','structr_private') AND p.proowner='app_principal_runner'::regrole LOOP EXECUTE format('ALTER FUNCTION %s OWNER TO postgres',obj.name);END LOOP;
   END $fixture$;
CREATE ROLE provider_fixture_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE SCHEMA extensions AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA extensions FROM PUBLIC;
GRANT USAGE ON SCHEMA extensions TO anon,authenticated,service_role;
ALTER EXTENSION pgcrypto SET SCHEMA extensions;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA extensions TO PUBLIC;
CREATE VIEW extensions.pg_stat_statements AS SELECT 1::bigint AS userid;
CREATE VIEW extensions.pg_stat_statements_info AS SELECT 0::bigint AS dealloc;
ALTER VIEW extensions.pg_stat_statements OWNER TO postgres;
ALTER VIEW extensions.pg_stat_statements_info OWNER TO postgres;
GRANT SELECT ON extensions.pg_stat_statements,extensions.pg_stat_statements_info TO PUBLIC;
CREATE SCHEMA provider_fixture AUTHORIZATION provider_fixture_owner;
REVOKE ALL ON SCHEMA provider_fixture FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE provider_fixture_owner IN SCHEMA provider_fixture GRANT EXECUTE ON FUNCTIONS TO PUBLIC;
CREATE FUNCTION provider_fixture.constant_value() RETURNS integer LANGUAGE sql RETURN 1;
ALTER FUNCTION provider_fixture.constant_value() OWNER TO provider_fixture_owner;
GRANT TEMPORARY ON DATABASE postgres TO anon,authenticated,authenticator;

-- Exact unrelated-owner defaults in application schemas must also be frozen.
ALTER DEFAULT PRIVILEGES FOR ROLE provider_fixture_owner IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE provider_fixture_owner IN SCHEMA public GRANT SELECT ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE provider_fixture_owner IN SCHEMA public GRANT USAGE ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE provider_fixture_owner IN SCHEMA structr_private GRANT EXECUTE ON FUNCTIONS TO anon;
