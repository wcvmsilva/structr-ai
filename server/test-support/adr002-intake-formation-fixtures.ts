/** Synthetic owned-lab formation fixtures. No hosted Auth or financial fixtures. */
import { randomUUID } from "node:crypto";
import type { Adr002Postgrest } from "./adr002-postgrest";

export type FormationIdentity = { id: string; tenant: string; sub: string; session: string };

export async function seedFormationIdentity(lab: Adr002Postgrest, role = "user", tenant = randomUUID()): Promise<FormationIdentity> {
  const identity = { id: randomUUID(), tenant, sub: randomUUID(), session: randomUUID() };
  await lab.sql`INSERT INTO public.tenants(id,name,slug,is_active)
    VALUES(${tenant},'Synthetic formation organization',${`formation-${tenant}`},true) ON CONFLICT(id) DO NOTHING`;
  await lab.sql`INSERT INTO public.profiles(id,tenant_id,external_open_id,full_name,role,is_active)
    VALUES(${identity.id},${tenant},${identity.sub},'Synthetic formation operator',${role},true)`;
  return identity;
}

/** Property order mirrors the existing router's validated command, then its helper's identity. */
export function formationCommand(identity: FormationIdentity, requestId = randomUUID()) {
  return {
    requestId,
    newProject: {
      name: "Synthetic formation", projectType: "repair",
      client: { firstName: "Synthetic", lastName: "Customer" },
      address: "1 Synthetic Formation Lane",
    },
    serviceType: "repair",
    rawPayload: { description: "Synthetic fixture only" },
    tenantId: identity.tenant, userId: identity.id,
  };
}

export function formationPreimage(identity: FormationIdentity, changes: Record<string, unknown> = {}) {
  return JSON.stringify({ ...formationCommand(identity), ...changes });
}

export async function formationToken(lab: Adr002Postgrest, identity: FormationIdentity, claims: Record<string, unknown> = {}) {
  return lab.token({ sub: identity.sub, session_id: identity.session, ...claims });
}
