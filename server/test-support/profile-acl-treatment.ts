import { createHash } from "node:crypto";
import type postgres from "postgres";
import { assertOwnedProfileAclConnection, type ProfileAclCluster } from "./profile-acl-postgres";

/** Metadata only. Excludes cluster-specific OIDs and all business rows. */
export async function readProfileAclState(cluster: ProfileAclCluster) {
  const sql = cluster.observer.sql;
  assertOwnedProfileAclConnection(sql);
  return readState(sql);
}

async function readState(sql: Pick<postgres.Sql, "unsafe">) {
  const [state] = await sql.unsafe(`SELECT
    (SELECT jsonb_agg(x ORDER BY x.name) FROM (
      SELECT nspname AS name, pg_get_userbyid(nspowner) AS owner,
        (SELECT jsonb_agg(y ORDER BY y.grantee, y.privilege_type) FROM (
          SELECT CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,
            pg_get_userbyid(a.grantor) AS grantor, a.privilege_type, a.is_grantable
          FROM aclexplode(COALESCE(nspacl,acldefault('n',nspowner))) a
        ) y) AS acls FROM pg_namespace WHERE nspname IN ('auth','public')
    ) x) AS schemas,
    (SELECT jsonb_agg(x ORDER BY x.schema, x.name, x.kind) FROM (
      SELECT n.nspname AS schema, c.relname AS name, c.relkind::text AS kind
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('auth','public')
      UNION ALL
      SELECT n.nspname, p.proname||'('||pg_get_function_identity_arguments(p.oid)||')', 'function'
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('auth','public')
    ) x) AS inventory,
    (SELECT jsonb_agg(x ORDER BY x.name) FROM (
      SELECT attname AS name, format_type(atttypid, atttypmod) AS type, attnotnull,
        pg_get_expr(d.adbin, d.adrelid) AS default_expr
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid='public.profiles'::regclass AND a.attnum>0 AND NOT a.attisdropped
    ) x) AS columns,
    (SELECT jsonb_agg(x ORDER BY x.conname) FROM (
      SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint
      WHERE conrelid='public.profiles'::regclass
    ) x) AS constraints,
    (SELECT jsonb_agg(x ORDER BY x.indexname) FROM (
      SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='profiles'
    ) x) AS indexes,
    (SELECT jsonb_agg(x ORDER BY x.policyname) FROM (
      SELECT policyname, permissive, roles, cmd, qual, with_check FROM pg_policies
      WHERE schemaname='public' AND tablename='profiles'
    ) x) AS policies,
    (SELECT jsonb_agg(x ORDER BY x.name) FROM (
      SELECT p.oid::regprocedure::text AS name, pg_get_userbyid(p.proowner) AS owner,
        pg_get_functiondef(p.oid) AS definition FROM pg_proc p
      WHERE p.oid IN ('auth.uid()'::regprocedure, 'public.setup_admin_user()'::regprocedure,
        'public.get_current_user_role()'::regprocedure, 'public.is_admin()'::regprocedure)
    ) x) AS functions,
    (SELECT jsonb_agg(x ORDER BY x.rolname) FROM (
      SELECT rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin, rolbypassrls
      FROM pg_roles WHERE rolname IN ('anon','authenticated','authenticator','postgres','service_role')
    ) x) AS roles,
    (SELECT jsonb_agg(x ORDER BY x.member, x.role) FROM (
      SELECT pg_get_userbyid(member) AS member, pg_get_userbyid(roleid) AS role,
        admin_option, inherit_option, set_option FROM pg_auth_members
      WHERE pg_get_userbyid(member) IN ('anon','authenticated','authenticator','postgres','service_role')
    ) x) AS memberships,
    (SELECT jsonb_build_object('owner',pg_get_userbyid(relowner),'rls',relrowsecurity,'force',relforcerowsecurity)
      FROM pg_class WHERE oid='public.profiles'::regclass) AS table_security,
    (SELECT jsonb_agg(pg_get_triggerdef(oid) ORDER BY tgname) FROM pg_trigger
      WHERE tgrelid='public.profiles'::regclass AND NOT tgisinternal) AS triggers,
    (SELECT jsonb_agg(x ORDER BY x.object, x.grantee, x.privilege_type, x.grantor) FROM (
      SELECT 'table'::text AS object, CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,
        pg_get_userbyid(a.grantor) AS grantor, a.privilege_type, a.is_grantable
      FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
      WHERE c.oid='public.profiles'::regclass
      UNION ALL
      SELECT 'column:'||c.attname, CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
        pg_get_userbyid(a.grantor), a.privilege_type, a.is_grantable
      FROM pg_attribute c CROSS JOIN LATERAL aclexplode(c.attacl) a
      WHERE c.attrelid='public.profiles'::regclass AND c.attnum>0
      UNION ALL
      SELECT 'function:'||p.oid::regprocedure::text, CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
        pg_get_userbyid(a.grantor), a.privilege_type, a.is_grantable
      FROM pg_proc p CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
      WHERE p.oid IN ('auth.uid()'::regprocedure, 'public.setup_admin_user()'::regprocedure,
        'public.get_current_user_role()'::regprocedure, 'public.is_admin()'::regprocedure)
    ) x) AS acls`);
  return state;
}

