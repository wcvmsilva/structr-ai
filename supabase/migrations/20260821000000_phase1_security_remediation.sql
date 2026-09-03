-- ============================================================
-- Phase 1 Security Remediation: Enable RLS + Default Deny
-- ============================================================
--
-- This migration addresses the 62 ERROR / 89 WARNING findings
-- from the Supabase Security Advisor by:
--
-- 1. Enabling RLS on all public tables (default-deny)
-- 2. Granting minimal read access to authenticated users
-- 3. Revoking all anon access on sensitive tables
-- 4. Hardening SECURITY DEFINER functions
--
-- IMPORTANT: Apply on staging first. Test all API endpoints.
-- RLS is bypassed by table owners (Supavisor pooler), so the
-- app continues to work. PostgREST/Data API access is locked down.
-- ============================================================

-- Step 1: Enable RLS on every table in public that doesn't have it
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'public'
          AND rowsecurity = false
    LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tablename);
        RAISE NOTICE 'Enabled RLS on public.%', r.tablename;
    END LOOP;
END $$;

-- Step 2: Create authenticated-read policies for all tables
-- (safe default: authenticated users can SELECT, nothing else)
DO $$
DECLARE
    r RECORD;
    policy_name TEXT;
BEGIN
    FOR r IN
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'public'
    LOOP
        policy_name := 'auth_read_' || r.tablename;
        -- Drop if exists (idempotent)
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', policy_name, r.tablename);
        -- Create read-only policy for authenticated
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)',
            policy_name, r.tablename
        );
        RAISE NOTICE 'Created authenticated-read policy on public.%', r.tablename;
    END LOOP;
END $$;

-- Step 3: Revoke anon access on sensitive tables
-- (subcontractors, audit_logs, cost_code_pricing_history, etc.)
DO $$
DECLARE
    sensitive_tables TEXT[] := ARRAY[
        'subcontractors', 'audit_logs', 'cost_code_pricing_history',
        'clients', 'deals', 'leads', 'intake_forms',
        'projects', 'estimates', 'estimate_items', 'estimate_drafts'
    ];
    t TEXT;
BEGIN
    FOREACH t IN ARRAY sensitive_tables
    LOOP
        EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
        RAISE NOTICE 'Revoked anon access on public.%', t;
    END LOOP;
END $$;

-- Step 4: Fix SECURITY DEFINER functions with mutable search_path
-- Set search_path = public on all SECURITY DEFINER functions
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT p.proname, n.nspname
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public'
          AND p.prosecdef = true
    LOOP
        -- Only fix if search_path is not already pinned
        IF NOT EXISTS (
            SELECT 1 FROM pg_proc p
            JOIN pg_namespace n ON p.pronamespace = n.oid
            WHERE n.nspname = 'public'
              AND p.proname = r.proname
              AND p.proconfig @> ARRAY['search_path=public']
        ) THEN
            EXECUTE format(
                'ALTER FUNCTION public.%I SET search_path = public',
                r.proname
            );
            RAISE NOTICE 'Pinned search_path on public.%', r.proname;
        END IF;
    END LOOP;
END $$;

-- Step 5: Create a verification query (run after migration)
-- SELECT
--     (SELECT count(*) FROM pg_tables WHERE schemaname='public' AND rowsecurity=true) AS rls_enabled,
--     (SELECT count(*) FROM pg_tables WHERE schemaname='public') AS total_tables,
--     (SELECT count(*) FROM pg_policies WHERE schemaname='public') AS policy_count;
