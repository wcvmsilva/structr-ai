import type postgres from "postgres";
import { assertOwnedProfileAclConnection } from "./profile-acl-postgres";

/** Stable, synthetic UUIDs only; no catalog/user identifiers are copied. */
export const PROFILE_ACL_IDS = {
  tenantA: "10000000-0000-4000-8000-000000000001",
  tenantB: "10000000-0000-4000-8000-000000000002",
  userA: "20000000-0000-4000-8000-000000000001",
  userB: "20000000-0000-4000-8000-000000000002",
  adminA: "20000000-0000-4000-8000-000000000003",
  inactiveA: "20000000-0000-4000-8000-000000000004",
  unprovisioned: "20000000-0000-4000-8000-000000000005",
  differentExternal: "20000000-0000-4000-8000-000000000006",
} as const;

type ObserverSql = ReturnType<typeof postgres>;

async function assertOwnedFixtureConnection(observerSql: ObserverSql): Promise<void> {
  const owned = assertOwnedProfileAclConnection(observerSql);
  if (observerSql.options.user !== "postgres") throw new Error("Profile ACL fixture requires the owner connection");
  if (process.env.PROFILE_ACL_LAB !== "1") throw new Error("Profile ACL fixture requires PROFILE_ACL_LAB=1");
  const [identity] = await observerSql<{
    host: string | null; database: string; role: string; session_role: string;
    nonce: string; port: string; listeners: string;
  }[]>`
    SELECT inet_server_addr()::text AS host, current_database() AS database,
      current_user AS role, session_user AS session_role,
      current_setting('profile_acl_lab.nonce', true) AS nonce,
      current_setting('port') AS port, current_setting('listen_addresses') AS listeners`;
  if (!identity || identity.host !== null || identity.database !== "postgres" ||
      identity.role !== "postgres" || identity.session_role !== "postgres" ||
      identity.nonce !== owned.nonce ||
      identity.port !== "55441" || identity.listeners !== "") {
    throw new Error("Profile ACL fixture refuses a connection outside the owned laboratory");
  }
}

/**
 * Baseline only: catalog columns, nullability, named FK/PK constraints, policies,
 * and the three exact catalog function definitions. Catalog evidence did not
 * include column defaults/index definitions; those below follow local Drizzle.
 * auth.users/tenants are deliberately minimal real FK targets, not Auth mocks.
 * No auto_confirm_users_trigger or on_auth_user_created: signup decisions remain
 * pending, and all fixture profile provisioning is explicit synthetic insertion.
 */