export function profileAclDigest(state: unknown): string {
  return createHash("sha256").update(JSON.stringify(state)).digest("hex");
}

// Pinned from the independently reproduced synthetic baseline (red-final.log).
// The candidate digest removes only the expressly approved grants. Neither value
// is a production fingerprint or permission to apply this treatment elsewhere.
const baselineDigest = "c74be695d8725de8f1f3746e4460467d8ac192b26d5b0a02d96ebdaa400eb15c";
const candidateDigest = "9bf4bb6d24e32e2592a5f4af8e27ff6e9c260127874ce6189c8418ff44d6dfaf";

/** Lab-only transaction: no URL, migration runner or arbitrary connection API. */
export async function applyProfileAclTreatment(cluster: ProfileAclCluster): Promise<void> {
  if (process.env.PROFILE_ACL_LAB !== "1") throw new Error("Treatment requires PROFILE_ACL_LAB=1");
  const sql = cluster.observer.sql;
  const owned = assertOwnedProfileAclConnection(sql); // Must precede every query.
  if (cluster.directory !== owned.directory || sql.options.user !== "postgres") {
    throw new Error("Treatment requires the owned laboratory owner connection");
  }
  await sql.begin(async transaction => {
    const [identity] = await transaction.unsafe(`SELECT current_user AS role, session_user AS session_role,
      current_database() AS database, inet_server_addr()::text AS host,
      current_setting('profile_acl_lab.nonce',true) AS nonce,
      current_setting('listen_addresses') AS listeners, current_setting('port') AS port`);
    if (identity.role !== "postgres" || identity.session_role !== "postgres" || identity.database !== "postgres" ||
        identity.host !== null || identity.nonce !== owned.nonce || identity.listeners !== "" || identity.port !== "55441") {
      throw new Error("Treatment destination is not the owned laboratory");
    }
    await transaction.unsafe("LOCK TABLE public.profiles IN SHARE ROW EXCLUSIVE MODE");
    const before = await readState(transaction);
    const digest = profileAclDigest(before);
    if (digest === candidateDigest) return;
    if (digest !== baselineDigest) throw new Error(`Profile ACL laboratory metadata drift: ${digest}`);

    await transaction.unsafe("REVOKE EXECUTE ON FUNCTION public.setup_admin_user() FROM PUBLIC, anon, authenticated");
    await transaction.unsafe("REVOKE INSERT, UPDATE, DELETE ON TABLE public.profiles FROM PUBLIC, anon, authenticated");
    // Table-level REVOKE alone does not remove independent column privileges.
    // Identifiers come from the pinned metadata and are still quoted defensively.
    const columns = before.columns.map((column: { name: string }) => '"' + column.name.replaceAll('"', '""') + '"').join(", ");
    await transaction.unsafe(`REVOKE INSERT (${columns}), UPDATE (${columns}) ON TABLE public.profiles FROM PUBLIC, anon, authenticated`);

    const after = await readState(transaction);
    if (profileAclDigest(after) !== candidateDigest) {
      throw new Error("Profile ACL laboratory drift after treatment; transaction rolled back");
    }
  });
}
