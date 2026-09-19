/**
 * Disposable PostgreSQL support for the G2 override-history proofs.
 *
 * Wraps the existing G2Point lifecycle (own cluster, private socket, no inherited
 * database configuration) and adds the parent/history tables this unit needs. It
 * never accepts a URL, data directory or existing service: the only reachable
 * database is the cluster this module creates and stops.
 *
 * Certified here: the real column set of profiles/projects/project_members/
 * scope_drafts/scope_draft_items/scope_override_log plus THREE local foreign keys
 * (draft→project CASCADE, history→draft CASCADE, history→rule SET NULL).
 * NOT certified: every other production foreign key, RLS, triggers, migrations and
 * operational seed behaviour — they are deliberately absent.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { getTableColumns, getTableName, is, sql, SQL, type Column, type Table } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type postgres from "postgres";
import {
  profiles, projects, projectMembers, scopeDrafts, scopeDraftItems, scopeOverrideLog,
} from "../../drizzle/schema";
import { startG2PointPostgres, type G2PointConnection, type G2PointPostgres } from "./g2-1-postgres";

/**
 * Binds one owned connection to the execution that is running, so two concurrent
 * operations never share a mutable global. Every `getDb()` inside `work` resolves to
 * this connection, including the code the production modules call.
 */
export const logConnection = new AsyncLocalStorage<G2PointConnection>();
export function onLogConnection<T>(connection: G2PointConnection, work: () => T): T {
  return logConnection.run(connection, work);
}

export type Latch = { promise: Promise<void>; resolve: () => void };
export function latch(): Latch {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

/** One capture/release pair used to schedule a real reader without changing its result. */
export type Pause = { captured: Latch; release: Latch };
export function pause(): Pause {
  return { captured: latch(), release: latch() };
}

/**
 * Waits until PostgreSQL itself reports the backend waiting on a lock. The oracle is
 * the server's own wait state, never elapsed time; exhausting the attempts is a
 * synchronization failure and is reported as such, not as a security result.
 */
export async function waitForLockWait(
  observer: G2PointConnection, pid: number, attempts = 200,
): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const [row] = await observer.sql<{ waitEventType: string | null }[]>`
      SELECT wait_event_type AS "waitEventType" FROM pg_stat_activity WHERE pid = ${pid}`;
    if (row?.waitEventType === "Lock") return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Backend ${pid} never reached a lock wait: synchronization failed`);
}

/** The local foreign keys actually present in the cluster, read from the catalog. */
export async function localForeignKeys(cluster: G2PointPostgres): Promise<string[]> {
  const rows = await cluster.observer.sql<{ definition: string }[]>`
    SELECT conrelid::regclass || ' ' || pg_get_constraintdef(oid) AS definition
    FROM pg_constraint WHERE contype = 'f' ORDER BY 1`;
  return Array.from(rows).map(row => row.definition);
}

/**
 * Renders a column default exactly as the schema declares it. A structural JSON default
 * (`jsonb` holding an array/object) has no SQL literal form in the generic path — it
 * compiles to an empty expression — so it is emitted as the equivalent JSON literal.
 * Anything that still fails to produce a literal is an error, never a silent omission.
 */
function defaultLiteral(column: Column, dialect: PgDialect): string {
  const type = column.getSQLType();
  const value = column.default;
  if ((type === "jsonb" || type === "json") && typeof value === "object" && value !== null && !is(value, SQL)) {
    return "'" + JSON.stringify(value).replaceAll("'", "''") + "'::" + type;
  }
  const compiled = dialect.sqlToQuery(sql`${value}`.inlineParams());
  if (compiled.params.length !== 0 || compiled.sql.trim() === "" || compiled.sql.trim() === "()") {
    throw new Error("Unresolved fixture default: " + column.name);
  }
  return compiled.sql;
}

function tableDDL(table: Table): string {
  const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"';
  const dialect = new PgDialect();
  const columns = Object.values(getTableColumns(table)).map(column => {
    if (column.defaultFn) throw new Error("Unsupported runtime default: " + column.name);
    const definition = [quote(column.name), column.getSQLType(), column.primary ? "PRIMARY KEY" : "", column.notNull ? "NOT NULL" : ""];
    if (column.default !== undefined) definition.push("DEFAULT " + defaultLiteral(column, dialect));
    return definition.filter(Boolean).join(" ");
  });
  return "CREATE TABLE " + quote(getTableName(table)) + " (" + columns.join(", ") + ")";
}

export const LOG_HARNESS_TABLES = [profiles, projects, projectMembers, scopeDrafts, scopeDraftItems, scopeOverrideLog] as const;

/** Opt-in twice: the G2Point flag plus this unit's own flag. */
export async function startG2LogPostgres(factory: typeof postgres): Promise<G2PointPostgres> {
  if (process.env.G2_LOGS_POSTGRES !== "1") throw new Error("Explicit local log test opt-in required");
  const cluster = await startG2PointPostgres(factory);
  try {
    for (const table of LOG_HARNESS_TABLES) {
      await cluster.observer.sql.unsafe(tableDDL(table));
    }
    // Only the parent/history chain this unit reasons about. Everything else the real
    // schema declares (tenants, assemblies, cost codes, intake, geo zones) is absent.
    await cluster.observer.sql.unsafe(`
      ALTER TABLE scope_drafts ADD CONSTRAINT log_draft_project_fk
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
      ALTER TABLE scope_override_log ADD CONSTRAINT log_history_draft_fk
        FOREIGN KEY (scope_draft_id) REFERENCES scope_drafts(id) ON DELETE CASCADE;
      ALTER TABLE scope_override_log ADD CONSTRAINT log_history_rule_fk
        FOREIGN KEY (override_id) REFERENCES geographic_overrides(id) ON DELETE SET NULL`);
    return cluster;
  } catch (error) {
    // Only this wrapper's own cluster is stopped; nothing else is touched.
    await cluster.stop();
    throw error;
  }
}

export type { G2PointConnection, G2PointPostgres };
