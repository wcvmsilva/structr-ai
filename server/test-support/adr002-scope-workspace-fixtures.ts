/** Synthetic fixtures confined to the owned PostgreSQL/PostgREST laboratory. */
import { randomUUID } from "node:crypto";
import type { Adr002Postgrest } from "./adr002-postgrest";
import { seedFormationIdentity, type FormationIdentity } from "./adr002-intake-formation-fixtures";

export async function seedScopePair(lab: Adr002Postgrest, actor?: FormationIdentity, metadata: unknown = {
  serviceType: "repair", area: " 120 sqft ", finishLevel: "standard", condition: "existing", channel: "direct", notes: "Synthetic only",
  rawPayload: { projectId: randomUUID() }, creationFingerprint: "not-authority",
}) {
  actor ??= await seedFormationIdentity(lab);
  const command = { projectId: randomUUID(), intakeFormId: randomUUID() };
  await lab.sql`INSERT INTO public.projects(id,tenant_id,owner_user_id,name,project_type,status,channel,address,city,state,zip,county,zone)
    VALUES(${command.projectId},${actor.tenant},${actor.id},'Synthetic scope pair','repair','intake','direct','1 Synthetic Lane','Charleston','SC','29401','Charleston','stored-zone')`;
  await lab.sql`INSERT INTO public.intake_forms(id,tenant_id,project_id,status,form_data,created_at,updated_at)
    VALUES(${command.intakeFormId},${actor.tenant},${command.projectId},'draft',${JSON.stringify(metadata)}::jsonb,
      '2026-10-09 01:02:03.123456+00','2026-10-09 02:03:04.987654+00')`;
  return { actor, command };
}

export async function seedScopeMembership(lab: Adr002Postgrest, actor: FormationIdentity, projectId: string,
  options: { tenant?: string; active?: boolean | null; role?: string; permissions?: unknown } = {}) {
  const id = randomUUID();
  await lab.sql`INSERT INTO public.project_members(id,tenant_id,project_id,user_id,project_role,permissions,is_active)
    VALUES(${id},${options.tenant ?? actor.tenant},${projectId},${actor.id},${options.role ?? "viewer"},
      ${options.permissions === undefined ? null : JSON.stringify(options.permissions)}::jsonb,${options.active === undefined ? true : options.active})`;
  return id;
}

/** Database JSON preserves every physical column, including timestamp microseconds. */
export async function scopePhysicalSnapshot(lab: Adr002Postgrest) {
  const result: Record<string, unknown> = {};
  const tables = await lab.sql`SELECT n.nspname AS schema,c.relname AS name FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relkind='r' AND n.nspname IN ('public','structr_private') ORDER BY n.nspname,c.relname`;
  for (const table of tables) {
    const [row] = await lab.sql`SELECT COALESCE(jsonb_agg(value ORDER BY value::text),'[]'::jsonb) AS rows
      FROM (SELECT to_jsonb(t) AS value FROM ${lab.sql(`${table.schema}.${table.name}`)} t) s`;
    result[`${table.schema}.${table.name}`] = row.rows;
  }
  return result;
}
