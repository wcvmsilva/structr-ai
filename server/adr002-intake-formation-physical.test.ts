/** Candidate only: real HTTP/ES256/owned PG17. Production allowlist stays closed. */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { access } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, sql as drizzleSql } from "drizzle-orm";
import { clients, projects, intakeForms } from "../drizzle/schema";
import { z } from "zod";
import { startAdr002Postgrest, type Adr002Postgrest } from "./test-support/adr002-postgrest";
import { formationCommand, formationToken, seedFormationIdentity, type FormationIdentity } from "./test-support/adr002-intake-formation-fixtures";

const direct = vi.hoisted(() => ({ db: undefined as any }));
vi.mock("./db", () => ({ getDb: async () => direct.db }));
import { createIntakeForm } from "./intake-db";
import { callAuthenticatedIntakeCreate } from "./authenticated-data-api";
import { decodeAuthenticatedIntakeCreate } from "./authenticated-intake-create";

const enabled = process.env.ADR002_PHYSICAL === "1" && process.env.ADR002_INTAKE_FORMATION === "1";
const rpc = "structr_intake_create_v1";
describe.skipIf(!enabled)("ADR002 candidate audited intake formation", () => {
  let lab: Adr002Postgrest, actor: FormationIdentity, token: string;
  beforeAll(async () => {
    if (process.env.ADR002_APPLY_BOUNDARY !== "1") throw new Error("Explicit owned boundary application required");
    lab = await startAdr002Postgrest({ applyMinimumReads: true, applyIntakeFormation: process.env.ADR002_INTAKE_APPLY === "1" });
    actor = await seedFormationIdentity(lab);
    token = await formationToken(lab, actor);
    direct.db = lab.cluster.observer.db;
  }, 90_000);
  afterAll(async () => {
    if (!lab) return;
    const directory = lab.cluster.directory;
    await lab.stop();
    await expect(access(directory)).rejects.toMatchObject({ code: "ENOENT" });
    console.log("ADR002_INTAKE_FORMATION_CLEANUP", JSON.stringify({ directory, removed: true }));
  }, 30_000);

  it("control: existing authenticated session verifies a genuine synthetic token", async () => {
    const result = await lab.rpc("structr_authenticated_session_v1", token);
    expect(result.status).toBe(200);
    expect(result.body.profile.id).toBe(actor.id);
  });

  it("creates one client, project and intake with three durable exact audits", async () => {
    const command = formationCommand(actor), preimage = JSON.stringify(command);
    const result = await lab.rpc(rpc, token, { preimage });
    expect(result.status).toBe(200);
    expect(result.body.version).toBe("structr-authenticated-intake-create-v1");
    expect(result.body.context).toEqual({ actorId: actor.id, tenantId: actor.tenant });
    expect(result.body.intake).toMatchObject({ id: command.requestId, tenantId: actor.tenant, status: "draft", leadId: null });
    const [project] = await lab.sql`SELECT * FROM public.projects WHERE id=${result.body.intake.projectId}`;
    expect(project).toMatchObject({ tenant_id: actor.tenant, owner_user_id: actor.id, status: "intake", provenance_state: "formation_only", city: null, state: null, estimated_total: null, actual_total: null, geocoded_at: null });
    const [client] = await lab.sql`SELECT * FROM public.clients WHERE id=${project.client_id}`;
    expect(client).toMatchObject({ tenant_id: actor.tenant, name: "Synthetic Customer", is_active: true });
    const audits = await lab.sql`SELECT action,record_id,new_values,old_values,user_id FROM public.audit_logs WHERE record_id IN (${client.id},${project.id},${command.requestId}) ORDER BY action`;
    expect(audits).toHaveLength(3);
    expect(audits.map(row => row.action)).toEqual(["client.create", "intake.create", "project.create"]);
    for (const audit of audits) {
      expect(audit.user_id).toBe(actor.id); expect(audit.old_values).toBeNull();
      expect(audit.new_values.id).toBe(audit.record_id);
      expect(audit.new_values.tenantId).toBe(actor.tenant);
      expect(audit.new_values.createdAt).toMatch(/^\d{4}-\d\d-\d\dT.*\.\d{3}Z$/);
    }
    expect(result.body.intake.formData.creationFingerprint).toBe(createHash("sha256").update(preimage).digest("hex"));
    expect(Object.keys(audits.find(row => row.action === "client.create")!.new_values)).toHaveLength(21);
    expect(Object.keys(audits.find(row => row.action === "project.create")!.new_values)).toHaveLength(55);
    expect(Object.keys(result.body.intake)).toHaveLength(8);
    const [clientReadback]=await lab.cluster.observer.db.select().from(clients).where(eq(clients.id,client.id));
    const [projectReadback]=await lab.cluster.observer.db.select().from(projects).where(eq(projects.id,project.id));
    const [intakeReadback]=await lab.cluster.observer.db.select().from(intakeForms).where(eq(intakeForms.id,command.requestId));
    for(const [action,row] of [["client.create",clientReadback],["project.create",projectReadback],["intake.create",intakeReadback]] as const){
      expect(audits.find(audit=>audit.action===action)!.new_values).toEqual(JSON.parse(JSON.stringify(row)));
    }
  });

  it("replays identical bytes without any extra entity or audit", async () => {
    const preimage = JSON.stringify(formationCommand(actor));
    const first = await lab.rpc(rpc, token, { preimage });
    expect(first.status).toBe(200);
    const before = await lab.sql`SELECT (SELECT count(*) FROM public.clients)::int AS clients,(SELECT count(*) FROM public.projects)::int AS projects,(SELECT count(*) FROM public.intake_forms)::int AS intakes,(SELECT count(*) FROM public.audit_logs)::int AS audits`;
    expect(await lab.rpc(rpc, token, { preimage })).toEqual(first);
    expect(await lab.sql`SELECT (SELECT count(*) FROM public.clients)::int AS clients,(SELECT count(*) FROM public.projects)::int AS projects,(SELECT count(*) FROM public.intake_forms)::int AS intakes,(SELECT count(*) FROM public.audit_logs)::int AS audits`).toEqual(before);
  });

  async function counts() {
    return lab.sql`SELECT (SELECT count(*) FROM public.clients)::int AS clients,(SELECT count(*) FROM public.projects)::int AS projects,(SELECT count(*) FROM public.intake_forms)::int AS intakes,(SELECT count(*) FROM public.audit_logs)::int AS audits`;
  }
  const invalid = "INTAKE_FORMATION_INPUT_INVALID";
  it.each([
    ["missing request", (c: any) => { delete c.requestId; }],
    ["existing target", (c: any) => { c.projectId = randomUUID(); }],
    ["invalid project type", (c: any) => { c.newProject.projectType = "renovation"; }],
    ["unknown authority", (c: any) => { c.ownerUserId = randomUUID(); }],
    ["untrimmed name", (c: any) => { c.newProject.name = " space "; }],
    ["null email", (c: any) => { c.newProject.client.email = null; }],
    ["bad email", (c: any) => { c.newProject.client.email = "a..b@example.test"; }],
    ["blank service", (c: any) => { c.serviceType = "\uFEFF\u00a0"; }],
    ["UTF16 state overflow", (c: any) => { c.newProject.state = "😀a"; }],
    ["invalid UUID version", (c: any) => { c.requestId = "10000000-0000-9000-8000-000000000001"; }],
    ["oversize UTF8", (c: any) => { c.notes = "é".repeat(32768); }],
    ["null scalar", (c: any) => { c.notes = "\u0000"; }],
    ["unpaired surrogate", (c: any) => { c.notes = "\uD800"; }],
    ["container depth", (c: any) => { let value: unknown = {}; for (let i=0;i<16;i++) value={ child:value }; c.rawPayload=value; }],
  ] as const)("rejects %s without any partial writes", async (_label, mutate) => {
    const command = formationCommand(actor); mutate(command);
    const before = await counts();
    const response = await lab.rpc(rpc, token, { preimage: JSON.stringify(command) });
    expect(response.body.message).toBe(invalid);
    expect(await counts()).toEqual(before);
  });

  it.each([
    '{"x":1,"x":2}', '{"x":{"a":1,"\\u0061":2}}', '{"x":[{"a":1,"a":2}]}',
  ])("rejects duplicate decoded keys recursively: %s", async raw => {
    const preimage = JSON.stringify(formationCommand(actor)).replace('"rawPayload":{"description":"Synthetic fixture only"}', `"rawPayload":${raw}`);
    const before = await counts();
    expect((await lab.rpc(rpc, token, { preimage })).body.message).toBe(invalid);
    expect(await counts()).toEqual(before);
  });

  it.each(["00000000-0000-0000-0000-000000000000", "ffffffff-ffff-ffff-ffff-ffffffffffff", "AABBCCDD-0000-4000-8000-000000000001"])("preserves accepted request UUID bytes %s", async requestId => {
    const preimage = JSON.stringify(formationCommand(actor, requestId));
    const result = await lab.rpc(rpc, token, { preimage });
    expect(result.status).toBe(200);
    expect(result.body.intake.id).toBe(requestId.toLowerCase());
    expect(result.body.intake.formData.creationFingerprint).toBe(createHash("sha256").update(preimage).digest("hex"));
  });

  it("returns evolved intake and does not demand the original project/client snapshots on replay", async () => {
    const command = formationCommand(actor), preimage = JSON.stringify(command);
    const first = await lab.rpc(rpc, token, { preimage }); expect(first.status).toBe(200);
    await lab.sql`UPDATE public.projects SET name='Legitimate later name',geocoded_address='Later geo' WHERE id=${first.body.intake.projectId}`;
    await lab.sql`UPDATE public.intake_forms SET status='reviewed',form_data=form_data || '{"notes":"later"}'::jsonb WHERE id=${command.requestId}`;
    const before = await counts(), replay = await lab.rpc(rpc, token, { preimage });
    expect(replay.status).toBe(200); expect(replay.body.intake.status).toBe("reviewed");
    expect(replay.body.intake.formData.notes).toBe("later"); expect(await counts()).toEqual(before);
  });

  it("conflicts on changed content and global other-tenant collisions without disclosing rows", async () => {
    const command = formationCommand(actor), first = await lab.rpc(rpc, token, { preimage: JSON.stringify(command) });
    expect(first.status).toBe(200); const before = await counts();
    const changed = await lab.rpc(rpc, token, { preimage: JSON.stringify({ ...command, notes: "different" }) });
    expect(changed.body.message).toBe("INTAKE_FORMATION_CONFLICT");
    const other = await seedFormationIdentity(lab), otherToken = await formationToken(lab, other);
    const collision = await lab.rpc(rpc, otherToken, { preimage: JSON.stringify(formationCommand(other, command.requestId)) });
    expect(collision.body.message).toBe("INTAKE_FORMATION_CONFLICT");
    expect(JSON.stringify(collision.body)).not.toContain(first.body.intake.projectId);
    expect(await counts()).toEqual(before);
  });

  it.each([
    ["client insert", "clients", "RAISE EXCEPTION 'fixture failure';"],
    ["project insert", "projects", "RAISE EXCEPTION 'fixture failure';"],
    ["intake insert", "intake_forms", "RAISE EXCEPTION 'fixture failure';"],
    ["first audit", "audit_logs", "IF NEW.action='client.create' THEN RAISE EXCEPTION 'fixture failure'; END IF;"],
    ["second audit", "audit_logs", "IF NEW.action='project.create' THEN RAISE EXCEPTION 'fixture failure'; END IF;"],
    ["third audit", "audit_logs", "IF NEW.action='intake.create' THEN RAISE EXCEPTION 'fixture failure'; END IF;"],
    ["suppressed audit", "audit_logs", "RETURN NULL;"],
    ["altered audit", "audit_logs", "NEW.new_values := '{}'::jsonb;"],
    ["null audit snapshot", "audit_logs", "NEW.new_values := NULL;"],
    ["null audit record", "audit_logs", "NEW.record_id := NULL;"],
    ["three client audits", "audit_logs", "IF NEW.action <> 'client.create' THEN SELECT record_id,new_values INTO NEW.record_id,NEW.new_values FROM public.audit_logs WHERE action='client.create' AND created_at=transaction_timestamp() LIMIT 1; NEW.action:='client.create'; NEW.table_name:='clients'; END IF;"],
    ["altered client", "clients", "NEW.name := 'inconsistent';"],
    ["unrelated unique failure", "audit_logs", "RAISE EXCEPTION 'same constraint name, different table' USING ERRCODE='23505',SCHEMA='public',TABLE='audit_logs',CONSTRAINT='intake_forms_pkey';"],
  ])("rolls every record back after %s", async (_label, table, action) => {
    const before = await counts();
    await lab.sql.unsafe(`CREATE FUNCTION public.formation_failure_probe() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN ${action} RETURN NEW; END $$;
      REVOKE ALL ON FUNCTION public.formation_failure_probe() FROM PUBLIC;
      CREATE TRIGGER formation_failure_probe BEFORE INSERT ON public.${table} FOR EACH ROW EXECUTE FUNCTION public.formation_failure_probe()`);
    try {
      const response = await lab.rpc(rpc, token, { preimage: JSON.stringify(formationCommand(actor)) });
      expect(response.body.message).toBe("INTAKE_FORMATION_INTEGRITY_VIOLATION");
      expect(await counts()).toEqual(before);
    } finally {
      await lab.sql.unsafe(`DROP TRIGGER formation_failure_probe ON public.${table}; DROP FUNCTION public.formation_failure_probe()`);
    }
  });

  it.each(["admin", "user", "formation_writer", "formation_reader"])("preserves tri-state client permission for %s", async role => {
    const identity = await seedFormationIdentity(lab, role);
    if (role.startsWith("formation_")) {
      const roleId = randomUUID(), permissionId = randomUUID();
      await lab.sql`INSERT INTO public.roles(id,name) VALUES(${roleId},${role})`;
      await lab.sql`INSERT INTO public.permissions(id,resource,action) VALUES(${permissionId},'client',${role === "formation_writer" ? "write" : "read"}) ON CONFLICT DO NOTHING`;
      const [permission] = await lab.sql`SELECT id FROM public.permissions WHERE resource='client' AND action=${role === "formation_writer" ? "write" : "read"}`;
      await lab.sql`INSERT INTO public.role_permissions(role_id,permission_id) VALUES(${roleId},${permission.id})`;
    }
    const response = await lab.rpc(rpc, await formationToken(lab, identity), { preimage: JSON.stringify(formationCommand(identity)) });
    expect(response.status).toBe(role === "formation_reader" ? 403 : 200);
  });

  it("rejects forged preimage identities and inactive organizational identity", async () => {
    const before = await counts(), identity = await seedFormationIdentity(lab);
    for (const change of [{ tenantId: identity.tenant }, { userId: identity.id }]) {
      expect((await lab.rpc(rpc, token, { preimage: JSON.stringify({ ...formationCommand(actor), ...change }) })).body.message).toBe("FORBIDDEN");
    }
    await lab.sql`UPDATE public.profiles SET is_active=false WHERE id=${identity.id}`;
    expect((await lab.rpc(rpc, await formationToken(lab, identity), { preimage: JSON.stringify(formationCommand(identity)) })).body.message).toBe("FORBIDDEN");
    expect(await counts()).toEqual(before);
  });

  it("keeps raw relations, private functions and owner role inaccessible to the API principal", async () => {
    for (const table of ["clients", "projects", "intake_forms", "audit_logs"]) {
      expect((await lab.request(`/${table}?select=id`, token, undefined, "GET")).status).toBeGreaterThanOrEqual(400);
    }
    expect((await lab.rpc("intake_create_v1", token, { preimage: JSON.stringify(formationCommand(actor)) })).status).toBeGreaterThanOrEqual(400);
    expect(await lab.sql`SELECT pg_has_role('authenticated','structr_intake_create_owner_v1','SET') AS can_set,has_schema_privilege('authenticated','structr_private','USAGE') AS private_usage`).toEqual([{ can_set: false, private_usage: false }]);
  });

  it("flushes a deferred audit trigger before final readback so late mutation rolls back", async () => {
    const before = await counts();
    await lab.sql.unsafe(`CREATE FUNCTION public.formation_deferred_probe() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
      IF NEW.action='project.create' THEN UPDATE public.projects SET name='late alteration' WHERE id=NEW.record_id; END IF; RETURN NEW; END $$;
      REVOKE ALL ON FUNCTION public.formation_deferred_probe() FROM PUBLIC;
      CREATE CONSTRAINT TRIGGER formation_deferred_probe AFTER INSERT ON public.audit_logs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.formation_deferred_probe()`);
    try {
      const result = await lab.rpc(rpc, token, { preimage: JSON.stringify(formationCommand(actor)) });
      expect(result.body.message).toBe("INTAKE_FORMATION_INTEGRITY_VIOLATION");
      expect(await counts()).toEqual(before);
    } finally {
      await lab.sql.unsafe("DROP TRIGGER formation_deferred_probe ON public.audit_logs; DROP FUNCTION public.formation_deferred_probe()");
    }
  });

  it.each(["ffffffff-ffff-ffff-ffff-ffffffffffff", "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF"])("matches installed Zod UUID acceptance for %s", async requestId => {
    const accepted = z.string().uuid().safeParse(requestId).success;
    const command = formationCommand(await seedFormationIdentity(lab), requestId);
    // Lowercase MAX already exists from the UUID vector: conflict proves validation passed.
    const identity = { ...actor, id: command.userId, tenant: command.tenantId };
    const [profile] = await lab.sql`SELECT external_open_id FROM public.profiles WHERE id=${identity.id}`;
    identity.sub=profile.external_open_id;
    const result = await lab.rpc(rpc, await formationToken(lab, identity), { preimage: JSON.stringify(command) });
    expect(result.body.message === "INTAKE_FORMATION_INPUT_INVALID").toBe(!accepted);
  });

  it.each(["direct-first", "rpc-first"])("preserves the exact legacy fingerprint across %s replay", async order => {
    const command = formationCommand(actor), { userId, ...data } = command;
    const preimage=JSON.stringify(command);
    if (order === "direct-first") {
      const original = await createIntakeForm(data, userId);
      const before=await counts(), result=await lab.rpc(rpc,token,{preimage});
      expect(result.status).toBe(200); expect(result.body.intake.id).toBe(original.id);
      expect(result.body.intake.formData).toEqual(original.formData); expect(await counts()).toEqual(before);
    } else {
      const original=await lab.rpc(rpc,token,{preimage}); expect(original.status).toBe(200);
      const before=await counts(), replay=await createIntakeForm(data,userId);
      expect(replay.id).toBe(original.body.intake.id); expect(replay.formData).toEqual(original.body.intake.formData);
      expect(await counts()).toEqual(before);
    }
  });

  async function waitForDatabaseWait(event: string) {
    for (let attempt=0;attempt<150;attempt++) {
      const [row] = await lab.sql`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE usename='authenticator' AND wait_event=${event}) AS waiting`;
      if (row.waiting) return;
      await new Promise(resolve => setTimeout(resolve,20));
    }
    throw new Error(`Real Data API lock wait ${event} was not observed`);
  }

  it("concurrent direct commit produces only the exact intake PK 40001, then full replay without orphan rows", async () => {
    const command=formationCommand(actor),preimage=JSON.stringify(command),supervisor=await lab.connectSupervisor();
    let release!:()=>void,locked!:()=>void;
    const ready=new Promise<void>(resolve=>{locked=resolve;}); const gate=new Promise<void>(resolve=>{release=resolve;});
    const before=await counts();
    const transaction=drizzle(supervisor).transaction(async tx=>{
      await tx.execute(drizzleSql`SELECT pg_advisory_xact_lock(hashtext(${actor.tenant}),hashtext(${command.requestId}))`);
      locked(); await gate;
      // Only the legacy fixture helper gets this supervisor transaction. HTTP JWT,
      // SQL authorization, locks and rollback are real and never mocked.
      direct.db={transaction:(operation:any)=>operation(tx)};
      try { const {userId,...data}=command; await createIntakeForm(data,userId); }
      finally { direct.db=lab.cluster.observer.db; }
    });
    await ready;
    const pending=lab.rpc(rpc,token,{preimage});
    try { await waitForDatabaseWait("advisory"); } finally { release(); }
    await transaction;
    const conflict=await pending;
    expect(conflict.body.code).toBe("40001");
    const after=await counts();
    expect(after[0]).toEqual({clients:before[0].clients+1,projects:before[0].projects+1,intakes:before[0].intakes+1,audits:before[0].audits+3});
    const replay=await lab.rpc(rpc,token,{preimage}); expect(replay.status).toBe(200);
    expect(await counts()).toEqual(after);
  });

  it("rejects token expiry after a real advisory wait without writing anything", async () => {
    const command=formationCommand(actor),preimage=JSON.stringify(command),supervisor=await lab.connectSupervisor();
    const expiry=Math.floor(Date.now()/1000)+2;
    const shortToken=await formationToken(lab,actor,{exp:expiry});
    let release!:()=>void,locked!:()=>void;
    const ready=new Promise<void>(resolve=>{locked=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
    const blocker=supervisor.begin(async tx=>{await tx`SELECT pg_advisory_xact_lock(hashtext(${actor.tenant}),hashtext(${command.requestId}))`;locked();await gate;});
    await ready; const before=await counts(), pending=lab.rpc(rpc,shortToken,{preimage});
    try { await waitForDatabaseWait("advisory"); await new Promise(resolve=>setTimeout(resolve,Math.max(0,expiry*1000-Date.now()+80))); }
    finally {release();}
    await blocker;
    expect((await pending).body.message).toBe("FORBIDDEN"); expect(await counts()).toEqual(before);
  });

  it("retries the whole transaction after concurrent profile revocation and denies the next attempt", async () => {
    const identity=await seedFormationIdentity(lab),bearer=await formationToken(lab,identity),preimage=JSON.stringify(formationCommand(identity));
    const supervisor=await lab.connectSupervisor();let release!:()=>void,locked!:()=>void;
    const ready=new Promise<void>(resolve=>{locked=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
    const blocker=supervisor.begin(async tx=>{await tx`UPDATE public.profiles SET is_active=false WHERE id=${identity.id}`;locked();await gate;});
    await ready;const before=await counts(),pending=lab.rpc(rpc,bearer,{preimage});
    try { await waitForDatabaseWait("transactionid"); } finally {release();}
    await blocker;expect((await pending).body.code).toBe("40001");
    expect((await lab.rpc(rpc,bearer,{preimage})).body.message).toBe("FORBIDDEN");expect(await counts()).toEqual(before);
  });

  it("a lost reply is replayable but current permission revocation still denies replay", async () => {
    const identity=await seedFormationIdentity(lab),bearer=await formationToken(lab,identity),preimage=JSON.stringify(formationCommand(identity));
    const committed=await lab.rpc(rpc,bearer,{preimage});expect(committed.status).toBe(200);
    const before=await counts();
    // The original response is deliberately not used to reconstruct the command.
    expect(await lab.rpc(rpc,bearer,{preimage})).toEqual(committed);expect(await counts()).toEqual(before);
    await lab.sql`UPDATE public.profiles SET is_active=false WHERE id=${identity.id}`;
    expect((await lab.rpc(rpc,bearer,{preimage})).body.message).toBe("FORBIDDEN");expect(await counts()).toEqual(before);
  });

  it("retries after a real client-write grant removal and denies the now read-only role", async () => {
    const role=`formation-concurrent-${randomUUID()}`,roleId=randomUUID();
    const identity=await seedFormationIdentity(lab,role),bearer=await formationToken(lab,identity),preimage=JSON.stringify(formationCommand(identity));
    await lab.sql`INSERT INTO public.roles(id,name) VALUES(${roleId},${role})`;
    const permissions=await lab.sql`SELECT id,action FROM public.permissions WHERE resource='client' AND action IN ('read','write')`;
    expect(permissions).toHaveLength(2);
    for(const permission of permissions) await lab.sql`INSERT INTO public.role_permissions(role_id,permission_id) VALUES(${roleId},${permission.id})`;
    const write=permissions.find(permission=>permission.action==='write')!;
    const supervisor=await lab.connectSupervisor();let release!:()=>void,locked!:()=>void;
    const ready=new Promise<void>(resolve=>{locked=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
    const blocker=supervisor.begin(async tx=>{await tx`DELETE FROM public.role_permissions WHERE role_id=${roleId} AND permission_id=${write.id}`;locked();await gate;});
    await ready;const before=await counts(),pending=lab.rpc(rpc,bearer,{preimage});
    try {await waitForDatabaseWait("transactionid");}finally{release();}
    await blocker;expect((await pending).body.code).toBe("40001");
    expect((await lab.rpc(rpc,bearer,{preimage})).body.message).toBe("FORBIDDEN");expect(await counts()).toEqual(before);
  });

  it("real Node transport handles a lost committed response through explicit replay and the real decoder", async () => {
    const identity=await seedFormationIdentity(lab),bearer=await formationToken(lab,identity);
    const {tenantId:_tenant,userId:_user,...command}=formationCommand(identity);
    const expected={actorId:identity.id,tenantId:identity.tenant},before=await counts();
    const nativeFetch=globalThis.fetch;let loseReply=true,calls=0;
    vi.stubEnv("STRUCTR_DATABASE_MODE","authenticated-data-api");vi.stubEnv("AUTH_PROVIDER","supabase");
    vi.stubEnv("TENANT_STRICT","true");vi.stubEnv("SUPABASE_URL","https://formation-lab.invalid");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY","sb_publishable_formation_lab");
    vi.stubGlobal("fetch",async (input: RequestInfo|URL,init?:RequestInit)=>{
      const url=String(input);expect(url).toBe("https://formation-lab.invalid/rest/v1/rpc/structr_intake_create_v1");calls++;
      const response=await nativeFetch(`${lab.baseUrl}/rpc/${rpc}`,init);
      if(loseReply&&response.ok){await response.text();throw new Error("Synthetic lost reply after real commit");}
      return response;
    });
    try {
      await expect(callAuthenticatedIntakeCreate({headers:{authorization:`Bearer ${bearer}`}},command,expected)).rejects.toMatchObject({kind:"unavailable"});
      expect(calls).toBe(1);const committed=await counts();
      expect(committed[0]).toEqual({clients:before[0].clients+1,projects:before[0].projects+1,intakes:before[0].intakes+1,audits:before[0].audits+3});
      loseReply=false;
      const raw=await callAuthenticatedIntakeCreate({headers:{authorization:`Bearer ${bearer}`}},command,expected);
      const decoded=decodeAuthenticatedIntakeCreate(raw,command,expected);
      expect(decoded.id).toBe(command.requestId);expect(decoded.createdAt).toBeInstanceOf(Date);
      expect(calls).toBe(2);expect(await counts()).toEqual(committed);
    } finally {vi.unstubAllGlobals();vi.unstubAllEnvs();}
  });

  it.each([65536,65537])("enforces the exact UTF8 preimage boundary at %i bytes", async bytes => {
    const command={...formationCommand(actor),notes:""};
    const available=bytes-Buffer.byteLength(JSON.stringify(command),"utf8");
    command.notes="é".repeat(Math.floor(available/2))+(available%2 ? "x" : "");
    const preimage=JSON.stringify(command);expect(Buffer.byteLength(preimage,"utf8")).toBe(bytes);
    const before=await counts(),result=await lab.rpc(rpc,token,{preimage});
    if(bytes===65536){expect(result.status).toBe(200);expect(result.body.intake.formData.notes).toBe(command.notes);}
    else {expect(result.body.message).toBe(invalid);expect(await counts()).toEqual(before);}
  });

  it.each([16,17])("counts only nested object/array containers at depth %i", async depth => {
    const command=formationCommand(actor);let raw:any={leaf:"value"};
    for(let i=0;i<depth-2;i++)raw=i===depth-3||i%2 ? {child:raw} : [raw];
    // The rawPayload itself is a record; root command plus this record count two.
    command.rawPayload=raw;
    const result=await lab.rpc(rpc,token,{preimage:JSON.stringify(command)});
    expect(result.status===200).toBe(depth===16);
    if(depth===17)expect(result.body.message).toBe(invalid);
  });

  it.each([
    ["name",255],["address",1000],["city",128],["county",128],["state",2],["zip",10],
  ] as const)("matches UTF16 limits for newProject.%s", async (field,maximum) => {
    for(const extra of [0,1]){
      const command=formationCommand(actor),value="😀".repeat(Math.floor(maximum/2))+"x".repeat(maximum%2+extra);
      Object.assign(command.newProject,{[field]:value});
      const result=await lab.rpc(rpc,token,{preimage:JSON.stringify(command)});
      expect(result.status===200).toBe(extra===0);
      if(extra)expect(result.body.message).toBe(invalid);
    }
  });

  it("rejects raw JSON numbers that overflow the response consumer before any write", async () => {
    for (const numeric of ["1e1000", "-1e1000", "1.7976931348623159e308", "-1.7976931348623159e308"]) {
      const preimage=JSON.stringify(formationCommand(actor)).replace('"rawPayload":{"description":"Synthetic fixture only"}',`"rawPayload":{"nested":[{"value":${numeric}}]}`);
      const before=await counts(), result=await lab.rpc(rpc,token,{preimage});
      expect(result.body.message).toBe(invalid);
      expect(await counts()).toEqual(before);
    }
  });

  it("preserves exact bytes for finite numeric boundaries without a safe-integer restriction", async () => {
    for (const numeric of ["1.7976931348623157e308", "-1.7976931348623157e308", "1.7976931348623158e308", "5e-324", "1e-1000", "9007199254740993"]) {
      const preimage=JSON.stringify(formationCommand(actor)).replace('"rawPayload":{"description":"Synthetic fixture only"}',`"rawPayload":{"value":${numeric}}`);
      const result=await lab.rpc(rpc,token,{preimage});
      expect(result.status).toBe(200);
      expect(Number.isFinite(result.body.intake.formData.rawPayload.value)).toBe(true);
      expect(result.body.intake.formData.creationFingerprint).toBe(createHash("sha256").update(preimage).digest("hex"));
      const before=await counts();
      expect(await lab.rpc(rpc,token,{preimage})).toEqual(result);
      expect(await counts()).toEqual(before);
    }
  });
});
