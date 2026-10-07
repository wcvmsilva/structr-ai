/** Local PG17 proof only. The supervisor creates a disposable socket-only
 * cluster; every migration below executes as a non-superuser CREATEROLE/table
 * owner. No hosted connection, Auth configuration or application token exists. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { access } from "node:fs/promises";
import postgres from "postgres";
import { startAppPrincipalPostgres, type AppPrincipalCluster } from "./test-support/app-principal-postgres";

const enabled = process.env.APP_PRINCIPAL_LAB === "1" && process.env.ADR002_MIGRATION_PRINCIPAL === "1";
const migrations = new URL("../drizzle/", import.meta.url);
const migration = readFileSync(new URL("0015_authenticated_review_boundary.sql", migrations), "utf8");

describe.skipIf(!enabled)("ADR002 non-superuser migration owner lifecycle", () => {
  let cluster: AppPrincipalCluster;
  const observer = () => cluster.observer.sql;
  const catalog = () => observer()`
    SELECT c.relname,c.relowner::regrole::text AS owner,c.relacl::text AS acl,
      c.relrowsecurity,c.relforcerowsecurity,
      (SELECT coalesce(jsonb_agg(jsonb_build_object('name',a.attname,'acl',a.attacl::text) ORDER BY a.attnum),'[]')
       FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) AS columns
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' ORDER BY c.relname`;

  beforeAll(async () => {
    cluster = await startAppPrincipalPostgres(postgres);
    await observer().unsafe(`
      CREATE ROLE adr002_migration_admin NOLOGIN NOSUPERUSER NOCREATEDB CREATEROLE NOREPLICATION NOBYPASSRLS;
      CREATE ROLE anon NOLOGIN NOSUPERUSER NOBYPASSRLS;
      CREATE ROLE authenticator LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
      GRANT anon,authenticated TO authenticator WITH INHERIT FALSE,SET TRUE;
      GRANT USAGE,CREATE ON SCHEMA public TO adr002_migration_admin;
      GRANT CREATE ON DATABASE postgres TO adr002_migration_admin;
    `);
    const journal = JSON.parse(readFileSync(new URL("meta/_journal.json", migrations), "utf8")) as {entries: {tag: string}[]};
    for (const {tag} of journal.entries.filter(e => Number(e.tag.slice(0,4)) <= 14)) {
      await observer().begin(async tx => {
        await tx.unsafe("SET LOCAL ROLE adr002_migration_admin");
        await tx.unsafe(readFileSync(new URL(`${tag}.sql`, migrations), "utf8"));
      });
    }
    // Explicit owned-lab containment by the supervisor, which also owns the
    // harness-installed pgcrypto routines. The migration principal cannot revoke
    // their PUBLIC defaults; 0015 must and does refuse that uncontained state.
    // This is not a grant/revoke against hosted public.
    await observer().unsafe(`
        REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC,anon,authenticated,authenticator;
        REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC,anon,authenticated,authenticator;
        REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC,anon,authenticated,authenticator;
    `);
  }, 90_000);

  afterAll(async () => {
    if (!cluster) return;
    const directory = cluster.directory;
    await cluster.stop();
    await expect(access(directory)).rejects.toMatchObject({code: "ENOENT"});
    console.log("ADR002_MIGRATION_PRINCIPAL_CLEANUP", JSON.stringify({directory, removed: true}));
  }, 20_000);

  it("executes base migrations as the non-superuser table owner", async () => {
    const rows = await catalog();
    expect(rows).toHaveLength(90);
    expect(new Set(rows.map(row => row.owner))).toEqual(new Set(["adr002_migration_admin"]));
    await observer().begin(async tx => {
      await tx.unsafe("SET LOCAL ROLE adr002_migration_admin");
      expect(await tx`SELECT current_user AS principal,rolsuper,rolcreaterole,rolbypassrls
        FROM pg_roles WHERE rolname=current_user`).toEqual([
        {principal: "adr002_migration_admin", rolsuper: false, rolcreaterole: true, rolbypassrls: false},
      ]);
    });
  });

  it("rolls back the complete boundary, policies, column grants and roles after a final failure", async () => {
    const before = await catalog();
    await expect(observer().begin(async tx => {
      await tx.unsafe("SET LOCAL ROLE adr002_migration_admin");
      await tx.unsafe(migration);
      // A final failure after ownership transfer tests the entire transaction,
      // not just a refusal before any side effect. No product SQL is altered.
      await tx.unsafe("DO $$ BEGIN RAISE EXCEPTION 'ADR002_TEST_ROLLBACK'; END $$");
    })).rejects.toMatchObject({code: "P0001", message: "ADR002_TEST_ROLLBACK"});
    expect(await catalog()).toEqual(before);
    expect(await observer()`SELECT
      (SELECT count(*)::int FROM pg_roles WHERE rolname='structr_review_owner_v1') AS roles,
      (SELECT count(*)::int FROM pg_namespace WHERE nspname='structr_private') AS schemas,
      (SELECT count(*)::int FROM pg_policy WHERE polname LIKE 'adr002_%') AS policies,
      (SELECT count(*)::int FROM pg_proc WHERE proname IN ('structr_authenticated_session_v1','structr_internal_approval_review_v1')) AS wrappers`)
      .toEqual([{roles: 0, schemas: 0, policies: 0, wrappers: 0}]);
  });

  it("installs the full boundary and withdraws temporary SET/INHERIT while retaining creator administration", async () => {
    await observer().begin(async tx => {
      await tx.unsafe("SET LOCAL ROLE adr002_migration_admin");
      await tx.unsafe(migration);
    });
    expect(await observer()`SELECT rolcanlogin,rolsuper,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls,rolinherit
      FROM pg_roles WHERE rolname='structr_review_owner_v1'`).toEqual([
      {rolcanlogin:false,rolsuper:false,rolcreaterole:false,rolcreatedb:false,rolreplication:false,rolbypassrls:false,rolinherit:false},
    ]);
    const memberships = await observer()`SELECT grantor.rolname AS grantor,m.admin_option,m.inherit_option,m.set_option
      FROM pg_auth_members m JOIN pg_roles target ON target.oid=m.roleid JOIN pg_roles member ON member.oid=m.member
      JOIN pg_roles grantor ON grantor.oid=m.grantor
      WHERE target.rolname='structr_review_owner_v1' AND member.rolname='adr002_migration_admin'`;
    expect(memberships).toEqual([{grantor:"app_principal_runner",admin_option:true,inherit_option:false,set_option:false}]);
    expect(await observer()`SELECT
      pg_has_role('adr002_migration_admin','structr_review_owner_v1','SET') AS can_set,
      pg_has_role('adr002_migration_admin','structr_review_owner_v1','USAGE') AS inherits,
      has_schema_privilege('structr_review_owner_v1','structr_private','CREATE') AS can_create,
      (SELECT count(*)::int FROM pg_class WHERE relowner='structr_review_owner_v1'::regrole) AS owned_relations,
      (SELECT count(*)::int FROM pg_proc WHERE proowner='structr_review_owner_v1'::regrole) AS owned_functions`)
      .toEqual([{can_set:false,inherits:false,can_create:false,owned_relations:0,owned_functions:6}]);
    const api = await observer()`SELECT rolname,pg_has_role(oid,'structr_review_owner_v1','SET') AS can_set,
      pg_has_role(oid,'structr_review_owner_v1','USAGE') AS inherits,
      has_schema_privilege(oid,'structr_private','USAGE') AS private_usage
      FROM pg_roles WHERE rolname IN ('anon','authenticated','authenticator') ORDER BY rolname`;
    expect(api).toEqual(["anon","authenticated","authenticator"].map(rolname => ({rolname,can_set:false,inherits:false,private_usage:false})));
  });

  it("permits an explicit administrative maintenance window and closes SET authority afterward", async () => {
    // Tests the real automatic ADMIN grant; no supervisor grant is added here.
    await observer().begin(async tx => {
      await tx.unsafe("SET LOCAL ROLE adr002_migration_admin");
      expect(await tx`SELECT pg_has_role(current_user,'structr_review_owner_v1','SET') AS can_set`).toEqual([{can_set:false}]);
      await tx.unsafe("GRANT structr_review_owner_v1 TO adr002_migration_admin WITH INHERIT FALSE,SET TRUE");
      expect(await tx`SELECT pg_has_role(current_user,'structr_review_owner_v1','SET') AS can_set`).toEqual([{can_set:true}]);
      await tx.unsafe("SET LOCAL ROLE structr_review_owner_v1");
      await tx.unsafe("ALTER FUNCTION structr_private.review_uuid_v1(text) COST 123");
      expect(await tx`SELECT current_user AS principal,procost FROM pg_proc
        WHERE oid='structr_private.review_uuid_v1(text)'::regprocedure`).toEqual([{principal:"structr_review_owner_v1",procost:123}]);
      await tx.unsafe("ALTER FUNCTION structr_private.review_uuid_v1(text) COST 100");
      await tx.unsafe("SET LOCAL ROLE adr002_migration_admin");
      await tx.unsafe("REVOKE structr_review_owner_v1 FROM adr002_migration_admin");
      expect(await tx`SELECT pg_has_role(current_user,'structr_review_owner_v1','SET') AS can_set,
        pg_has_role(current_user,'structr_review_owner_v1','USAGE') AS inherits`).toEqual([{can_set:false,inherits:false}]);
    });
    expect(await observer()`SELECT count(*)::int AS admin_memberships FROM pg_auth_members m
      JOIN pg_roles target ON target.oid=m.roleid JOIN pg_roles member ON member.oid=m.member
      WHERE target.rolname='structr_review_owner_v1' AND member.rolname='adr002_migration_admin'
      AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option`).toEqual([{admin_memberships:1}]);
  });
});
