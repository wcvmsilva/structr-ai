/** Separate fixed maintenance candidate. No connection creation, runner, or approval.
 * The caller supplies the separately confirmed actual postgres connection. */
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { logAudit } from "../../server/audit";
import approved from "../../docs/security/financial-executor/database-temp-containment-plan.json";
import { canonical } from "./contract";
type Row = { identity: string; definition: Record<string, any> };
const hash = (v: string) => createHash("sha256").update(v).digest("hex");
function snapshot(observation: { surface: Row[] }): Row[] {
  return observation.surface
    .filter(
      r =>
        r.identity === "database:postgres" ||
        /^(role|membership|effective-database):/.test(r.identity)
    )
    .map(r => {
      const definition = structuredClone(r.definition);
      if (r.identity === "database:postgres") {
        definition.acl?.sort();
        definition.effectiveAcl?.sort();
      }
      return { identity: r.identity, definition };
    })
    .sort((a, b) =>
      Buffer.compare(Buffer.from(a.identity), Buffer.from(b.identity))
    );
}
export async function applyCalculatorDatabaseTempContainment(
  db: PostgresJsDatabase,
  operationId: string
): Promise<string> {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      operationId
    )
  )
    throw new Error("TEMP_OPERATION_ID");
  const ddl = await readFile(
    new URL("./database-temp-containment.sql", import.meta.url),
    "utf8"
  );
  if (hash(ddl) !== approved.sourceSha256) throw new Error("TEMP_SOURCE_DRIFT");
  const collector = await readFile(
    new URL("./compatibility-inspect.sql", import.meta.url),
    "utf8"
  );
  return db.transaction(
    async tx => {
      await tx.execute(
        sql.raw(
          "SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='5s'; SET LOCAL search_path=pg_catalog"
        )
      );
      await tx.execute(sql`SELECT pg_advisory_xact_lock(173721,20261011)`);
      const [principal] = (await tx.execute(
        sql`SELECT current_user,session_user,current_database() AS database,current_setting('server_version_num') AS version`
      )) as any;
      if (
        principal.current_user !== "postgres" ||
        principal.session_user !== "postgres" ||
        principal.database !== "postgres" ||
        principal.version !== "170011"
      )
        throw new Error("TEMP_PRINCIPAL");
      const observe = async () =>
        snapshot(
          (
            (await tx.execute(
              sql.raw(collector.slice(collector.indexOf(";") + 1))
            )) as any
          )[0].observation
        );
      const before = await observe();
      if (canonical(before) !== canonical(approved.before))
        throw new Error("TEMP_BEFORE_DRIFT");
      await tx.execute(sql.raw(ddl));
      const after = await observe();
      if (canonical(after) !== canonical(approved.after))
        throw new Error("TEMP_AFTER_DRIFT");
      const params = {
        userId: null,
        action: "financial.homologation.database-temp-contained",
        tableName: "pg_database",
        recordId: operationId,
        before: { snapshot: before, sha256: hash(canonical(before)) },
        after: {
          snapshot: after,
          sha256: hash(canonical(after)),
          sourceSha256: approved.sourceSha256,
          administrativeActor: principal,
        },
      };
      // Drizzle audit table is unqualified: resolve public before any temp schema.
      await tx.execute(
        sql.raw("SET LOCAL search_path=pg_catalog,public,pg_temp")
      );
      const audit = await logAudit(params, tx);
      await tx.execute(sql.raw("SET LOCAL search_path=pg_catalog"));
      if (!audit) throw new Error("TEMP_AUDIT_MISSING");
      const [read] = (await tx.execute(
        sql`SELECT user_id,action,table_name,record_id,old_values,new_values FROM public.audit_logs WHERE id=${audit.id}::uuid`
      )) as any;
      if (
        !read ||
        read.user_id !== null ||
        read.action !== params.action ||
        read.table_name !== params.tableName ||
        read.record_id !== operationId ||
        canonical(read.old_values) !== canonical(params.before) ||
        canonical(read.new_values) !== canonical(params.after)
      )
        throw new Error("TEMP_AUDIT_MISMATCH");
      return audit.id;
    },
    { isolationLevel: "serializable" }
  );
}