export async function initializeProfileAclFixture(observerSql: ObserverSql): Promise<void> {
  await assertOwnedFixtureConnection(observerSql);
  await observerSql.begin(async transaction => {
    await transaction.unsafe(`
      CREATE SCHEMA auth AUTHORIZATION postgres;
      CREATE TABLE auth.users (id uuid PRIMARY KEY);
      CREATE TABLE public.tenants (id uuid PRIMARY KEY);
      CREATE TABLE public.profiles (
        id uuid NOT NULL DEFAULT gen_random_uuid(),
        full_name text,
        company_name text,
        role text DEFAULT 'user',
        created_at timestamp with time zone NOT NULL DEFAULT now(),
        updated_at timestamp with time zone NOT NULL DEFAULT now(),
        external_open_id text,
        tenant_id uuid,
        email text,
        login_method text,
        is_active boolean NOT NULL DEFAULT true,
        last_signed_in timestamp with time zone,
        CONSTRAINT profiles_pkey PRIMARY KEY (id),
        CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE,
        CONSTRAINT profiles_tenant_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT
      );
      CREATE UNIQUE INDEX uq_profiles_external_open_id ON public.profiles (external_open_id);
      CREATE INDEX idx_profiles_tenant ON public.profiles (tenant_id);
      CREATE INDEX idx_profiles_email ON public.profiles (email);

      -- SQL stand-in for auth.uid(): only claim extraction is modeled. No JWT
      -- signature/session validation occurs here; existing unit suites own that.
      -- Absent GUC, empty GUC, absent sub and empty sub all safely yield NULL.
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $uid$
        SELECT NULLIF(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid;
      $uid$;
      GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
      GRANT EXECUTE ON FUNCTION auth.uid() TO PUBLIC;
      ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
      CREATE POLICY "Users can create own profile" ON public.profiles
        FOR INSERT TO PUBLIC WITH CHECK (auth.uid() = id);
      CREATE POLICY "Users can update own profile" ON public.profiles
        FOR UPDATE TO PUBLIC USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
      CREATE POLICY "Users can view own profile" ON public.profiles
        FOR SELECT TO PUBLIC USING (auth.uid() = id);
      GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO anon, authenticated, service_role;
    `);
    await transaction.unsafe("CREATE OR REPLACE FUNCTION public.get_current_user_role()\n RETURNS text\n LANGUAGE sql\n STABLE SECURITY DEFINER\n SET search_path TO 'public'\nAS $function$\n  SELECT COALESCE(role, 'user') FROM public.profiles WHERE id = auth.uid();\n$function$\n");
    await transaction.unsafe("CREATE OR REPLACE FUNCTION public.is_admin()\n RETURNS boolean\n LANGUAGE sql\n STABLE SECURITY DEFINER\n SET search_path TO 'public'\nAS $function$\n  SELECT EXISTS (\n    SELECT 1 FROM public.profiles \n    WHERE id = auth.uid() AND role = 'admin'\n  );\n$function$\n");
    await transaction.unsafe("CREATE OR REPLACE FUNCTION public.setup_admin_user()\n RETURNS void\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'public'\nAS $function$\nBEGIN\n    -- Atualizar perfil do usuário atual para admin\n    INSERT INTO public.profiles (id, role)\n    VALUES (auth.uid(), 'admin')\n    ON CONFLICT (id) \n    DO UPDATE SET role = 'admin', updated_at = now()\n    WHERE profiles.role != 'admin';\nEND;\n$function$\n");
    // Saved public-schema default function ACLs explicitly grant these roles.
    // Per-function evidence records effective EXECUTE, not each individual proacl.
    // Preserve service_role's independent grant when candidate ACLs remove PUBLIC.
    await transaction.unsafe(`
      GRANT EXECUTE ON FUNCTION public.get_current_user_role(), public.is_admin(), public.setup_admin_user()
        TO anon, authenticated, service_role;
    `);
    // Default function EXECUTE for PUBLIC intentionally preserves baseline exposure.
    // Explicit ownership also guards against future initializer-role refactors.
    await transaction.unsafe(`
      ALTER TABLE auth.users OWNER TO postgres;
      ALTER TABLE public.tenants OWNER TO postgres;
      ALTER TABLE public.profiles OWNER TO postgres;
      ALTER FUNCTION auth.uid() OWNER TO postgres;
      ALTER FUNCTION public.get_current_user_role() OWNER TO postgres;
      ALTER FUNCTION public.is_admin() OWNER TO postgres;
      ALTER FUNCTION public.setup_admin_user() OWNER TO postgres;
    `);
  });
  await resetProfileAclFixture(observerSql);
}

/** Reset data only: candidate table/column/function ACLs, functions and policies survive. */
export async function resetProfileAclFixture(observerSql: ObserverSql): Promise<void> {
  await assertOwnedFixtureConnection(observerSql);
  const ids = PROFILE_ACL_IDS;
  await observerSql.begin(async transaction => {
    await transaction.unsafe("TRUNCATE TABLE public.profiles, auth.users, public.tenants");
    await transaction.unsafe("INSERT INTO public.tenants (id) VALUES ($1), ($2)", [ids.tenantA, ids.tenantB]);
    await transaction.unsafe("INSERT INTO auth.users (id) VALUES ($1), ($2), ($3), ($4), ($5), ($6)",
      [ids.userA, ids.userB, ids.adminA, ids.inactiveA, ids.unprovisioned, ids.differentExternal]);
    await transaction.unsafe(`INSERT INTO public.profiles
      (id, external_open_id, tenant_id, role, is_active, full_name, company_name, email, login_method)
      VALUES
      ($1::uuid, $1::text, $5, 'user', true, 'Lab User A', 'Lab A', 'user-a@example.invalid', 'lab'),
      ($2::uuid, $2::text, $6, 'user', true, 'Lab User B', 'Lab B', 'user-b@example.invalid', 'lab'),
      ($3::uuid, $3::text, $5, 'admin', true, 'Lab Admin A', 'Lab A', 'admin-a@example.invalid', 'lab'),
      ($4::uuid, $4::text, $5, 'user', false, 'Lab Inactive A', 'Lab A', 'inactive-a@example.invalid', 'lab')`,
      [ids.userA, ids.userB, ids.adminA, ids.inactiveA, ids.tenantA, ids.tenantB]);
  });
}
