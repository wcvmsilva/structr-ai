-- ============================================================
-- SECURITY AUDIT: Read-only discovery query
-- Run this FIRST to map the current security state.
-- All queries are SELECT-only; no schema changes.
-- ============================================================

-- 1. Tables with RLS disabled
SELECT schemaname, tablename, rowsecurity, forcerowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND rowsecurity = false
ORDER BY tablename;

-- 2. Current per-table GRANTs (who can do what)
SELECT grantee, table_schema, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee IN ('anon', 'authenticated', 'service_role')
ORDER BY table_name, grantee, privilege_type;

-- 3. SECURITY DEFINER functions and their EXECUTE grants
SELECT
    p.proname AS function_name,
    pg_get_userbyid(p.proowner) AS owner,
    CASE WHEN p.prosecdef THEN 'YES' ELSE 'NO' END AS security_definer,
    p.proconfig AS search_path,
    ARRAY(
        SELECT r.rolname
        FROM pg_auth_members m
        JOIN pg_roles r ON m.roleid = r.oid
        WHERE m.member = 0
    ) AS granted_to_roles
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.prosecdef = true
ORDER BY p.proname;

-- 4. Permissive RLS policies (USING (true) or WITH CHECK (true))
SELECT schemaname, tablename, policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND (qual = 'true' OR with_check = 'true')
ORDER BY tablename, policyname;

-- 5. SECURITY DEFINER views
SELECT viewname, viewowner
FROM pg_views
WHERE schemaname = 'public';

-- 6. Functions callable by anon
SELECT p.proname, n.nspname
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
JOIN pg_auth_members m ON m.member = 0
WHERE n.nspname = 'public'
ORDER BY p.proname;
